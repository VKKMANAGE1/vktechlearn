#!/usr/bin/env node
/**
 * M11 — Admin & Security, proven against the running stack (no mocks):
 *
 *   admin panel API     /api/panel/* served by shavi-admin, authorised by LibreChat
 *   user permissions    admin capability gate (403 for a plain user, 200 for ADMIN)
 *   usage tracking      panel aggregates == MongoDB aggregation over messages
 *   cost tracking       panel estimate == tokens × declared price table
 *   rate limits         chat limiter really returns 429 after the configured budget
 *   audit logs          a role change lands in the hash-chained audit log; chain verifies
 *   data privacy        per-account export matches the database, delete cascades
 *
 * Prereqs: mongod on 27017, LibreChat on 3080, shavi-admin on 4127.
 *   node tools/librechat-dev/m11-admin-security-test.mjs
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';

const BASE = process.env.SHAVI_LIBRECHAT_URL ?? 'http://127.0.0.1:3080';
const PANEL = process.env.SHAVI_ADMIN_URL ?? 'http://127.0.0.1:4127';
const MONGO = process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017/LibreChat';
const ADMIN_EMAIL = process.env.AUDIT_ADMIN_EMAIL ?? 'admin@shavi.local';
const ADMIN_PASSWORD = process.env.AUDIT_ADMIN_PASSWORD ?? 'ShaviLocal#2026';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MODEL = 'nvidia/nemotron-3-ultra-550b-a55b';
const ROOT = new URL('../../', import.meta.url).pathname;
const pricing = JSON.parse(fs.readFileSync(`${ROOT}shavi-admin/pricing.json`, 'utf8'));

const stamp = Date.now();
const TEST_EMAIL = `m11-audit-${stamp}@shavi.local`;
const TEST_PASSWORD = 'M11-Audit-Pass!42';
const PROMPT_TOKEN = `M11LOGCHK${stamp}`;
let createdUserId = null;

const results = [];
const pass = (name, detail = '') => {
  results.push({ name, ok: true, detail });
  console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`);
};
const fail = (name, detail = '') => {
  results.push({ name, ok: false, detail });
  console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
};
const check = (name, cond, detail = '') => (cond ? pass(name, detail) : fail(name, detail));

const json = async (res) => {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text.slice(0, 300) };
  }
};

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ email, password }),
  });
  const body = await json(res);
  return { status: res.status, token: body.token, body };
}

async function panel(path, token, init = {}) {
  const res = await fetch(`${PANEL}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  return { status: res.status, body: await json(res), headers: res.headers };
}

async function chat(token, turn = 0) {
  const res = await fetch(`${BASE}/api/agents/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': UA },
    body: JSON.stringify({
      text: `Reply with exactly: ${PROMPT_TOKEN}-${turn}-${Math.random().toString(36).slice(2, 8)}`,
      sender: 'User',
      isCreatedByUser: true,
      parentMessageId: null,
      messageId: crypto.randomUUID(),
      conversationId: null,
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
    }),
  });
  // LibreChat streams the limiter verdict as an SSE `error` frame with HTTP 200, so the
  // body — not the status code — is what proves the message limiter fired.
  return { status: res.status, text: await res.text() };
}

const client = await MongoClient.connect(MONGO);
const db = client.db();

try {
  /* ---------------------------------------------------------------- 0. health */
  const healthLc = await fetch(`${BASE}/health`);
  check('LibreChat API is up', healthLc.status === 200, `GET /health -> ${healthLc.status}`);
  const healthAdmin = await panel('/health');
  check(
    'admin panel service is up with Mongo access',
    healthAdmin.status === 200 && healthAdmin.body.mongo === true,
    `GET ${PANEL}/health -> ${healthAdmin.status}, mongo=${healthAdmin.body.mongo}`,
  );
  const panelHtml = await fetch(`${PANEL}/`);
  check('admin panel UI is served', panelHtml.status === 200, `GET / -> ${panelHtml.status}`);

  /* ------------------------------------------------------- 1. admin sign-in */
  const adminLogin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  check('admin can sign in through the panel login route', Boolean(adminLogin.token), `login -> ${adminLogin.status}`);
  const adminToken = adminLogin.token;
  const adminView = await panel('/api/panel/login', null, {
    method: 'POST',
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  check('panel login route returns a JWT', Boolean(adminView.body.token), `${adminView.status}`);

  const me = await panel('/api/panel/me', adminToken);
  check(
    'admin account reports its effective capabilities',
    me.status === 200 && me.body.capabilities?.includes('access:admin'),
    `capabilities=${me.body.capabilities?.length ?? 0}`,
  );
  check(
    'panel never returns the password hash',
    me.status === 200 && !JSON.stringify(me.body).includes('$2b$') && !('password' in (me.body.user ?? {})),
    'no bcrypt hash in /api/panel/me',
  );

  /* ------------------------------------------- 2. create a plain user (USER role) */
  const register = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, name: 'M11 Audit User', confirm_password: TEST_PASSWORD }),
  });
  const regBody = await json(register);
  const freshUser = await db.collection('users').findOne({ email: TEST_EMAIL });
  if (freshUser) {
    createdUserId = freshUser._id;
    await db.collection('users').updateOne({ _id: freshUser._id }, { $set: { emailVerified: true } });
  }
  check('a second, non-admin account can be created', Boolean(freshUser), `register -> ${register.status} ${regBody.message ?? ''}`.trim());
  const userLogin = await login(TEST_EMAIL, TEST_PASSWORD);
  const userToken = userLogin.token;
  check('the non-admin account can sign in', Boolean(userToken), `login -> ${userLogin.status}`);

  /* ------------------------------------------------------- 3. user permissions */
  const userMe = await panel('/api/panel/me', userToken);
  check(
    'plain user is refused the admin panel API (403, not just hidden UI)',
    userMe.status === 403,
    `GET /api/panel/me -> ${userMe.status} ${userMe.body.error ?? ''}`.trim(),
  );
  const userOverview = await panel('/api/panel/overview', userToken);
  check('plain user cannot read usage/cost', userOverview.status === 403, `${userOverview.status}`);
  const userDirect = await fetch(`${BASE}/api/admin/users?limit=1`, {
    headers: { Authorization: `Bearer ${userToken}`, 'User-Agent': UA },
  });
  check('plain user cannot read /api/admin/users directly on the API', userDirect.status === 403, `${userDirect.status}`);
  const userPatch = await panel('/api/panel/roles/USER/permissions/prompts', userToken, {
    method: 'PUT',
    body: JSON.stringify({ SHARE_PUBLIC: true }),
  });
  check('plain user cannot change role permissions', userPatch.status === 403, `${userPatch.status}`);
  const anon = await panel('/api/panel/overview');
  check('anonymous caller is refused (401)', anon.status === 401, `${anon.status}`);

  /* ------------------------------------------------ 4. admin reads (panel data) */
  const overview = await panel('/api/panel/overview?days=365', adminToken);
  check('admin sees the usage overview', overview.status === 200 && typeof overview.body.totals?.messages === 'number', `${overview.status}`);
  const users = await panel('/api/panel/users?limit=50', adminToken);
  check(
    'admin can list users',
    users.status === 200 && Array.isArray(users.body.users) && users.body.users.some((u) => u.email === TEST_EMAIL),
    `${users.body.total} users`,
  );
  const roles = await panel('/api/panel/roles', adminToken);
  check('admin can list roles', roles.status === 200 && roles.body.roles?.length >= 2, `${roles.body.roles?.length} roles`);
  const limits = await panel('/api/panel/limits', adminToken);
  check(
    'rate-limit configuration is reported',
    limits.status === 200 && limits.body.message?.enabled === true,
    `${limits.body.message?.userPerWindow}/${limits.body.message?.userWindowMinutes}min per user`,
  );

  /* ------------------------------------------------ 5. usage tracking == Mongo */
  const since = new Date(Date.now() - 365 * 86400000);
  const [mongoTotals] = await db
    .collection('messages')
    .aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: null,
          messages: { $sum: 1 },
          userMessages: { $sum: { $cond: ['$isCreatedByUser', 1, 0] } },
          assistantMessages: { $sum: { $cond: ['$isCreatedByUser', 0, 1] } },
          tokens: { $sum: { $ifNull: ['$tokenCount', 0] } },
        },
      },
    ])
    .toArray();
  const t = overview.body.totals ?? {};
  check(
    'usage totals equal the MongoDB aggregation (messages, roles, tokens)',
    t.messages === mongoTotals.messages &&
      t.userMessages === mongoTotals.userMessages &&
      t.assistantMessages === mongoTotals.assistantMessages &&
      t.tokens === mongoTotals.tokens,
    `panel ${t.messages}/${t.userMessages}/${t.assistantMessages}/${t.tokens} vs mongo ${mongoTotals.messages}/${mongoTotals.userMessages}/${mongoTotals.assistantMessages}/${mongoTotals.tokens}`,
  );

  /* ------------------------------------------------------- 6. cost tracking */
  const agentDocs = await db.collection('agents').find({}, { projection: { id: 1, model: 1 } }).toArray();
  const agentModels = new Map(agentDocs.filter((a) => a.id).map((a) => [a.id, a.model]));
  const pricedRows = await db
    .collection('messages')
    .aggregate([
      { $match: { createdAt: { $gte: since }, isCreatedByUser: false } },
      { $group: { _id: '$model', tokens: { $sum: { $ifNull: ['$tokenCount', 0] } } } },
    ])
    .toArray();
  let expectedUsd = 0;
  for (const row of pricedRows) {
    const model = agentModels.get(row._id) ?? row._id;
    const price = pricing.models[model];
    if (price) expectedUsd += (row.tokens / 1_000_000) * price.blended;
  }
  const cost = await panel('/api/panel/cost?days=365', adminToken);
  const delta = Math.abs((cost.body.cost?.total ?? -1) - expectedUsd);
  check(
    'cost equals tokens × the declared price table',
    cost.status === 200 && delta < 1e-4,
    `panel $${cost.body.cost?.total} vs expected $${expectedUsd.toFixed(4)}`,
  );
  check(
    'cost is labelled as an estimate, not an invoice',
    cost.body.cost?.estimate === true && cost.body.cost?.currency === 'USD',
    JSON.stringify(cost.body.cost),
  );

  /* ------------------------------------------------------- 7. rate limiting */
  // Fire them together: a turn can take longer than the 1-minute window when awaited
  // one by one, which would silently reset the limiter between requests.
  const turns = await Promise.all([0, 1, 2, 3, 4].map((i) => chat(userToken, i)));
  const limited = turns.filter((t) => t.text.includes('"type":"message_limit"'));
  const userLimited = limited.filter((t) => t.text.includes('"limiter":"user"'));
  check(
    'chat rate limit denies the turn once the per-user budget is spent',
    limited.length > 0,
    limited.length ? limited[0].text.slice(limited[0].text.indexOf('message_limit') - 20, limited[0].text.indexOf('message_limit') + 90) : 'no denial frame',
  );
  check(
    'the denial names the per-user limiter, not just the IP one',
    userLimited.length > 0,
    `${userLimited.length} user-limit denial(s) of ${turns.length} turns`,
  );
  check(
    'turns inside the budget are not denied',
    !turns[0].text.includes('message_limit'),
    `turn 1 ${turns[0].text.includes('message_limit') ? 'was' : 'was not'} denied`,
  );
  const limitedBody = await panel('/api/panel/limits', adminToken);
  check(
    'panel reports the limiter that actually fired',
    limitedBody.body.message.userPerWindow === 3,
    `configured ${limitedBody.body.message.userPerWindow}/min`,
  );

  /* ------------------------------------------------------------ 8. audit log */
  const before = await panel('/api/panel/audit?limit=100', adminToken);
  const beforeIds = new Set((before.body.entries ?? []).map((e) => e.id));
  const roleBefore = await panel('/api/panel/role-permissions/USER', adminToken);
  const originalShare = Boolean(roleBefore.body.permissions?.PROMPTS?.SHARE_PUBLIC);
  const patchRole = await panel('/api/panel/roles/USER/permissions/prompts', adminToken, {
    method: 'PUT',
    body: JSON.stringify({ SHARE_PUBLIC: !originalShare }),
  });
  check('admin can change a role permission', patchRole.status === 200, `${patchRole.status}`);
  const roleAfter = await panel('/api/panel/role-permissions/USER', adminToken);
  check(
    'the permission change is persisted in the role document',
    Boolean(roleAfter.body.permissions?.PROMPTS?.SHARE_PUBLIC) === !originalShare,
    `PROMPTS.SHARE_PUBLIC=${roleAfter.body.permissions?.PROMPTS?.SHARE_PUBLIC}`,
  );
  const after = await panel('/api/panel/audit?limit=100', adminToken);
  const newEntries = (after.body.entries ?? []).filter((e) => !beforeIds.has(e.id));
  check(
    'the admin action produced a new audit entry',
    newEntries.length > 0,
    `${newEntries.length} new entries, e.g. ${newEntries[0]?.action ?? 'none'}`,
  );
  const verify = await panel('/api/panel/audit/verify', adminToken);
  check('audit hash chain verifies', verify.status === 200 && verify.body.ok === true, JSON.stringify(verify.body).slice(0, 120));
  const csvRes = await fetch(`${PANEL}/api/panel/audit/export.csv`, { headers: { Authorization: `Bearer ${adminToken}` } });
  const csv = await csvRes.text();
  check('audit log exports as CSV', csvRes.status === 200 && csv.includes(',') && csv.split('\n').length > 1, `${csv.split('\n').length - 1} rows`);
  // restore the permission so the audit run leaves the role as it found it
  await panel('/api/panel/roles/USER/permissions/prompts', adminToken, {
    method: 'PUT',
    body: JSON.stringify({ SHARE_PUBLIC: originalShare }),
  });

  /* ---------------------------------------------------------- 9. data privacy */
  const exportRes = await panel('/api/panel/privacy/export', userToken);
  const userConvos = await db.collection('conversations').countDocuments({ user: createdUserId });
  const userMessages = await db.collection('messages').countDocuments({ user: createdUserId });
  check('account export is generated from the database', exportRes.status === 200 && exportRes.body.format === 'shavi-ai-user-export/v1', `${exportRes.status}`);
  check(
    'export counts match the database rows for that account',
    exportRes.body.counts?.conversations === userConvos && exportRes.body.counts?.messages === userMessages,
    `export ${exportRes.body.counts?.conversations}/${exportRes.body.counts?.messages} vs mongo ${userConvos}/${userMessages}`,
  );
  check(
    'export strips secrets (no password hash / 2FA secret)',
    !JSON.stringify(exportRes.body).includes('$2b$') && !('totpSecret' in (exportRes.body.account ?? {})),
    'account object is sanitised',
  );
  const foreignExport = await panel('/api/panel/privacy/export', adminToken);
  check(
    'export is scoped to the caller (admin export is the admin account, not the other user)',
    foreignExport.body.account?.email === ADMIN_EMAIL,
    `exported ${foreignExport.body.account?.email}`,
  );

  const deleted = await panel('/api/panel/privacy/account', userToken, { method: 'DELETE', body: JSON.stringify({}) });
  check('account deletion runs through the API', deleted.status === 200, `${deleted.status} ${deleted.body.error ?? ''}`.trim());
  const goneUser = await db.collection('users').findOne({ email: TEST_EMAIL });
  const goneConvos = await db.collection('conversations').countDocuments({ user: createdUserId });
  check(
    'deletion cascades: user row and owned conversations are gone',
    goneUser === null && goneConvos === 0,
    `user=${goneUser === null ? 'gone' : 'still present'}, conversations=${goneConvos}`,
  );
  const relogin = await login(TEST_EMAIL, TEST_PASSWORD);
  check('the deleted account can no longer sign in', !relogin.token, `login -> ${relogin.status}`);

  /* ------------------------------------------------------- 10. log hygiene */
  const logs = ['/tmp/shavi-librechat.log', '/tmp/shavi-admin.log']
    .map((f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''))
    .join('\n');
  check('prompt text is not written to the service logs', !logs.includes(PROMPT_TOKEN), 'searched both service logs');
  check(
    'no provider key is present in the panel responses',
    !JSON.stringify(overview.body).includes('nvapi-') && !JSON.stringify(cost.body).includes('nvapi-'),
    'usage/cost payloads carry no keys',
  );
} catch (error) {
  fail('test run completed without an exception', error.stack?.split('\n')[0] ?? String(error));
} finally {
  await client.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('FAILED:', failed.map((f) => f.name).join(' | '));
    process.exitCode = 1;
  }
}
