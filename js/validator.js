/* Millennium Scale — validator page */
(function () {
  'use strict';

  var $ = MS.$, el = MS.el;

  var state = {
    deck: null,
    formatKey: MS.prefs.get('formatKey', 'TCG'),
    listId: MS.prefs.get('listId', null),
    mode: MS.prefs.get('mode', 'advanced'),
    art: MS.prefs.get('art', 'text'),
    cap: MS.prefs.get('genesysCap', null)    // null = the list's own cap
  };

  var fmtSel = $('#fmt'), lstSel = $('#lst'), capIn = $('#cap');
  var statusBox = $('#status'), resultBox = $('#result');

  /* ---------------- list pickers ---------------- */

  function fillFormats() {
    var formats = MS.banlists.all();
    fmtSel.innerHTML = '';
    if (!formats.length) {
      fmtSel.appendChild(el('option', { value: '', text: 'No banlists loaded' }));
      fmtSel.disabled = true;
      lstSel.disabled = true;
      return false;
    }
    formats.forEach(function (f) {
      fmtSel.appendChild(el('option', { value: f.key, text: f.name + ' (' + f.lists.length + ')' }));
    });
    if (!formats.some(function (f) { return f.key === state.formatKey; })) state.formatKey = formats[0].key;
    fmtSel.value = state.formatKey;
    return true;
  }

  function fillLists() {
    var f = MS.banlists.format(state.formatKey);
    lstSel.innerHTML = '';
    if (!f) return;
    f.lists.forEach(function (l, i) {
      lstSel.appendChild(el('option', {
        value: l.id,
        text: MS.formatDate(l.date) + (i === 0 ? ' — current' : '') + (MS.banlists.isLocal(l.id) ? ' · local' : '')
      }));
    });
    if (!f.lists.some(function (l) { return l.id === state.listId; })) state.listId = f.lists.length ? f.lists[0].id : null;
    if (state.listId) lstSel.value = state.listId;

    // Traditional format only exists in the TCG.
    var rules = MS.rulesFor(state.formatKey);
    $('#mode-field').style.display = rules.hasTraditional ? '' : 'none';
    if (!rules.hasTraditional) state.mode = 'advanced';

    // Genesys events set their own cap; 100 is only the standard.
    $('#cap-field').style.display = rules.points ? '' : 'none';
    if (rules.points) capIn.value = String(currentCap());
    syncSegments();
  }

  function currentCap() {
    if (state.cap != null) return state.cap;
    var list = MS.banlists.get(state.formatKey, state.listId);
    return list && list.cap != null ? list.cap : MS.rulesFor(state.formatKey).pointCap;
  }

  function syncSegments() {
    MS.$$('#mode-seg button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode));
    });
    MS.$$('#art-seg button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.art === state.art));
    });
  }

  fmtSel.addEventListener('change', function () {
    state.formatKey = fmtSel.value;
    MS.prefs.set('formatKey', state.formatKey);
    state.listId = null;
    fillLists();
    MS.prefs.set('listId', state.listId);
    rerun();
  });

  capIn.addEventListener('change', function () {
    var v = parseInt(capIn.value, 10);
    state.cap = isNaN(v) || v < 0 ? null : v;
    MS.prefs.set('genesysCap', state.cap);
    capIn.value = String(currentCap());
    rerun();
  });

  lstSel.addEventListener('change', function () {
    state.listId = lstSel.value;
    MS.prefs.set('listId', state.listId);
    if (MS.rulesFor(state.formatKey).points) capIn.value = String(currentCap());
    rerun();
  });

  MS.$$('#mode-seg button').forEach(function (b) {
    b.addEventListener('click', function () {
      state.mode = b.dataset.mode;
      MS.prefs.set('mode', state.mode);
      syncSegments();
      rerun();
    });
  });

  MS.$$('#art-seg button').forEach(function (b) {
    b.addEventListener('click', function () {
      state.art = b.dataset.art;
      MS.prefs.set('art', state.art);
      syncSegments();
      MS.$$('.deck-grid').forEach(function (g) { g.classList.toggle('show-art', state.art === 'image'); });
    });
  });

  /* ---------------- input ---------------- */

  var dz = $('#dropzone');
  ['dragenter', 'dragover'].forEach(function (ev) {
    dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('is-over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    dz.addEventListener(ev, function (e) { e.preventDefault(); if (ev === 'dragleave' && dz.contains(e.relatedTarget)) return; dz.classList.remove('is-over'); });
  });
  dz.addEventListener('drop', function (e) {
    var file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) return readFile(file);
    var text = e.dataTransfer.getData('text');
    if (text) { $('#paste').value = text; ingest(text); }
  });

  $('#pick').addEventListener('click', function () { $('#file').click(); });
  $('#file').addEventListener('change', function () {
    if (this.files && this.files[0]) readFile(this.files[0]);
  });
  $('#read').addEventListener('click', function () { ingest($('#paste').value, null); });
  $('#paste').addEventListener('paste', function () {
    var ta = this;
    setTimeout(function () { if (ta.value.trim()) ingest(ta.value, null); }, 0);
  });
  $('#clear').addEventListener('click', function () {
    $('#paste').value = '';
    state.deck = null;
    statusBox.innerHTML = '';
    resultBox.innerHTML = '';
  });

  $('#sample').addEventListener('click', function () {
    // A deliberately illegal deck: Maxx "C", three Pot of Greed, an
    // over-limit Called by the Grave, and a Link monster in the Main Deck.
    var sample = {
      name: 'Sample — deliberately illegal',
      main: [
        { id: 23434538, name: 'Maxx "C"', count: 3 },
        { id: 55144522, name: 'Pot of Greed', count: 3 },
        { id: 24224830, name: 'Called by the Grave', count: 3 },
        { id: 14558127, name: 'Ash Blossom & Joyous Spring', count: 3 },
        { id: 10045474, name: 'Nibiru, the Primal Being', count: 3 },
        { id: 32807846, name: 'Reinforcement of the Army', count: 2 },
        { id: 73628505, name: 'Triple Tactics Talent', count: 2 },
        { id: 5318639, name: 'Terraforming', count: 2 },
        { id: 41209827, name: 'Mathmech Circular', count: 2 },
        { id: 30227494, name: 'Diviner of the Herald', count: 3 },
        { id: 91800273, name: 'Herald of Orange Light', count: 3 },
        { id: 3078576, name: 'Fiendsmith Engraver', count: 3 },
        { id: 89631139, name: 'Blue-Eyes White Dragon', count: 3 },
        { id: 46986414, name: 'Dark Magician', count: 3 },
        { id: 44519536, name: 'Linkuriboh', count: 2 }
      ],
      extra: [
        { id: 2857636, name: 'Fiendsmith\u2019s Requiem', count: 2 },
        { id: 60764609, name: 'Fiendsmith\u2019s Sequence', count: 1 },
        { id: 61665245, name: 'Knightmare Unicorn', count: 1 },
        { id: 2129638, name: 'Accesscode Talker', count: 1 },
        { id: 1861629, name: 'S:P Little Knight', count: 2 },
        { id: 88581108, name: 'Apollousa, Bow of the Goddess', count: 2 },
        { id: 65305468, name: 'I:P Masquerena', count: 1 },
        { id: 27548199, name: 'Underworld Goddess of the Closed World', count: 1 },
        { id: 65961500, name: 'Moon of the Closed Heaven', count: 1 },
        { id: 76794549, name: 'Baronne de Fleur', count: 3 }
      ],
      side: [
        { id: 14735698, name: 'Dimension Shifter', count: 3 },
        { id: 94145021, name: 'Droll & Lock Bird', count: 3 }
      ]
    };
    $('#paste').value = JSON.stringify(sample, null, 2);
    ingest(JSON.stringify(sample), 'sample.json');
  });

  function readFile(file) {
    var reader = new FileReader();
    reader.onload = function () { ingest(String(reader.result), file.name); };
    reader.onerror = function () { fail('That file could not be read.'); };
    reader.readAsText(file);
  }

  function ingest(text, filename) {
    var deck;
    try {
      deck = MS.parseDeckText(text, filename);
    } catch (err) {
      return fail(err.message);
    }
    if (!deck.main.length && !deck.extra.length && !deck.side.length && !(deck.pending || []).length) {
      return fail('That parsed cleanly but contained no cards.');
    }
    state.deck = deck;
    resolveAndRun(deck);
  }

  function missingIdMap(rep) {
    resultBox.innerHTML = '';
    statusBox.innerHTML = '';
    statusBox.appendChild(el('div', { class: 'note', style: 'margin-top:22px;border-left-color:var(--limited)' }, [
      el('strong', { text: "These aren't passcodes. " }),
      'All ' + rep.total + ' cards are identified by short ids rather than 8-digit passcodes, so a translation table is needed. Build one with ',
      el('code', { text: 'node tools/fetch-banlists.mjs --idmap' }),
      ', which writes data/idmap.js. Every deck format that uses passcodes (.ydk, ydke) works without it.'
    ]));
  }

  function badIdMap(rep) {
    resultBox.innerHTML = '';
    statusBox.innerHTML = '';
    statusBox.appendChild(el('div', { class: 'note', style: 'margin-top:22px;border-left-color:var(--forbidden)' }, [
      el('strong', { text: 'The id map didn\u2019t match. ' }),
      'None of the ' + rep.total + ' ids in this deck appear in the ' + (rep.label || 'loaded') +
      ' table, so they belong to a different numbering scheme. The first few are ' +
      rep.unmapped.slice(0, 6).join(', ') + '. Whichever tool exported this deck knows the mapping \u2014 export that table and drop it into data/idmap.js.'
    ]));
  }

  function fail(msg) {
    resultBox.innerHTML = '';
    statusBox.innerHTML = '';
    statusBox.appendChild(el('div', { class: 'note', style: 'margin-top:22px;border-left-color:var(--forbidden)' }, [
      el('strong', { text: "Couldn't read that. " }), msg
    ]));
  }

  function info(msg) {
    statusBox.innerHTML = '';
    statusBox.appendChild(el('div', { class: 'note', style: 'margin-top:22px', html: msg }));
  }

  /* ---------------- resolve then validate ---------------- */

  function resolveAndRun(deck) {
    info('Looking up card data\u2026');

    // Decks exported with non-passcode ids need translating first.
    state.idReport = MS.applyIdMap(deck);
    if (state.idReport.needed && !state.idReport.available) return missingIdMap(state.idReport);
    if (state.idReport.needed && state.idReport.mapped === 0) return badIdMap(state.idReport);

    var list = MS.banlists.get(state.formatKey, state.listId);
    var ids = deck.main.concat(deck.extra, deck.side);
    (deck.pending || []).forEach(function (p) { if (p.id != null) ids.push(p.id); });
    if (list) list.cards.forEach(function (c) { ids.push(c.id); });

    MS.cards.load(ids).then(function (res) {
      // JSON decks may not have said which pile each card belongs in,
      // or may have given names rather than passcodes. Sort that out now
      // that the card database is warm.
      if (deck.needsResolve) placeLooseCards(deck);
      run(res);
    }).catch(function () {
      info('Card lookup is unavailable right now, so passcodes are shown without names. The banlist check itself still works.');
      if (deck.needsResolve) placeLooseCards(deck);
      run({ missing: [] });
    });
  }

  function placeLooseCards(deck) {
    deck.main = []; deck.extra = []; deck.side = [];
    deck.unresolvedNames = [];
    (deck.pending || []).forEach(function (p) {
      var card = p.id != null ? MS.cards.get(p.id) : MS.cards.byName(p.name);
      var id = p.id != null ? p.id : (card ? card.id : null);
      if (id == null) { deck.unresolvedNames.push(p.name); return; }
      var section = p.section;
      if (!section) section = (card && MS.isExtraDeckFrame(card.frame)) ? 'extra' : 'main';
      deck[section].push(id);
    });
    deck.needsResolve = false;
  }

  function rerun() {
    if (state.deck) resolveAndRun(state.deck);
  }

  function run(loadResult) {
    var list = MS.banlists.get(state.formatKey, state.listId);
    if (!list) {
      return fail('No banlist is loaded for this format yet. Run the fetch script, or add one on the Publish page.');
    }
    var rules = MS.rulesFor(state.formatKey);
    var result = MS.validate(state.deck, list, { formatKey: state.formatKey, mode: state.mode, cap: rules.points ? currentCap() : null });
    render(result, loadResult);
  }

  /* ---------------- rendering ---------------- */

  function scaleSvg() {
    var ns = 'http://www.w3.org/2000/svg';
    var wrap = document.createElementNS(ns, 'svg');
    wrap.setAttribute('viewBox', '0 0 64 44');
    wrap.setAttribute('class', 'scale-viz');
    wrap.setAttribute('aria-hidden', 'true');
    wrap.innerHTML =
      '<g stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round">' +
      '<path d="M32 16v22"/><path d="M22 40h20"/>' +
      '<g class="beam-group">' +
      '<path d="M12 16h40"/>' +
      '<g class="pan pan-l"><path d="M12 16l-5 7M12 16l5 7"/><path d="M6 23h12a6 6 0 0 1-12 0Z" fill="currentColor" stroke="none"/></g>' +
      '<g class="pan pan-r"><path d="M52 16l-5 7M52 16l5 7"/><path d="M46 23h12a6 6 0 0 1-12 0Z" fill="currentColor" stroke="none"/></g>' +
      '</g></g>';
    return wrap;
  }

  function render(result, loadResult) {
    statusBox.innerHTML = '';
    resultBox.innerHTML = '';

    var rep = state.idReport;
    if (rep && rep.needed && rep.available) {
      statusBox.appendChild(el('div', { class: 'note', style: 'margin-top:22px' }, [
        el('strong', { text: 'Translated ' + rep.mapped + ' of ' + rep.total + ' cards. ' }),
        'This deck identifies cards by ' + (rep.label || 'a non-passcode id') + ', mapped to passcodes via data/idmap.js.' +
        (rep.unmapped.length ? ' No match for: ' + rep.unmapped.slice(0, 8).join(', ') + (rep.unmapped.length > 8 ? '\u2026' : '') + '.' : '')
      ]));
    }

    var missing = (loadResult && loadResult.missing) || [];
    var unresolved = (state.deck.unresolvedNames || []);
    if (missing.length || unresolved.length) {
      var bits = [];
      if (missing.length) bits.push(missing.length + ' passcode' + (missing.length > 1 ? 's' : '') + ' had no match in the card database (' + missing.slice(0, 5).join(', ') + (missing.length > 5 ? '\u2026' : '') + ')');
      if (unresolved.length) bits.push(unresolved.length + ' card name' + (unresolved.length > 1 ? 's' : '') + " couldn't be matched (" + unresolved.slice(0, 4).join(', ') + (unresolved.length > 4 ? '\u2026' : '') + ')');
      statusBox.appendChild(el('div', { class: 'note', style: 'margin-top:22px' }, [
        el('strong', { text: 'Partly resolved. ' }),
        bits.join('. ') + '. Those cards are shown as passcodes and checked against the list by number only.'
      ]));
    }

    /* --- verdict --- */
    var problems = result.problems;
    var v = el('div', { class: 'verdict', 'data-state': result.legal ? 'pass' : 'fail' });
    v.appendChild(scaleSvg());

    var deckName = state.deck.name && state.deck.name !== 'Untitled deck' ? state.deck.name : 'This deck';
    v.appendChild(el('div', { class: 'verdict-text' }, [
      el('p', {
        class: 'headline',
        text: result.legal ? 'Legal' : (problems.length + ' problem' + (problems.length > 1 ? 's' : ''))
      }),
      el('p', {
        class: 'sub',
        text: deckName + ' \u00b7 ' + result.rules.name + ' ' +
              (result.points ? result.points.cap + '-point cap' : (result.mode === 'traditional' ? 'Traditional' : 'Advanced')) +
              ' \u00b7 list effective ' + MS.formatDate(result.list.date)
      })
    ]));

    var tally = el('div', { class: 'tally' });
    function tallyCell(n, k, bad) {
      tally.appendChild(el('div', {}, [
        el('span', { class: 'n' + (bad ? ' bad' : ''), text: String(n) }),
        el('span', { class: 'k', text: k })
      ]));
    }
    tallyCell(result.sizes.main, 'Main', result.sizes.main < result.rules.mainMin || result.sizes.main > result.rules.mainMax);
    tallyCell(result.sizes.extra, 'Extra', result.sizes.extra > result.rules.extraMax);
    if (result.rules.hasSide || result.sizes.side) {
      tallyCell(result.sizes.side, 'Side', result.sizes.side > result.rules.sideMax);
    }
    if (result.points) tallyCell(result.points.total + '/' + result.points.cap, 'Points', result.points.over > 0);
    else tallyCell(result.byStatus[0], 'Forbidden', result.byStatus[0] > 0 && result.mode !== 'traditional');
    v.appendChild(tally);

    if (problems.length) {
      var ul = el('ul', { class: 'problems' });
      problems.forEach(function (p) {
        ul.appendChild(el('li', {}, [
          el('strong', { text: p.text }),
          el('span', { class: 'why', text: p.why })
        ]));
      });
      v.appendChild(ul);
    }
    resultBox.appendChild(v);

    /* --- deck sections --- */
    var order = ['main', 'extra', 'side'];
    var labels = { main: 'Main Deck', extra: 'Extra Deck', side: 'Side Deck' };
    order.forEach(function (sec) {
      var ids = state.deck[sec] || [];
      if (!ids.length) return;

      var seen = Object.create(null);
      var tiles = [];
      ids.forEach(function (id) {
        var e = result.statusOf(id);
        if (!e || seen[e.key]) return;
        seen[e.key] = 1;
        var sectionEntry = Object.assign({}, e, { count: e.bySection[sec], displayId: id });
        // A card is flagged in every pile it appears in, since the copy
        // limit counts Main, Extra and Side together.
        sectionEntry.illegal = e.illegal;
        tiles.push(MS.renderTile(sectionEntry));
      });

      var overSize = (sec === 'main' && (ids.length < result.rules.mainMin || ids.length > result.rules.mainMax)) ||
                     (sec === 'extra' && ids.length > result.rules.extraMax) ||
                     (sec === 'side' && ids.length > result.rules.sideMax);

      var grid = el('div', { class: 'deck-grid' + (state.art === 'image' ? ' show-art' : '') });
      tiles.forEach(function (t) { grid.appendChild(t); });

      resultBox.appendChild(el('section', { class: 'deck-section' }, [
        el('header', {}, [
          el('h2', { text: labels[sec] }),
          el('span', { class: 'count' + (overSize ? ' bad' : ''), text: ids.length + ' cards \u00b7 ' + tiles.length + ' unique' })
        ]),
        grid
      ]));
    });

    /* --- export --- */
    resultBox.appendChild(el('div', { class: 'crosslink' }, [
      el('span', { text: 'Export this deck:' }),
      el('button', { class: 'btn btn-sm', type: 'button', text: '.ydk', onclick: function () {
        MS.download('deck.ydk', MS.toYDK(state.deck), 'text/plain');
      } }),
      el('button', { class: 'btn btn-sm', type: 'button', text: 'ydke URI', onclick: function () {
        var uri = MS.toYDKE(state.deck);
        navigator.clipboard ? navigator.clipboard.writeText(uri).then(function () { MS.toast('ydke URI copied'); })
                            : MS.download('deck.txt', uri, 'text/plain');
      } }),
      el('button', { class: 'btn btn-sm', type: 'button', text: 'JSON', onclick: function () {
        MS.download('deck.json', JSON.stringify(MS.toDeckJSON(state.deck, MS.cards.snapshot()), null, 2), 'application/json');
      } }),
      MS.idmap ? el('button', { class: 'btn btn-sm', type: 'button', text: 'Converter JSON', onclick: function () {
        MS.download('deck-converter.json', JSON.stringify(MS.toConverterJSON(state.deck), null, 2), 'application/json');
      } }) : null
    ]));
  }

  /* ---------------- boot ---------------- */

  if (fillFormats()) {
    fillLists();
  } else {
    statusBox.appendChild(el('div', { class: 'note', style: 'margin-top:22px' }, [
      el('strong', { text: 'No banlists bundled yet. ' }),
      'Run ',
      el('code', { text: 'node tools/fetch-banlists.mjs' }),
      ' to pull every list from ygo.anihelp.co.uk, or add one by hand on the ',
      el('a', { href: 'publish.html', text: 'Publish page' }),
      '.'
    ]));
  }
  syncSegments();
})();
