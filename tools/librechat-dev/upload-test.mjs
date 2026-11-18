#!/usr/bin/env node
/**
 * M06 file-upload verification: uploads every fixture through the real LibreChat
 * `/api/files` endpoint, prints the server response, then reads the stored records
 * straight out of MongoDB (text length, delivery path, stored type).
 *
 *   node tools/librechat-dev/upload-test.mjs [--dir artifacts/m06-fixtures]
 *
 * Requires: LibreChat backend on 127.0.0.1:3080, mongod on 127.0.0.1:27017.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const BASE = 'http://127.0.0.1:3080';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36';
const dirArg = process.argv.indexOf('--dir');
const DIR = dirArg > -1 ? process.argv[dirArg + 1] : 'artifacts/m06-fixtures';
const MODEL = 'nvidia/nemotron-3-ultra-550b-a55b';

const login = async () => {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ email: 'admin@shavi.local', password: 'ShaviLocal#2026' }),
  });
  if (!res.ok) throw new Error(`login failed ${res.status}`);
  return (await res.json()).token;
};

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

const upload = async (token, file) => {
  const form = new FormData();
  const buf = fs.readFileSync(file.path);
  const ext = file.name.split('.').pop().toLowerCase();
  form.append('file', new Blob([buf], { type: MIME[ext] ?? 'application/octet-stream' }), file.name);
  form.append('file_id', crypto.randomUUID());
  form.append('endpoint', 'SHAVI AI');
  form.append('endpointType', 'custom');
  form.append('message_file', 'true');
  form.append('model', MODEL);
  const res = await fetch(`${BASE}/api/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA },
    body: form,
  });
  let body;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }
  return { status: res.status, body };
};

const mongoJson = (js) =>
  execFileSync('node', ['-e', js], { cwd: path.join(process.cwd(), 'librechat'), encoding: 'utf8' });

const main = async () => {
  const token = await login();
  const files = fs
    .readdirSync(DIR)
    .filter((f) => !f.startsWith('.'))
    .sort()
    .map((f) => ({ name: f, path: path.join(DIR, f) }));
  const rows = [];
  for (const file of files) {
    const { status, body } = await upload(token, file);
    const ok = status === 200;
    rows.push({
      file: file.name,
      status,
      message: ok ? body.message : body?.message ?? JSON.stringify(body).slice(0, 200),
      type: ok ? body.type : undefined,
      file_id: ok ? body.file_id : undefined,
      bytes: ok ? body.bytes : undefined,
      deliveryPath: ok ? body.llmDeliveryPath : undefined,
    });
    console.log(
      `${file.name.padEnd(12)} ${status}  ${ok ? `type=${body.type} delivery=${body.llmDeliveryPath ?? '-'}` : `message=${rows.at(-1).message}`}`,
    );
  }

  const ids = rows.filter((r) => r.file_id).map((r) => r.file_id);
  if (ids.length) {
    const js = `
      const m = require('mongoose');
      (async () => {
        await m.connect('mongodb://127.0.0.1:27017/LibreChat');
        const docs = await m.connection.collection('files')
          .find({ file_id: { $in: ${JSON.stringify(ids)} } })
          .project({ file_id: 1, filename: 1, type: 1, text: 1, llmDeliveryPath: 1, context: 1, source: 1 })
          .toArray();
        console.log(JSON.stringify(docs));
        await m.disconnect();
      })();`;
    const docs = JSON.parse(mongoJson(js).trim().split('\n').at(-1));
    console.log('\n--- stored file records (MongoDB `files`) ---');
    for (const doc of docs) {
      const text = typeof doc.text === 'string' ? doc.text : '';
      console.log(
        `  ${doc.filename.padEnd(12)} type=${doc.type} context=${doc.context ?? '-'} delivery=${doc.llmDeliveryPath ?? '-'} textChars=${text.length} textHead=${JSON.stringify(text.slice(0, 80))}`,
      );
    }
  }
  fs.writeFileSync('/tmp/m06-upload-result.json', JSON.stringify(rows, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
