#!/usr/bin/env node

const { spawn } = require('child_process');

// 解析参数
const args = process.argv.slice(2);
let model = 'gemini-2.5-flash-lite';  // 默认使用 flash-lite（最快）
let prompt = '';

for (const arg of args) {
  if (arg.startsWith('-m=')) {
    model = arg.slice(3);
  } else if (arg === '-m' || arg === '--model') {
    // 跳过，下一个参数是模型名
    continue;
  } else if (!prompt && args[args.indexOf(arg) - 1] !== '-m' && args[args.indexOf(arg) - 1] !== '--model') {
    prompt = arg;
  } else if (args[args.indexOf(arg) - 1] === '-m' || args[args.indexOf(arg) - 1] === '--model') {
    model = arg;
  }
}

if (!prompt) {
  console.error('用法: node minimal-gemini.js "你的问题" [-m model]');
  console.error('');
  console.error('可用模型:');
  console.error('  gemini-2.5-pro        (最强)');
  console.error('  gemini-2.5-flash      (默认，平衡)');
  console.error('  gemini-2.5-flash-lite (最快)');
  process.exit(1);
}

const gemini = spawn('gemini', [
  '-p', prompt,
  '--output-format', 'stream-json',
  '-m', model
], {
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe']
});

let buffer = '';

gemini.stdout.on('data', (chunk) => {
  buffer += chunk.toString();

  const lines = buffer.split('\n');
  buffer = lines.pop();

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const data = JSON.parse(line);
      parseGeminiEvent(data);
    } catch (e) {
      // 忽略解析失败的行
    }
  }
});

function parseGeminiEvent(data) {
  if (data.type === 'message' && data.role === 'assistant' && data.content) {
    process.stdout.write(data.content);
  }
}

gemini.stderr.on('data', () => {
  // 静默处理 stderr
});

gemini.on('error', (err) => {
  console.error('启动失败:', err.message);
  process.exit(1);
});

gemini.on('close', (code) => {
  if (buffer.trim()) {
    try {
      const data = JSON.parse(buffer);
      parseGeminiEvent(data);
    } catch (e) {}
  }

  process.stdout.write('\n');
  process.exit(code);
});
