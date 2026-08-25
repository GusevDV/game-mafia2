#!/usr/bin/env node
/**
 * One-off conversion: public/uploads/**\/*.{jpg,jpeg,png,bmp,gif} -> .webp
 * (cwebp -q 80), originals removed after a successful conversion.
 *
 * Requires the `cwebp` binary (part of Google's libwebp, e.g. `brew install webp`).
 *
 *   node scripts/convert-to-webp.mjs
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const UPLOADS = join(ROOT, 'public/uploads');
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.gif']);
const QUALITY = 80;

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

let before = 0;
let after = 0;
let converted = 0;
let skipped = 0;

for (const file of walk(UPLOADS)) {
  if (!IMAGE_EXTS.has(extname(file).toLowerCase())) {
    skipped++;
    continue;
  }
  const dest = file.slice(0, -extname(file).length) + '.webp';
  const sizeBefore = statSync(file).size;
  execFileSync('cwebp', ['-quiet', '-q', String(QUALITY), file, '-o', dest]);
  before += sizeBefore;
  after += statSync(dest).size;
  unlinkSync(file);
  converted++;
}

const mb = (n) => (n / 1024 / 1024).toFixed(1);
console.log(`converted: ${converted} files, skipped: ${skipped}`);
console.log(`before: ${mb(before)} MB, after: ${mb(after)} MB, saved: ${mb(before - after)} MB (${(100 * (1 - after / before)).toFixed(0)}%)`);
