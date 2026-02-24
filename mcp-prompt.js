function buildMcpCallbackInstructions(options) {
  const apiUrl = options.apiUrl;
  const threadId = options.threadId || '$CAT_CAFE_THREAD_ID';
  const catId = options.catId || '$CAT_CAFE_CAT_ID';

  return `## 可用工具 (HTTP 回调)

你可以通过 HTTP 请求使用以下工具来与团队协作。
凭证已通过环境变量提供: $CAT_CAFE_INVOCATION_ID 和 $CAT_CAFE_CALLBACK_TOKEN。

可用艾特：@opus，@codex，@gemini。仅在需要对方回复时才使用 @，并把 @ 放在新的一行行首。请只使用以上可识别的 @ 名称。

### 发送消息给团队
\`\`\`bash
curl -X POST ${apiUrl}/api/callbacks/post-message \\
  -H "Content-Type: application/json" \\
  -d "{
    \\"invocationId\\": \\"$CAT_CAFE_INVOCATION_ID\\",
    \\"callbackToken\\": \\"$CAT_CAFE_CALLBACK_TOKEN\\",
    \\"threadId\\": \\"${threadId}\\",
    \\"catId\\": \\"${catId}\\",
    \\"content\\": \\"你的消息（可包含 @布偶猫/@缅因猫/@暹罗猫）\\"
  }"
\`\`\`

如果无法执行 shell 命令（例如没有 curl 权限），请改用以下单行输出格式：

\`\`\`
CAT_CAFE_POST_MESSAGE {"content":"你的消息（可包含 @布偶猫/@缅因猫/@暹罗猫）","threadId":"${threadId}"}
\`\`\`

### 获取对话上下文
\`\`\`bash
curl "${apiUrl}/api/callbacks/thread-context?invocationId=$CAT_CAFE_INVOCATION_ID&callbackToken=$CAT_CAFE_CALLBACK_TOKEN&threadId=${threadId}"
\`\`\`
`;
}

module.exports = {
  buildMcpCallbackInstructions
};
