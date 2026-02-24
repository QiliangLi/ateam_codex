const path = require('path');
const { spawn } = require('child_process');
const { registerWorklist, unregisterWorklist, enqueueA2ATargets, markExecuted } = require('./a2a-registry');
const { buildMcpCallbackInstructions } = require('./mcp-prompt');
const { getCatConfig, CAT_CONFIGS } = require('./cats');

const DEFAULT_MAX_DEPTH = Number(process.env.MAX_A2A_DEPTH) || 15;
const CALLBACK_MARKER = 'CAT_CAFE_POST_MESSAGE';
const CALLBACK_SPLIT_REGEX = /CAT\s*\n\s*_CAFE_POST_MESSAGE/g;

function buildA2AMentionInstructions() {
  return '可用艾特：@opus，@codex，@gemini。仅在需要对方回复时才使用 @，并且把 @ 放在新的一行行首。请只使用这些可识别的 @ 名称。';
}

function extractCallbackMessages(text) {
  if (!text) return { cleanText: '', messages: [] };
  const normalized = text.replace(CALLBACK_SPLIT_REGEX, CALLBACK_MARKER);
  const lines = normalized.split('\n');
  const messages = [];
  const kept = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(CALLBACK_MARKER)) {
      kept.push(line);
      continue;
    }
    const payloadText = trimmed.slice(CALLBACK_MARKER.length).trim();
    if (!payloadText) continue;
    try {
      const payload = JSON.parse(payloadText);
      if (payload && typeof payload.content === 'string' && payload.content.trim()) {
        messages.push({
          content: payload.content,
          threadId: payload.threadId
        });
      }
    } catch (e) {
      kept.push(line);
    }
  }

  return { cleanText: kept.join('\n'), messages };
}

function filterCallbackOutput(chunk) {
  if (!chunk) return chunk;
  if (!chunk.includes(CALLBACK_MARKER) && !chunk.includes('_CAFE_POST_MESSAGE') && chunk.trim() !== 'CAT') {
    return chunk;
  }
  const normalized = chunk.replace(CALLBACK_SPLIT_REGEX, CALLBACK_MARKER);
  const lines = normalized.split('\n');
  const remove = new Set();

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === 'CAT' && i + 1 < lines.length && lines[i + 1].includes('_CAFE_POST_MESSAGE')) {
      remove.add(i);
      remove.add(i + 1);
      continue;
    }
    if (!lines[i].includes(CALLBACK_MARKER)) continue;
    remove.add(i);
    if (i > 0 && lines[i - 1].trim() === '```') remove.add(i - 1);
    if (i + 1 < lines.length && lines[i + 1].trim() === '```') remove.add(i + 1);
  }

  const kept = lines.filter((_, index) => !remove.has(index));
  return kept.join('\n');
}

async function postCallbackMessage(options, catId, content, threadId) {
  if (!options.apiUrl || !options.invocationId || !options.callbackToken) return;
  const res = await fetch(`${options.apiUrl}/api/callbacks/post-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      invocationId: options.invocationId,
      callbackToken: options.callbackToken,
      threadId: threadId || options.threadId,
      catId,
      content
    })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`callback post-message failed: ${res.status} ${text}`);
  }
}

function parseNdjson(stream, onEvent) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        onEvent(JSON.parse(line));
      } catch (e) {}
    }
  });
  stream.on('end', () => {
    if (buffer.trim()) {
      try {
        onEvent(JSON.parse(buffer));
      } catch (e) {}
    }
  });
}

function parseCliEvent(cli, data) {
  if (cli === 'claude') {
    if (data.type === 'assistant' && data.message?.content) {
      return data.message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
    }
    return '';
  }

  if (cli === 'codex') {
    if (data.type === 'item.completed' && data.item?.type === 'agent_message') {
      return data.item.text || '';
    }
    if (data.type === 'item.completed' && data.item?.type === 'assistant_message') {
      return data.item.text || '';
    }
    return '';
  }

  if (cli === 'gemini') {
    if (data.type === 'message' && data.role === 'assistant' && data.content) {
      return data.content;
    }
    return '';
  }

  return '';
}

function invokeCat(catId, prompt, options) {
  const config = getCatConfig(catId);
  if (!config) throw new Error(`Unknown cat: ${catId}`);

  const env = {
    ...process.env,
    CAT_CAFE_API_URL: options.apiUrl,
    CAT_CAFE_INVOCATION_ID: options.invocationId,
    CAT_CAFE_CALLBACK_TOKEN: options.callbackToken,
    CAT_CAFE_THREAD_ID: options.threadId,
    CAT_CAFE_CAT_ID: catId
  };

  let command = config.cli;
  let args = [];

  if (config.cli === 'claude') {
    args = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];
    if (options.mcpServerPath) {
      args.push('--mcp-config', JSON.stringify({
        mcpServers: {
          'cat-cafe': {
            command: 'node',
            args: [options.mcpServerPath]
          }
        }
      }));
    }
  } else if (config.cli === 'codex') {
    args = ['exec', '--json', '--skip-git-repo-check', prompt];
  } else if (config.cli === 'gemini') {
    const model = options.geminiModel || process.env.CAT_CAFE_GEMINI_MODEL || 'gemini-2.5-flash-lite';
    args = ['-p', prompt, '--output-format', 'stream-json', '-m', model];
  }

  const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });

  return new Promise((resolve, reject) => {
    let text = '';
    let stderr = '';

    parseNdjson(child.stdout, (data) => {
      const chunk = parseCliEvent(config.cli, data);
      if (chunk) {
        text += chunk;
        if (typeof options.onOutput === 'function') {
          const filtered = filterCallbackOutput(chunk);
          if (filtered && filtered.trim()) {
            options.onOutput({ type: 'cli', catId, text: filtered });
          }
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      reject(new Error(`${catId} failed to spawn: ${err.message}`));
    });
    child.on('close', (code) => {
      if (code === 0) return resolve(text);
      const detail = stderr.trim();
      if (detail) {
        reject(new Error(`${catId} exited with code ${code}. stderr: ${detail}`));
        return;
      }
      reject(new Error(`${catId} exited with code ${code}`));
    });
  });
}

async function routeSerial(worklist, options) {
  registerWorklist(options.threadId, worklist);

  try {
    for (let i = 0; i < worklist.length; i++) {
      const catId = worklist[i];
      const config = getCatConfig(catId);
      if (!config) continue;

      const shouldInject = config.cli !== 'claude' && options.apiUrl;
      const injected = shouldInject
        ? buildMcpCallbackInstructions({
            apiUrl: options.apiUrl,
            threadId: options.threadId,
            catId
          })
        : '';

      const mentionGuide = buildA2AMentionInstructions();
      const fullPrompt = [mentionGuide, injected, options.prompt].filter(Boolean).join('\n\n');
      const responseText = await invokeCat(catId, fullPrompt, options);
      markExecuted(options.threadId, catId);
      const { cleanText, messages } = extractCallbackMessages(responseText);

      for (const message of messages) {
        await postCallbackMessage(options, catId, message.content, message.threadId);
      }

      enqueueA2ATargets(options.threadId, cleanText, catId, {
        mode: 'agent',
        maxTargets: 2,
        allowRequeueExecuted: true,
        maxRequeuePerCat: 1
      });
    }
  } finally {
    unregisterWorklist(options.threadId);
  }
}

function getDefaultMcpServerPath() {
  return process.env.CAT_CAFE_MCP_SERVER || path.join(process.cwd(), 'cat-cafe-mcp.js');
}

module.exports = {
  routeSerial,
  getDefaultMcpServerPath
};
