#!/usr/bin/env node
/**
 * M06 end-to-end AI-context test: for every fixture, upload it through `/api/files`,
 * send a chat turn that carries the file, and check the model's answer against the
 * token printed inside the document. Nothing is mocked: real LibreChat API, real Mongo,
 * real NVIDIA NIM completion.
 *
 *   node tools/librechat-dev/m06-ai-context-test.mjs [--dir artifacts/m06-fixtures]
 *
 * Exit code 1 if any format fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const BASE = 'http://127.0.0.1:3080';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36';
const dirArg = process.argv.indexOf('--dir');
const DIR = dirArg > -1 ? process.argv[dirArg + 1] : 'artifacts/m06-fixtures';
const MODEL = process.env.SHAVI_MODEL ?? 'nvidia/nemotron-3-ultra-550b-a55b';
const SPEC = process.env.SHAVI_SPEC ?? 'shavi-nemotron';
const PROMPT =
  'इस अटैच की गई फ़ाइल में जो token (TOKEN-XXX-0000 जैसा) है, सिर्फ़ वही लिखो। ' +
  'कुछ भी न बनाओ, अगर न मिले तो "नहीं मिला" लिखो।';

const MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  json: 'application/json',
  txt: 'text/plain',
  png: 'image/png',
  jpg: 'image/jpeg',
};

const json = async (res) => {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text.slice(0, 300) };
  }
};

const login = async () => {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ email: 'admin@shavi.local', password: 'ShaviLocal#2026' }),
  });
  if (!res.ok) throw new Error(`login failed ${res.status}`);
  return (await res.json()).token;
};

const upload = async (token, name, model = MODEL) => {
  const ext = name.split('.').pop().toLowerCase();
  const form = new FormData();
  form.append(
    'file',
    new Blob([fs.readFileSync(path.join(DIR, name))], { type: MIME[ext] }),
    name,
  );
  form.append('file_id', crypto.randomUUID());
  form.append('endpoint', 'SHAVI AI');
  form.append('endpointType', 'custom');
  form.append('message_file', 'true');
  form.append('model', model);
  const res = await fetch(`${BASE}/api/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA },
    body: form,
  });
  return { status: res.status, body: await json(res) };
};

const sendTurn = async (token, file, text, model = MODEL, spec = SPEC) => {
  const res = await fetch(`${BASE}/api/agents/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'User-Agent': UA,
    },
    body: JSON.stringify({
      text,
      sender: 'User',
      isCreatedByUser: true,
      parentMessageId: null,
      messageId: crypto.randomUUID(),
      conversationId: null,
      error: false,
      endpoint: 'SHAVI AI',
      endpointType: 'custom',
      model,
      spec,
      modelDisplayLabel: 'SHAVI AI',
      isTemporary: false,
      isRegenerate: false,
      isContinued: false,
      ephemeralAgent: null,
      timezone: 'Asia/Kolkata',
      clientRequestId: crypto.randomUUID(),
      generationProtocolVersion: 1,
      files: file
        ? [
            {
              file_id: file.file_id,
              filepath: file.filepath,
              filename: file.filename,
              type: file.type,
              llmDeliveryPath: file.llmDeliveryPath,
              bytes: file.bytes,
              ...(file.height ? { height: file.height } : {}),
              ...(file.width ? { width: file.width } : {}),
            },
          ]
        : [],
    }),
  });
  const body = await json(res);
  return { status: res.status, body };
};

const waitForReply = async (token, conversationId, timeoutMs = 150000) => {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(`${BASE}/api/messages/${conversationId}`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA },
    });
    if (!res.ok) continue;
    const messages = await res.json();
    last = messages;
    const assistant = messages.filter((m) => !m.isCreatedByUser).at(-1);
    if (assistant) {
      const text = Array.isArray(assistant.content)
        ? assistant.content
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('\n')
        : String(assistant.content ?? '');
      const error = assistant.error ? JSON.stringify(assistant.error).slice(0, 200) : null;
      if (error || text.trim().length > 0) {
        return { text, error, model: assistant.model, endpoint: assistant.endpoint };
      }
    }
  }
  return { text: '', error: 'timeout', raw: JSON.stringify(last ?? {}).slice(0, 300) };
};

const main = async () => {
  const token = await login();
  const names = fs
    .readdirSync(DIR)
    .filter((f) => !f.startsWith('.') && f !== 'expected.json')
    .sort();
  const EXPECTED = JSON.parse(fs.readFileSync(path.join(DIR, 'expected.json'), 'utf8'));
  const rows = [];
  for (const name of names) {
    const expected = EXPECTED[name] ?? null;
    const model = expected?.model ?? MODEL;
    const spec = expected?.spec ?? SPEC;
    const question = expected?.question ?? PROMPT;
    const up = await upload(token, name, model);
    if (up.status !== 200) {
      rows.push({ name, upload: up.status, message: up.body?.message, answer: '', pass: false });
      console.log(`${name.padEnd(12)} upload ${up.status} ${up.body?.message ?? ''}`);
      continue;
    }
    const turn = await sendTurn(token, up.body, question, model, spec);
    if (turn.status !== 200 || !turn.body?.conversationId) {
      rows.push({
        name,
        upload: 200,
        chat: turn.status,
        message: JSON.stringify(turn.body).slice(0, 200),
        answer: '',
        pass: false,
      });
      console.log(`${name.padEnd(12)} chat ${turn.status} ${JSON.stringify(turn.body).slice(0, 160)}`);
      continue;
    }
    const reply = await waitForReply(token, turn.body.conversationId);
    const wanted = [
      ...(expected?.expect ?? []),
      ...(expected?.token ? [expected.token] : []),
      ...(expected?.amount ? [expected.amount] : []),
    ];
    /* providers format numbers either way: 445000 vs 445,000 */
    const normalized = reply.text.replace(/,/g, '');
    const pass = Boolean(reply.text) && wanted.every((t) => normalized.includes(t.replace(/,/g, '')));
    rows.push({
      name,
      upload: 200,
      deliveryPath: up.body.llmDeliveryPath,
      model,
      textChars: typeof up.body.text === 'string' ? up.body.text.length : 0,
      conversationId: turn.body.conversationId,
      answer: reply.text.slice(0, 300),
      error: reply.error,
      pass,
    });
    console.log(
      `${name.padEnd(12)} ${pass ? 'PASS' : 'FAIL'} delivery=${up.body.llmDeliveryPath} answer=${JSON.stringify(reply.text.slice(0, 160))}${reply.error ? ` error=${reply.error}` : ''}`,
    );
    fs.writeFileSync('/tmp/m06-ai-context.json', JSON.stringify(rows, null, 2));
  }
  fs.writeFileSync('/tmp/m06-ai-context.json', JSON.stringify(rows, null, 2));
  const failed = rows.filter((r) => !r.pass);
  console.log(`\n${rows.length - failed.length}/${rows.length} formats passed`);
  if (failed.length) process.exitCode = 1;
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
