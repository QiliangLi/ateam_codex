const fs = require('fs');
const path = require('path');
const os = require('os');
const { randomUUID } = require('crypto');

const LOG_DIR = path.join(process.cwd(), 'logs');
const MESSAGE_LOG_DIR = path.join(LOG_DIR, 'messages');
const activeRunByThread = new Map();

function ensureLogDir() {
  if (fs.existsSync(LOG_DIR)) return;
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function ensureMessageLogDir() {
  if (fs.existsSync(MESSAGE_LOG_DIR)) return;
  fs.mkdirSync(MESSAGE_LOG_DIR, { recursive: true });
}

function getLogFilePath() {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `${date}.log`);
}

function sanitizeFileSegment(input) {
  return String(input || '')
    .replace(/[:/\\]/g, '-')
    .replace(/\s+/g, '_')
    .slice(0, 120);
}

function getMessageLogFilePath(entry) {
  const ts = sanitizeFileSegment(entry.ts);
  const threadId = sanitizeFileSegment(entry.payload?.threadId || entry.payload?.payload?.threadId || 'default');
  const requestId = sanitizeFileSegment(entry.meta?.requestId || randomUUID());
  return path.join(MESSAGE_LOG_DIR, `${ts}_${threadId}_${requestId}.log`);
}

function getThreadIdFromPayload(payload) {
  return payload?.threadId || payload?.payload?.threadId || null;
}

function shouldCloseRun(type, payload) {
  if (type !== 'chat.output') return false;
  const message = payload?.event?.message || '';
  return message === '执行完成。' || message.startsWith('执行失败:');
}

function writeIoLog(type, payload = {}) {
  try {
    ensureLogDir();
    const requestId = randomUUID();
    const threadId = getThreadIdFromPayload(payload);
    const activeRun = threadId ? activeRunByThread.get(threadId) : null;
    const entry = {
      ts: new Date().toISOString(),
      type,
      payload,
      meta: {
        requestId,
        runId: activeRun?.runId || null,
        pid: process.pid,
        cwd: process.cwd(),
        node: process.version,
        platform: process.platform,
        hostname: os.hostname()
      }
    };
    fs.appendFileSync(getLogFilePath(), `${JSON.stringify(entry)}\n`, 'utf8');

    if (type === 'chat.input.run') {
      ensureMessageLogDir();
      const runId = entry.meta.requestId;
      const runFile = getMessageLogFilePath(entry);
      activeRunByThread.set(threadId || 'default', { runId, runFile });
      entry.meta.runId = runId;
      fs.appendFileSync(runFile, `${JSON.stringify(entry)}\n`, 'utf8');
    } else if (threadId && activeRun) {
      fs.appendFileSync(activeRun.runFile, `${JSON.stringify(entry)}\n`, 'utf8');
      if (shouldCloseRun(type, payload)) {
        activeRunByThread.delete(threadId);
      }
    }
  } catch (err) {
    // 日志写入失败不应影响主流程
  }
}

module.exports = {
  writeIoLog,
  LOG_DIR
};
