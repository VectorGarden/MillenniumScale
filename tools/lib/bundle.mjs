/**
 * Millennium Scale — comparing a freshly fetched archive with the one on disk.
 *
 * The scheduled refresh runs unattended, so it needs three answers before it
 * writes anything: did the content actually change, did it lose anything it
 * shouldn't have, and what moved (for the pull request it opens).
 *
 * Every function here is pure; the fetchers do the I/O.
 */

/** Stable JSON for content comparison. `generated` is a timestamp, not content. */
const contentOf = (value) => JSON.stringify(value);

export function sameFormats(a, b) {
  return contentOf(a || []) === contentOf(b || []);
}

/**
 * Replace only the formats that were fetched, keep the rest, and preserve the
 * order the archive already uses. `--only MD` must not wipe TCG and OCG.
 */
export function mergeFormats(previous, fetched, order) {
  const byKey = new Map((previous || []).map((f) => [f.key, f]));
  for (const f of fetched) byKey.set(f.key, f);
  const keys = [...(order || []), ...(previous || []).map((f) => f.key), ...fetched.map((f) => f.key)];
  return [...new Set(keys)].filter((k) => byKey.has(k)).map((k) => byKey.get(k));
}

/** Same cards, same statuses, regardless of which id or date the list carries. */
const cardsOf = (l) => JSON.stringify(l.cards);

/**
 * Lists that left under one id and came back under another with identical
 * cards. A month-only section ("2015.07 TCG") falls back to the 1st until the
 * index advertises the exact day, so this happens on its own.
 */
function redates(oldLists, newLists) {
  const oldIds = new Set(oldLists.map((l) => l.id));
  const newIds = new Set(newLists.map((l) => l.id));
  const fresh = newLists.filter((l) => !oldIds.has(l.id));
  const out = [];
  for (const l of oldLists) {
    if (newIds.has(l.id)) continue;
    const to = fresh.find((n) => cardsOf(n) === cardsOf(l) && !out.some((r) => r.to.id === n.id));
    if (to) out.push({ from: l, to });
  }
  return out;
}

/**
 * Anything that looks like a partial fetch rather than a real upstream change.
 *
 *   outage   a format disappeared or came back empty. Never written.
 *   removal  a list upstream no longer has. Written only with --allow-shrink,
 *            and called out in the summary so a person looks before merging.
 *
 * A re-dated list is neither.
 */
export function shrinkProblems(previous, next) {
  const problems = [];
  const nextByKey = new Map((next || []).map((f) => [f.key, f]));
  for (const old of previous || []) {
    const now = nextByKey.get(old.key);
    if (!now) { problems.push({ level: 'outage', text: `${old.key}: format missing entirely (had ${old.lists.length} lists)` }); continue; }
    if (!now.lists.length) { problems.push({ level: 'outage', text: `${old.key}: came back with no lists (had ${old.lists.length})` }); continue; }
    const ids = new Set(now.lists.map((l) => l.id));
    const moved = new Set(redates(old.lists, now.lists).map((r) => r.from.id));
    const lost = old.lists.filter((l) => !ids.has(l.id) && !moved.has(l.id)).map((l) => l.id);
    if (lost.length) problems.push({ level: 'removal', text: `${old.key}: ${lost.length} list(s) no longer upstream: ${lost.slice(0, 6).join(', ')}${lost.length > 6 ? '…' : ''}` });
  }
  return problems;
}

/** Cards whose value differs between two lists, keyed by passcode. */
function entryChanges(from, to, valueOf) {
  const a = new Map((from ? from.cards : []).map((c) => [c.id, valueOf(c)]));
  const b = new Map((to ? to.cards : []).map((c) => [c.id, valueOf(c)]));
  let changed = 0;
  for (const id of new Set([...a.keys(), ...b.keys()])) if (a.get(id) !== b.get(id)) changed++;
  return changed;
}

const statusOf = (c) => (c.status === undefined ? 3 : c.status);

/**
 * What moved, per format. A new list is compared with the list before it, so
 * the summary says how many cards it changed rather than how big it is.
 */
export function describeChanges(previous, next, { valueFn = statusOf } = {}) {
  const prevByKey = new Map((previous || []).map((f) => [f.key, f]));
  const out = [];
  for (const f of next || []) {
    const old = prevByKey.get(f.key);
    const oldById = new Map((old ? old.lists : []).map((l) => [l.id, l]));
    const nextIds = new Set(f.lists.map((l) => l.id));
    const moves = redates(old ? old.lists : [], f.lists);
    const movedTo = new Set(moves.map((r) => r.to.id));
    const movedFrom = new Set(moves.map((r) => r.from.id));
    const added = [], updated = [];
    // Lists are newest-first, so the one before lists[i] is lists[i + 1].
    f.lists.forEach((l, i) => {
      const was = oldById.get(l.id);
      if (movedTo.has(l.id)) return;
      if (!was) added.push({ id: l.id, date: l.date, entries: l.cards.length, changed: entryChanges(f.lists[i + 1], l, valueFn) });
      else if (contentOf(was) !== contentOf(l)) updated.push({ id: l.id, date: l.date, entries: l.cards.length, changed: entryChanges(was, l, valueFn) });
    });
    const redated = moves.map((r) => ({ from: r.from.date, to: r.to.date, id: r.to.id }));
    const removed = (old ? old.lists : []).filter((l) => !nextIds.has(l.id) && !movedFrom.has(l.id)).map((l) => ({ id: l.id, date: l.date }));
    if (added.length || updated.length || redated.length || removed.length) out.push({ key: f.key, name: f.name, added, updated, redated, removed });
  }
  return out;
}

/** Markdown for the refresh pull request and the job summary. */
export function summaryMarkdown(changes, { title = 'Banlist archive', unit = 'status' } = {}) {
  if (!changes.length) return `### ${title}\n\nNo changes upstream.\n`;
  const lines = [`### ${title}`, ''];
  for (const c of changes) {
    lines.push(`**${c.name}**`, '');
    for (const l of c.added) lines.push(`- New list **${l.date}** — ${l.entries} entries, ${l.changed} ${unit} change${l.changed === 1 ? '' : 's'} from the previous list`);
    for (const l of c.updated) lines.push(`- Corrected **${l.date}** — ${l.changed} entr${l.changed === 1 ? 'y' : 'ies'} changed upstream`);
    for (const l of c.redated) lines.push(`- Re-dated **${l.from}** → **${l.to}** — same cards, exact day now known`);
    for (const l of c.removed) lines.push(`- ⚠️ Removed **${l.date}** — no longer upstream. Check this is real before merging.`);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * A small file that says what the archive holds and when it last changed,
 * so anything polling the site can check it without pulling megabytes.
 */
export function manifestEntry(f, file) {
  const current = f.lists[0];
  return {
    key: f.key,
    name: f.name,
    file,
    lists: f.lists.length,
    oldest: f.lists.length ? f.lists[f.lists.length - 1].date : null,
    current: current ? { id: current.id, date: current.date, entries: current.cards.length } : null
  };
}
