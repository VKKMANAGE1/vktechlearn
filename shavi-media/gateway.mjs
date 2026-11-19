#!/usr/bin/env node
/**
 * SHAVI Media gateway — one local, OpenAI-compatible HTTP service in front of the
 * providers this deployment actually has:
 *
 *   POST /v1/images/generations     -> NVIDIA NIM FLUX.1-dev  (https://ai.api.nvidia.com/v1/genai/...)
 *   POST /v1/audio/speech           -> Piper neural TTS (local, Hindi + English voices)
 *   POST /v1/audio/transcriptions   -> faster-whisper ASR (local, whisper model)
 *   GET  /health, GET /v1/models
 *
 * Why a shim: LibreChat already speaks the OpenAI media protocol (its OpenAI TTS/STT
 * providers accept a `url`, and the `image_gen_oai` agent tool accepts
 * IMAGE_GEN_OAI_BASEURL). NVIDIA's hosted FLUX endpoint is not OpenAI-shaped, and no
 * hosted NVIDIA speech endpoint exists, so the translation lives here instead of
 * inside a patched LibreChat core. Every request below is a real provider call — no
 * cached, random or placeholder media.
 *
 * Env:
 *   SHAVI_AI_KEY               NVIDIA API key (required for image generation)
 *   SHAVI_MEDIA_PORT           default 4123
 *   SHAVI_MEDIA_RUNTIME        runtime dir with piper/ and venv/ (default ./runtime)
 *   SHAVI_MEDIA_IMAGE_MODEL    default black-forest-labs/flux.1-dev
 *   SHAVI_MEDIA_STT_MODEL      default small
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME = process.env.SHAVI_MEDIA_RUNTIME || path.join(HERE, 'runtime');
const PORT = Number(process.env.SHAVI_MEDIA_PORT || 4123);
const HOST = process.env.SHAVI_MEDIA_HOST || '127.0.0.1';
const NVIDIA_KEY = process.env.SHAVI_AI_KEY || process.env.NVIDIA_API_KEY || '';
const NVIDIA_GENAI = process.env.SHAVI_MEDIA_NVIDIA_BASE || 'https://ai.api.nvidia.com/v1/genai';
const IMAGE_MODEL = process.env.SHAVI_MEDIA_IMAGE_MODEL || 'black-forest-labs/flux.1-dev';
const STT_MODEL = process.env.SHAVI_MEDIA_STT_MODEL || 'small';
const STT_DOWNLOAD_ROOT = process.env.SHAVI_MEDIA_STT_ROOT || path.join(RUNTIME, 'hf', 'models');

const PIPER_BIN = path.join(RUNTIME, 'bin', 'piper', 'piper');
const PIPER_DATA = path.join(RUNTIME, 'bin', 'piper', 'espeak-ng-data');
const PIPER_MODELS = path.join(RUNTIME, 'models');
const WHISPER_PY = path.join(RUNTIME, 'venv', 'bin', 'python');
const TRANSCRIBE = path.join(HERE, 'transcribe.py');

/** Voice id -> Piper model + language. Ids are what LibreChat's voice picker shows. */
const VOICES = {
  'hi-IN-Pratham': { model: 'hi_IN-pratham-medium.onnx', language: 'hi', label: 'Hindi (Pratham)' },
  'en-US-Lessac': { model: 'en_US-lessac-medium.onnx', language: 'en', label: 'English (Lessac)' },
};
const DEFAULT_VOICE = 'hi-IN-Pratham';

const IMAGE_TIMEOUT_MS = Number(process.env.SHAVI_MEDIA_IMAGE_TIMEOUT_MS || 240000);
const STT_TIMEOUT_MS = Number(process.env.SHAVI_MEDIA_STT_TIMEOUT_MS || 300000);
const TTS_TIMEOUT_MS = Number(process.env.SHAVI_MEDIA_TTS_TIMEOUT_MS || 120000);
const MAX_TTS_CHARS = Number(process.env.SHAVI_MEDIA_TTS_MAX_CHARS || 3000);
const MAX_AUDIO_BYTES = Number(process.env.SHAVI_MEDIA_MAX_AUDIO_BYTES || 25 * 1024 * 1024);

const log = (...args) => console.log(new Date().toISOString(), '[shavi-media]', ...args);

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

function sendOpenAIError(res, status, message, code = 'provider_error') {
  sendJson(res, status, { error: { message, type: 'invalid_request_error', code } });
}

async function readBody(req, limit = MAX_AUDIO_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      throw new HttpError(413, `Request body larger than ${limit} bytes`, 'payload_too_large');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const raw = await readBody(req, 5 * 1024 * 1024);
  if (raw.length === 0) {
    return {};
  }
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw new HttpError(400, 'Request body is not valid JSON', 'invalid_json');
  }
}

/**
 * Minimal multipart/form-data parser: enough for OpenAI-style STT requests
 * (`file` + `model` + `language` fields). Returns fields and the first file.
 */
function parseMultipart(buffer, contentType) {
  const match = /boundary="?([^";]+)"?/i.exec(contentType || '');
  if (!match) {
    throw new HttpError(400, 'multipart/form-data without a boundary', 'invalid_multipart');
  }
  const boundary = Buffer.from(`--${match[1]}`);
  const fields = {};
  let file = null;

  let index = buffer.indexOf(boundary);
  if (index === -1) {
    throw new HttpError(400, 'multipart body has no parts', 'invalid_multipart');
  }
  while (index !== -1) {
    let start = index + boundary.length;
    if (buffer.slice(start, start + 2).toString() === '--') {
      break;
    }
    start += 2; // CRLF after the boundary
    const end = buffer.indexOf(boundary, start);
    if (end === -1) {
      break;
    }
    const part = buffer.slice(start, end);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) {
      index = end;
      continue;
    }
    const headerText = part.slice(0, headerEnd).toString('utf8');
    const body = part.slice(headerEnd + 4, part.length - 2); // strip trailing CRLF
    const nameMatch = /name="([^"]*)"/i.exec(headerText);
    const filenameMatch = /filename="([^"]*)"/i.exec(headerText);
    const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerText);
    if (nameMatch) {
      if (filenameMatch) {
        file = {
          field: nameMatch[1],
          filename: filenameMatch[1],
          mimeType: typeMatch ? typeMatch[1].trim() : 'application/octet-stream',
          data: body,
        };
      } else {
        fields[nameMatch[1]] = body.toString('utf8');
      }
    }
    index = end;
  }
  return { fields, file };
}

function requireKey() {
  if (!NVIDIA_KEY) {
    throw new HttpError(503, 'Image generation is not configured: NVIDIA key missing (SHAVI_AI_KEY)', 'not_configured');
  }
}

/** Keep every image request inside the box the model supports. */
function mapSize(size) {
  const allowed = {
    'auto': [1024, 1024],
    '1024x1024': [1024, 1024],
    '1536x1024': [1536, 1024],
    '1024x1536': [1024, 1536],
    '1792x1024': [1792, 1024],
    '1024x1792': [1024, 1792],
    '512x512': [1024, 1024],
  };
  const [width, height] = allowed[size] ?? allowed.auto;
  return { width, height };
}

async function generateImage({ prompt, size, model }) {
  requireKey();
  const capableModel = !model || /flux|sdxl|diffusion|image/i.test(model) ? IMAGE_MODEL : model;
  const { width, height } = mapSize(size);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  try {
    const response = await fetch(`${NVIDIA_GENAI}/${capableModel}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${NVIDIA_KEY}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ prompt, cfg_scale: 3.5, width, height, steps: 30 }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      const detail = text.slice(0, 500) || response.statusText;
      throw new HttpError(502, `NVIDIA ${capableModel} returned ${response.status}: ${detail}`, 'upstream_error');
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new HttpError(502, 'NVIDIA returned a non-JSON image response', 'upstream_error');
    }
    const base64 = parsed?.artifacts?.[0]?.base64;
    if (!base64) {
      throw new HttpError(502, 'NVIDIA returned no image artifact', 'upstream_error');
    }
    log(`image ok model=${capableModel} ${width}x${height} bytes~${Math.round((base64.length * 3) / 4)}`);
    return { base64, model: capableModel, width, height };
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new HttpError(504, `Image generation timed out after ${IMAGE_TIMEOUT_MS} ms`, 'timeout');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function runProcess(command, args, { input, timeoutMs, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    let settled = false;
    const timer = timeoutMs
      ? setTimeout(() => {
          if (!settled) {
            settled = true;
            child.kill('SIGKILL');
            reject(new HttpError(504, `${path.basename(command)} timed out after ${timeoutMs} ms`, 'timeout'));
          }
        }, timeoutMs)
      : null;

    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(new HttpError(500, `${path.basename(command)} could not start: ${error.message}`, 'engine_missing'));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      const stderr = Buffer.concat(err).toString('utf8').trim();
      if (code !== 0) {
        reject(new HttpError(502, `${path.basename(command)} exited ${code}: ${stderr.slice(-600)}`, 'engine_error'));
        return;
      }
      resolve({ stdout: Buffer.concat(out), stderr });
    });
    if (input != null) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });
}

async function synthesizeSpeech({ input, voice }) {
  const text = String(input ?? '').trim();
  if (!text) {
    throw new HttpError(400, 'Missing text in request body', 'missing_input');
  }
  if (text.length > MAX_TTS_CHARS) {
    throw new HttpError(413, `Text is ${text.length} characters; the limit is ${MAX_TTS_CHARS}`, 'input_too_long');
  }
  if (!fs.existsSync(PIPER_BIN)) {
    throw new HttpError(503, 'TTS is not configured: Piper binary missing (run shavi-media/setup-speech.sh)', 'not_configured');
  }
  const selected = VOICES[voice] ?? VOICES[DEFAULT_VOICE];
  const modelPath = path.join(PIPER_MODELS, selected.model);
  if (!fs.existsSync(modelPath)) {
    throw new HttpError(503, `TTS voice ${selected.model} is missing (run shavi-media/setup-speech.sh)`, 'not_configured');
  }
  const { stdout } = await runProcess(
    PIPER_BIN,
    ['-m', modelPath, '-f', '-', '--espeak_data', PIPER_DATA, '--sentence_silence', '0.15'],
    { input: text, timeoutMs: TTS_TIMEOUT_MS },
  );
  if (stdout.length < 44) {
    throw new HttpError(502, 'Piper returned no audio', 'engine_error');
  }
  const seconds = estimateWavSeconds(stdout);
  log(`tts ok voice=${voice ?? DEFAULT_VOICE} chars=${text.length} bytes=${stdout.length} seconds=${seconds ?? '?'}`);
  return { audio: stdout, voice: selected, seconds };
}

/** Duration of a PCM WAV from its header, for logs and tests. */
function estimateWavSeconds(buffer) {
  try {
    if (buffer.slice(0, 4).toString() !== 'RIFF') return null;
    const byteRate = buffer.readUInt32LE(28);
    const dataBytes = buffer.length - 44;
    if (!byteRate) return null;
    return Math.round((dataBytes / byteRate) * 100) / 100;
  } catch {
    return null;
  }
}

async function transcribeAudio({ file, language }) {
  if (!file) {
    throw new HttpError(400, 'Missing audio file in the multipart request', 'missing_file');
  }
  if (!fs.existsSync(WHISPER_PY)) {
    throw new HttpError(503, 'STT is not configured: whisper runtime missing (run shavi-media/setup-speech.sh)', 'not_configured');
  }
  const extension = path.extname(file.filename || '') || guessExtension(file.mimeType);
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'shavi-stt-'));
  const audioPath = path.join(tempDir, `audio${extension}`);
  try {
    await fsp.writeFile(audioPath, file.data);
    const args = [TRANSCRIBE, '--file', audioPath, '--model', STT_MODEL, '--download-root', STT_DOWNLOAD_ROOT];
    if (language) args.push('--language', String(language).slice(0, 5));
    const { stdout } = await runProcess(WHISPER_PY, args, { timeoutMs: STT_TIMEOUT_MS });
    let parsed;
    try {
      parsed = JSON.parse(stdout.toString('utf8').trim().split('\n').pop());
    } catch {
      throw new HttpError(502, 'Transcription engine returned unreadable output', 'engine_error');
    }
    log(`stt ok model=${STT_MODEL} lang=${parsed.language ?? language ?? '?'} seconds=${parsed.duration ?? '?'} chars=${(parsed.text || '').length}`);
    return parsed;
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
}

function guessExtension(mimeType) {
  const map = {
    'audio/webm': '.webm',
    'audio/ogg': '.ogg',
    'audio/mp4': '.m4a',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
    'audio/flac': '.flac',
  };
  return map[mimeType] ?? '.webm';
}

function capabilities() {
  return {
    imageGeneration: {
      configured: Boolean(NVIDIA_KEY),
      provider: 'NVIDIA NIM',
      model: IMAGE_MODEL,
      endpoint: `${NVIDIA_GENAI}/${IMAGE_MODEL}`,
    },
    textToSpeech: {
      configured: fs.existsSync(PIPER_BIN) && Object.values(VOICES).every((v) => fs.existsSync(path.join(PIPER_MODELS, v.model))),
      provider: 'Piper (local neural TTS)',
      voices: Object.entries(VOICES).map(([id, v]) => ({ id, label: v.label, language: v.language })),
    },
    speechToText: {
      configured: fs.existsSync(WHISPER_PY),
      provider: 'faster-whisper (local ASR)',
      model: STT_MODEL,
    },
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/')) {
      const caps = capabilities();
      sendJson(res, 200, { status: 'ok', capabilities: caps });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/models') {
      const caps = capabilities();
      const data = [];
      if (caps.imageGeneration.configured) {
        data.push({ id: IMAGE_MODEL, object: 'model', owned_by: 'nvidia', type: 'image' });
      }
      if (caps.textToSpeech.configured) {
        data.push({ id: 'shavi-tts', object: 'model', owned_by: 'shavi', type: 'tts' });
      }
      if (caps.speechToText.configured) {
        data.push({ id: `whisper-${STT_MODEL}`, object: 'model', owned_by: 'shavi', type: 'stt' });
      }
      sendJson(res, 200, { object: 'list', data });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/images/generations') {
      const body = await readJson(req);
      const prompt = String(body.prompt ?? '').trim();
      if (!prompt) {
        throw new HttpError(400, 'Missing required field: prompt', 'missing_prompt');
      }
      const image = await generateImage({ prompt, size: body.size, model: body.model });
      sendJson(res, 200, {
        created: Math.floor(Date.now() / 1000),
        data: [{ b64_json: image.base64, revised_prompt: prompt }],
        model: image.model,
        size: `${image.width}x${image.height}`,
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/audio/speech') {
      const body = await readJson(req);
      const { audio, voice, seconds } = await synthesizeSpeech({ input: body.input, voice: body.voice });
      res.writeHead(200, {
        'content-type': 'audio/wav',
        'content-length': audio.length,
        'x-shavi-voice': voice.model,
        'x-shavi-seconds': String(seconds ?? ''),
      });
      res.end(audio);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/audio/transcriptions') {
      const raw = await readBody(req);
      const contentType = req.headers['content-type'] || '';
      let file;
      let fields = {};
      if (contentType.includes('multipart/form-data')) {
        const parsed = parseMultipart(raw, contentType);
        file = parsed.file;
        fields = parsed.fields;
      } else if (contentType.includes('application/json')) {
        const body = JSON.parse(raw.toString('utf8') || '{}');
        if (body.file?.data) {
          file = { filename: body.file.filename || 'audio.webm', mimeType: body.file.mime_type, data: Buffer.from(body.file.data, 'base64') };
        }
        fields = body;
      } else {
        file = { filename: 'audio.webm', mimeType: contentType, data: raw };
      }
      const result = await transcribeAudio({ file, language: fields.language });
      sendJson(res, 200, { text: result.text, language: result.language, duration: result.duration });
      return;
    }

    sendOpenAIError(res, 404, `Unknown route ${req.method} ${url.pathname}`, 'not_found');
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status >= 500) {
      log(`error ${req.method} ${url.pathname}:`, error.message);
    }
    sendOpenAIError(res, status, error.message || 'Internal error', error.code || 'internal_error');
  }
});

server.listen(PORT, HOST, () => {
  const caps = capabilities();
  log(`listening on http://${HOST}:${PORT}`);
  log(
    `capabilities: image=${caps.imageGeneration.configured} stt=${caps.speechToText.configured} tts=${caps.textToSpeech.configured}`,
  );
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
  });
}
