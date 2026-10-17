/* ============================================================
   Millennium Scale — core library
   Plain classic script (no ES modules) so that opening the
   files straight off disk with file:// works without a server.
   Everything hangs off the global MS.
   ============================================================ */
(function (global) {
  'use strict';

  var MS = {};
  global.MS = MS;

  /* ---------------------------------------------------------
     Constants
     --------------------------------------------------------- */

  MS.STATUS = { FORBIDDEN: 0, LIMITED: 1, SEMI: 2, UNLIMITED: 3 };

  MS.STATUS_LABEL = {
    0: 'Forbidden',
    1: 'Limited',
    2: 'Semi-Limited',
    3: 'Unlimited'
  };

  // Per-format deck construction rules.
  MS.FORMAT_RULES = {
    TCG: { name: 'TCG',          hasSide: true,  hasTraditional: true,  mainMin: 40, mainMax: 60, extraMax: 15, sideMax: 15, maxCopies: 3 },
    OCG: { name: 'OCG',          hasSide: true,  hasTraditional: false, mainMin: 40, mainMax: 60, extraMax: 15, sideMax: 15, maxCopies: 3 },
    MD:  { name: 'Master Duel',  hasSide: false, hasTraditional: false, mainMin: 40, mainMax: 60, extraMax: 15, sideMax: 0,  maxCopies: 3 },
    // Genesys ignores the F&L list: every card is at 3, some cost points,
    // and the whole deck (Side included) must fit under the event's cap.
    GEN: { name: 'Genesys',      hasSide: true,  hasTraditional: false, mainMin: 40, mainMax: 60, extraMax: 15, sideMax: 15, maxCopies: 3, points: true, pointCap: 100 }
  };

  MS.rulesFor = function (formatKey) {
    return MS.FORMAT_RULES[formatKey] || MS.FORMAT_RULES.TCG;
  };

  /** Why a card can't be played in Genesys at all, or null. */
  MS.genesysBlocked = function (card) {
    if (!card || !card.frame) return null;
    if (card.frame === 'link') return 'Link Monsters aren\u2019t allowed in Genesys';
    if (card.frame.indexOf('pendulum') !== -1) return 'Pendulum Monsters aren\u2019t allowed in Genesys';
    return null;
  };

  var EXTRA_FRAMES = {
    fusion: 1, synchro: 1, xyz: 1, link: 1,
    fusion_pendulum: 1, synchro_pendulum: 1, xyz_pendulum: 1
  };
  MS.isExtraDeckFrame = function (frame) { return !!EXTRA_FRAMES[frame]; };

  MS.frameColorVar = function (frame) {
    if (!frame) return 'var(--f-unknown)';
    if (frame.indexOf('pendulum') !== -1) return 'var(--f-pendulum)';
    var map = {
      normal: '--f-normal', effect: '--f-effect', ritual: '--f-ritual',
      fusion: '--f-fusion', synchro: '--f-synchro', xyz: '--f-xyz',
      link: '--f-link', spell: '--f-spell', trap: '--f-trap',
      token: '--f-token', skill: '--f-unknown'
    };
    return map[frame] ? 'var(' + map[frame] + ')' : 'var(--f-unknown)';
  };

  /* ---------------------------------------------------------
     Small helpers
     --------------------------------------------------------- */

  MS.$  = function (sel, root) { return (root || document).querySelector(sel); };
  MS.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  MS.el = function (tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k === 'style') n.setAttribute('style', attrs[k]);
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  };

  MS.escapeHtml = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  /** Passcodes are always 8 characters, zero-padded (440556 -> "00440556").
      The numeric form is what the API, image CDN and .conf files use, so
      padding is applied only where a passcode is shown to a person. */
  MS.passcode = function (id) {
    var n = String(parseInt(id, 10));
    if (n === 'NaN') return String(id);
    while (n.length < 8) n = '0' + n;
    return n;
  };

  /** Accepts "00440556", "440556" or 440556 and returns the number. */
  MS.parsePasscode = function (v) {
    var n = parseInt(String(v).replace(/^0+/, '') || '0', 10);
    return isNaN(n) ? null : n;
  };

  MS.pretty = function (n) { return n === undefined || n === null || n === '' ? '—' : n; };

  MS.formatDate = function (iso) {
    if (!iso) return '';
    var p = String(iso).split('-');
    if (p.length !== 3) return iso;
    var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    var d = parseInt(p[2], 10);
    var suffix = (d % 10 === 1 && d !== 11) ? 'st' : (d % 10 === 2 && d !== 12) ? 'nd' : (d % 10 === 3 && d !== 13) ? 'rd' : 'th';
    return months[parseInt(p[1], 10) - 1] + ' ' + d + suffix + ', ' + p[0];
  };

  MS.toast = function (msg) {
    var prev = MS.$('.toast');
    if (prev) prev.remove();
    var t = MS.el('div', { class: 'toast', role: 'status', text: msg });
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.remove(); }, 2600);
  };

  MS.download = function (filename, text, mime) {
    var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = MS.el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  };

  /* ---------------------------------------------------------
     Theme
     --------------------------------------------------------- */

  MS.prefs = {
    get: function (key, fallback) {
      try {
        var v = localStorage.getItem('ms.' + key);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { localStorage.setItem('ms.' + key, JSON.stringify(value)); } catch (e) {}
    }
  };

  MS.theme = {
    get: function () {
      return document.documentElement.getAttribute('data-theme') ||
             MS.prefs.get('theme', 'light');
    },
    set: function (t) {
      document.documentElement.setAttribute('data-theme', t);
      MS.prefs.set('theme', t);
      var btn = MS.$('.theme-toggle');
      if (btn) btn.setAttribute('aria-label', t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    },
    toggle: function () { MS.theme.set(MS.theme.get() === 'dark' ? 'light' : 'dark'); }
  };

  /* ---------------------------------------------------------
     Preferences (small, localStorage)
     --------------------------------------------------------- */

  /* ---------------------------------------------------------
     LFList (.conf) parser — the EDOPro / YGOPro format that
     ygo.anihelp.co.uk publishes.

       #comment
       !2026.05 TCG          <- starts a new list
       $whitelist            <- optional: everything else is banned
       23434538 1 --Maxx "C"

     Status codes: 0 forbidden, 1 limited, 2 semi-limited, 3 unlimited.
     --------------------------------------------------------- */

  MS.parseLFList = function (text) {
    var lists = [];
    var current = null;
    var lines = String(text).replace(/\r\n?/g, '\n').split('\n');

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;

      if (line.charAt(0) === '!') {
        current = { name: line.slice(1).trim(), whitelist: false, cards: [] };
        lists.push(current);
        continue;
      }
      if (line.charAt(0) === '$') {
        if (current && /whitelist/i.test(line)) current.whitelist = true;
        continue;
      }
      if (line.charAt(0) === '#') continue;

      var m = line.match(/^(\d{1,10})\s+(-?\d+)(?:\s*--\s*(.*))?$/);
      if (!m) continue;
      if (!current) { current = { name: 'Unnamed list', whitelist: false, cards: [] }; lists.push(current); }

      var status = parseInt(m[2], 10);
      if (status < 0 || status > 3) continue;
      current.cards.push({
        id: parseInt(m[1], 10),
        name: (m[3] || '').trim() || null,
        status: status
      });
    }
    return lists.filter(function (l) { return l.cards.length; });
  };

  /* Turn a list name like "2026.05 TCG" / "2026-05-18 MD" into a date. */
  MS.guessListDate = function (name) {
    var s = String(name), m;
    // ISO: 2026-05-18
    if ((m = s.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/))) return m[1] + '-' + pad2(m[2]) + '-' + pad2(m[3]);
    // Day-first, as the archive publishes them: 18.05.2026
    if ((m = s.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/))) return m[3] + '-' + pad2(m[2]) + '-' + pad2(m[1]);
    // Month and year only: 08.2000
    if ((m = s.match(/(\d{1,2})[.\-/](\d{4})/))) return m[2] + '-' + pad2(m[1]) + '-01';
    if ((m = s.match(/(\d{4})[.\-/](\d{1,2})/))) return m[1] + '-' + pad2(m[2]) + '-01';
    return null;
  };
  function pad2(v) { v = String(parseInt(v, 10)); return v.length < 2 ? '0' + v : v; }

  MS.serializeLFList = function (list) {
    var out = ['#' + list.label + ' — exported by Millennium Scale', '!' + (list.confName || list.label)];
    var order = [0, 1, 2, 3];
    order.forEach(function (st) {
      var group = list.cards.filter(function (c) { return c.status === st; });
      if (!group.length) return;
      out.push('#' + MS.STATUS_LABEL[st].toLowerCase());
      group.forEach(function (c) {
        out.push(c.id + ' ' + c.status + ' --' + (c.name || ''));
      });
    });
    return out.join('\n') + '\n';
  };

  /* ---------------------------------------------------------
     Deck parsers: .ydk, ydke:// and JSON
     --------------------------------------------------------- */

  function emptyDeck(name) {
    return { name: name || 'Untitled deck', main: [], extra: [], side: [], warnings: [] };
  }

  MS.parseYDK = function (text) {
    var deck = emptyDeck();
    var bucket = 'main';
    var lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      var low = line.toLowerCase();
      if (low.indexOf('#created by') === 0) { deck.name = line.slice(11).trim() || deck.name; continue; }
      if (low === '#main')  { bucket = 'main';  continue; }
      if (low === '#extra') { bucket = 'extra'; continue; }
      if (low === '!side' || low === '#side') { bucket = 'side'; continue; }
      if (line.charAt(0) === '#' || line.charAt(0) === '!') continue;
      var id = parseInt(line, 10);
      if (!isNaN(id) && id > 0) deck[bucket].push(id);
    }
    return MS.detectIdSpace(deck);
  };

  MS.toYDK = function (deck) {
    var out = ['#created by Millennium Scale', '#main'];
    deck.main.forEach(function (id) { out.push(id); });
    out.push('#extra');
    deck.extra.forEach(function (id) { out.push(id); });
    out.push('!side');
    deck.side.forEach(function (id) { out.push(id); });
    return out.join('\n') + '\n';
  };

  function b64ToIds(b64) {
    if (!b64) return [];
    var bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var usable = bytes.length - (bytes.length % 4);
    return Array.from(new Uint32Array(bytes.buffer.slice(0, usable)));
  }

  function idsToB64(ids) {
    var arr = new Uint32Array(ids);
    var bytes = new Uint8Array(arr.buffer);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  MS.parseYDKE = function (uri) {
    var body = String(uri).trim().replace(/^ydke:\/\//i, '');
    var parts = body.split('!');
    if (parts.length < 3) throw new Error('A ydke URI needs three "!"-separated sections (main, extra, side).');
    var deck = emptyDeck('Imported from ydke');
    deck.main  = b64ToIds(parts[0]);
    deck.extra = b64ToIds(parts[1]);
    deck.side  = b64ToIds(parts[2]);
    return MS.detectIdSpace(deck);
  };

  MS.toYDKE = function (deck) {
    return 'ydke://' + idsToB64(deck.main) + '!' + idsToB64(deck.extra) + '!' + idsToB64(deck.side) + '!';
  };

  /* JSON. Deliberately permissive — it accepts every shape a
     deck converter is likely to emit, and says which one it read. */
  MS.parseDeckJSON = function (input) {
    var data = typeof input === 'string' ? JSON.parse(input) : input;
    var deck = emptyDeck(data && (data.name || data.Name || data.deckName || data.DeckName || data.title || data.Title));

    if (Array.isArray(data)) {
      // Flat array: [ids] or [{id, count, section}]
      absorb(data, null);
      return finish('flat array');
    }

    var root = data.deck && typeof data.deck === 'object' && !Array.isArray(data.deck) ? data.deck : data;

    if (Array.isArray(root.cards)) {
      absorb(root.cards, null);
      return finish('cards[]');
    }

    // Converter shape: Monsters / Spells / Traps / Extra / Side, where the
    // first three are all Main Deck.
    var BUCKETS = {
      main: 'main', maindeck: 'main',
      monsters: 'main', monster: 'main', spells: 'main', spell: 'main',
      traps: 'main', trap: 'main', ritual: 'main', rituals: 'main',
      extra: 'extra', extradeck: 'extra', fusion: 'extra', fusions: 'extra',
      synchro: 'extra', synchros: 'extra', xyz: 'extra', link: 'extra', links: 'extra',
      side: 'side', sidedeck: 'side'
    };
    var bucketed = false;
    Object.keys(root).forEach(function (k) {
      var target = BUCKETS[k.toLowerCase().replace(/[^a-z]/g, '')];
      if (target && Array.isArray(root[k])) { bucketed = true; absorb(root[k], target); }
    });
    if (bucketed) return finish('typed sections');

    var found = false;
    ['main', 'extra', 'side'].forEach(function (sec) {
      var v = root[sec] || root[sec + 'Deck'] || root[sec + '_deck'];
      if (Array.isArray(v)) { found = true; absorb(v, sec); }
    });
    if (found) return finish('main/extra/side');

    throw new Error('Could not find a deck in that JSON. Expected a "main"/"extra"/"side" object, a "cards" array, or a flat array of card ids.');

    function absorb(arr, forcedSection) {
      arr.forEach(function (entry) {
        var id = null, name = null, count = 1, section = forcedSection;

        if (typeof entry === 'number') { id = entry; }
        else if (typeof entry === 'string') {
          if (/^\d{5,10}$/.test(entry.trim())) id = parseInt(entry, 10);
          else name = entry.trim();
        } else if (entry && typeof entry === 'object') {
          id = firstOf(entry, ['id', 'cardId', 'card_id', 'CardDatabaseId', 'cardDatabaseId', 'passcode', 'password', 'konamiId', 'konami_id']);
          if (id != null) id = parseInt(id, 10);
          name = entry.name || entry.Name || entry.cardName || entry.card_name || null;
          var c = firstOf(entry, ['count', 'Count', 'qty', 'Qty', 'quantity', 'Quantity', 'amount', 'Amount']);
          if (c == null) c = 1;
          count = Math.max(1, parseInt(c, 10) || 1);
          section = forcedSection || normSection(entry.section || entry.deck || entry.location || entry.zone);
        }
        if (id == null && !name) return;
        for (var i = 0; i < count; i++) {
          deck.__pending = deck.__pending || [];
          deck.__pending.push({ id: isNaN(id) ? null : id, name: name, section: section });
        }
      });
    }

    function firstOf(obj, keys) {
      for (var i = 0; i < keys.length; i++) if (obj[keys[i]] != null) return obj[keys[i]];
      return null;
    }

    function normSection(v) {
      if (!v) return null;
      v = String(v).toLowerCase();
      if (v.indexOf('extra') !== -1) return 'extra';
      if (v.indexOf('side') !== -1) return 'side';
      if (v.indexOf('main') !== -1) return 'main';
      return null;
    }

    function finish(shape) {
      deck.shape = shape;
      var pending = deck.__pending || [];
      delete deck.__pending;
      deck.pending = pending; // resolved later, once names/frames are known
      pending.forEach(function (p) {
        if (p.section && p.id != null) deck[p.section].push(p.id);
      });
      deck.needsResolve = pending.some(function (p) { return !p.section || p.id == null; });
      MS.detectIdSpace(deck);
      return deck;
    }
  };

  /* ---------------------------------------------------------
     Foreign card ids

     Some exporters identify cards by something other than the
     8-digit passcode — Konami's own database id, or a
     simulator's internal index. Those are almost always short
     numbers, whereas real passcodes are overwhelmingly six
     digits or more, so a deck full of five-digit ids is a
     reliable signal that a translation table is needed.

     data/idmap.js supplies that table. Without it we say so
     plainly rather than reporting every card as unknown.
     --------------------------------------------------------- */

  MS.idmap = (global.MS_IDMAP && global.MS_IDMAP.map) ? global.MS_IDMAP : null;

  MS.detectIdSpace = function (deck) {
    var ids = (deck.main || []).concat(deck.extra || [], deck.side || []);
    (deck.pending || []).forEach(function (p) { if (p.id != null) ids.push(p.id); });
    if (!ids.length) { deck.idSpace = 'passcode'; return deck; }
    var small = ids.filter(function (id) { return id < 100000; }).length;
    deck.idSpace = (small / ids.length) >= 0.9 ? 'foreign' : 'passcode';
    return deck;
  };

  /** Translate a foreign-id deck into passcodes, in place. Idempotent. */
  MS.applyIdMap = function (deck) {
    var report = { needed: deck.idSpace === 'foreign', available: !!MS.idmap, label: MS.idmap ? MS.idmap.label : null, total: 0, mapped: 0, unmapped: [] };
    if (!report.needed) return report;

    if (!deck._sourceIds) {
      deck._sourceIds = { main: deck.main.slice(), extra: deck.extra.slice(), side: deck.side.slice() };
    }
    if (!MS.idmap) {
      report.total = deck._sourceIds.main.length + deck._sourceIds.extra.length + deck._sourceIds.side.length;
      return report;
    }

    var m = MS.idmap.map;
    ['main', 'extra', 'side'].forEach(function (sec) {
      deck[sec] = deck._sourceIds[sec].map(function (id) {
        report.total++;
        var pass = m[id];
        if (pass != null) { report.mapped++; return pass; }
        report.unmapped.push(id);
        return id;
      });
    });
    deck.idsTranslated = report.mapped > 0;
    return report;
  };

  /** Reverse lookup, for exporting back to the converter's own ids. */
  var reverseIdMap = null;
  MS.toConverterId = function (passcode) {
    if (!MS.idmap) return null;
    if (!reverseIdMap) {
      reverseIdMap = Object.create(null);
      Object.keys(MS.idmap.map).forEach(function (k) { reverseIdMap[MS.idmap.map[k]] = Number(k); });
    }
    var v = reverseIdMap[passcode];
    if (v != null) return v;
    var card = MS.cards.get(passcode);
    return card ? (reverseIdMap[card.id] != null ? reverseIdMap[card.id] : null) : null;
  };

  /** Export in the converter's shape: Monsters/Spells/Traps/Extra/Side. */
  MS.toConverterJSON = function (deck, name) {
    var out = { Name: name || deck.name || 'Untitled deck', Monsters: [], Spells: [], Traps: [], Extra: [], Side: [] };
    function push(list, id, count) {
      var cid = MS.toConverterId(id);
      list.push({ CardDatabaseId: cid != null ? cid : id, Quantity: count });
    }
    function tally(ids) {
      var order = [], counts = {};
      ids.forEach(function (id) { if (counts[id] === undefined) { counts[id] = 0; order.push(id); } counts[id]++; });
      return order.map(function (id) { return { id: Number(id), count: counts[id] }; });
    }
    tally(deck.main).forEach(function (e) {
      var c = MS.cards.get(e.id);
      var bucket = !c ? out.Monsters : c.frame === 'spell' ? out.Spells : c.frame === 'trap' ? out.Traps : out.Monsters;
      push(bucket, e.id, e.count);
    });
    tally(deck.extra).forEach(function (e) { push(out.Extra, e.id, e.count); });
    tally(deck.side).forEach(function (e) { push(out.Side, e.id, e.count); });
    return out;
  };

  MS.toDeckJSON = function (deck, cardsById) {
    function pack(ids) {
      var order = [], counts = {};
      ids.forEach(function (id) {
        if (counts[id] === undefined) { counts[id] = 0; order.push(id); }
        counts[id]++;
      });
      return order.map(function (id) {
        var c = cardsById ? cardsById[id] : null;
        return { id: Number(id), name: c ? c.name : null, count: counts[id] };
      });
    }
    return {
      name: deck.name || 'Untitled deck',
      main: pack(deck.main),
      extra: pack(deck.extra),
      side: pack(deck.side)
    };
  };

  /* Sniff the input type and dispatch. */
  MS.parseDeckText = function (text, filename) {
    var t = String(text).trim();
    if (!t) throw new Error('Nothing to read — the input is empty.');
    if (/^ydke:\/\//i.test(t)) return MS.parseYDKE(t);
    if (t.charAt(0) === '{' || t.charAt(0) === '[') return MS.parseDeckJSON(t);
    if (/^#(created|main)/im.test(t) || /^\s*\d{5,10}\s*$/m.test(t)) return MS.parseYDK(t);
    if (filename && /\.json$/i.test(filename)) return MS.parseDeckJSON(t);
    return MS.parseYDK(t);
  };

  /* ---------------------------------------------------------
     Card database

     Three sources, in order:
       1. window.MS_CARDS  — optional offline bundle (data/cards.js)
       2. IndexedDB cache  — anything looked up before
       3. YGOPRODeck API   — https://db.ygoprodeck.com/api/v7/

     Card data never changes once printed, so the cache is
     permanent. Alt-art passcodes are folded onto the base card,
     which matters because banlists and decklists frequently use
     different printings of the same card.
     --------------------------------------------------------- */

  var DB_NAME = 'millennium-scale', DB_VERSION = 1;
  var dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve) {
      if (!global.indexedDB) return resolve(null);
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('cards')) db.createObjectStore('cards', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('alias')) db.createObjectStore('alias', { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { resolve(null); };
    });
    return dbPromise;
  }

  function idbGetMany(store, keys) {
    return openDB().then(function (db) {
      if (!db || !keys.length) return {};
      return new Promise(function (resolve) {
        var out = {}, tx = db.transaction(store, 'readonly'), os = tx.objectStore(store), left = keys.length;
        keys.forEach(function (k) {
          var r = os.get(k);
          r.onsuccess = function () { if (r.result) out[k] = r.result; if (--left === 0) resolve(out); };
          r.onerror = function () { if (--left === 0) resolve(out); };
        });
        tx.onerror = function () { resolve(out); };
      });
    });
  }

  function idbPutMany(store, records) {
    return openDB().then(function (db) {
      if (!db || !records.length) return;
      return new Promise(function (resolve) {
        var tx = db.transaction(store, 'readwrite'), os = tx.objectStore(store);
        records.forEach(function (r) { try { os.put(r); } catch (e) {} });
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { resolve(); };
        tx.onabort = function () { resolve(); };
      });
    });
  }

  function compact(raw) {
    var alts = (raw.card_images || []).map(function (im) { return im.id; });
    var misc = (raw.misc_info && raw.misc_info[0]) || {};
    return {
      tcgDate: misc.tcg_date || null,
      ocgDate: misc.ocg_date || null,
      id: raw.id,
      name: raw.name,
      frame: raw.frameType || 'unknown',
      type: raw.type || '',
      race: raw.race || '',
      attribute: raw.attribute || '',
      level: raw.level != null ? raw.level : null,
      linkval: raw.linkval != null ? raw.linkval : null,
      linkmarkers: raw.linkmarkers || null,
      scale: raw.scale != null ? raw.scale : null,
      atk: raw.atk != null ? raw.atk : null,
      def: raw.def != null ? raw.def : null,
      desc: raw.desc || '',
      alts: alts
    };
  }

  var memCards = Object.create(null);   // baseId -> card
  var memAlias = Object.create(null);   // anyId  -> baseId
  var memMissing = Object.create(null); // ids the API doesn't know
  var bundleByName = null;

  function indexCard(card) {
    memCards[card.id] = card;
    memAlias[card.id] = card.id;
    (card.alts || []).forEach(function (a) { memAlias[a] = card.id; });
  }

  // Fold in the offline bundle, if one was shipped.
  if (global.MS_CARDS && Array.isArray(global.MS_CARDS.cards)) {
    global.MS_CARDS.cards.forEach(indexCard);
  }

  MS.cards = {
    /** Synchronous lookup. Returns a card or null. */
    get: function (id) {
      var base = memAlias[id];
      return base ? memCards[base] || null : null;
    },

    byName: function (name) {
      if (!bundleByName) {
        bundleByName = Object.create(null);
        Object.keys(memCards).forEach(function (k) {
          bundleByName[memCards[k].name.toLowerCase()] = memCards[k];
        });
      }
      return bundleByName[String(name).toLowerCase()] || null;
    },

    imageUrl: function (id) {
      return 'https://images.ygoprodeck.com/images/cards_small/' + id + '.jpg';
    },

    imageUrlLarge: function (id) {
      return 'https://images.ygoprodeck.com/images/cards/' + id + '.jpg';
    },

    /** Look up many ids, using cache first and the network only for the rest. */
    load: function (ids, onProgress) {
      var want = [];
      var seen = Object.create(null);
      ids.forEach(function (id) {
        id = Number(id);
        if (!id || seen[id] || memAlias[id] || memMissing[id]) return;
        seen[id] = 1; want.push(id);
      });
      if (!want.length) return Promise.resolve({ fetched: 0, missing: [] });

      return idbGetMany('alias', want).then(function (aliases) {
        var baseIds = [], stillWant = [];
        want.forEach(function (id) {
          if (aliases[id]) baseIds.push(aliases[id].base);
          else stillWant.push(id);
        });
        return idbGetMany('cards', baseIds.concat(stillWant)).then(function (hits) {
          Object.keys(hits).forEach(function (k) { indexCard(hits[k].card || hits[k]); });
          var remaining = want.filter(function (id) { return !memAlias[id]; });
          if (!remaining.length) return { fetched: 0, missing: [] };
          return fetchFromApi(remaining, onProgress);
        });
      });
    },

    /** Everything currently known, keyed by id (aliases included). */
    snapshot: function () {
      var out = Object.create(null);
      Object.keys(memAlias).forEach(function (id) { out[id] = memCards[memAlias[id]]; });
      return out;
    },

    clearCache: function () {
      return openDB().then(function (db) {
        if (!db) return;
        return new Promise(function (resolve) {
          var tx = db.transaction(['cards', 'alias'], 'readwrite');
          tx.objectStore('cards').clear();
          tx.objectStore('alias').clear();
          tx.oncomplete = resolve; tx.onerror = resolve;
        });
      });
    }
  };

  var API = 'https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes&id=';
  var networkDown = false;

  function fetchFromApi(ids, onProgress) {
    var chunks = [];
    for (var i = 0; i < ids.length; i += 90) chunks.push(ids.slice(i, i + 90));
    var fetched = 0, missing = [];
    var done = 0;

    networkDown = false;
    return chunks.reduce(function (p, chunk) {
      return p.then(function () {
        if (networkDown) { missing = missing.concat(chunk); return; }
        return fetchChunk(chunk).then(function (res) {
          fetched += res.fetched;
          missing = missing.concat(res.missing);
          done++;
          if (onProgress) onProgress(done / chunks.length);
        });
      });
    }, Promise.resolve()).then(function () {
      missing.forEach(function (id) { memMissing[id] = 1; });
      return { fetched: fetched, missing: missing };
    });
  }

  function fetchChunk(ids) {
    return fetch(API + ids.join(','))
      .then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.json();
      })
      .then(function (json) {
        var list = json && json.data ? json.data : [];
        var records = [], aliasRecs = [];
        list.forEach(function (raw) {
          var c = compact(raw);
          indexCard(c);
          records.push({ id: c.id, card: c });
          (c.alts || []).forEach(function (a) { aliasRecs.push({ id: a, base: c.id }); });
          aliasRecs.push({ id: c.id, base: c.id });
        });
        return Promise.all([idbPutMany('cards', records), idbPutMany('alias', aliasRecs)]).then(function () {
          var missing = ids.filter(function (id) { return !memAlias[id]; });
          return { fetched: list.length, missing: missing };
        });
      })
      .catch(function (err) {
        // The API rejects the whole batch if a single id is unknown, so
        // narrow down by halving rather than writing off the batch. But if
        // the network itself is gone, halving just fires N doomed requests.
        if (err instanceof TypeError) { networkDown = true; return { fetched: 0, missing: ids }; }
        if (ids.length === 1) return { fetched: 0, missing: ids };
        var mid = Math.ceil(ids.length / 2);
        return fetchChunk(ids.slice(0, mid)).then(function (a) {
          return fetchChunk(ids.slice(mid)).then(function (b) {
            return { fetched: a.fetched + b.fetched, missing: a.missing.concat(b.missing) };
          });
        });
      });
  }

  /* ---------------------------------------------------------
     Banlist store

     Bundled lists come from data/banlists.js (a plain script so
     that file:// works). Lists the user publishes locally are
     kept in localStorage and merged on top.
     --------------------------------------------------------- */

  MS.banlists = {
    all: function () {
      var bundled = ((global.MS_BANLISTS && global.MS_BANLISTS.formats) || [])
        .concat((global.MS_GENESYS && global.MS_GENESYS.formats) || []);
      var local = MS.prefs.get('customLists', []);
      var byKey = Object.create(null);
      var order = [];

      bundled.forEach(function (f) {
        byKey[f.key] = { key: f.key, name: f.name || f.key, source: f.source || '', lists: f.lists.slice() };
        order.push(f.key);
      });
      local.forEach(function (list) {
        var k = list.format || 'CUSTOM';
        if (!byKey[k]) { byKey[k] = { key: k, name: MS.rulesFor(k).name || k, source: 'local', lists: [] }; order.push(k); }
        var existing = byKey[k].lists.findIndex(function (l) { return l.id === list.id; });
        if (existing >= 0) byKey[k].lists[existing] = list;
        else byKey[k].lists.push(list);
      });

      order.forEach(function (k) {
        byKey[k].lists.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
      });
      return order.map(function (k) { return byKey[k]; });
    },

    format: function (key) {
      return MS.banlists.all().filter(function (f) { return f.key === key; })[0] || null;
    },

    get: function (formatKey, listId) {
      var f = MS.banlists.format(formatKey);
      if (!f) return null;
      if (!listId) return f.lists[0] || null;
      return f.lists.filter(function (l) { return l.id === listId; })[0] || f.lists[0] || null;
    },

    saveLocal: function (list) {
      var local = MS.prefs.get('customLists', []);
      var i = local.findIndex(function (l) { return l.id === list.id; });
      if (i >= 0) local[i] = list; else local.push(list);
      MS.prefs.set('customLists', local);
    },

    removeLocal: function (id) {
      MS.prefs.set('customLists', MS.prefs.get('customLists', []).filter(function (l) { return l.id !== id; }));
    },

    localOnly: function () { return MS.prefs.get('customLists', []); },

    isLocal: function (id) {
      return MS.prefs.get('customLists', []).some(function (l) { return l.id === id; });
    },

    /** id -> points, alt-art passcodes folded in where known. */
    pointsMap: function (list) {
      var map = Object.create(null);
      if (!list) return map;
      list.cards.forEach(function (c) {
        map[c.id] = c.points || 0;
        var known = MS.cards.get(c.id);
        if (known) (known.alts || []).concat([known.id]).forEach(function (a) { map[a] = c.points || 0; });
      });
      return map;
    },

    /** id -> status, alt-art passcodes folded in where known. */
    statusMap: function (list) {
      var map = Object.create(null);
      if (!list) return map;
      list.cards.forEach(function (c) {
        map[c.id] = c.status;
        var known = MS.cards.get(c.id);
        if (known) (known.alts || []).concat([known.id]).forEach(function (a) { map[a] = c.status; });
      });
      return map;
    }
  };

  /* ---------------------------------------------------------
     Comparing two lists

     A card absent from a list is Unlimited on it, so "came off
     the list" and "went to Unlimited" are the same event. Lower
     status numbers are stricter, so a falling number is a
     tightening.
     --------------------------------------------------------- */

  /** When a card first became legal, in the region that matters here. */
  MS.releaseDate = function (card, formatKey) {
    if (!card) return null;
    return formatKey === 'OCG' ? (card.ocgDate || card.tcgDate) : (card.tcgDate || card.ocgDate);
  };

  /** Did this card exist yet on the day the list took effect? */
  function existedOn(card, listDate, formatKey) {
    var rel = MS.releaseDate(card, formatKey);
    if (!rel || !listDate) return true;  // unknown release date — assume it existed
    return rel <= listDate;
  }

  /** A Genesys point list rather than a Forbidden & Limited one. */
  MS.isPointsList = function (list) {
    return !!(list && list.cards.length && list.cards[0].points !== undefined);
  };

  function kindOfChange(was, now, rest) {
    if (was === rest) return 'added';
    if (now === rest) return 'removed';
    return now < was ? 'tightened' : 'loosened';
  }

  /**
   * Point lists diff the same way, with 0 as the resting value: a card that
   * gains points is "added", one that drops to 0 is "removed", and a rising
   * cost is a tightening.
   */
  function diffPoints(from, to) {
    var a = Object.create(null), b = Object.create(null), ids = Object.create(null), names = Object.create(null);
    (from ? from.cards : []).forEach(function (c) { a[c.id] = c.points || 0; ids[c.id] = 1; names[c.id] = c.name; });
    (to ? to.cards : []).forEach(function (c) { b[c.id] = c.points || 0; ids[c.id] = 1; names[c.id] = c.name || names[c.id]; });

    var out = { from: from, to: to, points: true, added: [], removed: [], tightened: [], loosened: [], unchanged: 0, all: [] };
    Object.keys(ids).forEach(function (id) {
      var was = a[id] || 0, now = b[id] || 0;
      if (was === now) { out.unchanged++; return; }
      var card = MS.cards.get(id);
      var kind = was === 0 ? 'added' : now === 0 ? 'removed' : (now > was ? 'tightened' : 'loosened');
      var entry = {
        id: Number(id), name: card ? card.name : (names[id] || MS.passcode(id)),
        card: card, was: was, now: now, points: true, kind: kind,
        wasUnreleased: false, nowUnreleased: false,
        direction: now > was ? 'tighter' : 'looser'
      };
      out.all.push(entry);
      out[kind].push(entry);
    });
    out.all.sort(function (x, y) { return x.name.localeCompare(y.name); });
    return out;
  }

  MS.diffLists = function (from, to, opts) {
    if (MS.isPointsList(from) && MS.isPointsList(to)) return diffPoints(from, to);
    opts = opts || {};
    var fmt = opts.formatKey;
    var a = Object.create(null), b = Object.create(null), ids = Object.create(null);
    (from ? from.cards : []).forEach(function (c) { a[c.id] = c; ids[c.id] = 1; });
    (to ? to.cards : []).forEach(function (c) { b[c.id] = c; ids[c.id] = 1; });

    var out = { from: from, to: to, added: [], removed: [], tightened: [], loosened: [], unchanged: 0, all: [] };

    Object.keys(ids).forEach(function (id) {
      var was = a[id] ? a[id].status : 3;
      var now = b[id] ? b[id].status : 3;
      var card = MS.cards.get(id);
      var entry = {
        id: Number(id),
        name: card ? card.name : ((b[id] && b[id].name) || (a[id] && a[id].name) || MS.passcode(id)),
        card: card, was: was, now: now,
        // Absent from a list means Unlimited — unless the card hadn't been
        // printed yet, which is a different thing entirely.
        wasUnreleased: was === 3 && !existedOn(card, from && from.date, fmt),
        nowUnreleased: now === 3 && !existedOn(card, to && to.date, fmt),
        direction: now === was ? 'same' : (now < was ? 'tighter' : 'looser'),
        kind: kindOfChange(was, now, 3)
      };
      if (was === now) { out.unchanged++; return; }
      out.all.push(entry);
      if (was === 3) out.added.push(entry);
      else if (now === 3) out.removed.push(entry);
      else if (now < was) out.tightened.push(entry);
      else out.loosened.push(entry);
    });

    out.all.sort(function (x, y) { return x.name.localeCompare(y.name); });
    return out;
  };

  /** Short column label: "Unrel" when the card didn't exist yet. */
  MS.statusShort = function (status, unreleased) {
    if (unreleased) return 'Unrel';
    return ['Forb', 'Lim 1', 'Semi 2', 'Unlim'][status];
  };

  MS.statusLong = function (status, unreleased) {
    return unreleased ? 'Unreleased' : MS.STATUS_LABEL[status];
  };

  MS.changeLabel = function (e) {
    if (e.points) {
      if (e.was === 0) return 'Newly ' + e.now + ' points';
      if (e.now === 0) return 'Back to 0 (was ' + e.was + ')';
      return e.was + ' \u2192 ' + e.now + ' points';
    }
    if (e.wasUnreleased) return 'New card, ' + MS.STATUS_LABEL[e.now] + ' on release';
    if (e.was === 3) return 'Newly ' + MS.STATUS_LABEL[e.now];
    if (e.now === 3) return 'Off the list (was ' + MS.STATUS_LABEL[e.was] + ')';
    return MS.STATUS_LABEL[e.was] + ' \u2192 ' + MS.STATUS_LABEL[e.now];
  };

  /* ---------------------------------------------------------
     Hover art preview
     --------------------------------------------------------- */

  var hoverBox = null;
  MS.artHover = {
    enabled: function () { return MS.prefs.get('hoverArt', true); },
    set: function (v) { MS.prefs.set('hoverArt', !!v); if (!v) MS.artHover.hide(); },

    attach: function (node, id) {
      node.addEventListener('mouseenter', function () { MS.artHover.show(id, node); });
      node.addEventListener('mousemove', function (e) { MS.artHover.move(e); });
      node.addEventListener('mouseleave', MS.artHover.hide);
      node.addEventListener('focus', function () { MS.artHover.show(id, node); });
      node.addEventListener('blur', MS.artHover.hide);
    },

    show: function (id, node) {
      if (!MS.artHover.enabled()) return;
      if (!hoverBox) {
        hoverBox = MS.el('div', { class: 'art-hover', 'aria-hidden': 'true' }, [MS.el('img', { alt: '' })]);
        document.body.appendChild(hoverBox);
      }
      var img = hoverBox.firstChild;
      var src = MS.cards.imageUrl(id);
      if (img.getAttribute('src') !== src) {
        img.classList.remove('ready');
        img.onload = function () { img.classList.add('ready'); };
        img.onerror = function () { MS.artHover.hide(); };
        img.setAttribute('src', src);
      }
      hoverBox.classList.add('on');
      if (node) {
        var r = node.getBoundingClientRect();
        place(r.right + 14, r.top);
      }
    },

    move: function (e) { if (hoverBox && hoverBox.classList.contains('on')) place(e.clientX + 20, e.clientY - 40); },

    hide: function () { if (hoverBox) hoverBox.classList.remove('on'); }
  };

  function place(x, y) {
    var w = 172, h = 251, pad = 12;
    if (x + w + pad > innerWidth) x = innerWidth - w - pad;
    if (y + h + pad > innerHeight) y = innerHeight - h - pad;
    if (y < pad) y = pad;
    hoverBox.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
  }

  /* ---------------------------------------------------------
     Validation
     --------------------------------------------------------- */

  MS.allowedCopies = function (status, mode, rules) {
    var cap = rules ? rules.maxCopies : 3;
    if (status === 0) return mode === 'traditional' ? 1 : 0;
    if (status === 1) return 1;
    if (status === 2) return 2;
    return cap;
  };

  /**
   * @param deck  {main, extra, side} arrays of passcodes
   * @param list  a banlist record
   * @param opts  {formatKey, mode: 'advanced'|'traditional'}
   */
  MS.validate = function (deck, list, opts) {
    opts = opts || {};
    var rules = MS.rulesFor(opts.formatKey);
    var mode = rules.hasTraditional && opts.mode === 'traditional' ? 'traditional' : 'advanced';
    var pointsMode = !!rules.points;
    // A point list has no statuses: every card sits at 3 and costs points instead.
    var statuses = pointsMode ? Object.create(null) : MS.banlists.statusMap(list);
    var pointsOf = pointsMode ? MS.banlists.pointsMap(list) : null;
    var whitelist = !pointsMode && !!(list && list.whitelist);

    var sections = ['main', 'extra', 'side'];
    var entries = Object.create(null);  // baseKey -> {key, name, ids, counts, card}
    var problems = [];
    var unknown = [];

    sections.forEach(function (sec) {
      (deck[sec] || []).forEach(function (id) {
        var card = MS.cards.get(id);
        var key = card ? String(card.id) : 'id:' + id;
        if (!entries[key]) {
          entries[key] = {
            key: key, card: card, id: card ? card.id : id,
            displayId: id,
            name: card ? card.name : ('Unknown card ' + MS.passcode(id)),
            total: 0, bySection: { main: 0, extra: 0, side: 0 },
            status: 3
          };
          if (!card) unknown.push(id);
          if (pointsMode) {
            var pts = pointsOf[id];
            if (pts === undefined && card) pts = pointsOf[card.id];
            entries[key].points = pts || 0;
          }
        }
        var e = entries[key];
        e.total++;
        e.bySection[sec]++;
        var st = statuses[id];
        if (st === undefined && card) st = statuses[card.id];
        if (st !== undefined) e.status = st;
        else if (whitelist) e.status = 0;
      });
    });

    var list2 = Object.keys(entries).map(function (k) { return entries[k]; });

    list2.forEach(function (e) {
      e.allowed = MS.allowedCopies(e.status, mode, rules);
      e.over = e.total - e.allowed;
      e.illegal = e.over > 0;
      if (e.illegal) {
        problems.push({
          kind: 'copies',
          card: e,
          text: e.name,
          why: e.allowed === 0
            ? 'Forbidden — remove all ' + e.total + '.'
            : (pointsMode ? 'Three copies at most' : MS.STATUS_LABEL[e.status]) + ' — ' + e.total + ' in deck, ' + e.allowed + ' allowed. Remove ' + e.over + '.'
        });
      }
      if (pointsMode) {
        e.blocked = MS.genesysBlocked(e.card);
        if (e.blocked) {
          e.illegal = true;
          problems.push({ kind: 'blocked', card: e, text: e.name, why: e.blocked + ' — remove all ' + e.total + '.' });
        }
      }
    });

    // Genesys: every copy in Main, Extra and Side counts toward the cap.
    var pointTotal = 0, pointCap = null;
    if (pointsMode) {
      list2.forEach(function (e) { pointTotal += e.points * e.total; });
      pointCap = opts.cap != null ? opts.cap : (list && list.cap != null ? list.cap : rules.pointCap);
    }

    // Deck construction
    var sizes = { main: (deck.main || []).length, extra: (deck.extra || []).length, side: (deck.side || []).length };
    var sizeProblems = [];
    if (sizes.main < rules.mainMin) sizeProblems.push({ kind: 'size', text: 'Main Deck', why: sizes.main + ' cards — the minimum is ' + rules.mainMin + '.' });
    if (sizes.main > rules.mainMax) sizeProblems.push({ kind: 'size', text: 'Main Deck', why: sizes.main + ' cards — the maximum is ' + rules.mainMax + '.' });
    if (sizes.extra > rules.extraMax) sizeProblems.push({ kind: 'size', text: 'Extra Deck', why: sizes.extra + ' cards — the maximum is ' + rules.extraMax + '.' });
    if (sizes.side > rules.sideMax) {
      sizeProblems.push({
        kind: 'size', text: 'Side Deck',
        why: rules.sideMax === 0
          ? rules.name + ' has no Side Deck. Move these ' + sizes.side + ' cards or drop them.'
          : sizes.side + ' cards — the maximum is ' + rules.sideMax + '.'
      });
    }

    if (pointsMode && pointTotal > pointCap) {
      sizeProblems.push({
        kind: 'points', text: 'Point total',
        why: pointTotal + ' points \u2014 the cap is ' + pointCap + '. Cut ' + (pointTotal - pointCap) + '.'
      });
    }

    // Cards sitting in the wrong pile
    var misplaced = [];
    (deck.main || []).forEach(function (id) {
      var c = MS.cards.get(id);
      if (c && MS.isExtraDeckFrame(c.frame)) misplaced.push({ id: id, name: c.name, want: 'Extra Deck', have: 'Main Deck' });
    });
    (deck.extra || []).forEach(function (id) {
      var c = MS.cards.get(id);
      if (c && !MS.isExtraDeckFrame(c.frame)) misplaced.push({ id: id, name: c.name, want: 'Main Deck', have: 'Extra Deck' });
    });
    var seenMis = Object.create(null);
    misplaced = misplaced.filter(function (m) { if (seenMis[m.id]) return false; seenMis[m.id] = 1; return true; });
    misplaced.forEach(function (m) {
      sizeProblems.push({ kind: 'placement', text: m.name, why: 'Sitting in the ' + m.have + '. It belongs in the ' + m.want + '.' });
    });

    var byStatus = { 0: 0, 1: 0, 2: 0, 3: 0 };
    list2.forEach(function (e) { byStatus[e.status] += e.total; });

    return {
      mode: mode,
      rules: rules,
      list: list,
      entries: list2,
      byId: entries,
      problems: problems.concat(sizeProblems),
      copyProblems: problems,
      sizeProblems: sizeProblems,
      unknown: unknown,
      sizes: sizes,
      byStatus: byStatus,
      points: pointsMode ? { total: pointTotal, cap: pointCap, over: Math.max(0, pointTotal - pointCap) } : null,
      legal: problems.length === 0 && sizeProblems.length === 0,
      statusOf: function (id) {
        var c = MS.cards.get(id);
        var k = c ? String(c.id) : 'id:' + id;
        return entries[k] || null;
      }
    };
  };

  /* ---------------------------------------------------------
     Rendering: the typographic card tile
     --------------------------------------------------------- */

  MS.levelLine = function (card) {
    if (!card) return '';
    if (card.frame === 'link') return 'LINK-' + (card.linkval || '?');
    if (card.frame && card.frame.indexOf('xyz') === 0) return 'RANK ' + MS.pretty(card.level);
    if (card.level != null) return 'LV ' + card.level;
    return '';
  };

  MS.typeLine = function (card) {
    if (!card) return 'Unknown';
    if (card.frame === 'spell') return 'Spell · ' + (card.race || '');
    if (card.frame === 'trap')  return 'Trap · ' + (card.race || '');
    var bits = [];
    if (card.attribute) bits.push(card.attribute);
    if (card.race) bits.push(card.race);
    return bits.join(' · ') || (card.type || 'Monster');
  };

  MS.pipString = function (card) {
    if (!card || card.level == null || card.frame === 'link') return '';
    var n = Math.min(12, card.level);
    return new Array(n + 1).join('◆');
  };

  /**
   * Build one card tile.
   * @param entry  a validation entry, or {card, total, status, illegal}
   */
  MS.renderTile = function (entry, opts) {
    opts = opts || {};
    var card = entry.card;
    var frame = card ? card.frame : null;
    var tile = MS.el('button', {
      class: 'tile' + (entry.illegal ? ' illegal' : ''),
      type: 'button',
      'data-status': String(entry.status),
      'data-id': String(entry.displayId != null ? entry.displayId : entry.id),
      style: '--frame:' + MS.frameColorVar(frame),
      title: entry.name
    });

    var img = MS.el('img', {
      class: 'art', loading: 'lazy', alt: '',
      src: MS.cards.imageUrl(entry.displayId != null ? entry.displayId : entry.id)
    });
    img.addEventListener('error', function () { img.style.visibility = 'hidden'; });
    tile.appendChild(img);

    tile.appendChild(MS.el('div', { class: 'tname', text: entry.name }));
    tile.appendChild(MS.el('div', { class: 'tmeta', text: MS.typeLine(card) }));

    var stats = MS.el('div', { class: 'tstats' });
    if (card && (card.frame === 'spell' || card.frame === 'trap')) {
      stats.appendChild(MS.el('span', { text: (card.type || '').replace(' Card', '') }));
      stats.appendChild(MS.el('span', { text: '' }));
    } else if (card) {
      var lvl = MS.el('span', { class: 'pips', text: MS.pipString(card) || MS.levelLine(card) });
      stats.appendChild(lvl);
      stats.appendChild(MS.el('span', {
        text: (card.atk != null ? card.atk : '?') + ' / ' + (card.frame === 'link' ? '—' : (card.def != null ? card.def : '?'))
      }));
    } else {
      stats.appendChild(MS.el('span', { text: MS.passcode(entry.displayId != null ? entry.displayId : entry.id) }));
    }
    tile.appendChild(stats);

    var shown = entry.count != null ? entry.count : entry.total;
    if (shown > 1 || opts.alwaysShowQty) {
      tile.appendChild(MS.el('span', { class: 'qty', text: '\u00d7' + shown }));
    }
    if (entry.blocked) {
      tile.appendChild(MS.el('span', { class: 'verdict-chip blocked', text: 'Not allowed' }));
    } else if (entry.points) {
      tile.appendChild(MS.el('span', { class: 'verdict-chip pts', text: entry.points + ' pts' }));
    } else if (entry.status !== 3) {
      tile.appendChild(MS.el('span', {
        class: 'verdict-chip',
        text: entry.status === 0 ? 'Forbidden' : entry.status === 1 ? 'Limited 1' : 'Semi 2'
      }));
    }
    tile.addEventListener('click', function () { MS.showCard(entry); });
    return tile;
  };

  /* ---------------------------------------------------------
     Card detail dialog
     --------------------------------------------------------- */

  MS.showCard = function (entry) {
    var card = entry.card;
    var dlg = MS.$('#card-sheet');
    if (!dlg) {
      dlg = MS.el('dialog', { class: 'sheet', id: 'card-sheet' });
      document.body.appendChild(dlg);
    }
    dlg.innerHTML = '';
    dlg.style.setProperty('--frame', MS.frameColorVar(card ? card.frame : null));

    var head = MS.el('div', { class: 'sheet-head' }, [
      MS.el('h3', { text: entry.name }),
      MS.el('div', { class: 'sub', text: MS.typeLine(card) })
    ]);
    head.style.setProperty('--frame', MS.frameColorVar(card ? card.frame : null));
    dlg.appendChild(head);

    var kv = MS.el('dl', { class: 'kv' });
    function row(k, v) {
      if (v === null || v === undefined || v === '') return;
      kv.appendChild(MS.el('dt', { text: k }));
      kv.appendChild(MS.el('dd', { text: String(v) }));
    }
    row('Passcode', MS.passcode(entry.displayId != null ? entry.displayId : entry.id));
    if (card) {
      row('Card type', card.type);
      if (card.frame !== 'spell' && card.frame !== 'trap') {
        row('Attribute', card.attribute);
        row('Type', card.race);
        var lvlLabel = card.frame === 'link' ? 'Link rating' : (card.frame.indexOf('xyz') === 0 ? 'Rank' : 'Level');
        row(lvlLabel, card.frame === 'link' ? card.linkval : card.level);
        if (card.linkmarkers) row('Markers', card.linkmarkers.join(', '));
        if (card.scale != null) row('Pendulum scale', card.scale);
        row('ATK', card.atk);
        if (card.frame !== 'link') row('DEF', card.def);
      } else {
        row('Property', card.race);
      }
    }
    if (entry.total) row('In deck', entry.total + (entry.allowed != null ? ' of ' + entry.allowed + ' allowed' : ''));

    var shownId = entry.displayId != null ? entry.displayId : entry.id;

    var detail = MS.el('div', { class: 'sheet-detail' }, [
      MS.el('div', {}, [
        entry.points != null
          ? MS.el('span', { class: 'pill', 'data-status': 'points', text: entry.points + ' point' + (entry.points === 1 ? '' : 's') })
          : MS.el('span', { class: 'pill', 'data-status': String(entry.status), text: MS.STATUS_LABEL[entry.status] })
      ]),
      kv
    ]);

    var body = MS.el('div', { class: 'sheet-body has-art' });

    // The art is decoration around the facts, so if it fails to load the
    // layout collapses back to a single column rather than leaving a hole.
    var art = MS.el('img', {
      class: 'sheet-art', alt: card ? card.name : '', loading: 'lazy',
      src: MS.cards.imageUrlLarge(shownId)
    });
    art.addEventListener('load', function () { art.classList.add('ready'); });
    art.addEventListener('error', function () {
      art.remove();
      body.classList.remove('has-art');
    });
    body.appendChild(art);
    body.appendChild(detail);

    if (card && card.desc) body.appendChild(MS.el('div', { class: 'oracle', text: card.desc }));
    dlg.appendChild(body);

    dlg.appendChild(MS.el('div', { class: 'sheet-foot' }, [
      MS.el('button', { class: 'btn', type: 'button', text: 'Close', onclick: function () { dlg.close(); } })
    ]));

    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
    if (typeof dlg.showModal === 'function') dlg.showModal();
  };

  /* ---------------------------------------------------------
     Page boot: theme toggle + nav highlight
     --------------------------------------------------------- */

  MS.boot = function () {
    var toggle = MS.$('.theme-toggle');
    if (toggle) toggle.addEventListener('click', MS.theme.toggle);
    MS.theme.set(MS.theme.get());

    // Keep every open tab on the same theme.
    if (typeof global.addEventListener === 'function') global.addEventListener('storage', function (e) {
      if (e.key !== 'ms.theme' || !e.newValue) return;
      var t; try { t = JSON.parse(e.newValue); } catch (err) { t = e.newValue; }
      if ((t === 'dark' || t === 'light') && t !== MS.theme.get()) {
        document.documentElement.setAttribute('data-theme', t);
      }
    });

    var here = location.pathname.split('/').pop() || 'index.html';
    MS.$$('.nav a').forEach(function (a) {
      var target = a.getAttribute('href').split('/').pop();
      if (target === here) a.setAttribute('aria-current', 'page');
    });

    var y = MS.$('#year');
    if (y) y.textContent = new Date().getFullYear();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', MS.boot);
  else MS.boot();

})(window);
