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

async function aiAskShavi(prompt, onDelta) {
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

  let out = '';
  const take = (payload) => {
    let chunk;
    try { chunk = JSON.parse(payload); } catch (e) { return; }
    if (chunk.error) throw new Error(chunk.error);
    if (!chunk.delta) return;
    out += chunk.delta;
    if (onDelta) { try { onDelta(out); } catch (e) {} }
  };

  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, cut).trim();
          buffer = buffer.slice(cut + 1);
          if (line.startsWith('data:')) take(line.slice(5).trim());
        }
      }
      buffer += decoder.decode();
      const last = buffer.trim();
      if (last.startsWith('data:')) take(last.slice(5).trim());
    } finally {
      try { reader.releaseLock(); } catch (e) {}
    }
  } else {
    const raw = await res.text();
    for (const line of raw.split('\n')) {
      const text = line.trim();
      if (text.startsWith('data:')) take(text.slice(5).trim());
    }
  }

  if (!out.trim()) throw new Error('Shavi AI से खाली जवाब मिला — फिर कोशिश करें।');
  return out.trim();
}

async function aiAsk(prompt, provider, onDelta) {
  if (provider === 'shavi') return aiAskShavi(prompt, onDelta);
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
function aiKeyNote(provider) {
  const note = document.getElementById('key-note');
  if (!note) return;
  note.textContent = aiHasKey(provider)
    ? 'Key इस browser में सेव है — कहीं भेजी नहीं जाती।'
    : 'कोई key नहीं है। अपनी key डालें, वह सिर्फ इस browser में रहेगी।';
}
function bindKeyPanel(provider) {
  const input = document.getElementById('api-key');
  const save = document.getElementById('save-key');
  const note = document.getElementById('key-note');
  if (!input || !save || !note) return;
  if (!input.dataset.defaultPlaceholder) input.dataset.defaultPlaceholder = input.placeholder;
  // Save का listener सिर्फ एक बार — provider बदलने पर सिर्फ dataset.provider बदलता है,
  // वरना हर switch पर नया listener जुड़कर key कई बार सेव होती और status बार-बार बदलता।
  save.dataset.provider = provider;
  if (!save.dataset.bound) {
    save.dataset.bound = '1';
    save.addEventListener('click', () => {
      const current = save.dataset.provider || '';
      if (!current || AI_FREE_PROVIDERS[current]) return;
      aiSetKey(current, input.value.trim());
      aiKeyNote(current);
      aiStatus('ok', 'Key सेव हो गई।');
    });
  }
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
  input.value = keys[provider] || '';
  aiKeyNote(provider);
}

/* ---------------- Markdown → HTML (koi library nahi, sirf vanilla JS) ----------------
 * AI ke jawab me headings, lists, table aur code blocks aate hain; output box unhe theek
 * dikhaye isliye yahan chhota renderer hai. Har text pehle escape hota hai (jawab ke andar
 * ka HTML nahi chalta), aur link sirf http(s) URL ka banta hai. Adhoora markdown — jaise
 * streaming ke beech khula ``` fence — bhi kharab nahi dikhta, khula code block ban jata hai.
 */
function aiEscapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function aiMdInline(text) {
  return text
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

function aiMdCells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}
function aiMdTableSep(line) {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
}

function aiMarkdown(source) {
  const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  const para = [];
  let list = null;
  const md = (text) => aiMdInline(aiEscapeHtml(text));
  const flushPara = () => {
    if (!para.length) return;
    out.push('<p>' + para.map(md).join('<br>') + '</p>');
    para.length = 0;
  };
  const flushList = () => {
    if (!list) return;
    out.push('<' + list.tag + '>' + list.items.map((item) => '<li>' + md(item) + '</li>').join('') + '</' + list.tag + '>');
    list = null;
  };
  const flushAll = () => { flushPara(); flushList(); };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].replace(/\s+$/, '');
    if (!line.trim()) { flushAll(); i++; continue; }

    if (/^\s*```/.test(line)) {
      flushAll();
      const lang = (line.match(/^\s*```\s*([\w+#.-]*)/) || [])[1] || '';
      const code = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) { code.push(lines[i]); i++; }
      if (i < lines.length) i++;
      out.push('<pre' + (lang ? ' data-lang="' + aiEscapeHtml(lang) + '"' : '') + '><code>' + aiEscapeHtml(code.join('\n')) + '</code></pre>');
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const tag = heading[1].length <= 1 ? 'h3' : 'h4';
      out.push('<' + tag + '>' + md(heading[2]) + '</' + tag + '>');
      i++;
      continue;
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      flushAll();
      out.push('<hr>');
      i++;
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && aiMdTableSep(lines[i + 1])) {
      flushAll();
      const head = aiMdCells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) { rows.push(aiMdCells(lines[i])); i++; }
      out.push('<div class="md-table"><table><thead><tr>' + head.map((cell) => '<th>' + md(cell) + '</th>').join('') + '</tr></thead><tbody>' +
        rows.map((row) => '<tr>' + head.map((_, index) => '<td>' + md(row[index] || '') + '</td>').join('') + '</tr>').join('') +
        '</tbody></table></div>');
      continue;
    }

    if (/^\s*>/.test(line)) {
      flushAll();
      const quote = [];
      while (i < lines.length) {
        const q = /^\s*>\s?(.*)$/.exec(lines[i]);
        if (!q) break;
        quote.push(md(q[1]));
        i++;
      }
      out.push('<blockquote><p>' + quote.join('<br>') + '</p></blockquote>');
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushPara();
      const tag = bullet ? 'ul' : 'ol';
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push((bullet || numbered)[1]);
      i++;
      continue;
    }

    flushList();
    para.push(line);
    i++;
  }
  flushAll();
  return out.join('');
}

/* Output box me streaming markdown dikhane ke helpers. */
function aiStreamBox(id) {
  const el = document.getElementById(id);
  let streamed = false;
  let latest = '';
  let timer = 0;
  const stop = () => { if (timer) { clearTimeout(timer); timer = 0; } };
  return {
    begin() {
      streamed = false;
      latest = '';
      stop();
      if (el) el.innerHTML = '<p class="ai-wait">जवाब आ रहा है…</p>';
    },
    delta(full) {
      streamed = true;
      latest = full;
      // Har delta par poora HTML dobara banane ke bajaye thoda throttle.
      if (timer) return;
      timer = setTimeout(() => { timer = 0; if (el) el.innerHTML = aiMarkdown(latest); }, 70);
    },
    done(text) { stop(); if (el) el.innerHTML = aiMarkdown(text || 'खाली जवाब मिला।'); },
    fail() { stop(); if (el && !streamed) el.innerHTML = ''; }
  };
}
function copyText(text, button) {
  const done = () => { if (button) { const old = button.textContent; button.textContent = 'Copied ✓'; setTimeout(() => { button.textContent = old; }, 1400); } };
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, done);
  else done();
}
