/**
 * Millennium Scale — the OCG (Japan) Genesys point lists.
 *
 * Konami Japan publishes every list it has issued, each on its own page
 * (https://www.yugioh-card.com/japan/howto/genesys/?list=202610) with an
 * announced effective date and a card-pool cutoff: cards first distributed
 * in Japan after the cutoff can't be used. Names are Japanese only, so each
 * is resolved once through Konami's card database (name -> Konami card id)
 * and YGOPRODeck (Konami card id -> passcode), and the passcode is kept in
 * the published data so later runs only look up names they haven't seen.
 *
 * Every function here is pure; tools/fetch-genesys-ocg.mjs does the I/O.
 */

/**
 * The list's name for a card -> the Konami database's, where they differ by
 * more than width or spacing. Add to this when a refresh reports a name it
 * couldn't place.
 */
export const ALIASES = {};

/** Full-width letters, digits and dashes fold to ASCII; spacing is ignored. */
export function normJa(s) {
  return String(s).normalize('NFKC').replace(/\s+/g, '');
}

// Konami's database spells Greek letters, curly quotes and a few symbols as
// named entities (PSYフレームギア・&gamma;, &ldquo;Case of K９&rdquo;).
const GREEK = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu',
  'nu', 'xi', 'omicron', 'pi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega'];
const ENTITIES = {
  amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ',
  ldquo: '\u201c', rdquo: '\u201d', lsquo: '\u2018', rsquo: '\u2019', prime: '\u2032', Prime: '\u2033',
  times: '\u00d7', divide: '\u00f7', plusmn: '\u00b1', middot: '\u00b7', hellip: '\u2026', deg: '\u00b0',
  Oslash: '\u00d8', oslash: '\u00f8', sigmaf: '\u03c2'
};
GREEK.forEach((n, i) => {
  // Capital sigma's slot (U+03A2) is unassigned; lower case has final sigma there.
  const skip = i >= 17 ? 1 : 0;
  ENTITIES[n] = String.fromCodePoint(0x3b1 + i + skip);
  ENTITIES[n[0].toUpperCase() + n.slice(1)] = String.fromCodePoint(0x391 + i + skip);
});
function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n] ?? ENTITIES[n.toLowerCase()] ?? m);
}

const jaDate = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/**
 * The lists the index page links to, newest first:
 *   <a href="?list=202610" ...>最新版：2026年10月1日適用リスト
 */
export function parseIndex(html) {
  const out = [];
  const re = /href="[^"]*\?list=(\d{6})"[^>]*>[^<]*?(\d{4})年(\d{1,2})月(\d{1,2})日適用リスト/g;
  let m;
  while ((m = re.exec(String(html)))) {
    if (!out.some((l) => l.list === m[1])) out.push({ list: m[1], date: jaDate(m[2], m[3], m[4]) });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * One list page: its card-pool cutoff and its rows. The page shows 0-point
 * rows only for cards that just dropped to 0; those carry no information a
 * missing row doesn't, so they're kept here and dropped when the list is built.
 */
export function parseList(html) {
  const s = String(html);
  const cut = s.match(/[（(](\d{4})年(\d{1,2})月(\d{1,2})日までに収録されたカードまで/);
  const table = s.match(/<table[^>]*class="genesyspoint"[\s\S]*?<\/table>/);
  const rows = [];
  if (table) {
    const re = /<tr[^>]*\bdata-point="(\d+)"[^>]*>\s*<td>[\s\S]*?<\/td>\s*<td>([\s\S]*?)<\/td>/g;
    let m;
    while ((m = re.exec(table[0]))) {
      const name = decode(m[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
      if (name) rows.push({ name, points: Number(m[1]) });
    }
  }
  return { releasedBy: cut ? jaDate(cut[1], cut[2], cut[3]) : null, rows };
}

/**
 * Konami card database search results (request_locale=ja): each card is a
 *   <span class="card_name">NAME</span> ... <input class="cid" value="N">
 */
export function parseSearch(html) {
  const out = [];
  const re = /<span class="card_name">\s*([\s\S]*?)\s*<\/span>[\s\S]*?class="cid" value="(\d+)"/g;
  let m;
  while ((m = re.exec(String(html)))) out.push({ name: decode(m[1]).trim(), cid: Number(m[2]) });
  return out;
}

/**
 * A shorter keyword for a second search when the full name finds nothing:
 * the database's search misses names with Roman numerals, quotes and other
 * symbols, so search on the first run of kana, kanji, letters, digits and
 * spaces (終刻竜機Ⅴ－アマルテ -> 終刻竜機, “Case of K９” -> Case of K９) and
 * pick the exact name from the results.
 */
export function fallbackKeyword(name) {
  const m = String(name).match(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}A-Za-z0-9\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5Aー・ ]+/u);
  const k = m ? m[0].trim() : '';
  return k.length >= 2 && k !== name ? k : null;
}

/** The result whose name is exactly this one, after width folding. */
export function exactMatch(results, name) {
  const want = normJa(ALIASES[name] || name);
  return results.find((r) => normJa(r.name) === want) || null;
}

/** jaName -> {id, name} from the cards of lists already published. */
export function knownNames(lists) {
  const map = new Map();
  for (const l of lists || []) for (const c of l.cards) if (c.jaName) map.set(normJa(c.jaName), { id: c.id, name: c.name });
  return map;
}

/**
 * @param page      {list, date} from parseIndex
 * @param parsed    {releasedBy, rows} from parseList
 * @param resolve   normJa(name) -> {id, name} or undefined
 * @returns {list, unresolved}
 */
export function buildList(page, parsed, resolve, source) {
  const byId = new Map();
  const unresolved = [];
  for (const r of parsed.rows) {
    if (!r.points) continue;
    const card = resolve(normJa(r.name));
    if (!card) { unresolved.push(r); continue; }
    byId.set(card.id, { id: card.id, name: card.name, jaName: r.name, points: r.points });
  }
  return {
    list: {
      id: `GEN-OCG-${page.date}`, date: page.date, label: page.date, cap: 100,
      dateSource: 'announced',
      cardPool: { releasedBy: parsed.releasedBy },
      source,
      cards: [...byId.values()].sort((a, b) => a.id - b.id)
    },
    unresolved
  };
}

/**
 * Lists on the page replace their earlier copies; lists the page no longer
 * shows are kept, since Konami may drop old lists and the history is ours.
 */
export function mergeLists(previous, fetched) {
  const byId = new Map((previous || []).map((l) => [l.id, l]));
  for (const l of fetched) byId.set(l.id, l);
  return [...byId.values()].sort((a, b) => b.date.localeCompare(a.date));
}
