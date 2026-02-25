#!/bin/bash

# 测试 ai-cli.js 的 resume 功能（Claude、Codex、Gemini）

echo "=== 测试 AI CLI Resume 功能 ==="

# 清理旧的 session 文件
rm -rf .sessions

test_cli() {
  local cli=$1
  local test_num=$2

  echo ""
  echo "=== 测试 $cli ==="

  echo ""
  echo "1. 第一次对话（新 session）..."
  node ai-cli.js $cli "告诉我一个数字，比如$test_num，记住它"

  echo ""
  echo "2. 检查 session 文件是否创建..."
  if [ -f ".sessions/$cli-session.json" ]; then
    echo "✓ Session 文件已创建"
    cat .sessions/$cli-session.json
  else
    echo "✗ Session 文件未创建"
    return 1
  fi

  echo ""
  echo "3. 使用 --resume 继续对话..."
  node ai-cli.js $cli "我刚才让你记住的数字是多少？" --resume

  echo ""
  echo "✓ $cli 测试完成"
}

# 测试 Codex
test_cli "codex" "42"

# 测试 Gemini
test_cli "gemini" "99"

# 测试 Claude
test_cli "claude" "88"

echo ""
echo "=== 所有测试完成 ==="
