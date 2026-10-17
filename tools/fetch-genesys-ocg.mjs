#!/usr/bin/env node
/**
 * Millennium Scale — OCG (Japan) Genesys point list fetcher
 *
 *   node tools/fetch-genesys-ocg.mjs              fetch every list, write data/genesys-ocg.* if changed
 *   node tools/fetch-genesys-ocg.mjs --summary f  also write a Markdown summary of what changed to f
 *
 * Source: https://www.yugioh-card.com/japan/howto/genesys/ — every list Konami
 * Japan has issued, each with its effective date and card-pool cutoff.
 *
 * Names are Japanese only. A name already published in data/genesys-ocg.json
 * reuses its passcode; a new one is looked up once in Konami's card database
 * (name -> Konami card id, one request a second) and mapped to a passcode via
 * YGOPRODeck's konami_id. So the first build makes about a thousand lookups
 * and a normal day makes none.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseIndex, parseList, parseSearch, exactMatch, fallbackKeyword, knownNames, buildList, mergeLists, normJa } from './lib/genesys-ocg.mjs';
import { describeChanges, summaryMarkdown, sameFormats } from './lib/bundle.mjs';
import { readJSON, writeManifest } from './lib/manifest.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = 'https://www.yugioh-card.com/japan/howto/genesys/';
const DB_SEARCH = 'https://www.db.yugioh-card.com/yugiohdb/card_search.action';
const YGOPRODECK = 'https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes';
const UA = 'MillenniumScale/1.0 (Genesys point list builder)';

/** Fewer rows than this on a list page means a broken fetch or a new layout. */
const MIN_ROWS = 100;

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const SUMMARY = opt('--summary');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const pages = parseIndex(await get(INDEX, false));
console.log(`Konami Japan: ${pages.length} list(s) — ${pages.map((p) => p.date).join(', ')}`);
if (!pages.length) refuse('the index page links no point lists.');

const parsed = [];
for (const p of pages) {
  const list = parseList(await get(`${INDEX}?list=${p.list}`, false));
  console.log(`  ${p.date}: ${list.rows.length} rows, card pool up to ${list.releasedBy || '(no cutoff found)'}`);
  if (list.rows.length < MIN_ROWS) refuse(`the ${p.date} list has ${list.rows.length} rows (expected at least ${MIN_ROWS}).`);
  if (!list.releasedBy) refuse(`the ${p.date} list states no card-pool cutoff.`);
  parsed.push(list);
  await sleep(300);
}

const previous = await readJSON(resolve(ROOT, 'data/genesys-ocg.json'));
const prevLists = previous?.formats?.[0]?.lists || [];
const known = knownNames(prevLists);

const wanted = new Set();
for (const list of parsed) for (const r of list.rows) if (r.points && !known.has(normJa(r.name))) wanted.add(r.name);

const lookupFailed = [];
if (wanted.size) {
  console.log(`\nResolving ${wanted.size} new name(s) through Konami's card database`);
  const api = await get(YGOPRODECK, true);
  const byKonamiId = new Map();
  for (const c of api.data || []) {
    const kid = c.misc_info?.[0]?.konami_id;
    if (kid != null) byKonamiId.set(Number(kid), { id: c.id, name: c.name });
  }
  if (byKonamiId.size < 10000) refuse(`YGOPRODeck returned only ${byKonamiId.size} cards with Konami ids.`);

  const search = async (keyword) => parseSearch(await get(`${DB_SEARCH}?ope=1&sess=1&rp=100&stype=1&request_locale=ja&keyword=${encodeURIComponent(keyword)}`, false));

  let done = 0;
  for (const name of wanted) {
    try {
      let hit = exactMatch(await search(name), name);
      const shorter = !hit && fallbackKeyword(name);
      if (shorter) { await sleep(1000); hit = exactMatch(await search(shorter), name); }
      const card = hit && byKonamiId.get(hit.cid);
      if (card) known.set(normJa(name), card);
      else lookupFailed.push({ name, why: hit ? `Konami id ${hit.cid} has no passcode on YGOPRODeck` : 'no exact match in the card database' });
    } catch (e) {
      lookupFailed.push({ name, why: e.message });
    }
    if (++done % 50 === 0) console.log(`  ${done}/${wanted.size}`);
    await sleep(1000);
  }
}

const built = pages.map((p, i) => buildList(p, parsed[i], (k) => known.get(k), `${INDEX}?list=${p.list}`));
const unresolved = [...new Set(built.flatMap((b) => b.unresolved.map((u) => u.name)))];
for (const b of built) console.log(`  → ${b.list.date}: ${b.list.cards.length} pointed cards${b.unresolved.length ? `, ${b.unresolved.length} unplaced` : ''}`);

const lists = mergeLists(prevLists, built.map((b) => b.list));
const formats = [{ key: 'GEN-OCG', name: 'Genesys (OCG)', source: INDEX, lists }];
const changed = !previous || !sameFormats(previous.formats, formats);
const changes = describeChanges(previous?.formats, formats, { valueFn: (c) => c.points || 0 });

if (unresolved.length) {
  console.log(`\n! ${unresolved.length} name(s) couldn't be placed, so those cards count as 0 points:`);
  for (const n of unresolved) {
    const why = lookupFailed.find((f) => f.name === n);
    console.log(`    ${n}${why ? ` — ${why.why}` : ''}`);
  }
}

if (SUMMARY) {
  let md = summaryMarkdown(changes, { title: 'Genesys points (OCG)', unit: 'point' });
  if (unresolved.length) {
    md += `\n⚠️ ${unresolved.length} name(s) on Konami Japan's lists couldn't be placed, so they count as 0 points until fixed. Add each to ALIASES in tools/lib/genesys-ocg.mjs:\n\n`;
    md += unresolved.map((n) => `- ${n}`).join('\n') + '\n';
  }
  await writeFile(resolve(SUMMARY), md);
}

if (changed) {
  const bundle = { schema: 'millennium-scale/genesys@1', generated: new Date().toISOString(), source: INDEX, formats };
  await mkdir(resolve(ROOT, 'data'), { recursive: true });
  await writeFile(
    resolve(ROOT, 'data/genesys-ocg.js'),
    `/* Millennium Scale Genesys point lists (OCG, Japan)\n   Generated ${bundle.generated} from ${INDEX}\n   Rebuild with: node tools/fetch-genesys-ocg.mjs */\nwindow.MS_GENESYS_OCG = ${JSON.stringify(bundle)};\n`
  );
  await writeFile(resolve(ROOT, 'data/genesys-ocg.json'), JSON.stringify(bundle, null, 2));
  console.log(`\nWrote data/genesys-ocg.js and data/genesys-ocg.json — ${lists.length} list(s), newest ${lists[0].date}`);
} else {
  console.log('\nNo changes — data/genesys-ocg.* left as they are.');
}
await writeManifest(ROOT);
