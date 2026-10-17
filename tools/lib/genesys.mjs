/**
 * Millennium Scale — Genesys point list, built from two sources.
 *
 * Konami's Genesys page is the authority: a table of card names and point
 * values. It has no passcodes, so names are resolved against YGOPRODeck,
 * which also carries `genesys_points` of its own. The two are cross-checked:
 * a value Konami lists wins, and a pointed card YGOPRODeck knows that no
 * Konami row resolved to is kept with YGOPRODeck's value and reported, so a
 * spelling difference can't silently make a 100-point card free.
 *
 * Every function here is pure; tools/fetch-genesys.mjs does the I/O.
 */

/**
 * Konami's spelling -> YGOPRODeck's, where they differ by more than
 * punctuation, case or accents. Add to this when the cross-check reports a
 * name it couldn't place.
 */
export const ALIASES = {
  'Stellarnova Binding': 'Stellarnova Bonds'
};

/** Compare names on letters and digits only, with accents and Ω folded away. */
export function normName(s) {
  return String(s)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/ω/g, 'o')
    .replace(/[^a-z0-9]+/g, '');
}

const ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—' };
function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    // Older captures drop the semicolon on numeric entities (K9-&#216&#216 Lupis).
    .replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

/**
 * Rows of the TablePress table on https://www.yugioh-card.com/en/genesys/:
 *   <td class="column-1">Abyss Dweller</td><td class="column-2">100
 */
export function parseKonamiTable(html) {
  const table = String(html).match(/<table[^>]*\bid="tablepress-genesys"[\s\S]*?<\/table>/i);
  if (!table) return [];
  const rows = [];
  const re = /<td class="column-1">([\s\S]*?)<\/td>\s*<td class="column-2">\s*([\s\S]*?)<\/td>/g;
  let m;
  while ((m = re.exec(table[0]))) {
    const name = decode(m[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    const points = Number(decode(m[2].replace(/<[^>]+>/g, '')).trim());
    if (name && Number.isInteger(points) && points >= 0) rows.push({ name, points });
  }
  return rows;
}

/**
 * @param rows   [{name, points}] from Konami
 * @param cards  YGOPRODeck card records (cardinfo.php?misc=yes)
 * @param opts.fillFromApi  keep YGOPRODeck's value for pointed cards no row
 *        resolved to (default true). Off for historical lists: YGOPRODeck only
 *        knows today's points.
 * @returns {cards, mismatches, unresolved, apiOnly}
 */
export function resolvePoints(rows, cards, { fillFromApi = true } = {}) {
  const byName = new Map();
  for (const c of cards) {
    const k = normName(c.name);
    if (!byName.has(k)) byName.set(k, c);
  }
  const apiPoints = (c) => (c.misc_info && c.misc_info[0] && c.misc_info[0].genesys_points) || 0;

  const out = new Map();
  const mismatches = [], unresolved = [];
  for (const r of rows) {
    const card = byName.get(normName(ALIASES[r.name] || r.name));
    // An unplaced 0-point row costs nothing either way (Konami once put an
    // "Updated 6/23/2026" note in the table), so only pointed ones count.
    if (!card) { if (r.points > 0) unresolved.push(r); continue; }
    if (fillFromApi && apiPoints(card) !== r.points) mismatches.push({ id: card.id, name: card.name, konami: r.points, ygoprodeck: apiPoints(card) });
    out.set(card.id, { id: card.id, name: card.name, points: r.points });
  }

  const apiOnly = [];
  for (const c of fillFromApi ? cards : []) {
    if (apiPoints(c) > 0 && !out.has(c.id)) {
      apiOnly.push({ id: c.id, name: c.name, points: apiPoints(c) });
      out.set(c.id, { id: c.id, name: c.name, points: apiPoints(c) });
    }
  }

  return {
    // Zero-point rows say nothing a missing row doesn't, so they're dropped.
    cards: [...out.values()].filter((c) => c.points > 0).sort((a, b) => a.id - b.id),
    mismatches, unresolved, apiOnly
  };
}

const sameCards = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Fold today's snapshot into the list history (newest first).
 *
 * Unchanged from the newest list -> the history as it was. Otherwise a new
 * list, dated `date`, unless `seen` (an unmerged refresh's history) already
 * holds these exact cards, in which case its date is kept so a pending PR
 * isn't re-dated every day it sits open.
 */
export function nextLists(lists, cards, { date, cap = 100, seen = [], dateSource = 'detected' }) {
  const prev = lists || [];
  if (prev.length && sameCards(prev[0].cards, cards)) return prev;
  const pending = (seen || []).find((l) => sameCards(l.cards, cards));
  const d = pending ? pending.date : date;
  const list = {
    id: `GEN-${d}`, date: d, label: d, cap,
    dateSource: pending ? pending.dateSource || dateSource : dateSource,
    source: 'https://www.yugioh-card.com/en/genesys/',
    cards
  };
  return [list, ...prev.filter((l) => l.date !== d)];
}

/** Lines for the refresh PR describing where the two sources disagree. */
export function crossCheckMarkdown({ mismatches, unresolved, apiOnly }) {
  if (!mismatches.length && !unresolved.length && !apiOnly.length) {
    return 'Konami and YGOPRODeck agree on every point value.\n';
  }
  const lines = ['Konami and YGOPRODeck disagree — Konami’s value is used wherever its row could be placed:', ''];
  for (const m of mismatches) lines.push(`- ${m.name}: Konami ${m.konami}, YGOPRODeck ${m.ygoprodeck}`);
  for (const u of unresolved) lines.push(`- “${u.name}” (${u.points}) on Konami’s list matches no card name; add it to ALIASES in tools/lib/genesys.mjs`);
  for (const a of apiOnly) lines.push(`- ${a.name} (${a.points}) has points on YGOPRODeck only; kept at that value`);
  lines.push('');
  return lines.join('\n');
}
