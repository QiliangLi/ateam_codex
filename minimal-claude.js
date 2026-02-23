#!/usr/bin/env node

const { spawn } = require('child_process');

const prompt = process.argv[2];

if (!prompt) {
  console.error('用法: node minimal-claude.js "你的问题"');
  process.exit(1);
}

const claude = spawn('claude', [
  '-p', prompt,
  '--output-format', 'stream-json',
  '--verbose'
], {
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe']
});

let buffer = '';

claude.stdout.on('data', (chunk) => {
  buffer += chunk.toString();

  const lines = buffer.split('\n');
  buffer = lines.pop();

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const data = JSON.parse(line);

      if (data.type === 'assistant' && data.message?.content) {
        for (const block of data.message.content) {
          if (block.type === 'text') {
            process.stdout.write(block.text);
          }
        }
      }
    } catch (e) {
      // 忽略解析失败的行
    }
  }
});

claude.stderr.on('data', () => {
  // 静默处理 stderr
});

claude.on('error', (err) => {
  console.error('启动失败:', err.message);
  process.exit(1);
});

claude.on('close', (code) => {
  // 处理 buffer 中剩余的内容
  if (buffer.trim()) {
    try {
      const data = JSON.parse(buffer);
      if (data.type === 'assistant' && data.message?.content) {
        for (const block of data.message.content) {
          if (block.type === 'text') {
            process.stdout.write(block.text);
          }
        }
      }
    } catch (e) {}
  }

  process.stdout.write('\n');
  process.exit(code);
});
