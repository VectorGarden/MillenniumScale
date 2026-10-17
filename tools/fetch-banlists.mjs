#!/usr/bin/env node
/**
 * Millennium Scale — banlist fetcher
 *
 *   node tools/fetch-banlists.mjs              pull every list, write data/banlists.js + .json
 *   node tools/fetch-banlists.mjs --cards      also bundle card details for offline use
 *   node tools/fetch-banlists.mjs --only TCG   just one format, keeping the others as they are
 *   node tools/fetch-banlists.mjs --summary f  also write a Markdown summary of what changed to f
 *
 * Nothing is written when the content matches what's already on disk, so an
 * unchanged run leaves the working tree clean. A fetch that would lose lists
 * (a format gone, empty, or missing dates it used to have) is refused unless
 * --allow-shrink is given: unattended runs must not turn a flaky upstream into
 * a deleted archive.
 *
 * Source: https://ygo.anihelp.co.uk/ (TCG, /MD/, /OCG/)
 *
 * Each format publishes a combined "CombiList" .conf holding every list it
 * has ever had, plus per-date .conf files. We take the combined file first
 * because it's one request, then fill any gaps from the per-date files.
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sameFormats, mergeFormats, shrinkProblems, describeChanges, summaryMarkdown } from './lib/bundle.mjs';
import { readJSON, writeManifest } from './lib/manifest.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://ygo.anihelp.co.uk';
const UA = 'MillenniumScale/1.0 (banlist archive builder)';

const FORMATS = {
  TCG: {
    name: 'TCG',
    index: `${BASE}/`,
    combi: `${BASE}/public/TCG/TCGCombiList.conf`,
    perDate: (d) => [`${BASE}/public/TCG/lists/${d}.conf`, `${BASE}/public/TCG/Config/${d}.conf`],
    datePath: (d) => `${BASE}/${d}/`
  },
  MD: {
    name: 'Master Duel',
    index: `${BASE}/MD/`,
    combi: `${BASE}/public/MD/MDCombiList.conf`,
    perDate: (d) => [`${BASE}/public/MD/Config/${d}.conf`, `${BASE}/public/MD/lists/${d}.conf`],
    datePath: (d) => `${BASE}/MD/${d}/`
  },
  OCG: {
    name: 'OCG',
    index: `${BASE}/OCG/`,
    combi: `${BASE}/public/OCG/OCGCombiList.conf`,
    perDate: (d) => [`${BASE}/public/OCG/lists/${d}.conf`, `${BASE}/public/OCG/Config/${d}.conf`],
    datePath: (d) => `${BASE}/OCG/${d}/`
  }
};

const args = process.argv.slice(2);
const WANT_CARDS = args.includes('--cards');
const ONLY = (() => { const i = args.indexOf('--only'); return i >= 0 ? args[i + 1] : null; })();
/** --from <dir>: read *CombiList.conf off disk instead of the network. */
const FROM = (() => { const i = args.indexOf('--from'); return i >= 0 ? args[i + 1] : null; })();
/** --idmap: build data/idmap.js, translating Konami database ids to passcodes. */
const WANT_IDMAP = args.includes('--idmap');
/** --summary <file>: write a Markdown summary of what changed, for the refresh PR. */
const SUMMARY = (() => { const i = args.indexOf('--summary'); return i >= 0 ? args[i + 1] : null; })();
const ALLOW_SHRINK = args.includes('--allow-shrink');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, { asText = true } = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return asText ? res.text() : res.json();
}

/* ------------------------------------------------------------------
   .conf (LFList) parsing
   ------------------------------------------------------------------ */

function parseLFList(text) {
  const lists = [];
  let current = null;
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line[0] === '!') { current = { name: line.slice(1).trim(), whitelist: false, cards: [] }; lists.push(current); continue; }
    if (line[0] === '$') { if (current && /whitelist/i.test(line)) current.whitelist = true; continue; }
    if (line[0] === '#') continue;
    const m = line.match(/^(\d{1,10})\s+(-?\d+)(?:\s*--\s*(.*))?$/);
    if (!m) continue;
    const status = Number(m[2]);
    if (status < 0 || status > 3) continue;
    if (!current) { current = { name: 'unnamed', whitelist: false, cards: [] }; lists.push(current); }
    current.cards.push({ id: Number(m[1]), name: (m[3] || '').trim() || null, status });
  }
  return {
    lists: lists.filter((l) => l.cards.length),
    empty: lists.filter((l) => !l.cards.length).map((l) => l.name)
  };
}

const pad2 = (v) => String(Number(v)).padStart(2, '0');

/**
 * Section names in the archive are day-first European dates:
 *   "TCG 18.05.2026"      -> 2026-05-18
 *   "01.07.2021 TCG"      -> 2021-07-01
 *   "OCG 08.2000"         -> 2000-08 (month only; the day comes from the index page)
 * ISO-style names are accepted too, in case another source is used.
 */
function guessDate(name) {
  const s = String(name);
  let m;

  // ISO first: 2026-05-18 / 2026.05.18
  if ((m = s.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/))) {
    return { date: `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`, exact: true };
  }
  // Day-first: 18.05.2026
  if ((m = s.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/))) {
    return { date: `${m[3]}-${pad2(m[2])}-${pad2(m[1])}`, exact: true };
  }
  // Month + year only: 08.2000
  if ((m = s.match(/(\d{1,2})[.\-/](\d{4})/))) {
    return { date: `${m[2]}-${pad2(m[1])}`, exact: false };
  }
  // Year + month only: 2000.08
  if ((m = s.match(/(\d{4})[.\-/](\d{1,2})/))) {
    return { date: `${m[1]}-${pad2(m[2])}`, exact: false };
  }
  return null;
}

/* Effective dates advertised on the format's index page. */
function scrapeDates(html, formatKey) {
  const prefix = formatKey === 'TCG' ? '' : `/${formatKey}`;
  const re = new RegExp(`href="(?:${BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})?${prefix}/(\\d{4}-\\d{2}-\\d{2})/?"`, 'g');
  const out = new Set();
  let m;
  while ((m = re.exec(html))) out.add(m[1]);
  // Some entries are plain text rather than links; catch those too.
  const loose = new RegExp(`${prefix}/(\\d{4}-\\d{2}-\\d{2})`, 'g');
  while ((m = loose.exec(html))) out.add(m[1]);
  return [...out].sort().reverse();
}

/* ------------------------------------------------------------------
   Per-format build
   ------------------------------------------------------------------ */

async function buildFormat(key) {
  const cfg = FORMATS[key];
  process.stdout.write(`\n${key}\n`);

  let knownDates = [];
  if (FROM) {
    console.log(`  index: skipped (--from ${FROM})`);
  } else {
    try {
      const html = await get(cfg.index);
      knownDates = scrapeDates(html, key);
      console.log(`  index: ${knownDates.length} effective dates advertised`);
    } catch (e) {
      console.log(`  index: unavailable (${e.message})`);
    }
  }

  const byDate = new Map();

  // 1. combined file
  try {
    const text = FROM
      ? await readFile(resolve(FROM, `${key}CombiList.conf`), 'utf8')
      : await get(cfg.combi);
    const { lists: sections, empty } = parseLFList(text);
    console.log(`  combi: ${sections.length} sections, ${text.length.toLocaleString()} bytes`);
    if (empty.length) console.log(`  ~ ${empty.length} section(s) had no card entries upstream and were skipped: ${empty.join(', ')}`);

    for (const s of sections) {
      const g = guessDate(s.name);
      let date = null;
      if (g?.exact) {
        date = g.date;
      } else if (g) {
        // "2026.05" -> the advertised date in that month
        date = knownDates.find((d) => d.startsWith(g.date)) || `${g.date}-01`;
      }
      if (!date) { console.log(`  ! skipped section with no date: "${s.name}"`); continue; }

      // The archive occasionally carries two sections for one date, where the
      // later one is a correction. Keep whichever is more complete.
      const prev = byDate.get(date);
      if (prev) {
        const keepNew = s.cards.length >= prev.cards.length;
        console.log(`  ~ two sections for ${date} (${prev.cards.length} vs ${s.cards.length} entries) — keeping the larger`);
        if (!keepNew) continue;
      }
      byDate.set(date, { ...s, date, source: cfg.combi });
    }
  } catch (e) {
    console.log(`  combi: failed (${e.message})`);
  }

  // 2. gaps
  const missing = FROM ? [] : knownDates.filter((d) => !byDate.has(d));
  if (missing.length) {
    console.log(`  filling ${missing.length} gap(s) from per-date files`);
    for (const d of missing) {
      let got = false;
      for (const url of cfg.perDate(d)) {
        try {
          const text = await get(url);
          const [s] = parseLFList(text).lists;
          if (s) { byDate.set(d, { ...s, date: d, source: url }); got = true; break; }
        } catch { /* try the next candidate path */ }
      }
      if (!got) console.log(`    ${d}: not found`);
      await sleep(120);
    }
  }

  // Month-only sections keep a YYYY-MM key; give them a real day.
  for (const [date, s] of [...byDate.entries()]) {
    if (date.length !== 7) continue;
    byDate.delete(date);
    const exact = knownDates.find((d) => d.startsWith(date)) || `${date}-01`;
    if (!byDate.has(exact)) byDate.set(exact, { ...s, date: exact });
  }

  const lists = [...byDate.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((s) => ({
      id: `${key}-${s.date}`,
      date: s.date,
      label: s.date,
      confName: s.name,
      whitelist: !!s.whitelist,
      source: s.source,
      cards: dedupe(s.cards)
    }));

  const total = lists.reduce((n, l) => n + l.cards.length, 0);
  console.log(`  → ${lists.length} lists, ${total.toLocaleString()} entries`);

  return { key, name: cfg.name, source: cfg.index, lists };
}

function dedupe(cards) {
  const seen = new Map();
  for (const c of cards) seen.set(c.id, c);
  return [...seen.values()];
}

/* ------------------------------------------------------------------
   Optional: bundle card details for offline use
   ------------------------------------------------------------------ */

async function buildCards(formats) {
  const ids = new Set();
  for (const f of formats) for (const l of f.lists) for (const c of l.cards) ids.add(c.id);
  const all = [...ids];
  console.log(`\nCards: looking up ${all.length} passcodes on YGOPRODeck`);

  const out = [];
  for (let i = 0; i < all.length; i += 90) {
    const chunk = all.slice(i, i + 90);
    try {
      const json = await get(`https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${chunk.join(',')}`, { asText: false });
      for (const raw of json.data || []) out.push(compact(raw));
    } catch {
      // The API rejects the whole batch over one bad id, so retry singly.
      for (const id of chunk) {
        try {
          const json = await get(`https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${id}`, { asText: false });
          for (const raw of json.data || []) out.push(compact(raw));
        } catch { /* genuinely unknown passcode */ }
        await sleep(60);
      }
    }
    process.stdout.write(`\r  ${Math.min(i + 90, all.length)}/${all.length}`);
    await sleep(120);
  }
  process.stdout.write('\n');

  const seen = new Map();
  for (const c of out) seen.set(c.id, c);
  return [...seen.values()];
}

function compact(raw) {
  return {
    id: raw.id,
    name: raw.name,
    frame: raw.frameType || 'unknown',
    type: raw.type || '',
    race: raw.race || '',
    attribute: raw.attribute || '',
    level: raw.level ?? null,
    linkval: raw.linkval ?? null,
    linkmarkers: raw.linkmarkers || null,
    scale: raw.scale ?? null,
    atk: raw.atk ?? null,
    def: raw.def ?? null,
    desc: raw.desc || '',
    alts: (raw.card_images || []).map((im) => im.id)
  };
}

/* ------------------------------------------------------------------
   Main
   ------------------------------------------------------------------ */

const keys = ONLY ? [ONLY.toUpperCase()] : Object.keys(FORMATS);
for (const k of keys) {
  if (!FORMATS[k]) { console.error(`Unknown format "${k}". Try TCG, MD or OCG.`); process.exit(1); }
}

const fetched = [];
for (const k of keys) fetched.push(await buildFormat(k));

const previous = await readJSON(resolve(ROOT, 'data/banlists.json'));
const formats = mergeFormats(previous?.formats, fetched, Object.keys(FORMATS));

const shrink = previous ? shrinkProblems(previous.formats, formats) : [];
const outage = shrink.filter((p) => p.level === 'outage');
if (shrink.length) {
  const refuse = outage.length || !ALLOW_SHRINK;
  console.log(`\n${refuse ? 'Refusing to write — this fetch would lose data:' : 'Removing lists upstream no longer has (--allow-shrink):'}`);
  shrink.forEach((p) => console.log(`  ! ${p.text}`));
  if (outage.length) {
    console.log('A whole format is missing or empty, which means upstream is down, not changed. Re-run later.');
    process.exit(2);
  }
  if (!ALLOW_SHRINK) {
    console.log('Pass --allow-shrink if the removal is real.');
    process.exit(2);
  }
}

const changes = describeChanges(previous?.formats, formats);
const changed = !previous || !sameFormats(previous.formats, formats);

if (SUMMARY) await writeFile(resolve(SUMMARY), summaryMarkdown(changes, { title: 'Banlist archive' }));

if (changed) {
  const bundle = {
    schema: 'millennium-scale/banlists@1',
    generated: new Date().toISOString(),
    source: BASE,
    formats
  };

  await mkdir(resolve(ROOT, 'data'), { recursive: true });

  await writeFile(
    resolve(ROOT, 'data/banlists.js'),
    `/* Millennium Scale banlist bundle\n   Generated ${bundle.generated} from ${BASE}\n   Rebuild with: node tools/fetch-banlists.mjs */\nwindow.MS_BANLISTS = ${JSON.stringify(bundle)};\n`
  );
  await writeFile(resolve(ROOT, 'data/banlists.json'), JSON.stringify(bundle, null, 2));

  console.log(`\nWrote data/banlists.js and data/banlists.json`);
  console.log(`  ${formats.length} formats, ${formats.reduce((n, f) => n + f.lists.length, 0)} lists`);
  for (const c of changes) {
    console.log(`  ${c.key}: ${c.added.length} new, ${c.updated.length} corrected, ${c.removed.length} removed`);
  }
} else {
  console.log('\nNo changes upstream — data/banlists.* left as they are.');
}
await writeManifest(ROOT);

if (WANT_IDMAP) {
  console.log('\nBuilding the Konami id -> passcode map (one large request, please be patient)');
  const json = await get('https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes', { asText: false });
  const map = {};
  let withId = 0;
  for (const card of json.data || []) {
    const kid = card.misc_info?.[0]?.konami_id;
    if (kid == null) continue;
    withId++;
    map[kid] = card.id;
    // Alt-art printings share the base passcode, so no extra entries needed.
  }
  await writeFile(
    resolve(ROOT, 'data/idmap.js'),
    `/* Millennium Scale — Konami database id -> passcode\n   ${withId} of ${(json.data || []).length} cards, generated ${new Date().toISOString()}\n   Rebuild with: node tools/fetch-banlists.mjs --idmap */\n` +
    `window.MS_IDMAP = ${JSON.stringify({ name: 'konami', label: 'Konami database id', generated: new Date().toISOString(), map })};\n`
  );
  console.log(`Wrote data/idmap.js (${withId} ids)`);
}

if (WANT_CARDS) {
  const cards = await buildCards(formats);
  await writeFile(
    resolve(ROOT, 'data/cards.js'),
    `/* Millennium Scale offline card details — ${cards.length} cards, generated ${new Date().toISOString()} */\nwindow.MS_CARDS = ${JSON.stringify({ generated: new Date().toISOString(), cards })};\n`
  );
  console.log(`Wrote data/cards.js (${cards.length} cards)`);
  console.log('Add <script src="data/cards.js"></script> before js/core.js in each page to use it.');
}
