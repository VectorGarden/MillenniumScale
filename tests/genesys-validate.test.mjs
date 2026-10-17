import { load, suite, eq, truthy } from './harness.mjs';

const POT = 55144522, MAXX = 23434538, ASH = 14558127, LINKURIBOH = 44519536;

// Just enough card data for the frame checks and alt-art folding.
const CARDS = [
  { id: POT, name: 'Pot of Greed', frame: 'spell', alts: [] },
  { id: MAXX, name: 'Maxx "C"', frame: 'effect', alts: [] },
  { id: ASH, name: 'Ash Blossom & Joyous Spring', frame: 'effect', alts: [28427869] },
  { id: LINKURIBOH, name: 'Linkuriboh', frame: 'link', alts: [] },
  { id: 94215860, name: 'Odd-Eyes Pendulum Dragon', frame: 'effect_pendulum', alts: [] }
];

/** 40 zero-point cards nobody's heard of, plus whatever's being tested. */
const filler = (n) => new Array(n).fill(0).map((_, i) => 900000 + i);
const deck = (main, extra = [], side = []) => ({ main: filler(40 - main.length).concat(main), extra, side });

export default function run() {
  const S = suite('Genesys validation');
  const t = (n, f) => S.test(n, f);
  const { MS, findAll } = load({ files: ['data/banlists.js', 'data/genesys.js', 'js/core.js'], cards: CARDS });
  const list = MS.banlists.get('GEN');
  const pts = (id) => list.cards.find((c) => c.id === id).points;

  t('Genesys sits alongside the banlist formats', () => {
    eq(MS.banlists.all().map((f) => f.key), ['TCG', 'MD', 'OCG', 'GEN']);
    truthy(MS.isPointsList(list) && !MS.isPointsList(MS.banlists.get('TCG')));
    eq(MS.rulesFor('GEN').pointCap, 100);
  });

  t('every copy counts toward the cap, Side Deck included', () => {
    const r = MS.validate(deck([POT, POT], [], [POT]), list, { formatKey: 'GEN' });
    eq(r.points.total, 3 * pts(POT));
    eq(r.points.cap, 100);
  });

  t('going over the cap is a problem that says how much to cut', () => {
    const r = MS.validate(deck([MAXX, MAXX, MAXX]), list, { formatKey: 'GEN' });
    eq(r.points.total, 3 * pts(MAXX));
    truthy(!r.legal);
    const p = r.problems.find((x) => x.kind === 'points');
    truthy(p && p.why.indexOf('Cut ' + (3 * pts(MAXX) - 100)) !== -1, p && p.why);
  });

  t('an event cap overrides the standard one', () => {
    const three = deck([MAXX, MAXX, MAXX]);
    eq(MS.validate(three, list, { formatKey: 'GEN', cap: 200 }).legal, 3 * pts(MAXX) <= 200);
    eq(MS.validate(deck([POT]), list, { formatKey: 'GEN', cap: 0 }).legal, false);
  });

  t('the F&L list does not apply: three of a TCG-Forbidden card is fine on status', () => {
    const r = MS.validate(deck([MAXX, MAXX, MAXX]), list, { formatKey: 'GEN', cap: 1000 });
    eq(r.legal, true);
    eq(r.copyProblems.length, 0);
  });

  t('three copies is still the most of any card', () => {
    const r = MS.validate(deck([POT, POT, POT, POT]), list, { formatKey: 'GEN', cap: 1000 });
    eq(r.copyProblems.map((p) => p.kind), ['copies']);
  });

  t('Link and Pendulum Monsters are not allowed at all', () => {
    const r = MS.validate(deck([94215860], [LINKURIBOH]), list, { formatKey: 'GEN' });
    const blocked = r.problems.filter((p) => p.kind === 'blocked').map((p) => p.text).sort();
    eq(blocked, ['Linkuriboh', 'Odd-Eyes Pendulum Dragon']);
    truthy(r.statusOf(LINKURIBOH).illegal);
  });

  t('an alt-art printing costs what the base card costs', () => {
    const r = MS.validate(deck([28427869]), list, { formatKey: 'GEN' });
    eq(r.points.total, pts(ASH));
  });

  t('banlist formats report no points', () => {
    eq(MS.validate(deck([POT]), MS.banlists.get('TCG'), { formatKey: 'TCG' }).points, null);
  });

  t('point lists diff with 0 as the resting value', () => {
    const a = { id: 'GEN-a', date: '2026-01-01', cards: [{ id: 1, points: 20 }, { id: 2, points: 50 }, { id: 3, points: 10 }] };
    const b = { id: 'GEN-b', date: '2026-02-01', cards: [{ id: 1, points: 30 }, { id: 2, points: 40 }, { id: 4, points: 5 }] };
    const d = MS.diffLists(a, b, { formatKey: 'GEN' });
    eq([d.added.length, d.tightened.length, d.loosened.length, d.removed.length, d.unchanged], [1, 1, 1, 1, 0]);
    eq(d.all.map((e) => [e.id, e.kind]).sort(), [[1, 'tightened'], [2, 'loosened'], [3, 'removed'], [4, 'added']]);
    eq(MS.changeLabel(d.all.find((e) => e.id === 1)), '20 → 30 points');
    eq(MS.changeLabel(d.all.find((e) => e.id === 3)), 'Back to 0 (was 10)');
  });

  t('status diffs carry the same kinds', () => {
    const a = { cards: [{ id: 1, status: 1 }, { id: 2, status: 0 }] };
    const b = { cards: [{ id: 1, status: 0 }, { id: 3, status: 2 }] };
    eq(MS.diffLists(a, b, {}).all.map((e) => [e.id, e.kind]).sort(), [[1, 'tightened'], [2, 'removed'], [3, 'added']]);
  });

  t('tiles show the cost, or that the card is not allowed', () => {
    const r = MS.validate(deck([POT], [LINKURIBOH]), list, { formatKey: 'GEN' });
    const pot = MS.renderTile(r.statusOf(POT));
    eq(findAll(pot, 'pts').map((n) => n.textContent), [pts(POT) + ' pts']);
    const link = MS.renderTile(r.statusOf(LINKURIBOH));
    eq(findAll(link, 'blocked').map((n) => n.textContent), ['Not allowed']);
  });

  return S.report();
}
