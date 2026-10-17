import fs from 'node:fs';
import { load, suite, eq, truthy } from './harness.mjs';
import { normJa, parseIndex, parseList, parseSearch, exactMatch, fallbackKeyword, knownNames, buildList, mergeLists } from '../tools/lib/genesys-ocg.mjs';

const INDEX = `
<a href="?list=202610" class="btn howto marker">最新版：2026年10月1日適用リスト</a>
<a href="?list=202608">2026年8月1日適用リスト</a>
<a href="?list=202606">2026年6月1日適用リスト</a>
<a href="?list=202610">2026年10月1日適用リスト</a>`;

const LIST = `
<p>2026年3月1日以降に新規発売された商品に含まれるカード、発行・配布されたカードは使用できません。（2026年2月28日までに収録されたカードまで 使用可能です）</p>
<table class="genesyspoint" data-count="3">
<thead><tr><th>&nbsp;</th><th>カード名</th><th>ポイント</th><th>前回からの変動</th></tr></thead>
<tbody>
<tr data-original-index="1" data-point="5"" class="monster">
  <td></td>
  <td>青眼の白龍</td>
  <td><b>5</b></td>
  <td>5</td>
</tr>
<tr data-original-index="2" data-point="0"" class="effect">
  <td></td>
  <td>ARG☆S－栄冠のアドラ</td>
  <td><b>0</b></td>
  <td>-3</td>
</tr>
<tr data-original-index="3" data-point="15"" class="effect">
  <td></td>
  <td>K９－０４号 咒</td>
  <td><b>15</b></td>
  <td></td>
</tr>
</tbody></table>`;

const SEARCH = `
<span class="card_ruby">ディー．ディー．クロウ</span>
<span class="card_name">
  D.D.クロウ
</span>
<input type="hidden" class="cid" value="6980">
<span class="card_name">D.D.クロウ・リターンズ</span>
<input type="hidden" class="cid" value="99999">`;

export default function run() {
  const S = suite('Genesys points (OCG)');
  const t = (n, f) => S.test(n, f);

  t('the index gives each list once, with its announced date, newest first', () => {
    eq(parseIndex(INDEX), [
      { list: '202610', date: '2026-10-01' },
      { list: '202608', date: '2026-08-01' },
      { list: '202606', date: '2026-06-01' }
    ]);
  });

  t('a list page gives its card-pool cutoff and every row', () => {
    const p = parseList(LIST);
    eq(p.releasedBy, '2026-02-28');
    eq(p.rows, [
      { name: '青眼の白龍', points: 5 },
      { name: 'ARG☆S－栄冠のアドラ', points: 0 },
      { name: 'K９－０４号 咒', points: 15 }
    ]);
    eq(parseList('<html></html>'), { releasedBy: null, rows: [] });
  });

  t('names match across full-width digits, dashes and spacing', () => {
    eq(normJa('K９－０４号 咒'), normJa('K9-04号咒'));
    truthy(normJa('青眼の白龍') !== normJa('青眼の究極竜'));
  });

  t('a database search resolves only the exact name', () => {
    const results = parseSearch(SEARCH);
    eq(results.map((r) => r.cid), [6980, 99999]);
    eq(exactMatch(results, 'D.D.クロウ').cid, 6980);
    eq(exactMatch(results, 'D.D.'), null);
  });

  t('entity-spelled names from the database match the list\u2019s characters', () => {
    const results = parseSearch('<span class="card_name">PSYフレームギア・&gamma;</span><input class="cid" value="12070">' +
      '<span class="card_name">K９－EX &ldquo;Ripper／M&rdquo;</span><input class="cid" value="22146">' +
      '<span class="card_name">ふわんだりぃず&times;ろびーな</span><input class="cid" value="16504">' +
      '<span class="card_name">誘いの&Delta;</span><input class="cid" value="20803">' +
      '<span class="card_name">超神星輝士 セイクリッド・トレミス&Omega;７</span><input class="cid" value="1">');
    eq(exactMatch(results, 'PSYフレームギア・γ').cid, 12070);
    eq(exactMatch(results, 'K９－EX \u201cRipper\uff0fM\u201d').cid, 22146);
    eq(exactMatch(results, 'ふわんだりぃず×ろびーな').cid, 16504);
    eq(exactMatch(results, '誘いのΔ').cid, 20803);
    eq(exactMatch(results, '超神星輝士 セイクリッド・トレミスΩ７').cid, 1);
  });

  t('a name the full search misses gets a shorter second keyword', () => {
    eq(fallbackKeyword('終刻竜機Ⅴ－アマルテ'), '終刻竜機');
    eq(fallbackKeyword('PSYフレームギア・γ'), 'PSYフレームギア・');
    eq(fallbackKeyword('青眼の白龍'), null);
    eq(fallbackKeyword('\u201cCase of K９\u201d'), 'Case of K９');
    eq(fallbackKeyword('\u201c罪宝狩りの悪魔\u201d'), '罪宝狩りの悪魔');
  });

  t('0-point rows are dropped and unplaced names reported', () => {
    const known = new Map([[normJa('青眼の白龍'), { id: 89631139, name: 'Blue-Eyes White Dragon' }]]);
    const { list, unresolved } = buildList({ list: '202610', date: '2026-10-01' }, parseList(LIST), (k) => known.get(k), 'src');
    eq(list.id, 'GEN-OCG-2026-10-01');
    eq(list.cardPool, { releasedBy: '2026-02-28' });
    eq(list.cards, [{ id: 89631139, name: 'Blue-Eyes White Dragon', jaName: '青眼の白龍', points: 5 }]);
    eq(unresolved, [{ name: 'K９－０４号 咒', points: 15 }]);
  });

  t('published lists teach later runs their names', () => {
    const lists = [{ cards: [{ id: 1, name: 'A', jaName: 'Ａ' }] }];
    eq(knownNames(lists).get(normJa('A')), { id: 1, name: 'A' });
  });

  t('lists Konami no longer shows are kept; shown ones replace their copies', () => {
    const old = [{ id: 'GEN-OCG-2026-06-01', date: '2026-06-01', cards: [] }, { id: 'GEN-OCG-2026-08-01', date: '2026-08-01', cards: [{ id: 1 }] }];
    const merged = mergeLists(old, [{ id: 'GEN-OCG-2026-08-01', date: '2026-08-01', cards: [{ id: 2 }] }]);
    eq(merged.map((l) => l.id), ['GEN-OCG-2026-08-01', 'GEN-OCG-2026-06-01']);
    eq(merged[0].cards, [{ id: 2 }]);
  });

  t('the bundled OCG lists are well-formed', () => {
    const bundle = JSON.parse(fs.readFileSync('data/genesys-ocg.json', 'utf8'));
    const [f] = bundle.formats;
    eq(f.key, 'GEN-OCG');
    const ds = f.lists.map((l) => l.date);
    eq(ds, ds.slice().sort().reverse(), 'order: ');
    for (const l of f.lists) {
      if (l.id !== 'GEN-OCG-' + l.date) throw new Error('id mismatch ' + l.id);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(l.cardPool && l.cardPool.releasedBy)) throw new Error('no card pool on ' + l.id);
      if (l.cards.length < 100) throw new Error(`${l.id} has only ${l.cards.length} cards`);
      const ids = new Set();
      for (const c of l.cards) {
        if (!Number.isInteger(c.id) || c.id <= 0 || !c.jaName) throw new Error(`${l.id} bad entry ${JSON.stringify(c)}`);
        if (!Number.isInteger(c.points) || c.points <= 0) throw new Error(`${l.id} ${c.jaName} points ${c.points}`);
        if (ids.has(c.id)) throw new Error(`${l.id} duplicate ${c.id}`);
        ids.add(c.id);
      }
    }
    S.note(f.lists.map((l) => `${l.date}: ${l.cards.length} cards, pool to ${l.cardPool.releasedBy}`).join('; '));
  });

  t('cards released in Japan after the cutoff are outside the card pool', () => {
    const cards = [
      { id: 111, name: 'Old Card', frame: 'effect', ocgDate: '2025-06-01', alts: [] },
      { id: 222, name: 'New Card', frame: 'effect', ocgDate: '2026-04-01', alts: [] },
      { id: 333, name: 'Unknown Date', frame: 'effect', alts: [] }
    ];
    const { MS } = load({ files: ['js/core.js'], cards });
    const list = { id: 'GEN-OCG-2026-10-01', date: '2026-10-01', cap: 100, cardPool: { releasedBy: '2026-02-28' }, cards: [{ id: 111, points: 10 }] };
    const filler = new Array(37).fill(0).map((_, i) => 900000 + i);
    const r = MS.validate({ main: filler.concat([111, 222, 333]), extra: [], side: [] }, list, { formatKey: 'GEN-OCG' });
    eq(r.problems.filter((p) => p.kind === 'blocked').map((p) => p.text), ['New Card']);
    truthy(/after this list.s card pool closed/.test(r.problems.find((p) => p.kind === 'blocked').why));
    eq(r.points.total, 10);
    eq(MS.rulesFor('GEN-OCG').region, 'OCG');
  });

  return S.report();
}
