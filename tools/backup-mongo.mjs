#!/usr/bin/env node
/**
 * SHAVI AI backup — MongoDB dump + uploads snapshot, written as plain JSONL so it can be
 * restored on a machine that has no mongodump binary (this VM does not have one).
 *
 *   node tools/backup-mongo.mjs [--out DIR] [--db mongodb://…] [--uploads DIR]
 *
 * Output:
 *   <out>/manifest.json              collection counts, sizes, timestamp, mongo URI (db name only)
 *   <out>/collections/<name>.jsonl   one EJSON document per line (types preserved)
 *   <out>/uploads.tar.gz             uploaded files/hashes (only when the directory exists)
 *
 * The dump is consistent per collection, not a cluster-wide snapshot: writes that land
 * while the backup runs can show up in one collection and not another. For a transactional
 * snapshot use `mongodump --oplog` against a replica set.
 *
 * Restore: tools/restore-mongo.mjs
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
// The driver lives in tools/librechat-dev/node_modules (the only Node project in this repo);
// resolve it explicitly so these tools run from a checkout with no root package.json.
const require = createRequire(new URL('./librechat-dev/package.json', import.meta.url));
const { MongoClient } = require('mongodb');
const { EJSON } = require('bson');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const URI = arg('db', process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017/LibreChat');
const OUT = path.resolve(arg('out', path.join(ROOT, 'backups')));
const UPLOADS = path.resolve(arg('uploads', process.env.SHAVI_UPLOADS_DIR ?? path.join(ROOT, 'librechat/uploads')));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dest = path.join(OUT, `backup-${stamp}`);

const log = (...a) => console.log(new Date().toISOString(), '[backup]', ...a);

const client = await MongoClient.connect(URI, { serverSelectionTimeoutMS: 5000 });
const db = client.db();
await fsp.mkdir(path.join(dest, 'collections'), { recursive: true });

const collections = (await db.listCollections().toArray()).map((c) => c.name).sort();
const manifest = {
  format: 'shavi-ai-backup/v1',
  createdAt: new Date().toISOString(),
  database: db.databaseName,
  source: URI.replace(/\/\/[^@]*@/, '//***@'),
  collections: [],
  uploads: null,
};

let totalDocs = 0;
for (const name of collections) {
  const cursor = db.collection(name).find({});
  const file = path.join(dest, 'collections', `${name}.jsonl`);
  const stream = fs.createWriteStream(file);
  let count = 0;
  for await (const doc of cursor) {
    stream.write(EJSON.stringify(doc, { relaxed: false }) + '\n');
    count += 1;
  }
  await new Promise((resolve, reject) => stream.end((err) => (err ? reject(err) : resolve())));
  const bytes = (await fsp.stat(file)).size;
  manifest.collections.push({ name, documents: count, bytes });
  totalDocs += count;
}

manifest.totalDocuments = totalDocs;

if (fs.existsSync(UPLOADS)) {
  const tar = path.join(dest, 'uploads.tar.gz');
  try {
    execFileSync('tar', ['-czf', tar, '-C', path.dirname(UPLOADS), path.basename(UPLOADS)]);
    manifest.uploads = { path: 'uploads.tar.gz', files: walk(UPLOADS).length, bytes: fs.statSync(tar).size };
  } catch (error) {
    manifest.uploads = { error: String(error.message).slice(0, 200) };
  }
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(p) : [p];
  });
}

await fsp.writeFile(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2));
await client.close();

log(`wrote ${dest}`);
log(`${collections.length} collections, ${totalDocs} documents${manifest.uploads?.bytes ? `, uploads ${manifest.uploads.files} files` : ''}`);
console.log(dest);
