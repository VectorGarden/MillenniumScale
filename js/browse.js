/* Millennium Scale — banlist browser and diff */
(function () {
  'use strict';

  var $ = MS.$, el = MS.el;
  var params = new URLSearchParams(location.search);

  var state = {
    formatKey: params.get('format') || MS.prefs.get('formatKey', 'TCG'),
    listId: params.get('list') || null,
    compareId: params.get('vs') || 'prev',   // 'prev' | 'none' | a list id
    filter: 'all',
    kinds: {},          // which change categories the chips have switched on
    query: ''
  };

  var fmtSel = $('#fmt'), cmpSel = $('#compare'), rail = $('#rail'), body = $('#list-body');

  /** Genesys lists hold point costs rather than statuses. */
  function pointsMode() { return !!MS.rulesFor(state.formatKey).points; }

  // Point lists group by cost band rather than by status.
  var BANDS = [[100, Infinity, '100 points'], [50, 99, '50\u201399 points'], [20, 49, '20\u201349 points'], [10, 19, '10\u201319 points'], [1, 9, '1\u20139 points'], [0, 0, 'Back to 0 points']];

  var KIND_LABEL = {
    added: 'Newly listed', tightened: 'Tightened', loosened: 'Loosened', removed: 'Off the list', unchanged: 'Unchanged'
  };
  var KIND_LABEL_POINTS = {
    added: 'Newly pointed', tightened: 'Raised', loosened: 'Lowered', removed: 'Back to 0', unchanged: 'Unchanged'
  };
  function kindLabel(k) { return (pointsMode() ? KIND_LABEL_POINTS : KIND_LABEL)[k]; }

  /* ---------------- setup ---------------- */

  function init() {
    var all = MS.banlists.all();
    if (!all.length) {
      body.innerHTML = '';
      body.appendChild(el('div', { class: 'empty' }, [
        el('h2', { text: 'No banlists yet' }),
        el('p', {}, [
          'Run ', el('code', { text: 'node tools/fetch-banlists.mjs' }),
          ' to pull the whole archive, or add one on the ',
          el('a', { href: 'publish.html', text: 'Publish page' }), '.'
        ])
      ]));
      return;
    }
    all.forEach(function (f) { fmtSel.appendChild(el('option', { value: f.key, text: f.name })); });
    if (!all.some(function (f) { return f.key === state.formatKey; })) state.formatKey = all[0].key;
    fmtSel.value = state.formatKey;

    $('#hover-art').checked = MS.artHover.enabled();
    syncFilter();
    buildRail();
    buildCompare();
    show();
  }

  fmtSel.addEventListener('change', function () {
    state.formatKey = fmtSel.value;
    MS.prefs.set('formatKey', state.formatKey);
    state.listId = null;
    state.compareId = 'prev';
    syncFilter();
    buildRail(); buildCompare(); show();
  });

  // The status filter means nothing on a point list.
  function syncFilter() {
    var sel = $('#status-filter');
    sel.parentNode.style.display = pointsMode() ? 'none' : '';
    if (pointsMode()) { state.filter = 'all'; sel.value = 'all'; }
  }

  cmpSel.addEventListener('change', function () {
    state.compareId = cmpSel.value;
    syncUrl(); show();
  });

  $('#status-filter').addEventListener('change', function () { state.filter = this.value; show(); });
  $('#q').addEventListener('input', function () { state.query = this.value.trim().toLowerCase(); show(); });
  $('#hover-art').addEventListener('change', function () { MS.artHover.set(this.checked); });

  function syncUrl() {
    history.replaceState(null, '', '?format=' + encodeURIComponent(state.formatKey) +
      '&list=' + encodeURIComponent(state.listId || '') +
      (state.compareId !== 'prev' ? '&vs=' + encodeURIComponent(state.compareId) : ''));
  }

  function buildRail() {
    var f = MS.banlists.format(state.formatKey);
    rail.innerHTML = '';
    if (!f) return;
    if (!f.lists.some(function (l) { return l.id === state.listId; })) {
      state.listId = f.lists.length ? f.lists[0].id : null;
    }
    var year = null;
    f.lists.forEach(function (l) {
      var y = (l.date || '????').slice(0, 4);
      if (y !== year) { year = y; rail.appendChild(el('div', { class: 'rail-year', text: y })); }
      var a = el('a', { href: '#', 'aria-current': String(l.id === state.listId) }, [
        el('span', { text: MS.formatDate(l.date).replace(', ' + y, '') }),
        el('span', { class: 'n', text: String(l.cards.length) })
      ]);
      a.addEventListener('click', function (e) {
        e.preventDefault();
        state.listId = l.id;
        MS.$$('#rail a').forEach(function (x) { x.setAttribute('aria-current', 'false'); });
        a.setAttribute('aria-current', 'true');
        buildCompare(); syncUrl(); show();
      });
      rail.appendChild(a);
    });
  }

  function buildCompare() {
    var f = MS.banlists.format(state.formatKey);
    cmpSel.innerHTML = '';
    if (!f) return;
    cmpSel.appendChild(el('option', { value: 'prev', text: 'The list before it' }));
    cmpSel.appendChild(el('option', { value: 'none', text: "Don't compare" }));
    f.lists.forEach(function (l) {
      if (l.id === state.listId) return;
      cmpSel.appendChild(el('option', { value: l.id, text: MS.formatDate(l.date) }));
    });
    if (!Array.prototype.some.call(cmpSel.options, function (o) { return o.value === state.compareId; })) {
      state.compareId = 'prev';
    }
    cmpSel.value = state.compareId;
  }

  function currentList() { return MS.banlists.get(state.formatKey, state.listId); }

  function compareList() {
    if (state.compareId === 'none') return null;
    var f = MS.banlists.format(state.formatKey);
    if (!f) return null;
    if (state.compareId === 'prev') {
      var i = f.lists.findIndex(function (l) { return l.id === state.listId; });
      return i >= 0 && i + 1 < f.lists.length ? f.lists[i + 1] : null;
    }
    return f.lists.filter(function (l) { return l.id === state.compareId; })[0] || null;
  }

  /* ---------------- render ---------------- */

  function show() {
    var list = currentList();
    if (!list) return;
    var other = compareList();

    $('#list-title').textContent = MS.formatDate(list.date);
    if (pointsMode()) {
      $('#list-lede').textContent =
        'Genesys point list \u00b7 ' + list.cards.length + ' cards cost points, every other card is 0 \u00b7 standard cap ' +
        (list.cap != null ? list.cap : MS.rulesFor(state.formatKey).pointCap) +
        (list.dateSource === 'detected' ? ' \u00b7 dated when the change was first seen' : '');
    } else {
      var counts = { 0: 0, 1: 0, 2: 0, 3: 0 };
      list.cards.forEach(function (c) { counts[c.status]++; });
      $('#list-lede').textContent =
        MS.rulesFor(state.formatKey).name + ' Forbidden & Limited list \u00b7 ' +
        counts[0] + ' Forbidden, ' + counts[1] + ' Limited, ' + counts[2] + ' Semi-Limited' +
        (MS.banlists.isLocal(list.id) ? ' \u00b7 stored locally in this browser' : '');
    }

    body.innerHTML = '';
    body.appendChild(el('p', { class: 'eyebrow', text: 'Loading card details\u2026' }));

    var ids = list.cards.map(function (c) { return c.id; });
    if (other) ids = ids.concat(other.cards.map(function (c) { return c.id; }));

    MS.cards.load(ids).then(function () { paint(list, other); })
                     .catch(function () { paint(list, other); });
  }

  function paint(list, other) {
    body.innerHTML = '';
    var diff = other ? MS.diffLists(other, list, { formatKey: state.formatKey }) : null;

    if (diff) {
      body.appendChild(el('p', {
        class: 'eyebrow',
        text: 'Compared with ' + MS.formatDate(other.date) +
              ' \u00b7 ' + daysBetween(other.date, list.date) + ' days apart'
      }));
      var sum = el('div', { class: 'diff-summary', role: 'group', 'aria-label': 'Filter by what changed' });
      [
        ['added', diff.added.length],
        ['tightened', diff.tightened.length],
        ['loosened', diff.loosened.length],
        ['removed', diff.removed.length],
        ['unchanged', diff.unchanged]
      ].forEach(function (row) {
        var kind = row[0], n = row[1];
        var on = !!state.kinds[kind];
        var chip = el('button', {
          class: 'diff-stat', type: 'button', 'data-kind': kind,
          'aria-pressed': String(on),
          disabled: n === 0 && !on ? '' : null,
          title: n === 0 ? 'Nothing in this category' : (on ? 'Click to stop showing only these' : 'Click to show only these')
        }, [
          el('span', { class: 'n', text: String(n) }),
          el('span', { class: 'k', text: kindLabel(kind) })
        ]);
        chip.addEventListener('click', function () {
          if (state.kinds[kind]) delete state.kinds[kind];
          else state.kinds[kind] = true;
          show();
        });
        sum.appendChild(chip);
      });
      if (Object.keys(state.kinds).length) {
        var clear = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Show all' });
        clear.addEventListener('click', function () { state.kinds = {}; show(); });
        sum.appendChild(clear);
      }
      body.appendChild(sum);
    }

    var rows = buildRows(list, diff);
    var visible = rows.filter(matches);

    if (!visible.length) {
      body.appendChild(el('div', { class: 'empty' }, [
        el('h2', { text: 'Nothing matches' }),
        el('p', {
          text: state.query
            ? 'No card here matches \u201c' + state.query + '\u201d.'
            : (diff && Object.keys(state.kinds).length)
              ? 'Nothing falls into the categories you have selected.'
              : 'This list has no entries in that category.'
        })
      ]));
      return;
    }

    body.appendChild(table(visible, diff));
  }

  function buildRows(list, diff) {
    var byId = Object.create(null);
    list.cards.forEach(function (c) {
      var card = MS.cards.get(c.id);
      byId[c.id] = {
        id: c.id, status: c.status, points: c.points, card: card,
        name: card ? card.name : (c.name || MS.passcode(c.id)),
        change: null
      };
    });
    if (diff) {
      diff.all.forEach(function (e) {
        if (byId[e.id]) { byId[e.id].change = e; return; }
        // Fell off the list entirely — still worth showing in a comparison.
        byId[e.id] = e.points
          ? { id: e.id, points: e.now, card: e.card, name: e.name, change: e }
          : { id: e.id, status: e.now, card: e.card, name: e.name, change: e };
      });
    }
    return Object.keys(byId).map(function (k) { return byId[k]; });
  }

  function kindOf(r) {
    return r.change ? r.change.kind : 'unchanged';
  }

  function matches(r) {
    var active = Object.keys(state.kinds);
    if (active.length && active.indexOf(kindOf(r)) === -1) return false;
    if (state.filter !== 'all' && String(r.status) !== state.filter) return false;
    if (state.query) {
      var hay = (r.name + ' ' + r.id + ' ' + MS.passcode(r.id) + ' ' +
                 (r.card ? r.card.race + ' ' + r.card.type + ' ' + (r.card.attribute || '') : '')).toLowerCase();
      if (hay.indexOf(state.query) === -1) return false;
    }
    return true;
  }

  function table(rows, diff) {
    var showChange = !!diff;
    var t = el('table', { class: 'list-table' });
    var cols = ['Card', 'Type', 'Attribute', 'Lv / Rk / Link', 'ATK / DEF', pointsMode() ? 'Points' : 'Status'];
    if (showChange) cols.push('Change');
    cols.push('Released', 'Passcode');

    t.appendChild(el('thead', {}, [
      el('tr', {}, cols.map(function (c, i) {
        var right = (i === 3 || i === 4 || i >= cols.length - 2 || (i === 5 && pointsMode()));
        return el('th', { text: c, style: right ? 'text-align:right' : '' });
      }))
    ]));

    var groups;
    if (diff && Object.keys(state.kinds).length) {
      groups = ['added', 'tightened', 'loosened', 'removed', 'unchanged']
        .filter(function (k) { return state.kinds[k]; })
        .map(function (k) {
          return { label: kindLabel(k), rows: rows.filter(function (r) { return kindOf(r) === k; }) };
        }).filter(function (g) { return g.rows.length; });
    } else if (pointsMode()) {
      groups = BANDS.map(function (b) {
        return {
          label: b[2],
          rows: rows.filter(function (r) { return r.points >= b[0] && r.points <= b[1]; })
        };
      }).filter(function (g) { return g.rows.length; });
    } else {
      groups = [0, 1, 2, 3].map(function (st) {
        return {
          label: st === 3 ? 'No longer on the list' : MS.STATUS_LABEL[st],
          rows: rows.filter(function (r) { return r.status === st; })
        };
      }).filter(function (g) { return g.rows.length; });
    }

    var tb = el('tbody');
    groups.forEach(function (g) {
      tb.appendChild(el('tr', { class: 'group-head' }, [
        el('td', { colspan: String(cols.length), text: g.label + '  (' + g.rows.length + ')' })
      ]));
      g.rows.sort(function (a, b) { return (pointsMode() ? b.points - a.points : 0) || a.name.localeCompare(b.name); })
            .forEach(function (r) { tb.appendChild(rowFor(r, showChange)); });
    });
    t.appendChild(tb);
    return t;
  }

  function rowFor(r, showChange) {
    var c = r.card;

    var lvl = '';
    if (c) {
      if (c.frame === 'link') lvl = 'LINK-' + (c.linkval || '?');
      else if (c.level != null) lvl = String(c.level);
      if (c.scale != null) lvl += ' \u00b7 PS' + c.scale;
    }
    var atkdef = '';
    if (c && c.frame !== 'spell' && c.frame !== 'trap') {
      atkdef = (c.atk == null ? '?' : c.atk) + ' / ' + (c.frame === 'link' ? '\u2014' : (c.def == null ? '?' : c.def));
    }

    var nameCell = el('td', { class: 'cname', tabindex: '0' }, [
      el('span', { class: 'swatch', style: '--frame:' + MS.frameColorVar(c ? c.frame : null) }),
      el('span', { text: r.name })
    ]);
    nameCell.addEventListener('click', function () {
      MS.showCard({ card: c, name: r.name, id: r.id, displayId: r.id, status: r.status, points: r.points, total: 0 });
    });
    nameCell.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); nameCell.click(); }
    });
    MS.artHover.attach(nameCell, r.id);

    var cells = [
      nameCell,
      el('td', { text: c ? (c.type || '') : '\u2014' }),
      el('td', { text: c ? (c.attribute || c.race || '') : '' }),
      el('td', { class: 'num', text: lvl }),
      el('td', { class: 'num', text: atkdef }),
      r.points != null
        ? el('td', { class: 'num', text: String(r.points) })
        : el('td', {}, [el('span', { class: 'pill', 'data-status': String(r.status), text: MS.STATUS_LABEL[r.status] })])
    ];

    if (showChange) {
      cells.push(el('td', {}, [r.change ? changeCell(r.change) : el('span', { class: 'tag', text: '' })]));
    }
    cells.push(el('td', { class: 'released', style: 'text-align:right', text: releaseDate(c) }));
    cells.push(el('td', { class: 'pass', text: MS.passcode(r.id) }));

    return el('tr', {}, cells);
  }

  function changeCell(e) {
    return el('span', {
      class: 'arrow', 'data-dir': e.direction,
      title: MS.changeLabel(e)
    }, [
      el('span', { class: 'was' + (e.wasUnreleased ? ' unrel' : ''), text: e.points ? String(e.was) : MS.statusShort(e.was, e.wasUnreleased) }),
      el('span', { class: 'sep', text: '\u2192' }),
      el('span', { class: 'now' + (e.nowUnreleased ? ' unrel' : ''), text: e.points ? String(e.now) : MS.statusShort(e.now, e.nowUnreleased) })
    ]);
  }

  function releaseDate(c) {
    var d = MS.releaseDate(c, state.formatKey);
    return d ? d.slice(0, 7) : '';
  }

  function daysBetween(a, b) {
    var ms = Math.abs(new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z'));
    return Math.round(ms / 86400000).toLocaleString();
  }

  /* ---------------- actions ---------------- */

  $('#use-list').addEventListener('click', function () {
    MS.prefs.set('formatKey', state.formatKey);
    MS.prefs.set('listId', state.listId);
    location.href = 'index.html';
  });

  $('#dl-json').addEventListener('click', function () {
    var list = currentList(); if (!list) return;
    var known = MS.cards.snapshot();
    MS.download(state.formatKey + '-' + list.date + '.json', JSON.stringify(Object.assign({}, list, {
      format: state.formatKey,
      cards: list.cards.map(function (c) {
        var card = known[c.id];
        return {
          id: c.id, passcode: MS.passcode(c.id),
          name: card ? card.name : c.name,
          status: c.status, statusLabel: c.points != null ? undefined : MS.STATUS_LABEL[c.status],
          points: c.points,
          frame: card ? card.frame : null, type: card ? card.type : null,
          race: card ? card.race : null, attribute: card ? card.attribute : null,
          level: card ? card.level : null, linkval: card ? card.linkval : null,
          scale: card ? card.scale : null, atk: card ? card.atk : null, def: card ? card.def : null,
          tcgDate: card ? card.tcgDate : null, ocgDate: card ? card.ocgDate : null
        };
      })
    }), null, 2), 'application/json');
  });

  $('#dl-conf').addEventListener('click', function () {
    var list = currentList(); if (!list) return;
    if (MS.isPointsList(list)) return MS.toast('A point list has no .conf form \u2014 download the JSON instead');
    MS.download(state.formatKey + '-' + list.date + '.conf', MS.serializeLFList(list), 'text/plain');
  });

  $('#dl-diff').addEventListener('click', function () {
    var list = currentList(), other = compareList();
    if (!list || !other) return MS.toast('Pick a list to compare against first');
    var diff = MS.diffLists(other, list, { formatKey: state.formatKey });
    if (!diff.all.length) return MS.toast('Nothing changed between these two lists');
    var rows = [['Card', 'Passcode', 'Was', 'Now', 'Change']].concat(diff.all.map(function (e) {
      return [e.name, MS.passcode(e.id),
              e.points ? e.was : MS.statusLong(e.was, e.wasUnreleased),
              e.points ? e.now : MS.statusLong(e.now, e.nowUnreleased),
              MS.changeLabel(e)];
    }));
    var csv = rows.map(function (r) {
      return r.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\n');
    MS.download(state.formatKey + '_' + other.date + '_to_' + list.date + '.csv', csv, 'text/csv');
  });

  init();
})();
