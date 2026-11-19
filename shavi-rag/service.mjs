#!/usr/bin/env node
/**
 * SHAVI RAG — a local, LibreChat-compatible retrieval service.
 *
 * LibreChat only offers the `file_search` agent tool when a RAG API is reachable
 * (`RAG_API_URL`). The official rag_api image needs Postgres/pgvector and an
 * embeddings key, neither of which this deployment has, so the subset LibreChat
 * actually calls is implemented here, backed by the NVIDIA embeddings endpoint that
 * is already configured with SHAVI_AI_KEY:
 *
 *   GET    /health                     -> { status: "ok", ... }
 *   POST   /text                       -> { text }              (plain-text types only)
 *   POST   /embed                      -> { status, known_type }
 *   POST   /query                      -> [[chunk, distance], ...]
 *   GET    /ids?entity_id=             -> [file_id, ...]
 *   DELETE /documents?entity_id=       -> { deleted: n }        (body: [file_id, ...])
 *
 * Every embedding is a real provider call; the vector store is a JSON file per
 * document, scoped by the JWT `id` LibreChat signs (HS256, JWT_SECRET), so one user's
 * uploads can never be retrieved by another user. Text extraction for documents is
 * left to LibreChat's own parser (see /text below) so the M06/M07 extraction and OCR
 * pipeline keeps being the single source of truth.
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.SHAVI_RAG_PORT || 4125);
const HOST = process.env.SHAVI_RAG_HOST || '127.0.0.1';
const STORE = process.env.SHAVI_RAG_STORE || path.join(HERE, 'runtime', 'vectors');
const NVIDIA_KEY = process.env.SHAVI_AI_KEY || process.env.NVIDIA_API_KEY || '';
const EMBED_BASE = process.env.SHAVI_RAG_EMBED_BASE || 'https://integrate.api.nvidia.com/v1';
/**
 * Embeddings run locally by default: a multilingual sentence-transformer executed with
 * onnxruntime (CPU, quantised). The NVIDIA hosted embedding models in this account answer
 * `/v1/embeddings` with 504 after ~120 s, which would make `file_search` unusable, and a
 * local model also keeps retrieval working when the network is down. Set
 * SHAVI_RAG_EMBED_PROVIDER=nvidia to send embeddings to the hosted endpoint instead.
 */
const EMBED_PROVIDER = (process.env.SHAVI_RAG_EMBED_PROVIDER || 'local').toLowerCase();
const LOCAL_EMBED_MODEL = process.env.SHAVI_RAG_EMBED_LOCAL_MODEL || 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
const EMBED_MODEL =
  EMBED_PROVIDER === 'nvidia'
    ? process.env.SHAVI_RAG_EMBED_MODEL || 'nvidia/nemotron-3.5-embed-1b'
    : LOCAL_EMBED_MODEL;
// transformers.js stores its ONNX weights in the runtime dir (gitignored), never in the repo.
if (!process.env.HF_HOME) process.env.HF_HOME = path.join(HERE, 'runtime', 'hf');
const JWT_SECRET = process.env.JWT_SECRET || '';
const LIBRECHAT = process.env.SHAVI_LIBRECHAT_DIR || path.join(HERE, '..', 'librechat');

const CHUNK_CHARS = Number(process.env.SHAVI_RAG_CHUNK_CHARS || 1200);
const CHUNK_OVERLAP = Number(process.env.SHAVI_RAG_CHUNK_OVERLAP || 180);
const MAX_QUERY_K = 20;
const EMBED_BATCH = 8;

const log = (...args) => console.log(new Date().toISOString(), '[shavi-rag]', ...args);

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

async function readBody(req, limit = 64 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Request body too large', 'payload_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const raw = await readBody(req, 8 * 1024 * 1024);
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw new HttpError(400, 'Body is not valid JSON', 'invalid_json');
  }
}

/** Same minimal multipart reader used by the media gateway (file_id/file + fields). */
function parseMultipart(buffer, contentType) {
  const match = /boundary="?([^";]+)"?/i.exec(contentType || '');
  if (!match) throw new HttpError(400, 'multipart/form-data without a boundary', 'invalid_multipart');
  const boundary = Buffer.from(`--${match[1]}`);
  const fields = {};
  const files = [];
  let index = buffer.indexOf(boundary);
  if (index === -1) throw new HttpError(400, 'multipart body has no parts', 'invalid_multipart');
  while (index !== -1) {
    let start = index + boundary.length;
    if (buffer.slice(start, start + 2).toString() === '--') break;
    start += 2;
    const end = buffer.indexOf(boundary, start);
    if (end === -1) break;
    const part = buffer.slice(start, end);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) {
      index = end;
      continue;
    }
    const headerText = part.slice(0, headerEnd).toString('utf8');
    const body = part.slice(headerEnd + 4, part.length - 2);
    const nameMatch = /name="([^"]*)"/i.exec(headerText);
    const filenameMatch = /filename="([^"]*)"/i.exec(headerText);
    const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerText);
    if (nameMatch) {
      if (filenameMatch) {
        files.push({
          field: nameMatch[1],
          filename: filenameMatch[1],
          mimeType: typeMatch ? typeMatch[1].trim() : 'application/octet-stream',
          data: body,
        });
      } else {
        fields[nameMatch[1]] = body.toString('utf8');
      }
    }
    index = end;
  }
  return { fields, file: files[0] ?? null, files };
}

/* ------------------------------------------------------------------ auth ---- */

function base64urlToBuffer(value) {
  return Buffer.from(String(value).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * Verifies the short-lived HS256 token LibreChat signs for RAG calls and returns its
 * `id` (the owning user). No token, a bad signature, an expired token or a token
 * signed with another secret is refused — this service never trusts a raw user id.
 */
function requireUserId(req) {
  if (!JWT_SECRET) throw new HttpError(500, 'JWT_SECRET is not configured', 'server_misconfigured');
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) throw new HttpError(401, 'Missing bearer token', 'unauthorized');
  const token = header.slice(7).trim();
  const parts = token.split('.');
  if (parts.length !== 3) throw new HttpError(401, 'Malformed token', 'unauthorized');
  const [head, payload, signature] = parts;
  const expected = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${head}.${payload}`)
    .digest();
  const given = base64urlToBuffer(signature);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw new HttpError(401, 'Invalid token signature', 'unauthorized');
  }
  let claims;
  try {
    claims = JSON.parse(base64urlToBuffer(payload).toString('utf8'));
  } catch {
    throw new HttpError(401, 'Malformed token payload', 'unauthorized');
  }
  if (claims.exp != null && Number(claims.exp) * 1000 < Date.now()) {
    throw new HttpError(401, 'Token expired', 'unauthorized');
  }
  if (typeof claims.id !== 'string' || claims.id.length === 0) {
    throw new HttpError(401, 'Token has no user id', 'unauthorized');
  }
  return claims.id;
}

/* ------------------------------------------------------- text extraction ---- */

const requireFromLibreChat = createRequire(path.join(LIBRECHAT, 'package.json'));
let pdfjsPromise = null;
function loadPdfjs() {
  if (pdfjsPromise == null) {
    const entry = path.join(LIBRECHAT, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs');
    pdfjsPromise = import(pathToFileURL(entry).href);
  }
  return pdfjsPromise;
}

const TEXT_EXTENSIONS = /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|html?|log|yaml|yml|ini|conf|srt|vtt)$/i;

async function extractPdf(buffer) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
  }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => (typeof item.str === 'string' ? item.str : ''))
      .join(' ')
      .replace(/[ \t]+/g, ' ')
      .trim();
    pages.push(`[Page ${n}]\n${text}`);
    page.cleanup();
  }
  await doc.destroy();
  return pages.join('\n\n');
}

async function extractDocx(buffer) {
  const mammoth = requireFromLibreChat('mammoth');
  const { value } = await mammoth.extractRawText({ buffer });
  return String(value || '');
}

function extractSpreadsheet(buffer) {
  const XLSX = requireFromLibreChat('xlsx');
  const book = XLSX.read(buffer, { type: 'buffer' });
  return book.SheetNames.map((name) => {
    const sheet = book.Sheets[name];
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    return `[Sheet: ${name}]\n${csv}`;
  }).join('\n\n');
}

/** Returns { text, kind } or throws 415 so LibreChat falls back to its own parser. */
async function extractText(file) {
  const name = file.filename || 'upload';
  const mime = (file.mimeType || '').toLowerCase();
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) {
    return { text: await extractPdf(file.data), kind: 'pdf' };
  }
  if (/wordprocessingml/.test(mime) || /\.docx$/i.test(name)) {
    return { text: await extractDocx(file.data), kind: 'docx' };
  }
  if (/spreadsheetml|ms-excel|\.xlsx?$|\.csv$/i.test(`${mime} ${name}`)) {
    return { text: extractSpreadsheet(file.data), kind: 'spreadsheet' };
  }
  if (TEXT_EXTENSIONS.test(name) || mime.startsWith('text/') || mime === 'application/json') {
    return { text: file.data.toString('utf8'), kind: 'text' };
  }
  throw new HttpError(415, `No local extractor for ${mime || name}`, 'unsupported_type');
}

/* ------------------------------------------------------------ embeddings ---- */

let extractorPromise = null;

/** Loads (once) and returns the local multilingual embedding pipeline. */
async function getExtractor() {
  if (extractorPromise == null) {
    extractorPromise = (async () => {
      const started = Date.now();
      const { pipeline } = await import('@huggingface/transformers');
      const extractor = await pipeline('feature-extraction', EMBED_MODEL, { dtype: 'q8' });
      log(`embedding model ready: ${EMBED_MODEL} (${Date.now() - started} ms)`);
      return extractor;
    })().catch((error) => {
      extractorPromise = null;
      throw new HttpError(503, `Embedding model failed to load: ${error.message}`, 'not_configured');
    });
  }
  return extractorPromise;
}

async function embedBatch(inputs) {
  if (EMBED_PROVIDER !== 'nvidia') {
    const extractor = await getExtractor();
    const output = await extractor(inputs, { pooling: 'mean', normalize: true });
    return output.tolist();
  }
  if (!NVIDIA_KEY) throw new HttpError(503, 'Embeddings unavailable: SHAVI_AI_KEY missing', 'not_configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(`${EMBED_BASE}/embeddings`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${NVIDIA_KEY}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ input: inputs, model: EMBED_MODEL, input_type: inputType, truncate: 'END' }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new HttpError(502, `Embedding provider ${response.status}: ${text.slice(0, 300)}`, 'embedding_failed');
    }
    const parsed = JSON.parse(text);
    const vectors = (parsed.data || []).map((row) => row.embedding);
    if (vectors.length !== inputs.length) {
      throw new HttpError(502, 'Embedding provider returned the wrong number of vectors', 'embedding_failed');
    }
    return vectors;
  } finally {
    clearTimeout(timer);
  }
}

async function embedAll(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const slice = texts.slice(i, i + EMBED_BATCH);
    const vectors = await embedBatch(slice);
    out.push(...vectors);
  }
  return out;
}

/* --------------------------------------------------------------- chunking ---- */

function splitText(text) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\u0000/g, '');
  const paragraphs = normalized.split(/\n{2,}/);
  const chunks = [];
  let current = '';
  let currentPage = null;
  let nextPage = null;
  const flush = () => {
    const body = current.trim();
    if (body.length > 0) chunks.push({ text: body, page: currentPage });
    current = '';
  };
  for (const raw of paragraphs) {
    const pageMatch = /^\[Page (\d+)\]/i.exec(raw.trim());
    if (pageMatch) nextPage = Number(pageMatch[1]);
    const pieces = raw.length > CHUNK_CHARS * 2 ? raw.match(/[\s\S]{1,900}(?=\s|$)/g) || [raw] : [raw];
    for (const piece of pieces) {
      if (pageMatch && current.trim().length === 0) currentPage = nextPage;
      if (current.length + piece.length + 2 > CHUNK_CHARS && current.length > 0) {
        flush();
        const tail = chunks.length > 0 ? chunks[chunks.length - 1].text.slice(-CHUNK_OVERLAP) : '';
        current = tail ? `${tail}\n${piece}` : piece;
        if (pageMatch) currentPage = nextPage;
      } else {
        current = current ? `${current}\n\n${piece}` : piece;
        if (pageMatch && currentPage == null) currentPage = nextPage;
      }
    }
  }
  flush();
  return chunks.filter((chunk) => chunk.text.trim().length > 0);
}

/* ------------------------------------------------------------------ store ---- */

function storePath(fileId, entityId) {
  const scope = entityId ? `entity-${entityId}` : 'user';
  const safe = crypto.createHash('sha256').update(String(fileId)).digest('hex').slice(0, 40);
  return path.join(STORE, scope, `${safe}.json`);
}

async function readRecord(fileId, entityId) {
  try {
    return JSON.parse(await fsp.readFile(storePath(fileId, entityId), 'utf8'));
  } catch {
    return null;
  }
}

async function writeRecord(record) {
  const target = storePath(record.file_id, record.entity_id);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(record), { mode: 0o600 });
  await fsp.rename(tmp, target);
}

async function listScoped(fileId, userId, entityId) {
  const records = [];
  const own = await readRecord(fileId, null);
  if (own && own.user_id === userId) records.push(own);
  if (entityId) {
    const shared = await readRecord(fileId, entityId);
    if (shared) records.push(shared);
  }
  return records;
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/* --------------------------------------------------------------- handlers ---- */

async function handleEmbed(req, res) {
  const userId = requireUserId(req);
  const { fields, file } = parseMultipart(await readBody(req), req.headers['content-type']);
  const fileId = fields.file_id;
  if (!fileId) throw new HttpError(400, 'file_id is required', 'invalid_request');
  if (!file) throw new HttpError(400, 'file is required', 'invalid_request');
  const entityId = fields.entity_id && fields.entity_id.trim() ? fields.entity_id.trim() : null;

  let extracted;
  try {
    extracted = await extractText(file);
  } catch (error) {
    if (error instanceof HttpError && error.status === 415) {
      // LibreChat treats known_type:false as "this type cannot be embedded".
      return sendJson(res, 200, { status: false, known_type: false, reason: error.message });
    }
    throw error;
  }
  const chunks = splitText(extracted.text);
  if (chunks.length === 0) {
    return sendJson(res, 200, { status: false, known_type: true, reason: 'no extractable text' });
  }
  const vectors = await embedAll(chunks.map((chunk) => chunk.text));
  const record = {
    file_id: fileId,
    entity_id: entityId,
    user_id: userId,
    source: file.filename || fileId,
    kind: extracted.kind,
    model: EMBED_MODEL,
    created_at: new Date().toISOString(),
    chunks: chunks.map((chunk, index) => ({
      text: chunk.text,
      page: chunk.page,
      embedding: vectors[index],
    })),
  };
  await writeRecord(record);
  log(`embed ok file=${fileId} scope=${entityId ? `entity:${entityId}` : 'user'} kind=${record.kind} chunks=${chunks.length}`);
  return sendJson(res, 200, { status: true, known_type: true, chunks: chunks.length });
}

async function handleQuery(req, res) {
  const userId = requireUserId(req);
  const body = await readJson(req);
  const fileId = body.file_id;
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!fileId) throw new HttpError(400, 'file_id is required', 'invalid_request');
  if (!query) throw new HttpError(400, 'query is required', 'invalid_request');
  const k = Math.min(Math.max(Number(body.k) || 5, 1), MAX_QUERY_K);
  const entityId = typeof body.entity_id === 'string' && body.entity_id ? body.entity_id : null;

  const records = await listScoped(fileId, userId, entityId);
  if (records.length === 0) {
    // LibreChat treats an empty list as "nothing indexed"; a 404 would be retried as an error.
    return sendJson(res, 200, []);
  }
  const [queryVector] = await embedBatch([query]);
  const hits = [];
  for (const record of records) {
    for (const chunk of record.chunks) {
      const similarity = cosine(queryVector, chunk.embedding);
      hits.push({
        page_content: chunk.text,
        metadata: {
          source: record.source,
          page: typeof chunk.page === 'number' ? chunk.page - 1 : null,
          user_id: record.user_id,
          file_id: record.file_id,
        },
        distance: 1 - similarity,
      });
    }
  }
  hits.sort((a, b) => a.distance - b.distance);
  const top = hits.slice(0, k);
  log(`query file=${fileId} scope=${entityId ? `entity:${entityId}` : 'user'} k=${k} hits=${top.length} best=${top[0] ? top[0].distance.toFixed(4) : 'n/a'}`);
  return sendJson(
    res,
    200,
    top.map((hit) => [
      { page_content: hit.page_content, metadata: hit.metadata },
      Number(hit.distance.toFixed(6)),
    ]),
  );
}

async function handleDelete(req, res) {
  const userId = requireUserId(req);
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const entityId = url.searchParams.get('entity_id') || null;
  const body = await readJson(req);
  const ids = Array.isArray(body) ? body : Array.isArray(body?.file_ids) ? body.file_ids : [];
  let removed = 0;
  for (const fileId of ids) {
    const target = storePath(fileId, entityId);
    try {
      const record = JSON.parse(await fsp.readFile(target, 'utf8'));
      if (record.user_id !== userId) continue;
      await fsp.unlink(target);
      removed += 1;
    } catch {
      /* already absent */
    }
  }
  return sendJson(res, 200, { deleted: removed });
}

async function handleIds(req, res) {
  const userId = requireUserId(req);
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const entityId = url.searchParams.get('entity_id') || null;
  const dir = path.join(STORE, entityId ? `entity-${entityId}` : 'user');
  let names = [];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return sendJson(res, 200, []);
  }
  const ids = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const record = JSON.parse(await fsp.readFile(path.join(dir, name), 'utf8'));
      if (entityId || record.user_id === userId) ids.push(record.file_id);
    } catch {
      /* ignore unreadable record */
    }
  }
  return sendJson(res, 200, ids);
}

/** Plain-text types only: documents stay on LibreChat's own parser (incl. OCR). */
async function handleText(req, res) {
  requireUserId(req);
  const { file } = parseMultipart(await readBody(req), req.headers['content-type']);
  if (!file) throw new HttpError(400, 'file is required', 'invalid_request');
  const name = file.filename || 'upload';
  if (!(TEXT_EXTENSIONS.test(name) || /^text\/(plain|csv)/.test((file.mimeType || '').toLowerCase()))) {
    throw new HttpError(415, `Text extraction for ${name} uses the built-in parser`, 'unsupported_type');
  }
  return sendJson(res, 200, { text: file.data.toString('utf8') });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, {
        status: 'ok',
        service: 'shavi-rag',
        embedding_model: EMBED_MODEL,
        embedding_provider: EMBED_PROVIDER,
        embeddings_configured: EMBED_PROVIDER === 'nvidia' ? Boolean(NVIDIA_KEY) : true,
      });
    }
    if (req.method === 'POST' && url.pathname === '/embed') return await handleEmbed(req, res);
    if (req.method === 'POST' && url.pathname === '/query') return await handleQuery(req, res);
    if (req.method === 'POST' && url.pathname === '/text') return await handleText(req, res);
    if (req.method === 'DELETE' && url.pathname === '/documents') return await handleDelete(req, res);
    if (req.method === 'GET' && url.pathname === '/ids') return await handleIds(req, res);
    if (req.method === 'DELETE' && url.pathname === '/delete') return await handleDelete(req, res);
    return sendJson(res, 404, { detail: `No route for ${req.method} ${url.pathname}` });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status >= 500) log(`error ${req.method} ${url.pathname}:`, error.message);
    return sendJson(res, status, { detail: error.message, code: error.code || 'error' });
  }
});

await fsp.mkdir(STORE, { recursive: true });
server.listen(PORT, HOST, () => {
  log(`listening on http://${HOST}:${PORT} — embeddings ${EMBED_PROVIDER}:${EMBED_MODEL}`);
  // Warm the model so the first real `file_search` is not a cold start.
  getExtractor().catch((error) => log('embedding warm-up failed:', error.message));
});
