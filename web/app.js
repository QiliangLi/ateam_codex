const statusText = document.getElementById('statusText');
const catsEl = document.getElementById('cats');
const logEl = document.getElementById('log');
const runBtn = document.getElementById('runBtn');
const clearBtn = document.getElementById('clearBtn');
const threadInput = document.getElementById('threadId');
const promptInput = document.getElementById('prompt');

let availableCats = [];
let selectedCats = new Set();
let eventSource = null;

function formatTime(ts = Date.now()) {
  return new Date(ts).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function appendLog(type, text, label = type) {
  const item = document.createElement('article');
  item.className = `log-item ${type}`;

  const meta = document.createElement('div');
  meta.className = 'log-meta';

  const author = document.createElement('span');
  author.textContent = label;

  const time = document.createElement('span');
  time.textContent = formatTime();

  meta.appendChild(author);
  meta.appendChild(time);

  const content = document.createElement('div');
  content.textContent = text;

  item.appendChild(meta);
  item.appendChild(content);
  logEl.appendChild(item);
  logEl.scrollTop = logEl.scrollHeight;
}

function renderCats() {
  catsEl.innerHTML = '';
  availableCats.forEach((catId) => {
    const wrapper = document.createElement('label');
    wrapper.className = 'cat-pill';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = catId;
    checkbox.checked = selectedCats.has(catId);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        selectedCats.add(catId);
        return;
      }
      selectedCats.delete(catId);
    });
    const text = document.createElement('span');
    text.textContent = catId;
    wrapper.appendChild(checkbox);
    wrapper.appendChild(text);
    catsEl.appendChild(wrapper);
  });
}

function connectStream(threadId) {
  if (eventSource) {
    eventSource.close();
  }
  eventSource = new EventSource(`/api/stream?threadId=${encodeURIComponent(threadId)}`);
  eventSource.onopen = () => {
    statusText.textContent = `已连接 · ${threadId}`;
  };
  eventSource.onerror = () => {
    statusText.textContent = '连接中断，自动重试…';
  };
  eventSource.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === 'cli') {
      appendLog('cli', payload.text, `${payload.catId} / cli`);
      return;
    }
    if (payload.type === 'message') {
      appendLog('message', payload.content, payload.catId);
      return;
    }
    if (payload.type === 'system') {
      appendLog('system', payload.message, 'system');
    }
  };
}

async function bootstrap() {
  const res = await fetch('/api/bootstrap');
  const data = await res.json();
  availableCats = data.cats || [];
  selectedCats = new Set(availableCats);
  renderCats();
  connectStream(threadInput.value || 'default');
}

runBtn.addEventListener('click', async () => {
  const threadId = threadInput.value.trim() || 'default';
  connectStream(threadId);

  const cats = Array.from(selectedCats);
  if (cats.length === 0) {
    appendLog('system', '请至少选择一只猫。', 'system');
    return;
  }

  const prompt = promptInput.value.trim();
  if (!prompt) {
    appendLog('system', '请输入 prompt。', 'system');
    return;
  }

  appendLog('system', `已提交任务：${prompt}`, 'you');

  await fetch('/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ threadId, cats, prompt })
  });
});

clearBtn.addEventListener('click', () => {
  logEl.innerHTML = '';
});

threadInput.addEventListener('change', () => {
  connectStream(threadInput.value.trim() || 'default');
});

bootstrap().catch((err) => {
  statusText.textContent = '初始化失败';
  appendLog('system', err.message, 'system');
});
