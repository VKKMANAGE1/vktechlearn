#!/usr/bin/env node
/**
 * SHAVI YouTube Studio — runs the Jakeschincariol/youtube-agent-skill pack (MIT) on this stack.
 *
 *   skills/yt-*        the eleven SKILL.md instructions, vendored unchanged
 *   skills/yt-*\*.py   the six dependency-free Python tools, executed for real
 *   voice.md           your voice profile, injected into every skill prompt
 *
 * Endpoints
 *   GET  /                 the studio UI
 *   GET  /api/skills       eleven skills with their frontmatter + body
 *   POST /api/tool         {skill,text,thumb} -> runs the matching python tool (JSON when it can)
 *   POST /api/run          {skill,input,toolOutput} -> the skill answered by the SHAVI AI model
 *   GET  /api/voice        current voice.md
 *   PUT  /api/voice        replace voice.md
 *   GET  /health
 *
 * Nothing is published from here; the tools only read text the user pastes.
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SKILLS = path.join(ROOT, 'skills');
const PUBLIC = path.join(ROOT, 'public');
const VOICE_FILE = path.join(ROOT, 'voice.md');

const PORT = Number(process.env.SHAVI_YOUTUBE_PORT ?? 4128);
const HOST = process.env.SHAVI_YOUTUBE_HOST ?? '0.0.0.0';
const MODEL = process.env.SHAVI_YOUTUBE_MODEL ?? 'nvidia/nemotron-3-ultra-550b-a55b';
const BASE_URL = (process.env.SHAVI_YOUTUBE_BASEURL ?? 'https://integrate.api.nvidia.com/v1').replace(/\/+$/, '');
const MAX_BODY = 2 * 1024 * 1024;

/** The key is read from the environment, or from the gitignored key file the other services use. */
function apiKey() {
  if (process.env.SHAVI_AI_KEY) return process.env.SHAVI_AI_KEY.trim();
  for (const file of ['ai-key.txt', path.join('..', 'ai-key.txt')]) {
    const candidate = path.join(ROOT, file);
    if (fs.existsSync(candidate)) {
      const value = fs.readFileSync(candidate, 'utf8').replace(/[\r\n]/g, '');
      if (value && value !== 'PASTE_YOUR_KEY_HERE') return value;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ skills */

function parseSkill(id) {
  const dir = path.join(SKILLS, id);
  const file = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  const front = match ? match[1] : '';
  const body = (match ? match[2] : raw).trim();
  const meta = {};
  let current = null;
  for (const line of front.split('\n')) {
    const kv = /^([a-zA-Z_]+):\s*(.*)$/.exec(line);
    if (kv) {
      current = kv[1];
      meta[current] = kv[2].replace(/^[>|]-?\s*$/, '').trim();
      continue;
    }
    if (current && /^\s+\S/.test(line)) {
      meta[current] = `${meta[current]} ${line.trim()}`.trim();
    }
  }
  const tools = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.py'))
    .map((name) => name);
  return { id, name: meta.name ?? id, description: meta.description ?? '', body, tools };
}

function listSkills() {
  return fs
    .readdirSync(SKILLS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('yt-'))
    .map((entry) => parseSkill(entry.name))
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/* ------------------------------------------------------------------- tools */

const TOOL_INPUT = {
  'yt-script': { ext: 'txt', hint: 'एक hook प्रति line (5 hooks लिखें)', extra: null },
  'yt-package': { ext: null, hint: 'Title', extra: { key: 'thumb', label: 'Thumbnail text', placeholder: 'AI RAN IT' } },
  'yt-edit': { ext: 'srt', hint: 'SRT / VTT / whisper JSON transcript यहाँ paste करें', extra: null },
  'yt-chapters': { ext: 'srt', hint: 'Timestamped transcript (SRT / VTT / JSON)', extra: null },
  'yt-retention': { ext: 'csv', hint: 'Retention CSV (position,still watching)', extra: null },
  'yt-viral': { ext: 'json', hint: 'Collected videos JSON array', extra: null },
};

function runTool(skill, text, extra = {}) {
  const spec = TOOL_INPUT[skill];
  if (!spec) return { ok: false, error: `no tool for ${skill}` };
  const dir = path.join(SKILLS, skill);
  const script = fs.readdirSync(dir).find((name) => name.endsWith('.py'));
  if (!script) return { ok: false, error: `no python tool in ${skill}` };

  let tmpFile = null;
  const args = [];
  if (skill === 'yt-package') {
    const thumb = String(extra.thumb ?? '').trim();
    args.push('title.py', '--title', String(text ?? '').trim(), '--json');
    if (thumb) args.push('--thumb', thumb);
  } else {
    if (!String(text ?? '').trim()) return { ok: false, error: 'input is empty' };
    tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shavi-yt-')), `input.${spec.ext}`);
    fs.writeFileSync(tmpFile, String(text), 'utf8');
    args.push(script, tmpFile, '--json');
  }

  const started = Date.now();
  const result = spawnSync('python3', args, { cwd: dir, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
  if (tmpFile) fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true });

  const stdout = (result.stdout ?? '').trim();
  const stderr = (result.stderr ?? '').trim();
  let data = null;
  try {
    data = stdout ? JSON.parse(stdout) : null;
  } catch {
    data = null;
  }
  return {
    ok: result.status === 0,
    ms: Date.now() - started,
    data,
    output: data ? null : stdout,
    error: result.status === 0 ? null : stderr || `exit ${result.status}`,
  };
}

/* ------------------------------------------------------------------- model */

function stripFence(text) {
  return String(text ?? '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
}

async function askSkill({ skill, input, toolOutput }) {
  const entry = parseSkill(skill);
  if (!entry) throw new Error(`unknown skill ${skill}`);
  const key = apiKey();
  if (!key) throw new Error('SHAVI_AI_KEY missing (ai-key.txt or the environment)');

  const voice = fs.existsSync(VOICE_FILE) ? fs.readFileSync(VOICE_FILE, 'utf8').trim() : '';
  const system = [
    `You are SHAVI AI, running the "${entry.name}" skill from the YouTube agent skill pack.`,
    'Follow the skill instructions exactly. They are written for an assistant that can run shell commands:',
    'you cannot execute code in this surface, so analyse the material yourself and say plainly when a number',
    'would need the pack\'s python tool instead of inventing one.',
    'Never invent statistics, results or sources. Ask for a missing figure or write the line without it.',
    'Answer in the language the user wrote in (Hindi/Hinglish is fine); keep YouTube/platform terms in English.',
    '',
    '--- SKILL INSTRUCTIONS ---',
    entry.body,
    '--- END SKILL INSTRUCTIONS ---',
    '',
    voice ? `--- THE CREATOR'S VOICE PROFILE (voice.md) ---\n${voice}\n--- END VOICE PROFILE ---` : '',
    'If the voice profile is untouched template text, say so and ask for three of their videos instead of guessing a voice.',
  ]
    .filter(Boolean)
    .join('\n');

  const user = [
    String(input ?? '').trim() || '(no extra input)',
    toolOutput ? `\n\n--- OUTPUT OF THE PACK'S PYTHON TOOL (already run, use these numbers) ---\n${toolOutput}` : '',
  ].join('');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 240_000);
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.7,
        max_tokens: 4096,
        stream: false,
      }),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error?.message ?? body?.message ?? `model HTTP ${res.status}`);
    const text = stripFence(body?.choices?.[0]?.message?.content ?? '');
    if (!text) throw new Error('model returned an empty answer');
    return { text, model: MODEL, usage: body.usage ?? null };
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------- http */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('payload too large'), { status: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('invalid JSON body'), { status: 400 });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return send(res, 200, fs.readFileSync(path.join(PUBLIC, 'index.html')), MIME['.html']);
    }
    if (req.method === 'GET' && /^\/[A-Za-z0-9._-]+\.(js|css|svg)$/.test(url.pathname)) {
      const file = path.join(PUBLIC, path.basename(url.pathname));
      if (!fs.existsSync(file)) return send(res, 404, { error: 'not found' });
      return send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] ?? 'application/octet-stream');
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, {
        status: 'ok',
        skills: listSkills().length,
        model: MODEL,
        key: Boolean(apiKey()),
        python: spawnSync('python3', ['--version'], { encoding: 'utf8' }).stdout.trim(),
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/skills') {
      return send(res, 200, { skills: listSkills(), tools: TOOL_INPUT });
    }
    if (req.method === 'GET' && url.pathname === '/api/voice') {
      return send(res, 200, { voice: fs.existsSync(VOICE_FILE) ? fs.readFileSync(VOICE_FILE, 'utf8') : '' });
    }
    if (req.method === 'PUT' && url.pathname === '/api/voice') {
      const body = await readJson(req);
      if (typeof body.voice !== 'string') return send(res, 400, { error: 'voice must be a string' });
      fs.writeFileSync(VOICE_FILE, body.voice, 'utf8');
      return send(res, 200, { ok: true, bytes: Buffer.byteLength(body.voice) });
    }
    if (req.method === 'POST' && url.pathname === '/api/tool') {
      const body = await readJson(req);
      return send(res, 200, runTool(body.skill, body.text, { thumb: body.thumb }));
    }
    if (req.method === 'POST' && url.pathname === '/api/run') {
      const body = await readJson(req);
      const started = Date.now();
      const result = await askSkill({ skill: body.skill, input: body.input, toolOutput: body.toolOutput });
      console.log(`[youtube] ${body.skill} answered in ${Math.round((Date.now() - started) / 1000)}s (${result.text.length} chars)`);
      return send(res, 200, result);
    }
    return send(res, 404, { error: 'not found' });
  } catch (error) {
    const status = error.status ?? 502;
    console.log(`[youtube] ${req.method} ${url.pathname} -> ${status}: ${error.message}`);
    return send(res, status, { error: String(error.message ?? error) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`SHAVI YouTube Studio on http://${HOST}:${PORT} — ${listSkills().length} skills, model ${MODEL}`);
});
