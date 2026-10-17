import { suite, eq, truthy } from './harness.mjs';
import { sameFormats, mergeFormats, shrinkProblems, describeChanges, summaryMarkdown, manifestEntry } from '../tools/lib/bundle.mjs';

const list = (key, date, cards) => ({ id: `${key}-${date}`, date, label: date, cards });
const fmt = (key, lists) => ({ key, name: key, source: 'x', lists });

export default function run() {
  const S = suite('Scheduled refresh');
  const t = (n, f) => S.test(n, f);

  const older = list('TCG', '2026-01-01', [{ id: 1, status: 0 }, { id: 2, status: 1 }]);
  const newer = list('TCG', '2026-05-01', [{ id: 1, status: 0 }, { id: 2, status: 2 }, { id: 3, status: 1 }]);
  const md = fmt('MD', [list('MD', '2026-02-01', [{ id: 9, status: 0 }])]);
  const before = [fmt('TCG', [older]), md];

  t('identical content counts as unchanged, whatever the timestamp says', () => {
    truthy(sameFormats(before, JSON.parse(JSON.stringify(before))));
    truthy(!sameFormats(before, [fmt('TCG', [newer, older]), md]));
  });

  t('--only keeps the formats it did not fetch, in their original order', () => {
    const merged = mergeFormats(before, [fmt('TCG', [newer, older])], ['TCG', 'MD', 'OCG']);
    eq(merged.map((f) => f.key), ['TCG', 'MD']);
    eq(merged[0].lists.length, 2);
    eq(merged[1], md);
  });

  t('a format that vanished or came back empty is an outage', () => {
    eq(shrinkProblems(before, [fmt('TCG', [older])]).map((p) => p.level), ['outage']);
    const [p] = shrinkProblems(before, [fmt('TCG', []), md]);
    eq(p.level, 'outage');
    truthy(/no lists/.test(p.text));
  });

  t('a list that disappeared upstream is a removal; a new one is not', () => {
    eq(shrinkProblems(before, [fmt('TCG', [newer]), md]), [{ level: 'removal', text: 'TCG: 1 list(s) no longer upstream: TCG-2026-01-01' }]);
    eq(shrinkProblems(before, [fmt('TCG', [newer, older]), md]), []);
  });

  t('a month-only list that gained its exact day is re-dated, not removed', () => {
    const moved = { ...older, id: 'TCG-2026-01-16', date: '2026-01-16', label: '2026-01-16' };
    const after = [fmt('TCG', [moved]), md];
    eq(shrinkProblems(before, after), []);
    const [c] = describeChanges(before, after);
    eq(c.redated, [{ from: '2026-01-01', to: '2026-01-16', id: 'TCG-2026-01-16' }]);
    eq([c.added.length, c.removed.length], [0, 0]);
    truthy(/Re-dated \*\*2026-01-01\*\* → \*\*2026-01-16\*\*/.test(summaryMarkdown([c])));
  });

  t('a new list is described against the list before it', () => {
    const changes = describeChanges(before, [fmt('TCG', [newer, older]), md]);
    eq(changes.length, 1);
    eq(changes[0].added, [{ id: 'TCG-2026-05-01', date: '2026-05-01', entries: 3, changed: 2 }]);
    eq(changes[0].updated, []);
  });

  t('an upstream correction to an existing list is reported as such', () => {
    const fixed = list('TCG', '2026-01-01', [{ id: 1, status: 0 }, { id: 2, status: 0 }]);
    const [c] = describeChanges(before, [fmt('TCG', [fixed]), md]);
    eq(c.updated, [{ id: 'TCG-2026-01-01', date: '2026-01-01', entries: 2, changed: 1 }]);
  });

  t('the summary says plainly when nothing moved', () => {
    truthy(/No changes upstream/.test(summaryMarkdown([])));
    const md2 = summaryMarkdown(describeChanges(before, [fmt('TCG', [newer, older]), md]));
    truthy(/New list \*\*2026-05-01\*\* — 3 entries, 2 status changes/.test(md2), md2);
  });

  t('the manifest names the current list and the range', () => {
    eq(manifestEntry(fmt('TCG', [newer, older]), 'data/banlists.json'), {
      key: 'TCG', name: 'TCG', file: 'data/banlists.json', lists: 2, oldest: '2026-01-01',
      current: { id: 'TCG-2026-05-01', date: '2026-05-01', entries: 3 }
    });
  });

  return S.report();
}
