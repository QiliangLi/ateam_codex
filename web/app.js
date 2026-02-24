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

function appendMessage({ text, label, direction = 'left', kind = 'agent' }) {
  const row = document.createElement('article');
  row.className = `message-row ${direction === 'right' ? 'right' : ''} ${kind === 'system' ? 'system' : ''}`.trim();

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  const meta = document.createElement('div');
  meta.className = 'bubble-meta';

  const author = document.createElement('span');
  author.textContent = label;

  const time = document.createElement('span');
  time.textContent = formatTime();

  const content = document.createElement('div');
  content.className = 'bubble-content';
  content.textContent = text;

  meta.appendChild(author);
  meta.appendChild(time);
  bubble.appendChild(meta);
  bubble.appendChild(content);
  row.appendChild(bubble);

  logEl.appendChild(row);
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
      appendMessage({
        text: payload.text,
        label: `${payload.catId} · CLI`,
        direction: 'left',
        kind: 'agent'
      });
      return;
    }

    if (payload.type === 'message') {
      appendMessage({
        text: payload.content,
        label: payload.catId,
        direction: 'left',
        kind: 'agent'
      });
      return;
    }

    if (payload.type === 'system') {
      appendMessage({
        text: payload.message,
        label: 'System',
        direction: 'left',
        kind: 'system'
      });
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
    appendMessage({ text: '请至少选择一只猫。', label: 'System', kind: 'system' });
    return;
  }

  const prompt = promptInput.value.trim();
  if (!prompt) {
    appendMessage({ text: '请输入 prompt。', label: 'System', kind: 'system' });
    return;
  }

  appendMessage({
    text: prompt,
    label: 'You',
    direction: 'right',
    kind: 'user'
  });

  promptInput.value = '';

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
  appendMessage({ text: err.message, label: 'System', kind: 'system' });
});
