const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(process.cwd(), 'logs');

function ensureLogDir() {
  if (fs.existsSync(LOG_DIR)) return;
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function getLogFilePath() {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `${date}.log`);
}

function writeIoLog(type, payload = {}) {
  try {
    ensureLogDir();
    const entry = {
      ts: new Date().toISOString(),
      type,
      payload
    };
    fs.appendFileSync(getLogFilePath(), `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (err) {
    // 日志写入失败不应影响主流程
  }
}

module.exports = {
  writeIoLog,
  LOG_DIR
};
