/* SHAVI YouTube Studio — the eleven skills, their six Python tools, and voice.md. */
const $ = (id) => document.getElementById(id);
const state = { skills: [], tools: {}, current: null, toolOutput: '', busy: false };

const short = (text, max = 92) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function setStatus(text, kind = '') {
  const el = $('status');
  el.textContent = text;
  el.style.color = kind === 'error' ? 'var(--red)' : kind === 'ok' ? 'var(--green)' : 'var(--muted)';
}

function showOutput(text) {
  const out = $('out');
  out.hidden = false;
  out.textContent = text;
  $('copy').hidden = false;
}

async function jsonFetch(url, init) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

function renderNav() {
  const nav = $('nav');
  nav.textContent = '';
  state.skills.forEach((skill) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.id = skill.id;
    btn.innerHTML = `<span class="cmd">/${skill.id}</span><span class="one-line"></span>`;
    btn.querySelector('.one-line').textContent = short(skill.description);
    btn.addEventListener('click', () => select(skill.id));
    nav.appendChild(btn);
  });
}

function select(id) {
  const skill = state.skills.find((s) => s.id === id);
  if (!skill) return;
  state.current = skill;
  state.toolOutput = '';
  document.querySelectorAll('.rail button').forEach((b) => b.classList.toggle('active', b.dataset.id === id));

  const tool = state.tools[skill.id];
  $('skillName').textContent = `/${skill.id}`;
  $('skillDesc').textContent = skill.description;
  $('inputLabel').textContent = tool ? tool.hint : 'क्या बनवाना है — idea, transcript या channel details';
  $('input').placeholder = tool
    ? tool.hint
    : 'जैसे: "Stock market basics पर 10 मिनट का वीडियो" — जितना context देंगे, उतना अच्छा output';
  $('input').value = '';
  $('out').hidden = true;
  $('copy').hidden = true;
  $('runTool').hidden = !tool;
  $('runTool').disabled = false;
  $('ask').disabled = false;

  const extra = tool?.extra;
  $('extraWrap').hidden = !extra;
  if (extra) {
    $('extraLabel').textContent = extra.label;
    $('input').setAttribute('aria-label', tool.hint);
    $('extra').placeholder = extra.placeholder ?? '';
    $('extra').value = '';
  }
  $('extraWrap').querySelector('#extra').value = '';
  setStatus(tool ? `tool: ${tool.hint}` : 'prompt-only skill');
  if (!extra) $('input').setAttribute('aria-label', $('inputLabel').textContent);
}

async function runTool() {
  const skill = state.current;
  if (!skill || state.busy) return;
  state.busy = true;
  $('runTool').disabled = true;
  $('ask').disabled = true;
  setStatus('Tool चल रहा है…');
  try {
    const body = await jsonFetch('/api/tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skill: skill.id, text: $('input').value, thumb: $('extra').value }),
    });
    if (!body.ok) throw new Error(body.error ?? 'tool failed');
    const rendered = body.data ? JSON.stringify(body.data, null, 2) : body.output;
    state.toolOutput = rendered;
    showOutput(rendered);
    setStatus(`Tool ठीक चला · ${body.ms} ms`, 'ok');
  } catch (error) {
    state.toolOutput = '';
    showOutput(`Tool error: ${error.message}`);
    setStatus('Tool fail हुआ', 'error');
  } finally {
    state.busy = false;
    $('runTool').disabled = false;
    $('ask').disabled = false;
  }
}

async function ask() {
  const skill = state.current;
  if (!skill || state.busy) return;
  state.busy = true;
  $('ask').disabled = true;
  $('runTool').disabled = true;
  const started = Date.now();
  setStatus('SHAVI AI लिख रहा है… (30–90 सेकंड)');
  try {
    const body = await jsonFetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skill: skill.id,
        input: $('input').value,
        toolOutput: state.toolOutput,
      }),
    });
    showOutput(body.text);
    const secs = Math.round((Date.now() - started) / 1000);
    const tokens = body.usage?.total_tokens ? ` · ${body.usage.total_tokens} tokens` : '';
    setStatus(`${secs}s · ${body.model}${tokens}`, 'ok');
  } catch (error) {
    showOutput(`Error: ${error.message}`);
    setStatus('Model call fail हुआ', 'error');
  } finally {
    state.busy = false;
    $('ask').disabled = false;
    $('runTool').disabled = !state.tools[state.current?.id];
  }
}

async function loadVoice() {
  const { voice } = await jsonFetch('/api/voice');
  $('voiceText').value = voice;
  $('voiceDialog').showModal();
}

async function saveVoice() {
  $('voiceStatus').textContent = 'saving…';
  try {
    await jsonFetch('/api/voice', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voice: $('voiceText').value }),
    });
    $('voiceStatus').textContent = 'saved — हर skill अब यही पढ़ेगी';
  } catch (error) {
    $('voiceStatus').textContent = error.message;
  }
}

async function boot() {
  try {
    const [health, data] = await Promise.all([jsonFetch('/health'), jsonFetch('/api/skills')]);
    state.skills = data.skills;
    state.tools = data.tools;
    renderNav();
    $('health').textContent = `${health.skills} skills · ${health.python.replace('Python ', 'py')} · model ${health.model.split('/').pop()}${
      health.key ? '' : ' · API key missing'
    }`;
    const first = state.skills.find((s) => s.id === 'yt-script') ?? state.skills[0];
    if (first) select(first.id);
  } catch (error) {
    $('health').textContent = `load fail: ${error.message}`;
    setStatus(error.message, 'error');
  }
}

$('runTool').addEventListener('click', runTool);
$('ask').addEventListener('click', ask);
$('voiceBtn').addEventListener('click', loadVoice);
$('voiceSave').addEventListener('click', saveVoice);
$('copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('out').textContent ?? '');
  setStatus('copied', 'ok');
});
$('extra').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') ask();
});

boot();
