#!/usr/bin/env node
/**
 * SHAVI AI restore — replays a `tools/backup-mongo.mjs` dump into MongoDB and verifies it.
 *
 *   node tools/restore-mongo.mjs <backup-dir> [--db URI] [--drop] [--uploads DIR]
 *
 *   --db      target MongoDB URI (default: the URI recorded in the manifest, same database)
 *   --drop    drop each collection before restoring it (a clean restore; without it documents
 *             are upserted by _id, so a restore can be layered on top of live data)
 *   --uploads extract uploads.tar.gz into the uploads directory
 *
 * Exits non-zero when any collection's restored document count differs from the manifest,
 * so a recovery drill can be asserted in CI.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(new URL('./librechat-dev/package.json', import.meta.url));
const { MongoClient } = require('mongodb');
const { EJSON } = require('bson');

const argv = process.argv.slice(2);
const dir = argv[0] && !argv[0].startsWith('--') ? path.resolve(argv[0]) : null;
const flagValue = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
if (!dir) {
  console.error('usage: node tools/restore-mongo.mjs <backup-dir> [--db URI] [--drop] [--uploads DIR]');
  process.exit(2);
}

const manifestPath = path.join(dir, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error(`no manifest.json in ${dir}`);
  process.exit(2);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const URI = flagValue('db', process.env.MONGO_URI ?? `mongodb://127.0.0.1:27017/${manifest.database}`);
const DROP = argv.includes('--drop');
const log = (...a) => console.log(new Date().toISOString(), '[restore]', ...a);

const client = await MongoClient.connect(URI, { serverSelectionTimeoutMS: 5000 });
const db = client.db();
log(`backup ${manifest.createdAt} -> ${URI}${DROP ? ' (drop first)' : ''}`);

const mismatches = [];
for (const entry of manifest.collections) {
  const file = path.join(dir, 'collections', `${entry.name}.jsonl`);
  if (!fs.existsSync(file)) {
    mismatches.push(`${entry.name}: dump file missing`);
    continue;
  }
  const docs = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => EJSON.parse(line, { relaxed: false }));

  const collection = db.collection(entry.name);
  if (DROP) await collection.deleteMany({});
  if (docs.length) {
    // Preserve _id: replaceOne with upsert keeps restores idempotent.
    const chunk = 500;
    for (let i = 0; i < docs.length; i += chunk) {
      const slice = docs.slice(i, i + chunk);
      await collection.bulkWrite(
        slice.map((doc) => ({ replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } })),
        { ordered: false },
      );
    }
  }
  const restored = await collection.countDocuments({});
  log(`${entry.name}: ${restored}/${entry.documents}`);
  if (restored !== entry.documents) mismatches.push(`${entry.name}: ${restored} != ${entry.documents}`);
}

const uploadsDir = flagValue('uploads', null);
if (argv.includes('--uploads') === false && uploadsDir === null) {
  /* uploads are opt-in */
}
if (uploadsDir && fs.existsSync(path.join(dir, 'uploads.tar.gz'))) {
  await fsp.mkdir(uploadsDir, { recursive: true });
  execFileSync('tar', ['-xzf', path.join(dir, 'uploads.tar.gz'), '-C', path.dirname(uploadsDir)]);
  log(`uploads extracted into ${uploadsDir}`);
}

await client.close();

if (mismatches.length) {
  console.error(`\nRECOVERY CHECK FAILED:\n - ${mismatches.join('\n - ')}`);
  process.exit(1);
}
console.log(`\nRECOVERY CHECK OK — ${manifest.collections.length} collections, ${manifest.totalDocuments} documents restored`);
