// Rasterises the SHAVI AI mark into LibreChat's favicon PNGs (uses LibreChat's sharp).
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(path.join(root, 'librechat/package.json'));
const sharp = require('sharp');

const mark = path.join(here, 'brand/mark.svg');
const outDir = path.join(root, 'librechat/client/public/assets');
const targets = [
  ['favicon-16x16.png', 16],
  ['favicon-32x32.png', 32],
  ['apple-touch-icon-180x180.png', 180],
];

for (const [name, size] of targets) {
  await sharp(fs.readFileSync(mark)).resize(size, size).png().toFile(path.join(outDir, name));
  console.log('favicon:', name, size);
}
