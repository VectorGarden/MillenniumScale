/**
 * data/index.json — the cheap thing to poll.
 *
 * It names every published data file, what each format holds and when each
 * bundle last changed. It's rebuilt from the bundles on disk after every
 * fetch, and carries no timestamp of its own, so it only changes when the
 * data does.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { manifestEntry } from './bundle.mjs';

/** Bundles to describe, in the order they should appear. */
export const BUNDLES = [
  { file: 'data/banlists.json', kind: 'banlist' },
  { file: 'data/genesys.json', kind: 'points' }
];

export async function readJSON(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

export async function buildManifest(root) {
  const bundles = [];
  const formats = [];
  for (const b of BUNDLES) {
    const data = await readJSON(resolve(root, b.file));
    if (!data) continue;
    bundles.push({ file: b.file, kind: b.kind, schema: data.schema, generated: data.generated, source: data.source });
    for (const f of data.formats || []) formats.push({ kind: b.kind, ...manifestEntry(f, b.file) });
  }
  return { schema: 'millennium-scale/index@1', bundles, formats };
}

export async function writeManifest(root) {
  const manifest = await buildManifest(root);
  await writeFile(resolve(root, 'data/index.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
