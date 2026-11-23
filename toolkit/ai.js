/* Shared helpers for the toolkit pages: local key storage + AI calls. */
const AI_KEY_STORE = 'vktl-ai-keys';

/* Shavi AI — is site ka apna AI backend (ai-worker), key ki zaroorat nahi. */
const AI_SHAVI_API = 'https://site-d28594350583452e987524c38e89b7a9.freebuff.page';
const AI_FREE_PROVIDERS = {
  shavi: 'Shavi AI मुफ़्त है — कोई key नहीं चाहिए। सीधे सवाल पूछें।'
};

function aiGetKeys() {
  try { return JSON.parse(localStorage.getItem(AI_KEY_STORE) || '{}'); } catch (e) { return {}; }
}
function aiSetKey(name, value) {
  const keys = aiGetKeys();
  if (value) keys[name] = value; else delete keys[name];
  localStorage.setItem(AI_KEY_STORE, JSON.stringify(keys));
}
function aiHasKey(name) { return Boolean(aiGetKeys()[name]); }

async function aiAskShavi(prompt) {
  let res;
  try {
    res = await fetch(AI_SHAVI_API + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] })
    });
  } catch (e) {
    throw new Error('Shavi AI से कनेक्ट नहीं हो पाया — internet जाँचें।');
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error || ''; } catch (e) {}
    throw new Error(detail || ('Shavi AI error ' + res.status + ' — थोड़ी देर बाद कोशिश करें।'));
  }
  const raw = await res.text();
  let out = '';
  for (const line of raw.split('\n')) {
    const text = line.trim();
    if (!text.startsWith('data:')) continue;
    let chunk;
    try { chunk = JSON.parse(text.slice(5).trim()); } catch (e) { continue; }
    if (chunk.error) throw new Error(chunk.error);
    if (chunk.delta) out += chunk.delta;
  }
  if (!out.trim()) throw new Error('Shavi AI से खाली जवाब मिला — फिर कोशिश करें।');
  return out.trim();
}

async function aiAsk(prompt, provider) {
  if (provider === 'shavi') return aiAskShavi(prompt);
  const keys = aiGetKeys();
  if (provider === 'openai') {
    if (!keys.openai) throw new Error('OpenAI key सेव नहीं है। पहले key डालें।');
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + keys.openai },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }] })
    });
    if (!res.ok) throw new Error('OpenAI error ' + res.status + ' — key या balance जाँचें।');
    const data = await res.json();
    return data.choices[0].message.content.trim();
  }
  if (!keys.gemini) throw new Error('Gemini key सेव नहीं है। पहले key डालें।');
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + encodeURIComponent(keys.gemini);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  if (!res.ok) throw new Error('Gemini error ' + res.status + ' — key या quota जाँचें।');
  const data = await res.json();
  return ((data.candidates && data.candidates[0] && data.candidates[0].content.parts) || [])
    .map((p) => p.text || '').join('').trim();
}

function aiStatus(kind, text) {
  const el = document.getElementById('status');
  if (!el) return;
  el.className = 'status show ' + kind;
  el.textContent = text;
}
function aiBusy(button, busy, idle, working) {
  if (!button) return;
  button.disabled = busy;
  button.textContent = busy ? (working || 'Working…') : (idle || 'Run');
}
function bindKeyPanel(provider) {
  const input = document.getElementById('api-key');
  const save = document.getElementById('save-key');
  const note = document.getElementById('key-note');
  if (!input || !save || !note) return;
  if (!input.dataset.defaultPlaceholder) input.dataset.defaultPlaceholder = input.placeholder;
  const freeText = AI_FREE_PROVIDERS[provider];
  if (freeText) {
    input.value = '';
    input.disabled = true;
    input.placeholder = 'Shavi AI: key की ज़रूरत नहीं';
    save.disabled = true;
    note.textContent = freeText;
    return;
  }
  input.disabled = false;
  save.disabled = false;
  input.placeholder = input.dataset.defaultPlaceholder;
  const keys = aiGetKeys();
  if (keys[provider]) input.value = keys[provider];
  const paint = () => {
    note.textContent = aiHasKey(provider)
      ? 'Key इस browser में सेव है — कहीं भेजी नहीं जाती।'
      : 'कोई key नहीं है। अपनी key डालें, वह सिर्फ इस browser में रहेगी।';
  };
  save.addEventListener('click', () => {
    aiSetKey(provider, input.value.trim());
    paint();
    aiStatus('ok', 'Key सेव हो गई।');
  });
  paint();
}
function copyText(text, button) {
  const done = () => { if (button) { const old = button.textContent; button.textContent = 'Copied ✓'; setTimeout(() => { button.textContent = old; }, 1400); } };
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, done);
  else done();
}
