/* Millennium Scale — publish a banlist */
(function () {
  'use strict';

  var $ = MS.$, el = MS.el;

  var state = { sections: [], index: 0, candidate: null, checks: [] };

  /* ---------------- input ---------------- */

  var dz = $('#dropzone');
  ['dragenter', 'dragover'].forEach(function (ev) {
    dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('is-over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('is-over'); });
  });
  dz.addEventListener('drop', function (e) {
    var f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) readFile(f);
  });
  $('#pick').addEventListener('click', function () { $('#file').click(); });
  $('#file').addEventListener('change', function () { if (this.files[0]) readFile(this.files[0]); });
  $('#read').addEventListener('click', function () { ingest($('#paste').value, null); });

  function readFile(file) {
    var r = new FileReader();
    r.onload = function () { ingest(String(r.result), file.name); };
    r.readAsText(file);
  }

  function ingest(text, filename) {
    text = String(text || '').trim();
    if (!text) return showChecks([{ level: 'error', label: 'Nothing to read', detail: 'The input is empty.' }]);

    var sections = [];
    try {
      if (text.charAt(0) === '{' || text.charAt(0) === '[') {
        sections = fromJSON(JSON.parse(text));
      } else {
        sections = MS.parseLFList(text).map(function (l) {
          return { name: l.name, whitelist: l.whitelist, cards: l.cards, date: MS.guessListDate(l.name), format: guessFormat(l.name, filename) };
        });
      }
    } catch (err) {
      return showChecks([{ level: 'error', label: "Couldn't parse that", detail: err.message }]);
    }

    if (!sections.length) {
      return showChecks([{ level: 'error', label: 'No lists found', detail: 'The file parsed but contained no card entries. A .conf needs lines like "14558127 0 --Ronintoadin".' }]);
    }

    state.sections = sections;
    state.index = 0;

    var sel = $('#m-section');
    sel.innerHTML = '';
    sections.forEach(function (s, i) {
      sel.appendChild(el('option', { value: String(i), text: s.name + ' (' + s.cards.length + ' cards)' }));
    });
    $('#meta').hidden = false;
    sel.parentElement.style.display = sections.length > 1 ? '' : 'none';

    chooseSection(0);
  }

  function fromJSON(data) {
    // Either a single list, or a full bundle of formats.
    if (data && Array.isArray(data.formats)) {
      var out = [];
      data.formats.forEach(function (f) {
        (f.lists || []).forEach(function (l) {
          out.push({ name: (f.key || '') + ' ' + (l.date || l.id), whitelist: !!l.whitelist, cards: normCards(l.cards), date: l.date, format: f.key, source: l.source });
        });
      });
      return out;
    }
    if (data && Array.isArray(data.cards)) {
      return [{ name: data.label || data.id || 'Imported list', whitelist: !!data.whitelist, cards: normCards(data.cards), date: data.date, format: data.format, source: data.source }];
    }
    if (Array.isArray(data)) {
      return [{ name: 'Imported list', whitelist: false, cards: normCards(data), date: null, format: null }];
    }
    throw new Error('Expected a JSON object with a "cards" array, or a bundle with a "formats" array.');
  }

  function normCards(arr) {
    return (arr || []).map(function (c) {
      if (typeof c === 'number') return { id: c, name: null, status: 0 };
      var id = parseInt(c.id != null ? c.id : c.passcode, 10);
      var st = c.status;
      if (st == null && c.statusLabel) {
        st = { forbidden: 0, limited: 1, 'semi-limited': 2, semi: 2, unlimited: 3 }[String(c.statusLabel).toLowerCase()];
      }
      return { id: id, name: c.name || null, status: st == null ? 0 : Number(st) };
    }).filter(function (c) { return c.id && !isNaN(c.id) && c.status >= 0 && c.status <= 3; });
  }

  function guessFormat(name, filename) {
    var hay = ((name || '') + ' ' + (filename || '')).toUpperCase();
    if (/\bMD\b|MASTER\s*DUEL/.test(hay)) return 'MD';
    if (/\bOCG\b/.test(hay)) return 'OCG';
    if (/\bTCG\b/.test(hay)) return 'TCG';
    return null;
  }

  $('#m-section').addEventListener('change', function () { chooseSection(parseInt(this.value, 10)); });
  ['#m-format', '#m-date', '#m-source'].forEach(function (sel) {
    $(sel).addEventListener('change', verify);
    $(sel).addEventListener('input', function () { clearTimeout(verify._t); verify._t = setTimeout(verify, 400); });
  });

  function chooseSection(i) {
    state.index = i;
    var s = state.sections[i];
    if (!s) return;
    $('#m-format').value = s.format || guessFormat(s.name, null) || 'TCG';
    $('#m-date').value = s.date || MS.guessListDate(s.name) || '';
    $('#m-source').value = s.source || '';
    verify();
  }

  /* ---------------- verification ---------------- */

  function verify() {
    var s = state.sections[state.index];
    if (!s) return;

    var format = $('#m-format').value;
    var date = $('#m-date').value.trim();
    var source = $('#m-source').value.trim();

    var checks = [];
    var cards = s.cards;

    // 1. structure
    checks.push({ level: 'ok', label: 'Parsed ' + cards.length + ' entries', detail: s.name });

    // 2. date
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      var d = new Date(date + 'T00:00:00Z');
      if (isNaN(d.getTime())) checks.push({ level: 'error', label: 'Effective date is not a real date', detail: date });
      else checks.push({ level: 'ok', label: 'Effective ' + MS.formatDate(date), detail: '' });
    } else {
      checks.push({ level: 'error', label: 'Effective date needed', detail: 'Enter it as YYYY-MM-DD. It sorts the archive and names the file.' });
    }

    // 3. collision
    var id = format + '-' + date;
    var existing = MS.banlists.get(format, id);
    if (existing && existing.id === id) {
      checks.push({
        level: 'warn',
        label: 'A list already exists for this date',
        detail: 'Publishing replaces it. ' + existing.cards.length + ' entries currently.'
      });
    }

    // 4. duplicates
    var seen = Object.create(null), dupes = [];
    cards.forEach(function (c) { if (seen[c.id]) dupes.push(c.id); seen[c.id] = 1; });
    if (dupes.length) checks.push({ level: 'warn', label: dupes.length + ' duplicate passcode' + (dupes.length > 1 ? 's' : ''), detail: 'The last entry wins: ' + dupes.slice(0, 6).map(MS.passcode).join(', ') });
    else checks.push({ level: 'ok', label: 'No duplicate passcodes', detail: '' });

    // 5. status spread
    var counts = { 0: 0, 1: 0, 2: 0, 3: 0 };
    cards.forEach(function (c) { counts[c.status]++; });
    checks.push({
      level: counts[0] + counts[1] + counts[2] === 0 ? 'warn' : 'ok',
      label: counts[0] + ' Forbidden \u00b7 ' + counts[1] + ' Limited \u00b7 ' + counts[2] + ' Semi-Limited',
      detail: counts[3] ? counts[3] + ' entries are marked Unlimited and will be stored as explicit unlimits.' : ''
    });

    state.checks = checks;
    showChecks(checks, true);

    // 6. card lookup (async)
    MS.cards.load(cards.map(function (c) { return c.id; })).then(function (res) {
      var missing = res.missing || [];
      if (missing.length) {
        checks.push({
          level: 'warn',
          label: missing.length + ' passcode' + (missing.length > 1 ? 's' : '') + ' not in the card database',
          detail: missing.slice(0, 8).map(MS.passcode).join(', ') + (missing.length > 8 ? '\u2026' : '') + '. They still work, but will show as numbers.'
        });
      } else {
        checks.push({ level: 'ok', label: 'All ' + cards.length + ' passcodes resolved to real cards', detail: '' });
      }
      finishVerify(checks, format, date, source, s, cards);
    }).catch(function () {
      checks.push({ level: 'warn', label: 'Card database unreachable', detail: 'Names and stats will be missing until you reload with a connection.' });
      finishVerify(checks, format, date, source, s, cards);
    });
  }

  function finishVerify(checks, format, date, source, s, cards) {
    var blocking = checks.some(function (c) { return c.level === 'error'; });

    state.candidate = blocking ? null : {
      id: format + '-' + date,
      format: format,
      date: date,
      label: MS.formatDate(date),
      confName: s.name,
      whitelist: !!s.whitelist,
      source: source || null,
      addedBy: 'publish-page',
      addedAt: new Date().toISOString(),
      cards: dedupe(cards)
    };

    showChecks(checks, false);
    $('#publish').disabled = blocking;
    $('#export-json').disabled = blocking;
    renderPreview();
  }

  function dedupe(cards) {
    var byId = Object.create(null), order = [];
    cards.forEach(function (c) { if (!(c.id in byId)) order.push(c.id); byId[c.id] = c; });
    return order.map(function (id) {
      var c = byId[id];
      var known = MS.cards.get(id);
      return { id: id, name: known ? known.name : (c.name || null), status: c.status };
    });
  }

  function showChecks(checks, pending) {
    $('#checks-panel').hidden = false;
    var box = $('#checks');
    box.innerHTML = '';
    checks.forEach(function (c) {
      box.appendChild(el('div', { class: 'check ' + c.level }, [
        el('span', { class: 'mark', text: c.level === 'ok' ? '\u2713' : c.level === 'warn' ? '!' : '\u2717' }),
        el('div', {}, [
          el('div', { text: c.label }),
          c.detail ? el('div', { class: 'detail', text: c.detail }) : null
        ])
      ]));
    });
    if (pending) {
      box.appendChild(el('div', { class: 'check' }, [
        el('span', { class: 'mark', text: '\u2026' }),
        el('div', { text: 'Checking passcodes against the card database\u2026' })
      ]));
    }
  }

  function renderPreview() {
    var c = state.candidate;
    $('#preview-panel').hidden = !c;
    if (!c) return;
    var box = $('#preview');
    box.innerHTML = '';

    [0, 1, 2, 3].forEach(function (st) {
      var group = c.cards.filter(function (x) { return x.status === st; });
      if (!group.length) return;
      box.appendChild(el('div', { style: 'margin-top:12px' }, [
        el('span', { class: 'pill', 'data-status': String(st), text: MS.STATUS_LABEL[st] + ' \u00b7 ' + group.length })
      ]));
      var names = group.slice(0, 14).map(function (x) { return x.name || MS.passcode(x.id); }).join(', ');
      box.appendChild(el('p', {
        style: 'margin:8px 0 0;font-size:13.5px;color:var(--ink-2)',
        text: names + (group.length > 14 ? ', and ' + (group.length - 14) + ' more.' : '')
      }));
    });
  }

  /* ---------------- publish + export ---------------- */

  $('#publish').addEventListener('click', function () {
    if (!state.candidate) return;
    MS.banlists.saveLocal(state.candidate);
    MS.toast('Published ' + state.candidate.format + ' ' + state.candidate.label);
    renderLocal();
  });

  $('#export-json').addEventListener('click', function () {
    if (!state.candidate) return;
    MS.download(state.candidate.id + '.json', JSON.stringify(state.candidate, null, 2), 'application/json');
  });

  function bundle() {
    // Genesys point lists ship in their own bundle, data/genesys.js.
    var formats = MS.banlists.all().filter(function (f) { return !MS.rulesFor(f.key).points; }).map(function (f) {
      return {
        key: f.key,
        name: f.name,
        source: f.source,
        lists: f.lists
      };
    });
    return {
      schema: 'millennium-scale/banlists@1',
      generated: new Date().toISOString(),
      formats: formats
    };
  }

  $('#export-bundle').addEventListener('click', function () {
    var js = '/* Millennium Scale banlist bundle — generated ' + new Date().toISOString() + ' */\n' +
             'window.MS_BANLISTS = ' + JSON.stringify(bundle()) + ';\n';
    MS.download('banlists.js', js, 'application/javascript');
    MS.toast('Drop this into data/banlists.js and commit it');
  });

  $('#export-all-json').addEventListener('click', function () {
    MS.download('banlists.json', JSON.stringify(bundle(), null, 2), 'application/json');
  });

  function renderLocal() {
    var box = $('#local');
    box.innerHTML = '';
    var local = MS.banlists.localOnly();
    if (!local.length) {
      box.appendChild(el('p', { style: 'color:var(--ink-3);margin:0;font-size:13.5px', text: 'Nothing published from this browser yet. Anything you add here sits alongside the bundled archive and can be exported at any time.' }));
      return;
    }
    local.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); }).forEach(function (l) {
      box.appendChild(el('div', { class: 'check ok' }, [
        el('span', { class: 'mark', text: '\u2713' }),
        el('div', { style: 'flex:1' }, [
          el('div', { text: (MS.rulesFor(l.format).name || l.format) + ' \u00b7 ' + MS.formatDate(l.date) }),
          el('div', { class: 'detail', text: l.cards.length + ' entries' })
        ]),
        el('button', {
          class: 'btn btn-ghost btn-sm', type: 'button', text: 'Remove',
          onclick: function () { MS.banlists.removeLocal(l.id); renderLocal(); MS.toast('Removed'); }
        })
      ]));
    });
  }

  renderLocal();
})();
