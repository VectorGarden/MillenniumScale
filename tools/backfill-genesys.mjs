#!/usr/bin/env node
/**
 * Millennium Scale — rebuild the TCG Genesys point list history.
 *
 *   node tools/backfill-genesys.mjs
 *
 * Konami's Genesys page only ever shows the current list, so its history comes
 * from the Internet Archive's captures of that page, each matched to the
 * announcement that produced it. Run once; the daily fetcher
 * (tools/fetch-genesys.mjs) adds new lists on top from then on. Re-running it
 * rebuilds data/genesys.* from scratch, so the result is reproducible.
 *
 * Dating rules, per VERSIONS below:
 *   announced  a points update, dated by its post (or the effective date the
 *              post states)
 *   release    a new set's initial points, dated by the set's TCG release:
 *              Konami adds them to the page then, not when the post goes up
 *              (the 2026-10-09 capture still lacks Beyond the Brave, released
 *              2026-10-08, whose points were posted 2026-09-22)
 */

import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseKonamiTable, resolvePoints } from './lib/genesys.mjs';
import { writeManifest } from './lib/manifest.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = 'https://www.yugioh-card.com/en/genesys/';
const BLOG = 'https://yugiohblog.konami.com';
const YGOPRODECK = 'https://db.ygoprodeck.com/api/v7/cardinfo.php?format=genesys&misc=yes';
const UA = 'MillenniumScale/1.0 (Genesys history backfill)';

/**
 * Every list Konami has published, oldest first. `capture` is the Wayback
 * timestamp whose table is the list ('live' for today's page); `rebuild`
 * applies an announcement's new-card points to the list before it, for the
 * one version no capture caught.
 */
const VERSIONS = [
  { date: '2025-09-22', dateSource: 'announced', capture: '20250922', announcement: '/2025/news-updates/introducing-ygo-tcg-genesys/', note: 'Launch' },
  // The 2025-09-24 capture shows Planet Pathfinder at 2; the post and the
  // 2025-10-01 capture have 3, so the later capture is the list as announced.
  { date: '2025-09-24', dateSource: 'announced', capture: '20251001', announcement: '/2025/genesys/first-point-adjustments/', note: 'First point adjustments' },
  { date: '2025-10-27', dateSource: 'announced', capture: '20251028', announcement: '/2025/genesys/october-27-2025-genesys-points-update/', note: 'October points update' },
  { date: '2025-12-15', dateSource: 'announced', capture: '20251216', announcement: '/2025/genesys/genesys-december-points-update/', note: 'December points update' },
  { date: '2026-02-05', dateSource: 'release', capture: '20260209', announcement: '/2026/genesys/burst-protocol-pre-release-points/', note: 'Burst Protocol initial points (posted 2026-01-29)' },
  { date: '2026-03-05', dateSource: 'announced', capture: '20260321', announcement: '/2026/genesys/genesys-march-points-update/', note: 'March points update' },
  { date: '2026-05-07', dateSource: 'release', capture: '20260518', announcement: '/2026/genesys/blazing-dominion-genesys-points-update/', note: 'Blazing Dominion initial points (posted 2026-04-30)' },
  { date: '2026-06-08', dateSource: 'announced', capture: '20260609', announcement: '/2026/genesys/genesys-june-points-update/', note: 'June points update' },
  { date: '2026-07-02', dateSource: 'release', capture: '20260707', announcement: '/2026/genesys/chaos-origins-glorious-gallery-points-update/', note: 'Chaos Origins and Glorious Gallery initial points (posted 2026-06-22)' },
  // Posted Thursday 2026-07-30: "These point changes will take effect on Monday."
  { date: '2026-08-03', dateSource: 'announced', capture: '20260806', announcement: '/2026/genesys/post-genesys-championships-august-points-update/', note: 'Post-Championships August points update' },
  // No capture between 2026-08-06 and 2026-10-09, so this one is the August
  // list plus the post's ten new cards. The 2026-10-09 capture agrees with
  // every one of those values that the anniversary update didn't change.
  {
    date: '2026-09-03', dateSource: 'release', announcement: '/2026/genesys/magnificent-monsters-points-update/',
    note: 'Magnificent Monsters initial points (posted 2026-08-24)',
    rebuild: [
      ['Kuriboh - Multiply!', 10], ['Dark Magical Curtain', 30], ['Winged Kuriboh Sabatiel LV10', 7],
      ['Stardust Dragon - Victim Sanctuary', 15], ['Starjunk Synchron', 1], ['Synchro Emergency', 5],
      ['Number 39: Utopia, Emissary of Light', 5], ['Gagaga Magician - Gagaga Magic', 6],
      ['Rainbow Bridge Bifrost', 10], ['Malefic Paradigm Shift', 8]
    ]
  },
  { date: '2026-10-05', dateSource: 'announced', capture: '20261009', announcement: '/2026/genesys/genesys-big-1st-anniversary-update/', note: '1st Anniversary update' },
  { date: '2026-10-08', dateSource: 'release', capture: 'live', announcement: '/2026/genesys/beyond-the-brave-initial-genesys-points/', note: 'Beyond the Brave initial points (posted 2026-09-22)' }
];

async function get(url, asJSON) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return asJSON ? res.json() : res.text();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const captureUrl = (ts) => `https://web.archive.org/web/${ts}id_/${PAGE}`;

const api = await get(YGOPRODECK, true);
const cards = api.data || [];
console.log(`YGOPRODeck: ${cards.length} cards`);

const lists = [];
let failed = 0;
for (const v of VERSIONS) {
  let built;
  let source;
  if (v.rebuild) {
    const prev = lists[0];
    const rows = v.rebuild.map(([name, points]) => ({ name, points }));
    const r = resolvePoints(rows, cards, { fillFromApi: false });
    const byId = new Map(prev.cards.map((c) => [c.id, c]));
    for (const c of r.cards) byId.set(c.id, c);
    built = { cards: [...byId.values()].sort((a, b) => a.id - b.id), unresolved: r.unresolved, rows: rows.length };
    source = BLOG + v.announcement;
  } else {
    const live = v.capture === 'live';
    source = live ? PAGE : captureUrl(v.capture);
    const rows = parseKonamiTable(await get(source, false));
    // Today's list is built exactly as the daily fetcher builds it, so the
    // next scheduled run sees no change.
    const r = resolvePoints(rows, cards, { fillFromApi: live });
    built = { cards: r.cards, unresolved: r.unresolved, rows: rows.length };
    if (!live) await sleep(1500);
  }
  const zero = built.rows - built.unresolved.length - built.cards.length;
  console.log(`  ${v.date}  ${String(built.cards.length).padStart(3)} cards  (${v.dateSource}; ${v.note})${zero > 0 ? `, ${zero} zero-point rows dropped` : ''}`);
  for (const u of built.unresolved) { console.log(`      ! unplaced: "${u.name}" (${u.points})`); failed++; }
  lists.unshift({
    id: `GEN-${v.date}`, date: v.date, label: v.date, cap: 100,
    dateSource: v.dateSource,
    ...(v.rebuild ? { rebuilt: true } : {}),
    note: v.note,
    announcement: BLOG + v.announcement,
    source,
    cards: built.cards
  });
}

if (failed) {
  console.log(`\n${failed} name(s) couldn't be placed. Add them to ALIASES in tools/lib/genesys.mjs and re-run; nothing was written.`);
  process.exit(1);
}

const bundle = {
  schema: 'millennium-scale/genesys@1',
  generated: new Date().toISOString(),
  source: PAGE,
  formats: [{ key: 'GEN', name: 'Genesys', source: PAGE, lists }]
};
await writeFile(
  resolve(ROOT, 'data/genesys.js'),
  `/* Millennium Scale Genesys point lists\n   Generated ${bundle.generated} from ${PAGE}\n   Rebuild with: node tools/fetch-genesys.mjs */\nwindow.MS_GENESYS = ${JSON.stringify(bundle)};\n`
);
await writeFile(resolve(ROOT, 'data/genesys.json'), JSON.stringify(bundle, null, 2));
await writeManifest(ROOT);
console.log(`\nWrote data/genesys.js and data/genesys.json — ${lists.length} lists, ${lists[lists.length - 1].date} to ${lists[0].date}`);
