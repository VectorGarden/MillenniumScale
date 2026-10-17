import { load, suite, eq } from './harness.mjs';

export default function run() {
  const S = suite('List comparison');
  const t = (n, f) => S.test(n, f);
  const { MS } = load();

  t('consecutive TCG lists produce a diff', () => {
    const f = MS.banlists.format('TCG');
    const d = MS.diffLists(f.lists[1], f.lists[0], { formatKey: 'TCG' });
    S.note(`${f.lists[1].date} \u2192 ${f.lists[0].date}: +${d.added.length} new, ${d.tightened.length} tighter, ${d.loosened.length} looser, ${d.removed.length} off, ${d.unchanged} same`);
    if (!d.all.length) throw new Error('no changes found');
    d.all.forEach((e) => { if (e.was === e.now) throw new Error('unchanged entry leaked into all[]'); });
  });

  // Pinned by id rather than "the current list", so the scheduled refresh can
  // add newer lists without breaking the tests.
  t('matches the published changes for May 18th 2026', () => {
    const f = MS.banlists.format('TCG');
    const i = f.lists.findIndex((l) => l.id === 'TCG-2026-05-18');
    if (i < 0) throw new Error('TCG-2026-05-18 is missing from the archive');
    const by = {};
    MS.diffLists(f.lists[i + 1], f.lists[i], { formatKey: 'TCG' }).all.forEach((e) => { by[e.name] = e; });
    eq(by['K9-04 Noroi'].now, 0, 'K9-04 Noroi newly Forbidden: ');
    eq(by['Naturia Rosewhip'].now, 0, 'Naturia Rosewhip newly Forbidden: ');
    eq([by['Fairy Tail - Snow'].was, by['Fairy Tail - Snow'].now], [0, 1], 'Snow: ');
    eq([by['Branded Fusion'].was, by['Branded Fusion'].now], [2, 1], 'Branded Fusion: ');
    eq([by['Metamorphosis'].was, by['Metamorphosis'].now], [0, 1], 'Metamorphosis: ');
    eq([by['Premature Burial'].was, by['Premature Burial'].now], [0, 1], 'Premature Burial: ');
    eq(by['Dracotail Lukias'].now, 2, 'Dracotail Lukias newly Semi: ');
  });

  t('direction is classified correctly', () => {
    const f = MS.banlists.format('TCG');
    const d = MS.diffLists(f.lists[1], f.lists[0], { formatKey: 'TCG' });
    d.tightened.forEach((e) => { if (!(e.now < e.was) || e.was === 3 || e.now === 3) throw new Error('bad tightened: ' + e.name); });
    d.loosened.forEach((e) => { if (!(e.now > e.was) || e.now === 3) throw new Error('bad loosened: ' + e.name); });
    d.added.forEach((e) => { if (e.was !== 3) throw new Error('bad added: ' + e.name); });
    d.removed.forEach((e) => { if (e.now !== 3) throw new Error('bad removed: ' + e.name); });
  });

  t('a list against itself shows nothing', () => {
    const l = MS.banlists.get('TCG');
    const d = MS.diffLists(l, l, { formatKey: 'TCG' });
    eq(d.all.length, 0); eq(d.unchanged, l.cards.length);
  });

  t('works across a 24-year gap', () => {
    const f = MS.banlists.format('TCG');
    const d = MS.diffLists(f.lists[f.lists.length - 1], f.lists[0], { formatKey: 'TCG' });
    S.note(`${f.lists[f.lists.length - 1].date} \u2192 ${f.lists[0].date}: +${d.added.length} new, ${d.removed.length} off, ${d.unchanged} same`);
    if (d.added.length < 150) throw new Error('expected a large diff');
  });

  t('compares across formats too', () => {
    const d = MS.diffLists(MS.banlists.get('MD'), MS.banlists.get('TCG'), { formatKey: 'TCG' });
    S.note(`MD \u2192 TCG: ${d.all.length} differences, ${d.unchanged} identical`);
    if (!d.all.length) throw new Error('formats should differ');
  });

  t('changeLabel reads sensibly', () => {
    eq(MS.changeLabel({ was: 3, now: 0 }), 'Newly Forbidden');
    eq(MS.changeLabel({ was: 1, now: 3 }), 'Off the list (was Limited)');
    eq(MS.changeLabel({ was: 2, now: 1 }), 'Semi-Limited \u2192 Limited');
    eq(MS.changeLabel({ was: 3, now: 1, wasUnreleased: true }), 'New card, Limited on release');
  });

  /* ---- unreleased vs unlimited ---- */

  const seed = [
    { id: 11111111, name: 'Old Card', frame: 'effect', type: 'Effect Monster', race: 'Warrior', tcgDate: '2004-01-01', ocgDate: '2003-06-01', alts: [] },
    { id: 22222222, name: 'Brand New Card', frame: 'effect', type: 'Effect Monster', race: 'Dragon', tcgDate: '2026-04-01', ocgDate: '2026-01-01', alts: [] },
    { id: 33333333, name: 'Dateless Card', frame: 'spell', type: 'Spell Card', race: 'Normal', tcgDate: null, ocgDate: null, alts: [] }
  ];
  const { MS: M } = load({ files: ['js/core.js'], cards: seed });
  const older = { id: 'a', date: '2026-02-02', cards: [{ id: 11111111, status: 1 }] };
  const newer = { id: 'b', date: '2026-05-18', cards: [{ id: 11111111, status: 0 }, { id: 22222222, status: 1 }, { id: 33333333, status: 2 }] };
  const d = M.diffLists(older, newer, { formatKey: 'TCG' });

  t('a card printed later reads as Unreleased, not Unlimited', () => {
    const e = d.all.find((x) => x.id === 22222222);
    eq(e.wasUnreleased, true);
    eq(M.statusShort(e.was, e.wasUnreleased), 'Unrel');
    eq(M.statusLong(e.was, e.wasUnreleased), 'Unreleased');
  });

  t('a card that already existed still reads as Unlimited', () => {
    eq(M.statusShort(3, false), 'Unlim');
  });

  t('a genuine tightening is untouched', () => {
    const e = d.all.find((x) => x.id === 11111111);
    eq([e.was, e.now], [1, 0]); eq(e.wasUnreleased, false);
  });

  t('missing release data falls back rather than guessing', () => {
    eq(d.all.find((x) => x.id === 33333333).wasUnreleased, false);
  });

  t('release dates follow the format being browsed', () => {
    eq(M.releaseDate(seed[1], 'OCG'), '2026-01-01');
    eq(M.releaseDate(seed[1], 'TCG'), '2026-04-01');
    eq(M.releaseDate(null, 'TCG'), null);
    const o = { id: 'o', date: '2026-04-01', cards: [] }, n = { id: 'n', date: '2026-07-01', cards: [{ id: 22222222, status: 1 }] };
    eq(M.diffLists(o, n, { formatKey: 'OCG' }).all[0].wasUnreleased, false, 'OCG: ');
    const o2 = { id: 'o', date: '2026-02-02', cards: [] }, n2 = { id: 'n', date: '2026-05-18', cards: [{ id: 22222222, status: 1 }] };
    eq(M.diffLists(o2, n2, { formatKey: 'TCG' }).all[0].wasUnreleased, true, 'TCG: ');
  });

  return S.report();
}
