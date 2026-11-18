#!/usr/bin/env node
/**
 * M07 — image OCR proven end-to-end with a text-only model.
 *
 * Uploads the Hindi note and the revenue table image to an agent's `context` resource, so
 * LibreChat runs the OCR engine and stores the transcription on the file record, then sends
 * a normal turn carrying those files. The answering model is text-only, so a correct answer
 * proves the OCR text — not the image pixels — reached the model.
 *
 *   node tools/librechat-dev/m07-agent-ocr-test.mjs <agent-id>
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = 'http://127.0.0.1:3080';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36';
const AGENT_ID = process.argv[2];
const DIR = 'artifacts/m07-images';
const MIME = { png: 'image/png', jpg: 'image/jpeg' };

if (!AGENT_ID) {
  console.error('usage: node tools/librechat-dev/m07-agent-ocr-test.mjs <agent-id>');
  process.exit(1);
}

const login = async () => {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ email: 'admin@shavi.local', password: 'ShaviLocal#2026' }),
  });
  return (await res.json()).token;
};

const uploadToAgent = async (token, name) => {
  const ext = name.split('.').pop().toLowerCase();
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(`${DIR}/${name}`)], { type: MIME[ext] }), name);
  form.append('file_id', crypto.randomUUID());
  form.append('endpoint', 'SHAVI AI');
  form.append('endpointType', 'custom');
  form.append('agent_id', AGENT_ID);
  form.append('tool_resource', 'context');
  form.append('model', 'nvidia/nemotron-3-ultra-550b-a55b');
  const res = await fetch(`${BASE}/api/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA },
    body: form,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const main = async () => {
  const token = await login();
  const files = [];
  for (const name of fs.readdirSync(DIR).filter((f) => !f.startsWith('.'))) {
    const { status, body } = await uploadToAgent(token, name);
    console.log(
      `upload ${name.padEnd(16)} ${status} delivery=${body.llmDeliveryPath ?? '-'} textChars=${typeof body.text === 'string' ? body.text.length : 0}`,
    );
    if (status === 200) {
      files.push({
        file_id: body.file_id,
        filename: body.filename,
        filepath: body.filepath,
        type: body.type,
        llmDeliveryPath: body.llmDeliveryPath,
        bytes: body.bytes,
      });
    }
  }

  const messageId = crypto.randomUUID();
  const chat = await fetch(`${BASE}/api/agents/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': UA },
    body: JSON.stringify({
      text: 'मेरे अटैच दस्तावेज़ों में हिंदी नोट का token और बजट क्या है, और revenue table में Q2 की revenue कितनी है? सिर्फ़ वही लिखो।',
      sender: 'User',
      isCreatedByUser: true,
      parentMessageId: null,
      messageId,
      conversationId: null,
      error: false,
      endpoint: 'SHAVI AI',
      endpointType: 'custom',
      model: 'nvidia/nemotron-3-ultra-550b-a55b',
      spec: 'shavi-nemotron',
      files,
      isTemporary: false,
      isRegenerate: false,
      isContinued: false,
      timezone: 'Asia/Kolkata',
      generationProtocolVersion: 1,
    }),
  });
  const started = await chat.json().catch(() => ({}));
  console.log('chat', chat.status, JSON.stringify(started).slice(0, 160));
  if (!started.conversationId) {
    process.exit(1);
  }

  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const res = await fetch(`${BASE}/api/messages/${started.conversationId}`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA },
    });
    const messages = await res.json();
    const answer = messages.filter((m) => !m.isCreatedByUser).at(-1);
    if (!answer) continue;
    const text = Array.isArray(answer.content)
      ? answer.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n')
      : String(answer.content ?? '');
    if (text.trim() || answer.error) {
      const ok = text.includes('TOKEN-HINDI-401') && text.includes('445000') && text.includes('283000');
      console.log(`\n${ok ? 'PASS' : 'FAIL'} model=${answer.model} endpoint=${answer.endpoint}`);
      console.log('answer:', text.slice(0, 400));
      if (answer.error) console.log('error:', JSON.stringify(answer.error).slice(0, 200));
      process.exit(ok ? 0 : 1);
    }
  }
  console.error('timeout waiting for the answer');
  process.exit(1);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
