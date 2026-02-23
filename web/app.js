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

function appendLog(type, text) {
  const item = document.createElement('div');
  item.className = `log-item ${type}`;
  item.textContent = text;
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
      } else {
        selectedCats.delete(catId);
      }
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
    statusText.textContent = '已连接';
  };
  eventSource.onerror = () => {
    statusText.textContent = '连接中断，自动重试…';
  };
  eventSource.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === 'cli') {
      appendLog('cli', `[${payload.catId}] ${payload.text}`);
    }
    if (payload.type === 'message') {
      appendLog('message', `[${payload.catId}] ${payload.content}`);
    }
    if (payload.type === 'system') {
      appendLog('system', payload.message);
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
    appendLog('system', '请至少选择一只猫。');
    return;
  }
  const prompt = promptInput.value.trim();
  if (!prompt) {
    appendLog('system', '请输入 prompt。');
    return;
  }
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
  appendLog('system', err.message);
});
