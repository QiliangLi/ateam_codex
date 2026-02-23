const path = require('path');
const { spawn } = require('child_process');
const { registerWorklist, unregisterWorklist, enqueueA2ATargets } = require('./a2a-registry');
const { buildMcpCallbackInstructions } = require('./mcp-prompt');
const { getCatConfig } = require('./cats');

const DEFAULT_MAX_DEPTH = Number(process.env.MAX_A2A_DEPTH) || 15;

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
    args = ['-p', prompt, '--output-format', 'stream-json', '-m', options.geminiModel || 'gemini-2.5-pro'];
  }

  const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });

  return new Promise((resolve, reject) => {
    let text = '';

    parseNdjson(child.stdout, (data) => {
      const chunk = parseCliEvent(config.cli, data);
      if (chunk) {
        text += chunk;
        if (typeof options.onOutput === 'function') {
          options.onOutput({ type: 'cli', catId, text: chunk });
        }
      }
    });

    child.stderr.on('data', () => {});
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) return resolve(text);
      reject(new Error(`${catId} exited with code ${code}`));
    });
  });
}

async function routeSerial(worklist, options) {
  const maxDepth = options.maxDepth || DEFAULT_MAX_DEPTH;
  registerWorklist(options.threadId, worklist);
  let a2aCount = 0;

  try {
    for (let i = 0; i < worklist.length && a2aCount < maxDepth; i++) {
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

      const fullPrompt = injected ? `${injected}\n\n${options.prompt}` : options.prompt;
      const responseText = await invokeCat(catId, fullPrompt, options);

      const mentions = enqueueA2ATargets(options.threadId, responseText, catId);
      if (mentions.length > 0) {
        a2aCount += mentions.length;
      }
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
