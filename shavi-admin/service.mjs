#!/usr/bin/env node
/**
 * SHAVI Admin — the admin panel gateway for SHAVI AI (LibreChat) — M11.
 *
 * The LibreChat build in this repo already ships a hardened admin *API*
 * (`/api/admin/{users,roles,grants,groups,audit-log,config}`), a hash-chained audit
 * log and capability-based RBAC, but no admin UI (its `ADMIN_PANEL_URL` points at a
 * separate product) and no usage/cost aggregation. This service adds exactly those
 * two missing pieces without duplicating LibreChat's security model:
 *
 *   • authentication and authorisation are delegated to LibreChat — every admin call
 *     is made with the caller's own JWT, and the panel only opens if LibreChat answers
 *     `/api/admin/users` with 200 (i.e. the caller holds the `access:admin` capability).
 *   • usage/cost numbers are aggregated from the real MongoDB that LibreChat writes to
 *     (`messages.tokenCount`, `conversations`), not from client-side state.
 *   • privacy export reads the caller's own rows from MongoDB; account deletion is
 *     performed by LibreChat's own `DELETE /api/user/delete` cascade.
 *
 *   GET    /                          static admin panel
 *   POST   /api/panel/login           -> LibreChat /api/auth/login (same origin, httpOnly refresh cookie untouched)
 *   POST   /api/panel/logout          -> LibreChat /api/auth/logout
 *   GET    /api/panel/me              -> user + effective capabilities
 *   GET    /api/panel/overview        -> users / conversations / messages / tokens / cost
 *   GET    /api/panel/usage?days=&by= -> day | model | user breakdown
 *   GET    /api/panel/cost?days=      -> estimated cost per model + total
 *   GET    /api/panel/limits          -> effective rate-limit configuration
 *   GET    /api/panel/users           -> proxy of /api/admin/users
 *   GET    /api/panel/roles           -> proxy of /api/admin/roles
 *   PATCH  /api/panel/roles/:name/permissions -> proxy (audited admin action)
 *   GET    /api/panel/audit           -> proxy of /api/admin/audit-log
 *   GET    /api/panel/audit/verify    -> proxy of /api/admin/audit-log/verify
 *   GET    /api/panel/audit/export.csv-> proxy of /api/admin/audit-log/export.csv
 *   GET    /api/panel/privacy/export  -> JSON export of the caller's own data
 *   DELETE /api/panel/privacy/account -> proxy of /api/user/delete (cascade)
 *   GET    /health
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, 'public');
const PORT = Number(process.env.SHAVI_ADMIN_PORT || 4127);
const HOST = process.env.SHAVI_ADMIN_HOST || '0.0.0.0';
const LIBRECHAT = process.env.SHAVI_LIBRECHAT_URL || 'http://127.0.0.1:3080';
const MONGO_URI = process.env.MONGO_URI || process.env.SHAVI_MONGO_URI || 'mongodb://127.0.0.1:27017/LibreChat';

const pricing = JSON.parse(fs.readFileSync(path.join(HERE, 'pricing.json'), 'utf8'));

const log = (...a) => console.log(new Date().toISOString(), '[shavi-admin]', ...a);

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/* ------------------------------------------------------------------ mongo */

let mongoClient;
let mongoDb;
async function mongo() {
  if (mongoDb) return mongoDb;
  mongoClient = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  await mongoClient.connect();
  mongoDb = mongoClient.db();
  return mongoDb;
}

/* --------------------------------------------------------------- LibreChat */

async function lcFetch(pathname, { method = 'GET', token, body, raw = false } = {}) {
  const res = await fetch(`${LIBRECHAT}${pathname}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (raw) return { status: res.status, data, headers: res.headers };
  if (!res.ok) {
    const message =
      (data && (data.message || data.error)) || `LibreChat ${method} ${pathname} failed (${res.status})`;
    throw new HttpError(res.status === 401 ? 401 : res.status === 403 ? 403 : 502, String(message));
  }
  return data;
}

function bearer(req) {
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : '';
}

async function session(req) {
  const token = bearer(req);
  if (!token) throw new HttpError(401, 'Not signed in');
  const user = await lcFetch('/api/user', { token });
  return { token, user };
}

/** Authorisation for every admin surface: LibreChat's own capability check. */
async function adminSession(req) {
  const s = await session(req);
  try {
    await lcFetch('/api/admin/users?limit=1', { token: s.token });
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      throw new HttpError(403, 'Admin capability (access:admin) required');
    }
    throw error;
  }
  const effective = await lcFetch('/api/admin/grants/effective', { token: s.token }).catch(() => null);
  return { ...s, capabilities: effective?.capabilities ?? [] };
}

/* ------------------------------------------------------------------ usage */

const DAY = 24 * 60 * 60 * 1000;

function windowStart(days) {
  const n = Number(days);
  const safe = Number.isFinite(n) && n > 0 ? Math.min(n, 365) : 30;
  return { since: new Date(Date.now() - safe * DAY), days: safe };
}

function priceFor(model) {
  const entry = pricing.models[model];
  if (!entry) return { ...pricing.fallback, model, known: false };
  return { ...entry, model, known: true };
}

function costOf(model, tokens) {
  const p = priceFor(model);
  return (tokens / 1_000_000) * p.blended;
}

async function agentModelMap() {
  const db = await mongo();
  const agents = await db
    .collection('agents')
    .find({}, { projection: { id: 1, model: 1, name: 1 } })
    .toArray();
  return new Map(agents.filter((a) => a.id).map((a) => [a.id, a.model]));
}

async function usageBundle(days) {
  const db = await mongo();
  const agentModels = await agentModelMap();
  const { since, days: window } = windowStart(days);
  const messages = db.collection('messages');
  const conversations = db.collection('conversations');
  const users = db.collection('users');
  const createdAt = { $gte: since };

  const [totals] = await messages
    .aggregate([
      { $match: { createdAt } },
      {
        $group: {
          _id: null,
          messages: { $sum: 1 },
          userMessages: { $sum: { $cond: ['$isCreatedByUser', 1, 0] } },
          assistantMessages: { $sum: { $cond: ['$isCreatedByUser', 0, 1] } },
          tokens: { $sum: { $ifNull: ['$tokenCount', 0] } },
          billableMessages: { $sum: { $cond: [{ $gt: ['$tokenCount', 0] }, 1, 0] } },
        },
      },
    ])
    .toArray();

  const byDay = await messages
    .aggregate([
      { $match: { createdAt } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          messages: { $sum: 1 },
          tokens: { $sum: { $ifNull: ['$tokenCount', 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ])
    .toArray();

  const byModel = await messages
    .aggregate([
      { $match: { createdAt, isCreatedByUser: false } },
      {
        $group: {
          _id: { model: '$model', endpoint: '$endpoint' },
          messages: { $sum: 1 },
          tokens: { $sum: { $ifNull: ['$tokenCount', 0] } },
        },
      },
      { $sort: { tokens: -1 } },
      { $limit: 50 },
    ])
    .toArray();

  const byUserRows = await messages
    .aggregate([
      { $match: { createdAt } },
      {
        $group: {
          _id: '$user',
          messages: { $sum: 1 },
          tokens: { $sum: { $ifNull: ['$tokenCount', 0] } },
        },
      },
      { $sort: { tokens: -1 } },
      { $limit: 100 },
    ])
    .toArray();

  const userIds = byUserRows.map((r) => r._id).filter(Boolean);
  const userDocs = userIds.length
    ? await users.find({ _id: { $in: userIds } }, { projection: { email: 1, name: 1, role: 1 } }).toArray()
    : [];
  const userMap = new Map(userDocs.map((u) => [String(u._id), u]));

  const totalsOut = {
    messages: totals?.messages ?? 0,
    userMessages: totals?.userMessages ?? 0,
    assistantMessages: totals?.assistantMessages ?? 0,
    tokens: totals?.tokens ?? 0,
    billableMessages: totals?.billableMessages ?? 0,
  };
  const modelOut = byModel.map((row) => {
    const model = row._id?.model || 'unknown';
    // Agent turns are recorded with the agent id as `model`; the agent document
    // holds the model that actually produced the tokens, so price against that.
    const pricedAs = agentModels.get(model) || model;
    return {
      model,
      pricedAs,
      endpoint: row._id?.endpoint || 'unknown',
      messages: row.messages,
      tokens: row.tokens,
      usd: Number(costOf(pricedAs, row.tokens).toFixed(4)),
      usdRaw: costOf(pricedAs, row.tokens),
      knownPrice: priceFor(pricedAs).known,
    };
  });
  const userOut = byUserRows.map((row) => {
    const doc = row._id ? userMap.get(String(row._id)) : null;
    return {
      userId: row._id ? String(row._id) : null,
      email: doc?.email ?? '(deleted user)',
      name: doc?.name ?? '',
      role: doc?.role ?? '',
      messages: row.messages,
      tokens: row.tokens,
    };
  });

  const [convos, totalUsers, activeUsers] = await Promise.all([
    conversations.countDocuments({ createdAt }),
    users.countDocuments({}),
    messages.distinct('user', { createdAt }).then((ids) => ids.filter(Boolean).length),
  ]);

  return {
    window: { days: window, since: since.toISOString() },
    totals: { ...totalsOut, conversations: convos, users: totalUsers, activeUsers },
    byDay: byDay.map((d) => ({ date: d._id, messages: d.messages, tokens: d.tokens })),
    byModel: modelOut,
    byUser: userOut,
    cost: {
      currency: pricing.currency,
      unit: pricing.unit,
      total: Number(modelOut.reduce((sum, m) => sum + m.usdRaw, 0).toFixed(4)),
      unpricedTokens: modelOut.filter((m) => !m.knownPrice).reduce((sum, m) => sum + m.tokens, 0),
      estimate: true,
    },
  };
}

/* ---------------------------------------------------------------- privacy */

async function exportUserData(userId) {
  const db = await mongo();
  const { ObjectId } = await import('mongodb');
  const _id = ObjectId.isValid(userId) ? new ObjectId(userId) : userId;
  // LibreChat stores ownership as the hex *string* for conversations/messages/memories and
  // as an ObjectId elsewhere, so scope by both forms instead of guessing per collection.
  const owner = { $in: [String(userId), _id] };
  const user = await db.collection('users').findOne({ _id });
  if (!user) throw new HttpError(404, 'User not found');
  const safeUser = { ...user };
  delete safeUser.password;
  delete safeUser.totpSecret;
  delete safeUser.backupCodes;

  const [conversations, messages, memories, files, projects, sharedLinks] = await Promise.all([
    db.collection('conversations').find({ user: owner }).toArray(),
    db.collection('messages').find({ user: owner }).toArray(),
    db.collection('memoryentries').find({ userId: owner }).toArray().catch(() => []),
    db.collection('files')
      .find({ user: owner }, { projection: { text: 0, content: 0 } })
      .toArray()
      .catch(() => []),
    db.collection('chatprojects').find({ user: owner }).toArray().catch(() => []),
    db.collection('sharedlinks').find({ user: owner }).toArray().catch(() => []),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    format: 'shavi-ai-user-export/v1',
    account: safeUser,
    counts: {
      conversations: conversations.length,
      messages: messages.length,
      memories: memories.length,
      files: files.length,
      projects: projects.length,
      sharedLinks: sharedLinks.length,
    },
    conversations,
    messages,
    memories,
    files,
    projects,
    sharedLinks,
  };
}

/* ------------------------------------------------------------------ limits */

function limitConfig() {
  const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
  const bool = (v) => String(v).toLowerCase() === 'true';
  return {
    enforcedBy: 'LibreChat express-rate-limit middleware (per IP and per user)',
    durable: false,
    note: 'In-memory counters per backend process. LibreChat persists nothing for these windows; a restart resets them. Set USE_REDIS=true (LibreChat) for shared, durable counters across replicas.',
    message: {
      enabled: bool(process.env.LIMIT_MESSAGE_USER) || bool(process.env.LIMIT_MESSAGE_IP),
      userPerWindow: num(process.env.MESSAGE_USER_MAX, 40),
      userWindowMinutes: num(process.env.MESSAGE_USER_WINDOW, 1),
      ipPerWindow: num(process.env.MESSAGE_IP_MAX, 40),
      ipWindowMinutes: num(process.env.MESSAGE_IP_WINDOW, 1),
    },
    login: {
      perWindow: num(process.env.LOGIN_MAX, 7),
      windowMinutes: num(process.env.LOGIN_WINDOW, 5),
    },
    register: {
      perWindow: num(process.env.REGISTER_MAX, 7),
      windowMinutes: num(process.env.REGISTER_WINDOW, 5),
    },
    tools: {
      toolCallPerWindow: num(process.env.TOOL_CALL_USER_MAX, 30),
      toolCallWindowMinutes: num(process.env.TOOL_CALL_USER_WINDOW, 3),
    },
  };
}

/* ------------------------------------------------------------------ server */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/vnd.microsoft.icon',
};

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new HttpError(413, 'Body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = path.join(PUBLIC, rel);
  if (!target.startsWith(PUBLIC)) throw new HttpError(403, 'Forbidden');
  const data = await fsp.readFile(target).catch(() => null);
  if (!data) throw new HttpError(404, 'Not found');
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(target)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  const method = req.method || 'GET';
  try {
    if (p === '/health') {
      const db = await mongo().catch(() => null);
      return send(res, db ? 200 : 503, {
        status: db ? 'ok' : 'degraded',
        mongo: Boolean(db),
        librechat: LIBRECHAT,
        uptime: Math.round(process.uptime()),
      });
    }

    if (p === '/api/panel/login' && method === 'POST') {
      const body = await readBody(req);
      if (!body.email || !body.password) throw new HttpError(400, 'Email and password are required');
      const result = await lcFetch('/api/auth/login', { method: 'POST', body });
      return send(res, 200, {
        token: result.token,
        user: result.user,
      });
    }

    if (p === '/api/panel/logout' && method === 'POST') {
      const s = await session(req);
      await lcFetch('/api/auth/logout', { method: 'POST', token: s.token }).catch(() => null);
      return send(res, 200, { ok: true });
    }

    if (p === '/api/panel/me') {
      const s = await adminSession(req);
      return send(res, 200, {
        user: {
          id: s.user.id,
          email: s.user.email,
          name: s.user.name,
          role: s.user.role,
        },
        capabilities: s.capabilities,
      });
    }

    if (p === '/api/panel/overview' || p === '/api/panel/usage' || p === '/api/panel/cost') {
      await adminSession(req);
      const bundle = await usageBundle(url.searchParams.get('days') || 30);
      if (p === '/api/panel/overview') return send(res, 200, bundle);
      if (p === '/api/panel/cost') return send(res, 200, { window: bundle.window, cost: bundle.cost, byModel: bundle.byModel });
      const by = url.searchParams.get('by') || 'model';
      return send(res, 200, {
        window: bundle.window,
        totals: bundle.totals,
        by,
        rows: by === 'day' ? bundle.byDay : by === 'user' ? bundle.byUser : bundle.byModel,
      });
    }

    if (p === '/api/panel/limits') {
      await adminSession(req);
      return send(res, 200, limitConfig());
    }

    if (p === '/api/panel/users') {
      const s = await adminSession(req);
      const q = new URLSearchParams(url.searchParams);
      if (!q.has('limit')) q.set('limit', '25');
      const data = await lcFetch(`/api/admin/users?${q}`, { token: s.token });
      return send(res, 200, data);
    }

    if (p === '/api/panel/roles' && method === 'GET') {
      const s = await adminSession(req);
      const data = await lcFetch('/api/admin/roles', { token: s.token });
      return send(res, 200, data);
    }

    // `/api/admin/roles/:name` omits the legacy permission map, so role details for the
    // panel come from the role endpoint the client itself uses.
    const roleDetail = /^\/api\/panel\/role-permissions\/([^/]+)$/.exec(p);
    if (roleDetail && method === 'GET') {
      const s = await adminSession(req);
      const data = await lcFetch(`/api/roles/${encodeURIComponent(roleDetail[1])}`, { token: s.token });
      return send(res, 200, data);
    }

    // A permission group is written through the documented per-group route
    // (`PUT /api/roles/:name/prompts`), which merges into the legacy role document.
    const rolePerm = /^\/api\/panel\/roles\/([^/]+)\/permissions\/([a-z-]+)$/.exec(p);
    if (rolePerm && (method === 'PATCH' || method === 'PUT')) {
      const s = await adminSession(req);
      const body = await readBody(req);
      const data = await lcFetch(
        `/api/roles/${encodeURIComponent(rolePerm[1])}/${encodeURIComponent(rolePerm[2])}`,
        { method: 'PUT', token: s.token, body },
      );
      log('role permission group updated by', s.user.email, '->', rolePerm[1], rolePerm[2]);
      return send(res, 200, data);
    }

    if (p === '/api/panel/audit/verify') {
      const s = await adminSession(req);
      return send(res, 200, await lcFetch('/api/admin/audit-log/verify', { token: s.token }));
    }

    if (p === '/api/panel/audit/export.csv') {
      const s = await adminSession(req);
      const { data } = await lcFetch('/api/admin/audit-log/export.csv', { token: s.token, raw: true });
      return send(res, 200, typeof data === 'string' ? data : JSON.stringify(data), {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="shavi-audit-log.csv"',
      });
    }

    if (p === '/api/panel/audit') {
      const s = await adminSession(req);
      const q = new URLSearchParams(url.searchParams);
      q.set('limit', q.get('limit') || '50');
      const data = await lcFetch(`/api/admin/audit-log?${q}`, { token: s.token });
      return send(res, 200, data);
    }

    if (p === '/api/panel/privacy/export') {
      const s = await session(req);
      const data = await exportUserData(s.user.id);
      return send(res, 200, data, {
        'Content-Disposition': `attachment; filename="shavi-ai-export-${Date.now()}.json"`,
      });
    }

    if (p === '/api/panel/privacy/account' && method === 'DELETE') {
      const s = await session(req);
      const body = await readBody(req);
      const result = await lcFetch('/api/user/delete', { method: 'DELETE', token: s.token, body });
      log('account deleted:', s.user.email);
      return send(res, 200, { ok: true, result });
    }

    if (p.startsWith('/api/')) throw new HttpError(404, 'Unknown endpoint');
    return await serveStatic(res, p);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status >= 500) log('error', method, p, error.message);
    return send(res, status, { error: error.message, ...(error.extra || {}) });
  }
});

server.listen(PORT, HOST, () => {
  log(`listening on http://${HOST}:${PORT}  (LibreChat ${LIBRECHAT})`);
});

const shutdown = () => {
  server.close();
  mongoClient?.close().catch(() => {});
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
