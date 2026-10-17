#!/usr/bin/env node
/**
 * Millennium Scale — Genesys point list fetcher
 *
 *   node tools/fetch-genesys.mjs                    fetch, write data/genesys.js + .json if changed
 *   node tools/fetch-genesys.mjs --summary f        also write a Markdown summary of what changed to f
 *   node tools/fetch-genesys.mjs --date 2026-10-05  date a new list by its announced effective date
 *   node tools/fetch-genesys.mjs --seen f           reuse a date from an unmerged refresh's genesys.json
 *   node tools/fetch-genesys.mjs --from dir         read konami.html + ygoprodeck.json from dir instead
 *
 * Sources: https://www.yugioh-card.com/en/genesys/ (names and points, the
 * authority) and YGOPRODeck (passcodes, and a second opinion on points).
 *
 * Konami publishes the current list only, with no effective date. Each time
 * the values change, a new dated list is added to the history: by default
 * dated the day the change was first seen, which a reviewer can correct with
 * --date before merging. Nothing is written when the values are unchanged.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseKonamiTable, resolvePoints, nextLists, crossCheckMarkdown } from './lib/genesys.mjs';
import { describeChanges, summaryMarkdown, sameFormats } from './lib/bundle.mjs';
import { readJSON, writeManifest } from './lib/manifest.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KONAMI = 'https://www.yugioh-card.com/en/genesys/';
const YGOPRODECK = 'https://db.ygoprodeck.com/api/v7/cardinfo.php?format=genesys&misc=yes';
const UA = 'MillenniumScale/1.0 (Genesys point list builder)';

/** Fewer rows than this means the page layout changed or the fetch broke, not a real list. */
const MIN_ROWS = 100;

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const SUMMARY = opt('--summary');
const FROM = opt('--from');
const SEEN = opt('--seen');
const DATE = opt('--date');

if (DATE && !/^\d{4}-\d{2}-\d{2}$/.test(DATE)) { console.error(`--date wants YYYY-MM-DD, got "${DATE}"`); process.exit(64); }

async function get(url, asJSON) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: asJSON ? 'application/json' : 'text/html' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return asJSON ? res.json() : res.text();
}

function refuse(why) {
  console.log(`\nRefusing to write — ${why}`);
  console.log('That looks like a broken fetch or a changed page layout, not a new list. Re-run later, or check the page.');
  process.exit(2);
}

const html = FROM ? await readFile(resolve(FROM, 'konami.html'), 'utf8') : await get(KONAMI, false);
const rows = parseKonamiTable(html);
console.log(`Konami: ${rows.length} pointed cards`);
if (rows.length < MIN_ROWS) refuse(`Konami's table has ${rows.length} rows (expected at least ${MIN_ROWS}).`);

const api = FROM ? JSON.parse(await readFile(resolve(FROM, 'ygoprodeck.json'), 'utf8')) : await get(YGOPRODECK, true);
const cards = api.data || [];
console.log(`YGOPRODeck: ${cards.length} cards`);
if (cards.length < 1000) refuse(`YGOPRODeck returned ${cards.length} cards.`);

const resolved = resolvePoints(rows, cards);
console.log(`  → ${resolved.cards.length} cards with points`);
if (resolved.mismatches.length) console.log(`  ~ ${resolved.mismatches.length} value(s) differ between the sources; Konami's used`);
if (resolved.unresolved.length) console.log(`  ! ${resolved.unresolved.length} Konami name(s) matched no card: ${resolved.unresolved.map((u) => u.name).join(', ')}`);
if (resolved.apiOnly.length) console.log(`  ~ ${resolved.apiOnly.length} card(s) pointed on YGOPRODeck only: ${resolved.apiOnly.map((a) => a.name).join(', ')}`);

const previous = await readJSON(resolve(ROOT, 'data/genesys.json'));
const seen = SEEN ? await readJSON(resolve(SEEN)) : null;
const prevLists = previous?.formats?.[0]?.lists || [];
const lists = nextLists(prevLists, resolved.cards, {
  date: DATE || new Date().toISOString().slice(0, 10),
  dateSource: DATE ? 'announced' : 'detected',
  seen: seen?.formats?.[0]?.lists
});

const formats = [{ key: 'GEN', name: 'Genesys', source: KONAMI, lists }];
const changed = !previous || !sameFormats(previous.formats, formats);
const changes = describeChanges(previous?.formats, formats, { valueFn: (c) => c.points || 0 });

if (SUMMARY) {
  const md = summaryMarkdown(changes, { title: 'Genesys points', unit: 'point' });
  const dated = changed && lists[0].dateSource === 'detected'
    ? `\nThe new list is dated **${lists[0].date}**, the day the change was first seen. If Konami announced a different effective date, re-run \`node tools/fetch-genesys.mjs --date YYYY-MM-DD\` on this branch before merging.\n`
    : '';
  await writeFile(resolve(SUMMARY), md + dated + '\n' + crossCheckMarkdown(resolved));
}

if (changed) {
  const bundle = {
    schema: 'millennium-scale/genesys@1',
    generated: new Date().toISOString(),
    source: KONAMI,
    formats
  };
  await mkdir(resolve(ROOT, 'data'), { recursive: true });
  await writeFile(
    resolve(ROOT, 'data/genesys.js'),
    `/* Millennium Scale Genesys point lists\n   Generated ${bundle.generated} from ${KONAMI}\n   Rebuild with: node tools/fetch-genesys.mjs */\nwindow.MS_GENESYS = ${JSON.stringify(bundle)};\n`
  );
  await writeFile(resolve(ROOT, 'data/genesys.json'), JSON.stringify(bundle, null, 2));
  console.log(`\nWrote data/genesys.js and data/genesys.json — ${lists.length} list(s), newest ${lists[0].date}`);
} else {
  console.log('\nNo changes — data/genesys.* left as they are.');
}
await writeManifest(ROOT);
