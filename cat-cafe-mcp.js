#!/usr/bin/env node

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

function getCallbackConfig() {
  const apiUrl = process.env.CAT_CAFE_API_URL;
  const invocationId = process.env.CAT_CAFE_INVOCATION_ID;
  const callbackToken = process.env.CAT_CAFE_CALLBACK_TOKEN;
  const threadId = process.env.CAT_CAFE_THREAD_ID || 'default';
  const catId = process.env.CAT_CAFE_CAT_ID || 'opus';
  if (!apiUrl || !invocationId || !callbackToken) return null;
  return { apiUrl, invocationId, callbackToken, threadId, catId };
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json().catch(() => ({}));
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

async function main() {
  const server = new McpServer({
    name: 'cat-cafe-mcp',
    version: '0.1.0'
  });

  server.tool('cat_cafe_post_message', { content: 'string' }, async ({ content }) => {
    const cfg = getCallbackConfig();
    if (!cfg) {
      throw new Error('Missing callback env vars.');
    }
    await postJson(`${cfg.apiUrl}/api/callbacks/post-message`, {
      invocationId: cfg.invocationId,
      callbackToken: cfg.callbackToken,
      threadId: cfg.threadId,
      catId: cfg.catId,
      content: content || ''
    });
    return { ok: true };
  });

  server.tool('cat_cafe_get_context', {}, async () => {
    const cfg = getCallbackConfig();
    if (!cfg) {
      throw new Error('Missing callback env vars.');
    }
    const url = `${cfg.apiUrl}/api/callbacks/thread-context?invocationId=${cfg.invocationId}&callbackToken=${cfg.callbackToken}&threadId=${cfg.threadId}`;
    const data = await getJson(url);
    return data;
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
