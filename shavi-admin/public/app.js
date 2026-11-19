/* SHAVI AI admin panel — talks only to /api/panel/* (same origin as the panel). */
const TOKEN_KEY = 'shavi-admin-token';
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let token = sessionStorage.getItem(TOKEN_KEY) || '';
let days = Number($('#days').value);

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const fmt = (n) => Number(n ?? 0).toLocaleString('en-IN');
const usd = (n) => '$' + Number(n ?? 0).toFixed(4);

function table(headers, rows) {
  const head = headers
    .map((h) => `<th class="${h.num ? 'num' : ''}">${esc(h.label)}</th>`)
    .join('');
  const body = rows
    .map(
      (row) =>
        '<tr>' +
        row
          .map((cell, i) => `<td class="${headers[i]?.num ? 'num' : ''}">${cell}</td>`)
          .join('') +
        '</tr>',
    )
    .join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function status(msg, cls = '') {
  const el = $('#status');
  el.className = 'muted ' + cls;
  el.textContent = msg;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    signOut(true);
    throw new Error('Session expired — sign in again');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/* ------------------------------------------------------------------- auth */

function showPanel(me) {
  $('#login-view').hidden = true;
  $('#panel-view').hidden = false;
  $('#signout').hidden = false;
  $('#whoami').textContent = `${me.user.email} · ${me.user.role} · ${me.capabilities.length} capabilities`;
  $('#whoami').title = me.capabilities.join('\n');
}

function signOut(silent) {
  token = '';
  sessionStorage.removeItem(TOKEN_KEY);
  $('#panel-view').hidden = true;
  $('#login-view').hidden = false;
  $('#signout').hidden = true;
  $('#whoami').textContent = 'not signed in';
  if (!silent) $('#login-error').hidden = true;
}

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const error = $('#login-error');
  error.hidden = true;
  try {
    const res = await fetch('/api/panel/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Sign-in failed');
    token = data.token;
    sessionStorage.setItem(TOKEN_KEY, token);
    const me = await api('/api/panel/me');
    showPanel(me);
    loadTab('overview');
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  }
});

$('#signout').addEventListener('click', () => signOut());

/* ------------------------------------------------------------------- tabs */

$$('.tab').forEach((tab) =>
  tab.addEventListener('click', () => {
    $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    loadTab(tab.dataset.tab);
  }),
);

function showTab(name) {
  $$('.tabpanel').forEach((panel) => (panel.hidden = panel.id !== 'tab-' + name));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
}

const loaders = {
  overview: loadOverview,
  usage: () => loadUsage(currentBy),
  cost: loadCost,
  users: () => loadUsers($('#user-search').value),
  roles: loadRoles,
  limits: loadLimits,
  audit: loadAudit,
  privacy: loadPrivacy,
};

async function loadTab(name) {
  showTab(name);
  if (!token) return;
  status('loading…');
  try {
    await loaders[name]();
    status('');
  } catch (error) {
    status(error.message, 'error');
  }
}

$('#days').addEventListener('change', (event) => {
  days = Number(event.target.value);
  const active = $$('.tab').find((t) => t.classList.contains('active'))?.dataset.tab || 'overview';
  loadTab(active);
});

/* --------------------------------------------------------------- overview */

async function loadOverview() {
  const data = await api(`/api/panel/overview?days=${days}`);
  const t = data.totals;
  $('#kpis').innerHTML = [
    ['Users', fmt(t.users), `${fmt(t.activeUsers)} active in window`],
    ['Conversations', fmt(t.conversations), 'created in window'],
    ['Messages', fmt(t.messages), `${fmt(t.userMessages)} user · ${fmt(t.assistantMessages)} assistant`],
    ['Tokens', fmt(t.tokens), `${fmt(t.billableMessages)} messages metered`],
    ['Estimated cost', usd(data.cost.total), `${data.cost.currency} · list-price estimate`],
  ]
    .map(
      ([label, value, hint]) =>
        `<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div><div class="hint">${hint}</div></div>`,
    )
    .join('');

  const max = Math.max(1, ...data.byDay.map((d) => d.tokens || d.messages));
  $('#chart').innerHTML = data.byDay.length
    ? data.byDay
        .map((d) => {
          const h = Math.max(2, Math.round(((d.tokens || d.messages) / max) * 120));
          return `<div class="bar" style="height:${h}px" data-tip="${esc(d.date)}: ${fmt(d.tokens)} tokens / ${fmt(d.messages)} msgs"></div>`;
        })
        .join('')
    : '<span class="muted">No activity in this window.</span>';

  $('#overview-models').innerHTML = table(
    [
      { label: 'Model' },
      { label: 'Provider' },
      { label: 'Messages', num: true },
      { label: 'Tokens', num: true },
      { label: 'Est. cost', num: true },
    ],
    data.byModel.map((m) => [
      esc(m.model),
      esc(m.endpoint),
      fmt(m.messages),
      fmt(m.tokens),
      m.knownPrice ? usd(m.usd) : '<span class="pill bad">no price</span>',
    ]),
  );
}

/* ------------------------------------------------------------------ usage */

let currentBy = 'day';

async function loadUsage(by = 'day') {
  currentBy = by;
  $$('.chip').forEach((c) => c.classList.toggle('active', c.dataset.by === by));
  const data = await api(`/api/panel/usage?days=${days}&by=${by}`);
  if (by === 'day') {
    $('#usage-table').innerHTML = table(
      [{ label: 'Date' }, { label: 'Messages', num: true }, { label: 'Tokens', num: true }],
      data.rows.map((r) => [esc(r.date), fmt(r.messages), fmt(r.tokens)]),
    );
  } else if (by === 'model') {
    $('#usage-table').innerHTML = table(
      [{ label: 'Model' }, { label: 'Endpoint' }, { label: 'Messages', num: true }, { label: 'Tokens', num: true }],
      data.rows.map((r) => [esc(r.model), esc(r.endpoint), fmt(r.messages), fmt(r.tokens)]),
    );
  } else {
    $('#usage-table').innerHTML = table(
      [{ label: 'Email' }, { label: 'Role' }, { label: 'Messages', num: true }, { label: 'Tokens', num: true }],
      data.rows.map((r) => [esc(r.email), esc(r.role), fmt(r.messages), fmt(r.tokens)]),
    );
  }
}

$$('.chip').forEach((chip) => chip.addEventListener('click', () => loadUsage(chip.dataset.by)));

/* ------------------------------------------------------------------- cost */

async function loadCost() {
  const data = await api(`/api/panel/cost?days=${days}`);
  $('#cost-summary').innerHTML = [
    ['Total (estimate)', usd(data.cost.total), data.cost.currency],
    ['Priced models', String(data.byModel.filter((m) => m.knownPrice).length), 'in price table'],
    ['Unpriced tokens', fmt(data.cost.unpricedTokens), 'excluded from cost'],
  ]
    .map(
      ([label, value, hint]) =>
        `<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div><div class="hint">${hint}</div></div>`,
    )
    .join('');
  $('#cost-table').innerHTML = table(
    [
      { label: 'Model' },
      { label: 'Provider' },
      { label: 'Tokens', num: true },
      { label: 'Blended $/1M', num: true },
      { label: 'Est. cost', num: true },
    ],
    data.byModel.map((m) => [
      esc(m.model),
      esc(m.endpoint),
      fmt(m.tokens),
      m.knownPrice ? (m.usd / (m.tokens || 1)) * 1_000_000 > 0 ? (((m.usd / (m.tokens || 1)) * 1_000_000).toFixed(2)) : '—' : 'n/a',
      m.knownPrice ? usd(m.usd) : '—',
    ]),
  );
}

/* ------------------------------------------------------------------ users */

async function loadUsers(search = '') {
  const query = new URLSearchParams({ limit: '50' });
  if (search) query.set('search', search);
  const data = await api(`/api/panel/users?${query}`);
  $('#users-table').innerHTML = table(
    [{ label: 'Email' }, { label: 'Name' }, { label: 'Role' }, { label: 'Provider' }, { label: 'Created' }],
    (data.users || []).map((u) => [
      esc(u.email),
      esc(u.name || '—'),
      `<span class="pill ${u.role === 'ADMIN' ? 'ok' : ''}">${esc(u.role)}</span>`,
      esc(u.provider),
      esc((u.createdAt || '').slice(0, 10)),
    ]),
  );
  status(`${data.total} user(s)`);
}

$('#user-search-btn').addEventListener('click', () => loadTab('users'));
$('#user-search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadTab('users');
});

/* ------------------------------------------------------------------ roles */

async function loadRoles() {
  const list = await api('/api/panel/roles');
  const details = await Promise.all(
    list.roles.map((r) => api(`/api/panel/role-permissions/${encodeURIComponent(r.name)}`)),
  );
  const rows = details.map((role) => {
    const caps = Object.entries(role.permissions || {})
      .map(([group, perms]) => `${group}: ${Object.entries(perms).filter(([, v]) => v).map(([k]) => k).join('/') || 'none'}`)
      .join(' · ');
    return [
      `<strong>${esc(role.name)}</strong>`,
      esc(role.description || ''),
      `<span class="small">${esc(caps)}</span>`,
      `<button class="ghost" data-role="${esc(role.name)}">Toggle SHARE_PUBLIC</button>`,
    ];
  });
  $('#roles-list').innerHTML = table(
    [{ label: 'Role' }, { label: 'Description' }, { label: 'Capabilities' }, { label: 'Action' }],
    rows,
  );
  $$('#roles-list button[data-role]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const name = btn.dataset.role;
      const role = await api(`/api/panel/role-permissions/${encodeURIComponent(name)}`);
      const current = Boolean(role.permissions?.PROMPTS?.SHARE_PUBLIC);
      try {
        await api(`/api/panel/roles/${encodeURIComponent(name)}/permissions/prompts`, {
          method: 'PUT',
          body: JSON.stringify({ SHARE_PUBLIC: !current }),
        });
        status(`PROMPTS.SHARE_PUBLIC ${!current ? 'enabled' : 'disabled'} for ${name} — audit entry written`);
        loadRoles();
      } catch (error) {
        status(error.message);
      }
    }),
  );
}

/* ----------------------------------------------------------------- limits */

async function loadLimits() {
  const data = await api('/api/panel/limits');
  const rows = [
    ['Chat messages / user', `${data.message.userPerWindow} per ${data.message.userWindowMinutes} min`, data.message.enabled ? '<span class="pill ok">enforcing</span>' : '<span class="pill bad">disabled</span>'],
    ['Chat messages / IP', `${data.message.ipPerWindow} per ${data.message.ipWindowMinutes} min`, data.message.enabled ? '<span class="pill ok">enforcing</span>' : '<span class="pill bad">disabled</span>'],
    ['Login attempts', `${data.login.perWindow} per ${data.login.windowMinutes} min`, '<span class="pill ok">enforcing</span>'],
    ['Registrations', `${data.register.perWindow} per ${data.register.windowMinutes} min`, '<span class="pill ok">enforcing</span>'],
    ['Tool calls / user', `${data.tools.toolCallPerWindow} per ${data.tools.toolCallWindowMinutes} min`, '<span class="pill ok">enforcing</span>'],
  ];
  $('#limits').innerHTML =
    table([{ label: 'Limit' }, { label: 'Configured' }, { label: 'State' }, { label: 'Source' }],
      rows.map((r) => [...r, '<code>' + esc(data.enforcedBy) + '</code>'])) +
    `<p class="muted small note">${esc(data.note)}</p>`;
}

/* ------------------------------------------------------------------ audit */

async function loadAudit() {
  const data = await api('/api/panel/audit?limit=50');
  $('#audit-table').innerHTML = table(
    [
      { label: 'When' },
      { label: 'Category' },
      { label: 'Action' },
      { label: 'Actor' },
      { label: 'Target' },
      { label: 'Outcome' },
      { label: 'Seq', num: true },
    ],
    (data.entries || []).map((e) => [
      esc((e.createdAt || '').replace('T', ' ').slice(0, 19)),
      esc(e.category),
      esc(e.action),
      esc(e.actor?.email || e.actor?.id || e.actorType || '—'),
      esc(e.target?.id || e.target?.name || e.target?.type || '—'),
      `<span class="pill ${e.outcome === 'success' ? 'ok' : 'bad'}">${esc(e.outcome)}</span>`,
      fmt(e.seq),
    ]),
  );
  if (!data.entries?.length) status('No audit entries yet — change a role or a grant to produce one.');
}

$('#audit-refresh').addEventListener('click', () => loadTab('audit'));

$('#audit-verify').addEventListener('click', async () => {
  try {
    const data = await api('/api/panel/audit/verify');
    $('#audit-verify-result').textContent = `Verified ${data.verified ?? data.checked ?? '?'} entries — chain ${
      data.valid === false ? 'BROKEN' : 'intact'
    }`;
  } catch (error) {
    $('#audit-verify-result').textContent = error.message;
  }
});

/* ----------------------------------------------------------------- privacy */

async function loadPrivacy() {
  const me = await api('/api/panel/me');
  $('#privacy-status').textContent = `Signed in as ${me.user.email}`;
}

$('#export-btn').addEventListener('click', async () => {
  try {
    const data = await api('/api/panel/privacy/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shavi-ai-export-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    $('#privacy-status').textContent = `Exported ${data.counts.conversations} conversations, ${data.counts.messages} messages, ${data.counts.memories} memories.`;
  } catch (error) {
    $('#privacy-status').textContent = error.message;
  }
});

$('#delete-btn').addEventListener('click', async () => {
  if (!confirm('Delete your account and every conversation/message/file? This cannot be undone.')) return;
  try {
    await api('/api/panel/privacy/account', { method: 'DELETE', body: JSON.stringify({}) });
    $('#privacy-status').textContent = 'Account deleted. Signing out…';
    signOut(true);
  } catch (error) {
    $('#privacy-status').textContent = error.message;
  }
});

/* ------------------------------------------------------------------ start */

$('#audit-csv').addEventListener('click', async (event) => {
  event.preventDefault();
  const res = await fetch('/api/panel/audit/export.csv', { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return status('CSV export failed');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'shavi-audit-log.csv';
  a.click();
});

(async function boot() {
  if (!token) return;
  try {
    const me = await api('/api/panel/me');
    showPanel(me);
    loadTab('overview');
  } catch {
    signOut(true);
  }
})();
