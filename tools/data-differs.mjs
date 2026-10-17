#!/usr/bin/env node
/**
 * Does the data on disk differ in content from the data at a git ref?
 *
 *   node tools/data-differs.mjs origin/bot/data-refresh    prints true or false
 *
 * Every fetch that finds a change stamps a fresh `generated` time, so two runs
 * against the same upstream produce different files with the same content.
 * The scheduled refresh uses this to leave an open pull request alone when
 * nothing new has landed since it was last updated, rather than pushing a new
 * commit every day. A ref that doesn't exist, or lacks a bundle, counts as
 * different.
 */

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { sameFormats } from './lib/bundle.mjs';
import { BUNDLES, readJSON } from './lib/manifest.mjs';

const ref = process.argv[2];
if (!ref) { console.error('usage: node tools/data-differs.mjs <git-ref>'); process.exit(64); }

function atRef(file) {
  try { return JSON.parse(execFileSync('git', ['show', `${ref}:${file}`], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] })); }
  catch { return null; }
}

let differs = false;
for (const b of BUNDLES) {
  const here = await readJSON(resolve(b.file));
  const there = atRef(b.file);
  if (!here && !there) continue;
  if (!here || !there || !sameFormats(here.formats, there.formats)) { differs = true; break; }
}
console.log(String(differs));
