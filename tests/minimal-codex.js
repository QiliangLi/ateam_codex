#!/usr/bin/env node

const { spawn } = require('child_process');

const prompt = process.argv[2];

if (!prompt) {
  console.error('用法: node minimal-codex.js "你的问题"');
  process.exit(1);
}

const codex = spawn('codex', [
  'exec',
  '--json',
  '--skip-git-repo-check',
  prompt
], {
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe']
});

let buffer = '';

codex.stdout.on('data', (chunk) => {
  buffer += chunk.toString();

  const lines = buffer.split('\n');
  buffer = lines.pop();

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const data = JSON.parse(line);
      parseCodexEvent(data);
    } catch (e) {
      // 忽略解析失败的行
    }
  }
});

function parseCodexEvent(data) {
  switch (data.type) {
    case 'item.completed':
      // agent_message 类型：文本直接在 item.text
      if (data.item?.type === 'agent_message') {
        process.stdout.write(data.item.text || '');
      }
      break;

    default:
      break;
  }
}

codex.stderr.on('data', () => {
  // 静默处理 stderr
});

codex.on('error', (err) => {
  console.error('启动失败:', err.message);
  process.exit(1);
});

codex.on('close', (code) => {
  if (buffer.trim()) {
    try {
      const data = JSON.parse(buffer);
      parseCodexEvent(data);
    } catch (e) {}
  }

  process.stdout.write('\n');
  process.exit(code);
});
