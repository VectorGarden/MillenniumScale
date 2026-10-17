import { load, suite, eq } from './harness.mjs';

export default function run() {
  const S = suite('Bundled archive');
  const t = (n, f) => S.test(n, f);
  const { MS } = load();

  t('all three formats are present and populated', () => {
    const all = MS.banlists.all();
    eq(all.map((f) => f.key), ['TCG', 'MD', 'OCG']);
    all.forEach((f) => { if (!f.lists.length) throw new Error(f.key + ' has no lists'); });
    S.note(all.map((f) => `${f.key} ${f.lists.length} lists (${f.lists[f.lists.length - 1].date} \u2192 ${f.lists[0].date})`).join(', '));
  });

  t('every list has an ISO date, a matching id and at least one card', () => {
    for (const f of MS.banlists.all()) for (const l of f.lists) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(l.date)) throw new Error('bad date ' + l.id);
      if (!l.cards.length) throw new Error('empty list ' + l.id);
      if (l.id !== f.key + '-' + l.date) throw new Error('id mismatch ' + l.id);
    }
  });

  t('dates are unique and newest-first within each format', () => {
    for (const f of MS.banlists.all()) {
      const ds = f.lists.map((l) => l.date);
      eq(ds, ds.slice().sort().reverse(), f.key + ' order: ');
      if (new Set(ds).size !== ds.length) throw new Error(f.key + ' has duplicate dates');
    }
  });

  t('every entry has a valid status', () => {
    for (const f of MS.banlists.all()) for (const l of f.lists) for (const c of l.cards) {
      if (![0, 1, 2, 3].includes(c.status)) throw new Error(`${l.id} ${c.id} status ${c.status}`);
      if (!Number.isInteger(c.id) || c.id <= 0) throw new Error(`${l.id} bad id ${c.id}`);
    }
  });

  // Pinned by id rather than "the current list", so the scheduled refresh can
  // add newer lists without breaking the tests.
  t('the May 18th 2026 TCG list matches the source', () => {
    const l = MS.banlists.get('TCG', 'TCG-2026-05-18');
    eq(l.id, 'TCG-2026-05-18');
    const counts = { 0: 0, 1: 0, 2: 0, 3: 0 };
    l.cards.forEach((c) => counts[c.status]++);
    eq([counts[0], counts[1], counts[2]], [119, 97, 10]);
  });

  t('3x Maxx "C" is Forbidden in TCG, legal at one in Traditional', () => {
    const filler = new Array(37).fill(0).map((_, i) => 900000 + i);
    const l = MS.banlists.get('TCG', 'TCG-2026-05-18');
    eq(MS.validate({ main: filler.concat([23434538, 23434538, 23434538]), extra: [], side: [] }, l, { formatKey: 'TCG' }).legal, false);
    eq(MS.validate({ main: filler.concat([23434538, 900099, 900098]), extra: [], side: [] }, l, { formatKey: 'TCG', mode: 'traditional' }).legal, true);
  });

  t('Maxx "C" is Limited in the July 2026 MD list, Semi in Oct 2025', () => {
    const filler = new Array(38).fill(0).map((_, i) => 900000 + i);
    const two = { main: filler.concat([23434538, 23434538]), extra: [], side: [] };
    eq(MS.banlists.get('MD', 'MD-2026-07-01').id, 'MD-2026-07-01');
    eq(MS.validate(two, MS.banlists.get('MD', 'MD-2026-07-01'), { formatKey: 'MD' }).legal, false);
    eq(MS.validate(two, MS.banlists.get('MD', 'MD-2025-10-08'), { formatKey: 'MD' }).legal, true);
  });

  t('serialises back out to a valid .conf', () => {
    const l = MS.banlists.get('TCG');
    eq(MS.parseLFList(MS.serializeLFList(l))[0].cards.length, l.cards.length);
  });

  return S.report();
}
