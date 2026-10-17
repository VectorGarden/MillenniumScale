import fs from 'node:fs';
import { suite, eq, truthy } from './harness.mjs';
import { normName, parseKonamiTable, resolvePoints, nextLists, crossCheckMarkdown } from '../tools/lib/genesys.mjs';

const card = (id, name, points) => ({ id, name, misc_info: [{ genesys_points: points }] });

const PAGE = `
<p>intro</p>
<table id="tablepress-genesys" class="tablepress">
<thead><tr><th class="column-1">Card Name</th><th class="column-2">Points</th></tr></thead>
<tbody>
<tr class="row-2 even"><td class="column-1">"A Case for K9"</td><td class="column-2">15
</td></tr>
<tr class="row-3 odd"><td class="column-1">Ash Blossom &amp; Joyous Spring</td><td class="column-2">25
</td></tr>
<tr class="row-4 even"><td class="column-1">Exstellarknight Constellar Ptolemy O7</td><td class="column-2">5
</td></tr>
<tr class="row-5 odd"><td class="column-1">Stellarnova Binding</td><td class="column-2">3
</td></tr>
</tbody></table>
<table><tr><td class="column-1">Not the list</td><td class="column-2">99</td></tr></table>`;

export default function run() {
  const S = suite('Genesys points');
  const t = (n, f) => S.test(n, f);

  t('reads only the Genesys table, decoding entities', () => {
    eq(parseKonamiTable(PAGE), [
      { name: '"A Case for K9"', points: 15 },
      { name: 'Ash Blossom & Joyous Spring', points: 25 },
      { name: 'Exstellarknight Constellar Ptolemy O7', points: 5 },
      { name: 'Stellarnova Binding', points: 3 }
    ]);
    eq(parseKonamiTable('<html>no table</html>'), []);
  });

  t('names compare on letters and digits, with Ω folded to O', () => {
    eq(normName('Exstellarknight Constellar Ptolemy Ω7'), normName('Exstellarknight Constellar Ptolemy O7'));
    eq(normName('"A Case for K9"'), normName('A Case for K9'));
    eq(normName('Élan'), 'elan');
  });

  const api = [
    card(10, 'A Case for K9', 15),
    card(20, 'Ash Blossom & Joyous Spring', 0),
    card(30, 'Exstellarknight Constellar Ptolemy Ω7', 5),
    card(40, 'Stellarnova Bonds', 3),
    card(50, 'Pot of Greed', 20),
    card(60, 'Blue-Eyes White Dragon', 0)
  ];

  t('Konami wins where it disagrees; YGOPRODeck fills what Konami lacks', () => {
    const r = resolvePoints(parseKonamiTable(PAGE), api);
    eq(r.cards, [
      { id: 10, name: 'A Case for K9', points: 15 },
      { id: 20, name: 'Ash Blossom & Joyous Spring', points: 25 },
      { id: 30, name: 'Exstellarknight Constellar Ptolemy Ω7', points: 5 },
      { id: 40, name: 'Stellarnova Bonds', points: 3 },
      { id: 50, name: 'Pot of Greed', points: 20 }
    ]);
    eq(r.mismatches, [{ id: 20, name: 'Ash Blossom & Joyous Spring', konami: 25, ygoprodeck: 0 }]);
    eq(r.unresolved, []);
    eq(r.apiOnly.map((a) => a.name), ['Pot of Greed']);
  });

  t('a name nothing matches is reported, not dropped silently', () => {
    const r = resolvePoints([{ name: 'Totally Unknown Card', points: 40 }], api);
    eq(r.unresolved, [{ name: 'Totally Unknown Card', points: 40 }]);
    truthy(/ALIASES/.test(crossCheckMarkdown(r)));
    truthy(/agree on every point value/.test(crossCheckMarkdown({ mismatches: [], unresolved: [], apiOnly: [] })));
  });

  const a = [{ id: 1, name: 'x', points: 20 }];
  const b = [{ id: 1, name: 'x', points: 30 }];

  t('unchanged values leave the history alone', () => {
    const lists = nextLists([], a, { date: '2026-01-01' });
    eq(nextLists(lists, a, { date: '2026-02-02' }), lists);
  });

  t('changed values add a dated list on top, keeping the old one', () => {
    const one = nextLists([], a, { date: '2026-01-01' });
    const two = nextLists(one, b, { date: '2026-02-02' });
    eq(two.map((l) => l.id), ['GEN-2026-02-02', 'GEN-2026-01-01']);
    eq([two[0].cap, two[0].dateSource], [100, 'detected']);
  });

  t('an unmerged refresh with the same values keeps its date', () => {
    const one = nextLists([], a, { date: '2026-01-01' });
    const pending = nextLists(one, b, { date: '2026-02-02', dateSource: 'announced' });
    const later = nextLists(one, b, { date: '2026-02-09', seen: pending });
    eq(later[0].id, 'GEN-2026-02-02');
    eq(later[0].dateSource, 'announced');
  });

  t('the bundled point list is well-formed', () => {
    const bundle = JSON.parse(fs.readFileSync('data/genesys.json', 'utf8'));
    eq(bundle.schema, 'millennium-scale/genesys@1');
    const [f] = bundle.formats;
    eq(f.key, 'GEN');
    truthy(f.lists.length > 0, 'no lists');
    const ds = f.lists.map((l) => l.date);
    eq(ds, ds.slice().sort().reverse(), 'order: ');
    for (const l of f.lists) {
      if (l.id !== 'GEN-' + l.date) throw new Error('id mismatch ' + l.id);
      if (!Number.isInteger(l.cap)) throw new Error('no cap on ' + l.id);
      if (l.cards.length < 100) throw new Error(`${l.id} has only ${l.cards.length} cards`);
      const ids = new Set();
      for (const c of l.cards) {
        if (!Number.isInteger(c.id) || c.id <= 0) throw new Error(`${l.id} bad id ${c.id}`);
        if (!Number.isInteger(c.points) || c.points <= 0) throw new Error(`${l.id} ${c.name} points ${c.points}`);
        if (ids.has(c.id)) throw new Error(`${l.id} duplicate ${c.id}`);
        ids.add(c.id);
      }
    }
    S.note(`${f.lists.length} list(s), newest ${f.lists[0].date} with ${f.lists[0].cards.length} pointed cards`);
  });

  return S.report();
}
