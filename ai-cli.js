#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_KILL_GRACE_MS = 5000; // 5 seconds
const DEFAULT_RETRY_DELAY_MS = 500; // 0.5 seconds

// Session 存储目录（当前工作目录下的 .sessions 文件夹）
const SESSION_DIR = path.join(process.cwd(), '.sessions');

// 确保 session 目录存在
function ensureSessionDir() {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }
}

// 获取 session 文件路径
function getSessionFilePath(cli) {
  return path.join(SESSION_DIR, `${cli}-session.json`);
}

// 保存 session
function saveSession(cli, sessionId) {
  ensureSessionDir();
  const sessionFile = getSessionFilePath(cli);
  fs.writeFileSync(sessionFile, JSON.stringify({ sessionId, updatedAt: Date.now() }, null, 2));
}

// 读取 session
function loadSession(cli) {
  const sessionFile = getSessionFilePath(cli);
  if (fs.existsSync(sessionFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
      return data.sessionId;
    } catch (e) {
      return null;
    }
  }
  return null;
}

function parseDurationToMs(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const text = String(value).trim();
  if (!text) return null;
  const match = text.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = (match[2] || 's').toLowerCase();
  switch (unit) {
    case 'ms':
      return amount;
    case 's':
      return amount * 1000;
    case 'm':
      return amount * 60 * 1000;
    case 'h':
      return amount * 60 * 60 * 1000;
    default:
      return null;
  }
}

/**
 * 调用 AI CLI 并返回流式文本
 * @param {'claude' | 'codex' | 'gemini'} cli - CLI 类型
 * @param {string} prompt - 提示词
 * @param {object} options - 可选配置
 * @param {string} options.model - 模型名称
 * @param {boolean} options.resume - 是否继续上次对话
 * @param {number} options.timeoutMs - 超时时间（毫秒），0 表示不超时
 * @param {number} options.killGraceMs - 超时/中断后的优雅退出等待时间
 * @param {boolean} options.attachSignalHandlers - 是否在当前进程上挂载信号处理
 * @param {number} options.retries - 重试次数
 * @param {number} options.retryDelayMs - 重试间隔（毫秒）
 * @returns {Promise<string>} - 返回完整响应文本
 */
async function invoke(cli, prompt, options = {}) {
  const maxRetries = options.retries == null ? 0 : Math.max(0, Number(options.retries) || 0);
  const retryDelayMs = options.retryDelayMs == null ? DEFAULT_RETRY_DELAY_MS : options.retryDelayMs;

  const runAttempt = (attempt) => new Promise((resolve, reject) => {
    const config = getCliConfig(cli, prompt, options);
    const args = typeof config.args === 'function' ? config.args() : config.args;
    const child = spawn(config.command, args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32'
    });

    const timeoutMs = options.timeoutMs == null ? DEFAULT_TIMEOUT_MS : options.timeoutMs;
    const killGraceMs = options.killGraceMs == null ? DEFAULT_KILL_GRACE_MS : options.killGraceMs;

    let buffer = '';
    let output = '';
    let stderrBuffer = '';
    let stderrLines = [];
    let ended = false;
    let timedOut = false;
    let terminationReason = null;
    let killTimer = null;
    let timeoutTimer = null;
    let lastActivity = Date.now();
    let cliError = null;

    function refreshActivity() {
      lastActivity = Date.now();
    }

    function recordStderr(chunk) {
      stderrBuffer += chunk.toString();
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        stderrLines.push(line);
        if (stderrLines.length > 20) stderrLines.shift();
      }
    }

    function killProcessTree(signal) {
      if (child.killed) return;
      if (process.platform !== 'win32' && child.pid) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch (e) {
          // fall back to direct kill
        }
      }
      try {
        child.kill(signal);
      } catch (e) {}
    }

    function requestTerminate(reason) {
      if (ended) return;
      if (!terminationReason) terminationReason = reason;
      if (child.killed) return;
      killProcessTree('SIGTERM');
      if (killGraceMs > 0 && !killTimer) {
        killTimer = setTimeout(() => {
          if (!child.killed) {
            killProcessTree('SIGKILL');
          }
        }, killGraceMs);
      }
    }

    function cleanupTimers() {
      if (timeoutTimer) clearInterval(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
    }

    function attachSignalHandlers() {
      const signals = ['SIGINT', 'SIGTERM'];
      const handlers = new Map();
      for (const signal of signals) {
        const handler = () => {
          requestTerminate(`parent-${signal}`);
        };
        handlers.set(signal, handler);
        process.on(signal, handler);
      }
      const exitHandler = () => {
        if (!child.killed) {
          killProcessTree('SIGTERM');
        }
      };
      process.on('exit', exitHandler);
      return () => {
        for (const [signal, handler] of handlers) {
          process.off(signal, handler);
        }
        process.off('exit', exitHandler);
      };
    }

    const detachSignalHandlers = options.attachSignalHandlers ? attachSignalHandlers() : () => {};

    if (timeoutMs > 0) {
      timeoutTimer = setInterval(() => {
        if (Date.now() - lastActivity > timeoutMs) {
          timedOut = true;
          requestTerminate('timeout');
        }
      }, 1000);
    }

    child.stdout.on('data', (chunk) => {
      refreshActivity();
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          const result = config.parse(data);
          if (result?.error) cliError = result.error;
          if (result?.text) {
            output += result.text;
            process.stdout.write(result.text); // 流式输出
          }
        } catch (e) {
          // 忽略解析失败的行
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      refreshActivity(); // stderr 也是活跃信号
      recordStderr(chunk);
    });

    child.on('error', (err) => {
      cleanupTimers();
      detachSignalHandlers();
      const error = new Error(`启动失败: ${err.message}`);
      error.retryable = true;
      error.code = 'spawn';
      reject(error);
    });

    child.on('close', (code) => {
      ended = true;
      cleanupTimers();
      detachSignalHandlers();

      if (stderrBuffer.trim()) {
        stderrLines.push(stderrBuffer.trim());
        if (stderrLines.length > 20) stderrLines.shift();
      }

      // 处理剩余 buffer
      if (buffer.trim()) {
        try {
          const data = JSON.parse(buffer);
          const result = config.parse(data);
          if (result?.error) cliError = result.error;
          if (result?.text) {
            output += result.text;
            process.stdout.write(result.text);
          }
        } catch (e) {}
      }

      if (timedOut) {
        const error = new Error(`进程超时 (${Math.round(timeoutMs / 1000)}s)，已中止`);
        error.retryable = true;
        error.code = 'timeout';
        return reject(error);
      }

      if (code === 0) {
        resolve(output);
      } else {
        const reason = terminationReason ? `，原因: ${terminationReason}` : '';
        const stderrTail = stderrLines.length ? `\n--- stderr (last ${stderrLines.length} lines) ---\n${stderrLines.join('\n')}` : '';
        const cliMsg = cliError ? `\n--- cli error ---\n${cliError}` : '';
        const error = new Error(`进程退出码: ${code}${reason}${cliMsg}${stderrTail}`);
        error.retryable = true;
        error.code = 'exit';
        reject(error);
      }
    });
  });

  const attemptRun = async (attempt) => {
    try {
      return await runAttempt(attempt);
    } catch (err) {
      const retryable = err && err.retryable;
      if (retryable && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, retryDelayMs));
        return attemptRun(attempt + 1);
      }
      throw err;
    }
  };

  return attemptRun(0);
}

/**
 * 获取 CLI 配置
 */
function getCliConfig(cli, prompt, options) {
  const configs = {
    claude: {
      command: 'claude',
      args: () => {
        const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];
        if (options.resume) {
          const sessionId = loadSession('claude');
          if (sessionId) {
            args.push('--resume', sessionId);
          }
        }
        return args;
      },
      parse: (data) => {
        // 捕获 session_id（在 system init 事件中）
        if (data.type === 'system' && data.subtype === 'init' && data.session_id) {
          saveSession('claude', data.session_id);
        }
        if (data.type === 'result' && data.subtype === 'error') {
          const message = data.error?.message || data.message || 'Claude CLI error';
          return { error: message, text: '' };
        }
        if (data.type === 'assistant' && data.message?.content) {
          const text = data.message.content
            .filter(block => block.type === 'text')
            .map(block => block.text)
            .join('');
          return { text };
        }
        return null;
      }
    },

    codex: {
      command: 'codex',
      args: () => {
        const model = options.model || 'gpt-5.2-codex';

        // 如果 resume 且存在 session，使用 resume 子命令
        if (options.resume) {
          const sessionId = loadSession('codex');
          if (sessionId) {
            return ['exec', 'resume', '--json', '--skip-git-repo-check', '-m', model, sessionId, prompt];
          }
        }

        // 正常新对话
        return ['exec', '--json', '--skip-git-repo-check', '-m', model, prompt];
      },
      parse: (data) => {
        if (data.type === 'item.completed' && data.item?.type === 'agent_message') {
          return { text: data.item.text || '' };
        }
        if (data.type === 'item.completed' && data.item?.type === 'assistant_message') {
          return { text: data.item.text || '' };
        }
        // 捕获 thread_id（codex 用 thread_id 而不是 session_id）
        if (data.type === 'thread.started' && data.thread_id) {
          saveSession('codex', data.thread_id);
        }
        return null;
      }
    },

    gemini: {
      command: 'gemini',
      args: () => {
        const args = [
          '-p', prompt,
          '--output-format', 'stream-json',
          '-m', options.model || 'gemini-2.5-pro'  // 使用 pro 模型，因为 flash-lite 的 resume 功能有问题
        ];
        if (options.resume) {
          const sessionId = loadSession('gemini');
          if (sessionId) {
            // gemini 使用 "latest" 恢复最近会话，不支持直接用 session_id
            args.push('--resume', 'latest');
          }
        }
        return args;
      },
      parse: (data) => {
        // 捕获 session_id（在 init 事件中）
        if (data.type === 'init' && data.session_id) {
          saveSession('gemini', data.session_id);
        }
        if (data.type === 'message' && data.role === 'assistant' && data.content) {
          return { text: data.content };
        }
        return null;
      }
    }
  };

  const config = configs[cli];
  if (!config) {
    throw new Error(`不支持的 CLI: ${cli}，可用: claude, codex, gemini`);
  }

  return config;
}

// CLI 入口
if (require.main === module) {
  const args = process.argv.slice(2);
  const cli = args[0];
  const prompt = args[1];
  const options = {};

  // 解析 -m 参数（模型）
  const modelFlagIndex = args.indexOf('-m');
  if (modelFlagIndex !== -1 && args[modelFlagIndex + 1]) {
    options.model = args[modelFlagIndex + 1];
  }

  // 解析 --resume 参数（继续上次对话）
  if (args.includes('--resume')) {
    options.resume = true;
  }

  // 解析 --timeout 参数（默认单位秒，支持 ms/s/m/h）
  const timeoutFlagIndex = args.indexOf('--timeout');
  if (timeoutFlagIndex !== -1 && args[timeoutFlagIndex + 1]) {
    const parsed = parseDurationToMs(args[timeoutFlagIndex + 1]);
    if (parsed != null) {
      options.timeoutMs = parsed;
    }
  }

  // 解析 --no-timeout
  if (args.includes('--no-timeout')) {
    options.timeoutMs = 0;
  }

  // 解析 --kill-grace 参数（优雅退出等待时间）
  const killGraceFlagIndex = args.indexOf('--kill-grace');
  if (killGraceFlagIndex !== -1 && args[killGraceFlagIndex + 1]) {
    const parsed = parseDurationToMs(args[killGraceFlagIndex + 1]);
    if (parsed != null) {
      options.killGraceMs = parsed;
    }
  }

  // 解析 --retry 参数（重试次数）
  const retryFlagIndex = args.indexOf('--retry');
  if (retryFlagIndex !== -1 && args[retryFlagIndex + 1]) {
    const parsed = Number(args[retryFlagIndex + 1]);
    if (Number.isFinite(parsed)) {
      options.retries = Math.max(0, Math.floor(parsed));
    }
  }

  // 解析 --retry-delay 参数（重试间隔）
  const retryDelayFlagIndex = args.indexOf('--retry-delay');
  if (retryDelayFlagIndex !== -1 && args[retryDelayFlagIndex + 1]) {
    const parsed = parseDurationToMs(args[retryDelayFlagIndex + 1]);
    if (parsed != null) {
      options.retryDelayMs = parsed;
    }
  }

  if (!cli || !prompt) {
    console.error('用法: node ai-cli.js <claude|codex|gemini> "你的问题" [-m model] [--resume]');
    console.error('');
    console.error('参数:');
    console.error('  -m <model>    指定模型');
    console.error('  --resume      继续上次对话');
    console.error('  --timeout <d> 超时时间（默认 30m，支持 10s/5m/1h）');
    console.error('  --no-timeout  关闭超时');
    console.error('  --kill-grace <d> 退出等待时间（默认 5s）');
    console.error('  --retry <n>   重试次数（默认 0）');
    console.error('  --retry-delay <d> 重试间隔（默认 500ms）');
    console.error('');
    console.error('默认模型:');
    console.error('  codex:  gpt-5.2-codex');
    console.error('  gemini: gemini-2.5-pro');
    console.error('');
    console.error('示例:');
    console.error('  node ai-cli.js claude "你好"');
    console.error('  node ai-cli.js claude "继续刚才的问题" --resume');
    console.error('  node ai-cli.js codex "你好"');
    console.error('  node ai-cli.js codex "继续刚才的问题" --resume');
    console.error('  node ai-cli.js gemini "你好" -m gemini-2.5-pro');
    console.error('  node ai-cli.js gemini "继续刚才的问题" --resume');
    process.exit(1);
  }

  options.attachSignalHandlers = true;

  invoke(cli, prompt, options)
    .then(() => {
      process.stdout.write('\n');
    })
    .catch((err) => {
      console.error('\n错误:', err.message);
      process.exit(1);
    });
}

module.exports = { invoke };
