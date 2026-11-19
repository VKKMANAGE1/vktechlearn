#!/usr/bin/env node
/**
 * SHAVI Code — a local, LibreChat-compatible Code Interpreter API.
 *
 * LibreChat's `execute_code` agent tool posts to `${LIBRECHAT_CODE_BASEURL}/exec` and
 * then downloads any generated artifact from `${base}/files/<session>/<file>`. This
 * service implements that contract on this host, executing each call in a namespaced
 * sandbox (see sandbox.sh): no host filesystem, no network, no inherited secrets,
 * CPU/memory/file-size limits and a hard wall-clock timeout.
 *
 *   POST   /exec                          -> { session_id, stdout, stderr, files? }
 *   POST   /exec/programmatic             -> same contract (programmatic tool calling)
 *   GET    /files/:session/:file          -> raw artifact bytes
 *   HEAD   /files/:session/:file
 *   DELETE /files/:session/:file          -> { deleted: true }
 *   GET    /sessions/:session/objects/:id -> 404 (no pre-seeded objects on this host)
 *   GET    /health                        -> { status: "ok", ... }
 *
 * Nothing is simulated: the program really runs, and only what it prints or writes is
 * returned. If Python/Node are missing the call fails loudly instead of faking output.
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.SHAVI_CODE_PORT || 4126);
const HOST = process.env.SHAVI_CODE_HOST || '127.0.0.1';
const RUNTIME = process.env.SHAVI_CODE_RUNTIME || path.join(HERE, 'runtime');
const SESSIONS = path.join(RUNTIME, 'sessions');
const SANDBOX = path.join(HERE, 'sandbox.sh');

const TIMEOUT_MS = Number(process.env.SHAVI_CODE_TIMEOUT_MS || 30000);
const MAX_OUTPUT = Number(process.env.SHAVI_CODE_MAX_OUTPUT || 60000);
const MAX_FILES = Number(process.env.SHAVI_CODE_MAX_FILES || 25);
const MAX_FILE_BYTES = Number(process.env.SHAVI_CODE_MAX_FILE_BYTES || 32 * 1024 * 1024);
const SESSION_TTL_MS = Number(process.env.SHAVI_CODE_SESSION_TTL_MS || 6 * 60 * 60 * 1000);
const AS_LIMIT = process.env.SHAVI_CODE_MEMORY_BYTES || '536870912';
const CPU_SECONDS = process.env.SHAVI_CODE_CPU_SECONDS || '25';

const log = (...args) => console.log(new Date().toISOString(), '[shavi-code]', ...args);

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJson(req, limit = 8 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Request body too large', 'payload_too_large');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks);
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw new HttpError(400, 'Body is not valid JSON', 'invalid_json');
  }
}

/** Language ids LibreChat's code tool sends; anything else is refused, never guessed. */
const LANGUAGES = {
  py: { file: 'main.py', command: '/usr/local/bin/python3', entry: '/mnt/data/main.py', label: 'Python 3' },
  python: { file: 'main.py', command: '/usr/local/bin/python3', entry: '/mnt/data/main.py', label: 'Python 3' },
  python3: { file: 'main.py', command: '/usr/local/bin/python3', entry: '/mnt/data/main.py', label: 'Python 3' },
  js: { file: 'main.js', command: '/usr/local/bin/node', entry: '/mnt/data/main.js', label: 'Node.js' },
  javascript: { file: 'main.js', command: '/usr/local/bin/node', entry: '/mnt/data/main.js', label: 'Node.js' },
  node: { file: 'main.js', command: '/usr/local/bin/node', entry: '/mnt/data/main.js', label: 'Node.js' },
  bash: { file: 'main.sh', command: '/bin/bash', entry: '/mnt/data/main.sh', label: 'Bash' },
  sh: { file: 'main.sh', command: '/bin/bash', entry: '/mnt/data/main.sh', label: 'Bash' },
  shell: { file: 'main.sh', command: '/bin/bash', entry: '/mnt/data/main.sh', label: 'Bash' },
};

function sessionDir(sessionId) {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(sessionId || '')) {
    throw new HttpError(400, 'Invalid session id', 'invalid_session');
  }
  return path.join(SESSIONS, sessionId);
}

async function readManifest(dir) {
  try {
    return JSON.parse(await fsp.readFile(path.join(dir, 'files.json'), 'utf8'));
  } catch {
    return {};
  }
}

async function writeManifest(dir, manifest) {
  await fsp.writeFile(path.join(dir, 'files.json'), JSON.stringify(manifest), { mode: 0o600 });
}

/** File writes are only picked up from /mnt/data; that is the only writable mount. */
async function collectFiles(dir, sessionId) {
  const dataDir = path.join(dir, 'data');
  const manifest = await readManifest(dir);
  const entries = [];
  const walk = async (relative) => {
    const absolute = path.join(dataDir, relative);
    const stats = await fsp.stat(absolute).catch(() => null);
    if (stats == null) return;
    if (stats.isDirectory()) {
      for (const child of await fsp.readdir(absolute)) {
        await walk(path.join(relative, child));
      }
      return;
    }
    if (!stats.isFile() || stats.size === 0 || stats.size > MAX_FILE_BYTES) return;
    if (relative === 'main.py' || relative === 'main.js' || relative === 'main.sh') return;
    const name = path.basename(relative);
    if (!/^[\w.\- ()[\]]+$/.test(name)) return;
    entries.push({ relative, name, bytes: stats.size });
  };
  await walk('');
  await fsp.rm(path.join(dataDir, 'main.py'), { force: true });
  await fsp.rm(path.join(dataDir, 'main.js'), { force: true });
  await fsp.rm(path.join(dataDir, 'main.sh'), { force: true });

  const refs = [];
  for (const entry of entries.slice(0, MAX_FILES)) {
    const existing = Object.entries(manifest).find(([, value]) => value.relative === entry.relative);
    const id = existing ? existing[0] : crypto.randomUUID();
    manifest[id] = { relative: entry.relative, name: entry.name, bytes: entry.bytes };
    refs.push({
      id,
      name: entry.name,
      path: `/mnt/data/${entry.relative}`,
      storage_session_id: sessionId,
    });
  }
  await writeManifest(dir, manifest);
  return { refs, truncated: entries.length > MAX_FILES ? entries.length - MAX_FILES : 0 };
}

function runSandbox(args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(
      'unshare',
      ['-r', '-m', '-n', '-p', '-f', '--mount-proc', '/bin/bash', SANDBOX, ...args],
      { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' } },
    );
    const stdout = [];
    const stderr = [];
    let outBytes = 0;
    let errBytes = 0;
    let killedBy = null;
    const timer = setTimeout(() => {
      killedBy = 'timeout';
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      if (outBytes < MAX_OUTPUT) {
        stdout.push(chunk);
        outBytes += chunk.length;
      }
    });
    child.stderr.on('data', (chunk) => {
      if (errBytes < MAX_OUTPUT) {
        stderr.push(chunk);
        errBytes += chunk.length;
      }
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout: '', stderr: `sandbox launch failed: ${error.message}`, killedBy: 'error' });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      let out = Buffer.concat(stdout).toString('utf8');
      let err = Buffer.concat(stderr).toString('utf8');
      if (outBytes > MAX_OUTPUT) out = `${out}\n[stdout truncated at ${MAX_OUTPUT} bytes]`;
      if (errBytes > MAX_OUTPUT) err = `${err}\n[stderr truncated at ${MAX_OUTPUT} bytes]`;
      if (killedBy === 'timeout') {
        err = `${err}${err ? '\n' : ''}[execution killed after ${timeoutMs} ms timeout]`;
      }
      resolve({ code, stdout: out, stderr: err, killedBy });
    });
  });
}

async function handleExec(req, res) {
  const body = await readJson(req);
  const lang = String(body.lang || 'py').toLowerCase();
  const code = typeof body.code === 'string' ? body.code : '';
  if (!code.trim()) throw new HttpError(400, 'code is required', 'invalid_request');
  const runtime = LANGUAGES[lang];
  if (!runtime) {
    throw new HttpError(
      400,
      `Unsupported language "${lang}". This interpreter runs py, js and bash.`,
      'unsupported_language',
    );
  }

  const sessionId = crypto.randomUUID().replace(/-/g, '').slice(0, 24);
  const dir = sessionDir(sessionId);
  const dataDir = path.join(dir, 'data');
  await fsp.mkdir(dataDir, { recursive: true, mode: 0o700 });
  await fsp.writeFile(path.join(dataDir, runtime.file), code, { mode: 0o600 });

  const extraArgs = Array.isArray(body.args) ? body.args.map(String).slice(0, 16) : [];
  const command = [runtime.entry, ...extraArgs];
  const limitArgs = [
    'prlimit',
    `--as=${AS_LIMIT}`,
    `--cpu=${CPU_SECONDS}`,
    '--nproc=96',
    `--fsize=${MAX_FILE_BYTES}`,
    '--nofile=256',
    '--core=0',
    '--',
    runtime.command,
    ...command,
  ];

  const started = Date.now();
  const result = await runSandbox([dir, ...limitArgs], TIMEOUT_MS);
  const took = Date.now() - started;
  const files = await collectFiles(dir, sessionId);

  log(
    `exec lang=${runtime.label} session=${sessionId} exit=${result.code} ms=${took} ` +
      `out=${result.stdout.length}B err=${result.stderr.length}B files=${files.refs.length}`,
  );

  const response = {
    session_id: sessionId,
    stdout: result.stdout,
    stderr: result.stderr,
    files: files.refs,
  };
  if (files.truncated > 0) {
    response.artifact_truncation = { code: 'artifact_truncated', reasons: { max_files: files.truncated } };
  }
  return sendJson(res, 200, response);
}

const CONTENT_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip',
};

async function handleDownload(req, res, sessionId, fileId, headOnly = false) {
  const dir = sessionDir(sessionId);
  const manifest = await readManifest(dir);
  const entry = manifest[fileId];
  if (!entry) throw new HttpError(404, 'File not found in this session', 'not_found');
  const absolute = path.join(dir, 'data', entry.relative);
  const stats = await fsp.stat(absolute).catch(() => null);
  if (stats == null) throw new HttpError(404, 'File no longer exists', 'not_found');
  const contentType = CONTENT_TYPES[path.extname(entry.name).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'content-type': contentType,
    'content-length': stats.size,
    'content-disposition': `attachment; filename="${entry.name.replace(/"/g, '')}"`,
  });
  if (headOnly) return res.end();
  return fs.createReadStream(absolute).pipe(res);
}

async function handleDeleteFile(res, sessionId, fileId) {
  const dir = sessionDir(sessionId);
  const manifest = await readManifest(dir);
  const entry = manifest[fileId];
  if (entry) {
    await fsp.rm(path.join(dir, 'data', entry.relative), { force: true });
    delete manifest[fileId];
    await writeManifest(dir, manifest);
  }
  return sendJson(res, 200, { deleted: true });
}

/** Sessions older than the TTL are removed on boot and hourly, so /mnt/data never grows forever. */
async function pruneSessions() {
  let names = [];
  try {
    names = await fsp.readdir(SESSIONS);
  } catch {
    return;
  }
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const name of names) {
    const target = path.join(SESSIONS, name);
    const stats = await fsp.stat(target).catch(() => null);
    if (stats && stats.mtimeMs < cutoff) {
      await fsp.rm(target, { recursive: true, force: true });
    }
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, {
        status: 'ok',
        service: 'shavi-code',
        engines: ['py', 'js', 'bash'],
        sandbox: 'user+mount+network+pid namespaces, chroot, prlimit, timeout',
        timeout_ms: TIMEOUT_MS,
      });
    }
    if (req.method === 'POST' && (url.pathname === '/exec' || url.pathname === '/exec/programmatic')) {
      return await handleExec(req, res);
    }
    /** LibreChat's artifact download path is `/download/<session>/<file>` (see
     *  Files/Code/process.js downloadCodeOutputBuffer); `/files/...` is the same bytes. */
    const fileMatch = /^\/(?:files|download)\/([A-Za-z0-9_-]+)\/([A-Za-z0-9-]+)$/.exec(url.pathname);
    if (fileMatch && (req.method === 'GET' || req.method === 'HEAD')) {
      return await handleDownload(req, res, fileMatch[1], fileMatch[2], req.method === 'HEAD');
    }
    if (fileMatch && req.method === 'DELETE') {
      return await handleDeleteFile(res, fileMatch[1], fileMatch[2]);
    }
    const objectMatch = /^\/sessions\/([A-Za-z0-9_-]+)\/objects\/([A-Za-z0-9-]+)$/.exec(url.pathname);
    if (objectMatch) {
      return sendJson(res, 404, { detail: 'No pre-seeded objects on this interpreter', code: 'not_found' });
    }
    return sendJson(res, 404, { detail: `No route for ${req.method} ${url.pathname}` });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status >= 500) log(`error ${req.method} ${url.pathname}:`, error.message);
    return sendJson(res, status, { detail: error.message, code: error.code || 'error' });
  }
});

await fsp.mkdir(SESSIONS, { recursive: true });
await pruneSessions();
setInterval(pruneSessions, 60 * 60 * 1000).unref();
server.listen(PORT, HOST, () => {
  log(`listening on http://${HOST}:${PORT} — timeout ${TIMEOUT_MS} ms, memory ${AS_LIMIT} bytes`);
});
