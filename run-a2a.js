#!/usr/bin/env node

const { routeSerial, getDefaultMcpServerPath } = require('./a2a-router');
const { listCatIds } = require('./cats');

function parseArgs(argv) {
  const args = [...argv];
  const opts = {
    cats: [],
    threadId: 'default',
    prompt: ''
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--cats' && args[i + 1]) {
      opts.cats = args[i + 1].split(',').map((s) => s.trim()).filter(Boolean);
      i += 1;
      continue;
    }
    if (arg === '--thread' && args[i + 1]) {
      opts.threadId = args[i + 1];
      i += 1;
      continue;
    }
    if (!arg.startsWith('-') && !opts.prompt) {
      opts.prompt = arg;
      continue;
    }
  }

  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.prompt) {
    console.error('用法: node run-a2a.js --cats opus,codex,gemini --thread demo "你的问题"');
    console.error('可用 cats:', listCatIds().join(', '));
    process.exit(1);
  }

  if (opts.cats.length === 0) {
    opts.cats = ['opus'];
  }

  const apiUrl = process.env.CAT_CAFE_API_URL || 'http://localhost:3200';
  const invocationId = process.env.CAT_CAFE_INVOCATION_ID;
  const callbackToken = process.env.CAT_CAFE_CALLBACK_TOKEN;

  if (!invocationId || !callbackToken) {
    console.error('缺少回传凭证：请先启动 callback-server.js 并设置 CAT_CAFE_INVOCATION_ID / CAT_CAFE_CALLBACK_TOKEN');
    process.exit(1);
  }

  await routeSerial([...opts.cats], {
    prompt: opts.prompt,
    threadId: opts.threadId,
    apiUrl,
    invocationId,
    callbackToken,
    mcpServerPath: getDefaultMcpServerPath(),
    onOutput: (event) => {
      if (event.type === 'cli') {
        process.stdout.write(`[${event.catId}] ${event.text}`);
      }
    }
  });
  process.stdout.write('\n');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
