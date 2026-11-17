/**
 * Local MongoDB for LibreChat verification.
 *
 * The cloud VM has no mongod binary and no Docker access, so this starts a real
 * mongod via mongodb-memory-server, bound to 127.0.0.1:27017 with a persistent
 * dbPath (./mongo-data) so data survives a restart of this script.
 *
 * Usage: node mongod-server.mjs
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const dbPath = path.join(here, 'mongo-data');
fs.mkdirSync(dbPath, { recursive: true });

const server = await MongoMemoryServer.create({
  binary: { version: '8.0.20' },
  instance: {
    port: 27017,
    ip: '127.0.0.1',
    dbName: 'LibreChat',
    dbPath,
    storageEngine: 'wiredTiger',
  },
});

const uri = server.getUri('LibreChat');
fs.writeFileSync(path.join(here, 'mongo-uri.txt'), uri);
console.log(`mongod ready: ${uri}`);

const shutdown = async () => {
  await server.stop({ doCleanup: false, force: false });
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
