#!/usr/bin/env node

const http = require('http');
const { randomUUID } = require('crypto');
const url = require('url');
const { enqueueA2ATargets } = require('./a2a-registry');

const PORT = Number(process.env.CAT_CAFE_CALLBACK_PORT || 3200);

const invocationId = randomUUID();
const callbackToken = randomUUID();

const threadMessages = new Map();

function getThreadMessages(threadId) {
  if (!threadMessages.has(threadId)) {
    threadMessages.set(threadId, []);
  }
  return threadMessages.get(threadId);
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      resolve(body);
    });
    req.on('error', reject);
  });
}

function validateToken(payload) {
  return payload.invocationId === invocationId && payload.callbackToken === callbackToken;
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  if (req.method === 'POST' && pathname === '/api/callbacks/post-message') {
    const raw = await readBody(req);
    let payload = null;
    try {
      payload = JSON.parse(raw || '{}');
    } catch (e) {
      return sendJson(res, 400, { error: 'invalid_json' });
    }

    if (!validateToken(payload)) {
      return sendJson(res, 401, { error: 'unauthorized' });
    }

    const threadId = payload.threadId || 'default';
    const catId = payload.catId || 'unknown';
    const content = payload.content || '';

    const messages = getThreadMessages(threadId);
    messages.push({ role: catId, content, ts: Date.now() });

    console.log(`[callback] ${threadId} ${catId}: ${content}`);

    const mentions = enqueueA2ATargets(threadId, content, catId);
    if (mentions.length > 0) {
      console.log(`[a2a] enqueue from callback -> ${mentions.join(', ')}`);
    }

    return sendJson(res, 200, { status: 'ok' });
  }

  if (req.method === 'GET' && pathname === '/api/callbacks/thread-context') {
    const query = parsedUrl.query || {};
    const payload = {
      invocationId: query.invocationId,
      callbackToken: query.callbackToken
    };

    if (!validateToken(payload)) {
      return sendJson(res, 401, { error: 'unauthorized' });
    }

    const threadId = query.threadId || 'default';
    const messages = getThreadMessages(threadId);
    return sendJson(res, 200, { messages });
  }

  sendJson(res, 404, { error: 'not_found' });
});

server.listen(PORT, () => {
  console.log(`Server listening on :${PORT}`);
  console.log(`invocationId: ${invocationId}`);
  console.log(`callbackToken: ${callbackToken}`);
});
