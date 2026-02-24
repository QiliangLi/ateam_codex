#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { randomUUID } = require('crypto');
const { enqueueA2ATargets } = require('./a2a-registry');
const { routeSerial, getDefaultMcpServerPath } = require('./a2a-router');
const { listCatIds } = require('./cats');
const { writeIoLog } = require('./io-logger');

const PORT = Number(process.env.CAT_CAFE_PORT || 3200);
const WEB_DIR = path.join(process.cwd(), 'web');

const invocationId = randomUUID();
const callbackToken = randomUUID();

const threadMessages = new Map();
const sseClients = new Set();
const activeThreads = new Set();

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
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function validateToken(payload) {
  return payload.invocationId === invocationId && payload.callbackToken === callbackToken;
}

function pushEvent(threadId, event) {
  writeIoLog('chat.output', { threadId, event });
  const payload = JSON.stringify(event);
  for (const client of sseClients) {
    if (client.threadId !== threadId) continue;
    client.res.write(`data: ${payload}\n\n`);
  }
}

function serveStatic(req, res) {
  const parsed = url.parse(req.url);
  const pathname = parsed.pathname === '/' ? '/index.html' : parsed.pathname;
  const filePath = path.join(WEB_DIR, pathname);
  if (!filePath.startsWith(WEB_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return true;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return false;
  }
  const ext = path.extname(filePath);
  const type = ext === '.css' ? 'text/css' : ext === '.js' ? 'text/javascript' : 'text/html';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

async function handleRun(payload) {
  const threadId = payload.threadId || 'default';
  if (activeThreads.has(threadId)) {
    pushEvent(threadId, { type: 'system', message: '当前 thread 正在执行中，请稍后再试。' });
    return;
  }

  const cats = Array.isArray(payload.cats) && payload.cats.length
    ? payload.cats
    : ['opus'];

  activeThreads.add(threadId);
  pushEvent(threadId, { type: 'system', message: `开始执行: ${cats.join(', ')}` });

  try {
    await routeSerial([...cats], {
      prompt: payload.prompt || '',
      threadId,
      apiUrl: `http://localhost:${PORT}`,
      invocationId,
      callbackToken,
      mcpServerPath: getDefaultMcpServerPath(),
      onOutput: (event) => {
        if (event.type === 'cli') {
          pushEvent(threadId, { type: 'cli', catId: event.catId, text: event.text });
        }
      }
    });
    pushEvent(threadId, { type: 'system', message: '执行完成。' });
  } catch (err) {
    pushEvent(threadId, { type: 'system', message: `执行失败: ${err.message}` });
  } finally {
    activeThreads.delete(threadId);
  }
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  if (req.method === 'GET' && pathname.startsWith('/api/stream')) {
    const threadId = parsedUrl.query.threadId || 'default';
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    res.write('\n');
    const client = { res, threadId };
    sseClients.add(client);
    req.on('close', () => {
      sseClients.delete(client);
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/bootstrap') {
    writeIoLog('chat.input.bootstrap', { path: pathname });
    return sendJson(res, 200, {
      apiUrl: `http://localhost:${PORT}`,
      invocationId,
      callbackToken,
      cats: listCatIds()
    });
  }

  if (req.method === 'POST' && pathname === '/api/run') {
    const raw = await readBody(req);
    let payload = null;
    try {
      payload = JSON.parse(raw || '{}');
    } catch (e) {
      return sendJson(res, 400, { error: 'invalid_json' });
    }
    writeIoLog('chat.input.run', { threadId: payload.threadId || 'default', payload });
    sendJson(res, 200, { status: 'queued' });
    void handleRun(payload);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/callbacks/post-message') {
    const raw = await readBody(req);
    let payload = null;
    try {
      payload = JSON.parse(raw || '{}');
    } catch (e) {
      return sendJson(res, 400, { error: 'invalid_json' });
    }

    writeIoLog('chat.input.callback', { payload });

    if (!validateToken(payload)) {
      return sendJson(res, 401, { error: 'unauthorized' });
    }

    const threadId = payload.threadId || 'default';
    const catId = payload.catId || 'unknown';
    const content = payload.content || '';

    const messages = getThreadMessages(threadId);
    messages.push({ role: catId, content, ts: Date.now() });
    pushEvent(threadId, { type: 'message', catId, content });

    const mentions = enqueueA2ATargets(threadId, content, catId, {
      mode: 'agent',
      maxTargets: 2,
      allowRequeueExecuted: true,
      maxRequeuePerCat: 1
    });
    if (mentions.length > 0) {
      pushEvent(threadId, { type: 'system', message: `A2A 入队: ${mentions.join(', ')}` });
    }

    return sendJson(res, 200, { status: 'ok' });
  }

  if (req.method === 'GET' && pathname === '/api/callbacks/thread-context') {
    const query = parsedUrl.query || {};
    const payload = {
      invocationId: query.invocationId,
      callbackToken: query.callbackToken
    };

    writeIoLog('chat.input.callback', { payload });

    if (!validateToken(payload)) {
      return sendJson(res, 401, { error: 'unauthorized' });
    }

    const threadId = query.threadId || 'default';
    const messages = getThreadMessages(threadId);
    return sendJson(res, 200, { messages });
  }

  if (serveStatic(req, res)) return;
  sendJson(res, 404, { error: 'not_found' });
});

server.listen(PORT, () => {
  console.log(`Chat server listening on :${PORT}`);
  console.log(`invocationId: ${invocationId}`);
  console.log(`callbackToken: ${callbackToken}`);
});
