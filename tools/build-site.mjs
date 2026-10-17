#!/usr/bin/env node
/**
 * Assemble the publishable site into a folder (default _site).
 *
 *   node tools/build-site.mjs          -> _site/
 *   node tools/build-site.mjs out      -> out/
 *
 * Only what the pages actually serve is copied. tools/, tests/, README.md
 * and package.json stay in the repo. Run check-links.mjs on the result
 * before publishing it.
 */

import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, process.argv[2] || '_site');

const FILES = [
  'index.html', 'lists.html', 'publish.html', '404.html',
  'CNAME', '.nojekyll', 'favicon.ico', 'site.webmanifest', 'robots.txt', 'sitemap.xml'
];
const DIRS = ['assets', 'js', 'data'];

const exists = async (p) => { try { await stat(p); return true; } catch { return false; } };

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

let missing = 0;
for (const f of [...FILES, ...DIRS]) {
  const from = resolve(ROOT, f);
  if (!(await exists(from))) { console.error(`  MISSING  ${f}`); missing++; continue; }
  await cp(from, resolve(OUT, f), { recursive: true });
}

if (missing) {
  console.error(`\n${missing} file(s) missing — nothing to publish.`);
  process.exit(1);
}
console.log(`build-site: ${FILES.length} files and ${DIRS.length} folders -> ${OUT.slice(ROOT.length + 1) || OUT}`);
