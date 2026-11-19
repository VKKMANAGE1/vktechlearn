#!/usr/bin/env node
/**
 * M12 — final end-to-end QA against the running stack (no mocks, no stubs):
 *
 *   app          production bundle served by the API (index + hashed assets)
 *   auth         register -> verify -> login -> JWT
 *   chat         real model round-trip through /api/agents/chat (Nemotron), streamed SSE
 *   persistence  conversation + messages in MongoDB, tokenCount recorded
 *   memory       create / list / delete against the real memory API
 *   admin        panel API: admin 200, plain user 403
 *   rate limit   per-user message limit denies with a `message_limit` frame
 *   audit        hash-chained audit log verifies
 *   privacy      export matches the DB, delete cascades
 *   backup       tools/backup-mongo.mjs -> tools/restore-mongo.mjs into a scratch DB
 *
 *   node tools/librechat-dev/m12-e2e-test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { MongoClient } from 'mongodb';

const BASE = process.env.SHAVI_LIBRECHAT_URL ?? 'http://127.0.0.1:3080';
const PANEL = process.env.SHAVI_ADMIN_URL ?? 'http://127.0.0.1:4127';
const MONGO = process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017/LibreChat';
const ADMIN_EMAIL = process.env.AUDIT_ADMIN_EMAIL ?? 'admin@shavi.local';
const ADMIN_PASSWORD = process.env.AUDIT_ADMIN_PASSWORD ?? 'ShaviLocal#2026';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MODEL = 'nvidia/nemotron-3-ultra-550b-a55b';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

const stamp = Date.now();
const EMAIL = `m12-qa-${stamp}@shavi.local`;
const PASSWORD = 'M12-QA-Pass!42';
const TOKEN = `M12QACHK${stamp}`;
let userId = null;

const results = [];
const pass = (name, detail = '') => {
  results.push({ name, ok: true });
  console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`);
};
const fail = (name, detail = '') => {
  results.push({ name, ok: false });
  console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
};
const check = (name, ok, detail = '') => (ok ? pass(name, detail) : fail(name, detail));

const json = async (res) => {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text.slice(0, 200) };
  }
};

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ email, password }),
  });
  const body = await json(res);
  return { status: res.status, token: body.token };
}

async function panel(pathname, token, init = {}) {
  const res = await fetch(`${PANEL}${pathname}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  return { status: res.status, body: await json(res) };
}

function chatBody(text, i = 0) {
  return {
    text,
    sender: 'User',
    isCreatedByUser: true,
    messageId: crypto.randomUUID(),
    conversationId: null,
    parentMessageId: null,
    error: false,
    endpoint: 'SHAVI AI',
    endpointType: 'custom',
    model: MODEL,
    spec: 'shavi-nemotron',
    isTemporary: false,
    isRegenerate: false,
    isContinued: false,
    timezone: 'Asia/Kolkata',
    generationProtocolVersion: 1,
    clientRequestId: `m12-${stamp}-${i}`,
  };
}

async function chat(token, text, i = 0) {
  const res = await fetch(`${BASE}/api/agents/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': UA },
    body: JSON.stringify(chatBody(text, i)),
  });
  return { status: res.status, text: await res.text() };
}

async function waitForReply(token, conversationId, timeoutMs = 150000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(`${BASE}/api/messages/${conversationId}`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA },
    });
    if (!res.ok) continue;
    const messages = await res.json();
    const assistant = messages.filter((m) => !m.isCreatedByUser).at(-1);
    if (!assistant) continue;
    const text = Array.isArray(assistant.content)
      ? assistant.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n')
      : String(assistant.content ?? '');
    if (text.trim() || assistant.error) return { assistant, text };
  }
  return { assistant: null, text: '' };
}

const client = await MongoClient.connect(MONGO);
const db = client.db();

try {
  /* ------------------------------------------------------------ 1. app */
  const health = await fetch(`${BASE}/health`);
  check('API health endpoint answers', health.status === 200, `GET /health -> ${health.status}`);
  const spa = await fetch(`${BASE}/`);
  const spaHtml = await spa.text();
  const asset = /\/assets\/index\.[A-Za-z0-9_-]+\.js/.exec(spaHtml)?.[0];
  const assetRes = asset ? await fetch(`${BASE}${asset}`) : null;
  check(
    'production bundle is served (SPA shell + hashed JS asset)',
    spa.status === 200 && Boolean(asset) && assetRes?.status === 200,
    `${asset} -> ${assetRes?.status}`,
  );
  check('built bundle carries no provider key', !spaHtml.includes('nvapi-'), 'index.html scanned');
  const panelHealth = await panel('/health');
  check('admin panel service is up', panelHealth.status === 200 && panelHealth.body.mongo === true, `mongo=${panelHealth.body.mongo}`);

  /* ----------------------------------------------------------- 2. auth */
  const register = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, name: 'M12 QA', confirm_password: PASSWORD }),
  });
  const user = await db.collection('users').findOne({ email: EMAIL });
  check('registration creates an account', register.status === 200 && Boolean(user), `register -> ${register.status}`);
  if (user) {
    userId = user._id;
    // No SMTP in this environment: flip the verification flag the email link would set.
    await db.collection('users').updateOne({ _id: user._id }, { $set: { emailVerified: true } });
  }
  const userLogin = await login(EMAIL, PASSWORD);
  check('login issues a JWT', Boolean(userLogin.token), `login -> ${userLogin.status}`);
  const userToken = userLogin.token;
  const adminToken = (await login(ADMIN_EMAIL, ADMIN_PASSWORD)).token;
  check('admin login issues a JWT', Boolean(adminToken), 'admin@shavi.local');

  /* ----------------------------------------------------------- 3. chat */
  const turn = await chat(userToken, `Reply with exactly this token and nothing else: ${TOKEN}`, 0);
  const conversationId = (() => {
    for (const line of turn.text.split('\n')) {
      const m = /"conversationId":"([0-9a-f-]{36})"/.exec(line);
      if (m) return m[1];
    }
    return null;
  })();
  check('chat request is accepted and starts a generation', turn.status === 200 && Boolean(conversationId), `conversation ${conversationId}`);

  const reply = conversationId ? await waitForReply(userToken, conversationId) : { text: '' };
  check('the model answers through the real provider', reply.text.includes(TOKEN), `reply: ${reply.text.slice(0, 80).replace(/\n/g, ' ')}`);

  /* ---------------------------------------------------- 4. persistence */
  const convo = conversationId ? await db.collection('conversations').findOne({ conversationId }) : null;
  const msgs = conversationId
    ? await db.collection('messages').find({ conversationId, isCreatedByUser: false }).toArray()
    : [];
  check('conversation and messages are persisted in MongoDB', Boolean(convo) && msgs.length > 0, `${msgs.length} assistant message(s)`);
  check(
    'token usage is recorded for the model call',
    msgs.some((m) => Number(m.tokenCount) > 0),
    `tokenCount=${msgs.map((m) => m.tokenCount).join(',')}`,
  );
  const convoList = await fetch(`${BASE}/api/convos`, { headers: { Authorization: `Bearer ${userToken}`, 'User-Agent': UA } }).then(json);
  const listed = Array.isArray(convoList) ? convoList : (convoList.conversations ?? []);
  check('conversation appears in the history API', listed.some((c) => c.conversationId === conversationId), `${listed.length} conversation(s)`);

  /* --------------------------------------------------------- 5. memory */
  // Memory keys accept lowercase letters and underscores only (API validation).
  const MEMORY_KEY = 'mqa_memory_key';
  const memCreate = await fetch(`${BASE}/api/memories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}`, 'User-Agent': UA },
    body: JSON.stringify({ key: MEMORY_KEY, value: 'QA memory value' }),
  }).then(json);
  const memList = await fetch(`${BASE}/api/memories`, { headers: { Authorization: `Bearer ${userToken}`, 'User-Agent': UA } }).then(json);
  const memories = Array.isArray(memList) ? memList : (memList.memories ?? []);
  check(
    'memory create/list works through the real API',
    memories.some((m) => m.key === MEMORY_KEY),
    `${memories.length} memories${memCreate?.error ? ` (create: ${memCreate.error})` : ''}`,
  );
  const memDelete = await fetch(`${BASE}/api/memories/${encodeURIComponent(MEMORY_KEY)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${userToken}`, 'User-Agent': UA },
  });
  check('memory delete works', memDelete.status === 200, `${memDelete.status}`);

  /* ----------------------------------------------------------- 6. admin */
  const adminOverview = await panel('/api/panel/overview?days=365', adminToken);
  const userOverview = await panel('/api/panel/overview?days=365', userToken);
  check('admin panel data is admin-only', adminOverview.status === 200 && userOverview.status === 403, `admin ${adminOverview.status}, user ${userOverview.status}`);
  const verify = await panel('/api/panel/audit/verify', adminToken);
  check('audit hash chain verifies', verify.body?.ok === true, JSON.stringify(verify.body).slice(0, 80));

  /* ------------------------------------------------------- 7. rate limit */
  const burst = await Promise.all([0, 1, 2, 3, 4].map((i) => chat(userToken, `rate check ${i} ${crypto.randomUUID()}`, 10 + i)));
  const denied = burst.filter((b) => b.text.includes('message_limit'));
  check(
    'per-user message rate limit denies a burst',
    denied.length > 0,
    `${denied.length}/${burst.length} denied (limit ${process.env.MESSAGE_USER_MAX ?? '?'}/min)`,
  );

  /* ---------------------------------------------------------- 8. privacy */
  const exportRes = await panel('/api/panel/privacy/export', userToken);
  // Ownership is stored as the hex string in these collections.
  const dbConvos = await db.collection('conversations').countDocuments({ user: String(userId) });
  const dbMessages = await db.collection('messages').countDocuments({ user: String(userId) });
  check(
    'data export matches the database rows for this account',
    exportRes.status === 200 && exportRes.body.counts.conversations === dbConvos && exportRes.body.counts.messages === dbMessages,
    `export ${exportRes.body.counts?.conversations}/${exportRes.body.counts?.messages} vs mongo ${dbConvos}/${dbMessages}`,
  );
  const del = await panel('/api/panel/privacy/account', userToken, { method: 'DELETE', body: JSON.stringify({}) });
  const gone = await db.collection('users').findOne({ email: EMAIL });
  const goneMsgs = await db.collection('messages').countDocuments({ user: String(userId) });
  check('account deletion cascades (user + messages removed)', del.status === 200 && gone === null && goneMsgs === 0, `user=${gone ? 'present' : 'gone'}, messages=${goneMsgs}`);

  /* ------------------------------------------------- 9. backup / restore */
  const OUT = path.join('/tmp', `m12-backup-${stamp}`);
  let backupOk = false;
  let restoreOk = false;
  let backupDetail = '';
  try {
    backupDetail = execFileSync('node', [path.join(ROOT, 'tools/backup-mongo.mjs'), '--out', OUT], { encoding: 'utf8' });
    backupOk = backupDetail.includes('collections,');
    const dir = backupDetail.trim().split('\n').at(-1);
    const restoreOut = execFileSync(
      'node',
      [path.join(ROOT, 'tools/restore-mongo.mjs'), dir, '--db', 'mongodb://127.0.0.1:27017/LibreChatRecoveryCheck'],
      { encoding: 'utf8' },
    );
    restoreOk = restoreOut.includes('RECOVERY CHECK OK');
    backupDetail = `${backupDetail.split('\n')[1] ?? ''} | ${restoreOut.trim().split('\n').at(-1)}`;
  } catch (error) {
    backupDetail = String(error.message).slice(0, 160);
  }
  check('MongoDB backup completes', backupOk, backupDetail.slice(0, 120));
  check('backup restores into a clean database and counts match', restoreOk, backupDetail.slice(120, 240));

  /* ------------------------------------------------------ 10. log hygiene */
  const logs = ['/tmp/shavi-librechat.log', '/tmp/shavi-admin.log']
    .map((f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''))
    .join('\n');
  check('prompt text never reaches the service logs', !logs.includes(TOKEN), 'both logs scanned');
} catch (error) {
  fail('suite completed without an exception', error.stack?.split('\n')[0] ?? String(error));
} finally {
  await client.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('FAILED:', failed.map((f) => f.name).join(' | '));
    process.exitCode = 1;
  }
}
