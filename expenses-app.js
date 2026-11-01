/* MISMO Service Orders and Agreements — Expenses on a phone, and the receipt reader.
 *
 * Two jobs, both kept out of index.html so the portal itself is not reworked:
 *
 * 1. THE RECEIPT READER, everywhere. When a picture of a receipt is attached to
 *    an expense, this reads it and fills in what it can — amount, what the
 *    receipt says, date, category, description. It follows the rule written on
 *    applyReceiptRead in index.html: WHAT SOMEBODY TYPED IS NEVER OVERWRITTEN.
 *    It fills only empty fields (and the untouched "today" date on a brand-new
 *    expense), rings what it filled, and says so, so it is checked before it is
 *    kept. Reading uses the relay's ask route when the company's key has it
 *    switched on, and reads the picture on the phone itself when it does not.
 *
 * 2. THE EXPENSES APP. Opened as ?app=expenses, or from the home-screen icon,
 *    the portal shows only the person's own My Expenses, with Snap a Receipt
 *    and Add by Hand along the bottom. Same sign-in, same data, same rules —
 *    nothing is saved any differently. It is a narrower door into the same room.
 *
 * ⚠ This file is served from a PUBLIC repository. No names, no keys.
 */
(function (root) {
  'use strict';

  /* =======================================================================
   * Reading receipt text — plain functions, no page needed (tested on their own)
   * ===================================================================== */
  var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function printDate(d) { return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + '/' + String(d.getFullYear()).slice(-2); }

  /* A receipt date is believable only if it is not in the future (a day of
     grace for time zones) and not older than about eighteen months. Anything
     else is far more likely a misread than a real date. */
  function sane(y, m, d, now) {
    if (y < 100) y += 2000;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    var dt = new Date(y, m - 1, d);
    if (dt.getMonth() !== m - 1) return null;
    var t = now || new Date();
    if (dt.getTime() > t.getTime() + 36 * 3600e3) return null;
    if (dt.getTime() < t.getTime() - 550 * 86400e3) return null;
    return dt;
  }

  function findDate(text, now) {
    var t = String(text || ''), m, re, hit;
    var tries = [];
    re = /\b(20\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/g;
    while ((m = re.exec(t))) tries.push({ i: m.index, y: +m[1], m: +m[2], d: +m[3] });
    re = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4}|\d{2})(?!\d)/g;
    while ((m = re.exec(t))) {
      var a = +m[1], b = +m[2], y = +m[3];
      if (a > 12 && b <= 12) tries.push({ i: m.index, y: y, m: b, d: a });
      else tries.push({ i: m.index, y: y, m: a, d: b });
    }
    re = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+'?(\d{4}|\d{2})\b/gi;
    while ((m = re.exec(t))) tries.push({ i: m.index, y: +m[3], m: MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, d: +m[2] });
    re = /\b(\d{1,2})[\s\-]+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?[\s\-,]+'?(\d{4}|\d{2})\b/gi;
    while ((m = re.exec(t))) tries.push({ i: m.index, y: +m[3], m: MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, d: +m[1] });
    tries.sort(function (p, q) { return p.i - q.i; });
    for (var k = 0; k < tries.length; k++) {
      hit = sane(tries[k].y, tries[k].m, tries[k].d, now);
      if (hit) return printDate(hit);
    }
    return '';
  }

  /* Minutes past midnight of the first believable time on the receipt. */
  function findTime(text) {
    var re = /\b([01]?\d|2[0-3])[:.]([0-5]\d)(?:[:.][0-5]\d)?\s*([ap])?\.?\s*m?\b/gi, m;
    while ((m = re.exec(String(text || '')))) {
      var h = +m[1], mi = +m[2], ap = (m[3] || '').toLowerCase();
      /* "4.50" is a price, not a time: a dot only counts with am/pm after it */
      if (m[0].indexOf(':') < 0 && !ap) continue;
      if (ap === 'p' && h < 12) h += 12;
      if (ap === 'a' && h === 12) h = 0;
      if (h > 23) continue;
      return h * 60 + mi;
    }
    return null;
  }

  var MONEY = /(?:\$|usd)?\s*(-?\d{1,3}(?:[,\s]\d{3})*|-?\d+)\s?[.,]\s?(\d{2})(?!\d)/gi;
  function moneyIn(line) {
    var out = [], m;
    MONEY.lastIndex = 0;
    while ((m = MONEY.exec(line))) {
      var v = Number(String(m[1]).replace(/[,\s]/g, '') + '.' + m[2]);
      if (isFinite(v) && v > 0 && v < 20000) out.push(v);
    }
    return out;
  }

  /* The total paid. The line that names it wins over the biggest number,
     because a hotel folio or a card slip carries several. */
  function findTotal(text) {
    var lines = String(text || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    var best = null;
    lines.forEach(function (ln, i) {
      var low = ln.toLowerCase();
      if (/sub\s*-?\s*total|total\s+(tax|savings|discount|items?|qty)|tax\s+total|\btip\s+(guide|suggest)|suggested|\d{1,2}\s*%/.test(low)) return;
      var score = 0;
      if (/grand\s*total|total\s*(due|paid|charged|amount|sale)|amount\s*(due|paid|charged)|balance\s*due|you\s*paid|total\s*\(?usd/.test(low)) score = 6;
      else if (/\btotal\b|\btotal:/.test(low)) score = 5;
      else if (/\bamount\b|\bbalance\b|\bcharged?\b|\bpaid\b/.test(low)) score = 3;
      else if (/\b(visa|mastercard|master card|amex|american express|discover|debit|credit|card)\b/.test(low)) score = 2;
      if (!score) return;
      var vals = moneyIn(ln);
      if (!vals.length && lines[i + 1]) vals = moneyIn(lines[i + 1]);
      if (!vals.length) return;
      var v = vals[vals.length - 1];
      /* later lines win a tie: a total after a tip line is the one paid */
      if (!best || score > best.score || (score === best.score && i >= best.i && v >= best.v * 0.5)) best = { score: score, v: v, i: i };
    });
    if (best) return best.v;
    var all = [];
    lines.forEach(function (ln) { all = all.concat(moneyIn(ln)); });
    if (!all.length) return '';
    return Math.max.apply(null, all);
  }

  var JUNK = /receipt|welcome|thank|invoice|order\s*#|store\s*#|tel\b|phone|www\.|\.com|http|cashier|server:|table|check\s*#|guest|^\W*$|merchant\s*(id|copy)|customer\s*copy|transaction|terminal/i;
  function titleCase(s) {
    return s.toLowerCase().replace(/(^|[\s\-'&\/])([a-z])/g, function (_, a, b) { return a + b.toUpperCase(); });
  }
  function findMerchant(text) {
    var lines = String(text || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    for (var i = 0; i < Math.min(lines.length, 8); i++) {
      var ln = lines[i].replace(/[^A-Za-z0-9&'.+\- ]+/g, ' ').replace(/\s+/g, ' ').trim();
      var letters = (ln.match(/[A-Za-z]/g) || []).length;
      if (letters < 3 || letters < ln.length * 0.5) continue;
      if (JUNK.test(ln)) continue;
      if (/^\d/.test(ln)) continue; // a street address
      if (/\b(st|street|ave|avenue|rd|road|blvd|suite|ste|dr|drive|hwy)\b\.?$/i.test(ln)) continue;
      if (ln.length > 40) ln = ln.slice(0, 40).replace(/\s+\S*$/, '');
      return ln === ln.toUpperCase() ? titleCase(ln) : ln;
    }
    return '';
  }

  /* Which category. Brand names count for more than ordinary words, and a
     tie means nothing is filled — an empty box is better than a wrong one. */
  var CATS = [
    { k: 'Baggage Fees', strong: /bag(gage)?\s*fee|checked\s*bag|excess\s*baggage/, weak: /baggage/ },
    { k: 'Airfare', strong: /airlines?|airways|delta air|jetblue|southwest|alaska air|spirit air|frontier air|e-?ticket|boarding pass/, weak: /flight|itinerary|fare\b|passenger|seat\s/ },
    { k: 'Hotel/Lodging', strong: /hotel|marriott|hilton|hyatt|sheraton|westin|intercontinental|holiday inn|hampton inn|courtyard|embassy suites|doubletree|ritz|kimpton|omni |four seasons|folio|room\s*(rate|charge)/, weak: /\binn\b|suites|resort|lodging|check-?out|arrival|departure|nights?\b/ },
    { k: 'Taxi/Uber/Lyft', strong: /\buber\b|\blyft\b|taxi|yellow cab|\bcab\b|rideshare/, weak: /trip fare|driver|pickup|drop-?off/ },
    { k: 'Parking', strong: /parking|spothero|parkwhiz|laz parking|sp\+|valet/, weak: /garage|\blot\b|entry|exit time/ },
    { k: 'Gasoline', strong: /gallons?|unleaded|diesel|\bfuel\b|exxon|chevron|\bshell\b|mobil|sunoco|citgo|wawa|sheetz|marathon|valero|\bbp\b|speedway/, weak: /\bpump\b|\bgal\b|price\/gal|regular|premium/ },
    { k: 'Train', strong: /amtrak|acela|northeast regional|\bvre\b|\bmarc\b|metro-?north|\bnjt\b|nj transit/, weak: /\btrain\b|\brail\b|coach class/ },
    { k: 'Metro / Bus', strong: /wmata|smartrip|\bmta\b|\bbart\b|marta|septa|\bcta\b|greyhound|megabus|metrocard|omny/, weak: /\bmetro\b|\bbus\b|transit|subway fare/ },
    { k: 'Tolls', strong: /\btolls?\b|e-?zpass|sunpass|fastrak|i-?pass|peach pass/, weak: /toll road|plaza/ },
    { k: 'Membership Dues', strong: /membership|annual dues|\bdues\b/, weak: /renewal|annual fee/ },
    { k: 'MEAL', strong: /restaurant|cafe|café|coffee|starbucks|dunkin|panera|chipotle|mcdonald|subway|grill|bistro|diner|kitchen|tavern|brasserie|pizzeria|pizza|burger|steakhouse|sushi|taqueria|bakery|deli\b|gratuity|\btip\b|server|food|beverage|entree|appetizer|latte|espresso|sandwich|salad|breakfast|lunch|dinner/, weak: /\bbar\b|\bpub\b|guests?|table|\bcheck\b|dine|meal/ }
  ];

  function mealFor(mins, total) {
    if (mins == null) return '';
    if (mins >= 300 && mins < 645) return 'Meal Trvl - Breakfast';    // 5:00–10:45
    if (mins >= 645 && mins < 930) return 'Meal Trvl - Lunch';        // 10:45–3:30
    if (mins >= 1020 || mins < 120) return 'Meal Trvl - Dinner';      // 5pm–2am
    return total !== '' && total < 12 ? 'Meal Trvl - Snack' : '';     // mid-afternoon: only a small one is surely a snack
  }

  function pickCat(text, options) {
    var low = String(text || '').toLowerCase();
    var scored = CATS.map(function (c) {
      var s = 0, m;
      var rs = new RegExp(c.strong.source, 'g'), rw = new RegExp(c.weak.source, 'g');
      while ((m = rs.exec(low))) s += 3;
      while ((m = rw.exec(low))) s += 1;
      return { k: c.k, s: s };
    }).sort(function (a, b) { return b.s - a.s; });
    if (!scored[0].s || (scored[1] && scored[1].s === scored[0].s)) return '';
    if (scored[0].s < 2) return '';
    return scored[0].k;
  }

  function matchOption(name, options) {
    if (!name) return '';
    var n = String(name).toLowerCase().replace(/\s+/g, ' ').trim();
    var opts = options || [];
    for (var i = 0; i < opts.length; i++) if (opts[i].toLowerCase() === n) return opts[i];
    for (i = 0; i < opts.length; i++) if (opts[i].toLowerCase().replace(/[^a-z]/g, '') === n.replace(/[^a-z]/g, '')) return opts[i];
    return '';
  }

  /* Everything at once, from the text a picture was turned into. */
  function readText(text, options, now) {
    var total = findTotal(text);
    var mins = findTime(text);
    var merchant = findMerchant(text);
    var cat = pickCat(text, options);
    var meal = '';
    if (cat === 'MEAL') { meal = mealFor(mins, total); cat = meal; }
    cat = matchOption(cat, options);
    var desc = merchant;
    if (merchant && cat && /^Meal Trvl - /.test(cat) && !/snack/i.test(cat)) {
      desc = cat.replace('Meal Trvl - ', '') + ' at ' + merchant;
    }
    return {
      amt: total === '' ? '' : Number(total).toFixed(2),
      date: findDate(text, now),
      cat: cat,
      desc: desc,
      by: 'the phone'
    };
  }

  /* What the relay's ask route sends back — JSON, ideally, but read loosely. */
  function readAnswer(txt, options, now) {
    var s = String(txt || ''), j = null;
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) { try { j = JSON.parse(s.slice(a, b + 1)); } catch (e) { j = null; } }
    if (!j) return null;
    var amt = Number(String(j.amount == null ? '' : j.amount).replace(/[^0-9.\-]/g, ''));
    var date = j.date ? findDate(String(j.date), now) : '';
    var cat = matchOption(j.category, options);
    var desc = String(j.description || j.merchant || '').trim().slice(0, 80);
    return {
      amt: isFinite(amt) && amt > 0 ? amt.toFixed(2) : '',
      date: date, cat: cat, desc: desc, by: 'the receipt reader'
    };
  }

  var API = { readText: readText, readAnswer: readAnswer, findDate: findDate, findTotal: findTotal,
              findTime: findTime, findMerchant: findMerchant, pickCat: pickCat };
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; }
  if (typeof document === 'undefined') return;

  /* =======================================================================
   * The page side
   * ===================================================================== */
  if (root.__soxp && root.__soxp.on) return;
  var NS = 'resources:service-orders:';
  function sget(k) { try { return sessionStorage.getItem(NS + k); } catch (e) { return null; } }
  function sput(k, v) { try { sessionStorage.setItem(NS + k, v); } catch (e) {} }
  function sdrop(k) { try { sessionStorage.removeItem(NS + k); } catch (e) {} }
  function lget(k) { try { return localStorage.getItem(NS + k); } catch (e) { return null; } }
  function lput(k, v) { try { localStorage.setItem(NS + k, v); } catch (e) {} }

  var qs = new URLSearchParams(location.search);
  var standalone = (root.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  if (qs.get('app') === 'expenses') sdrop('xp.full');
  var APP = qs.get('app') === 'expenses' || (standalone && sget('xp.full') !== '1');
  var isiOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var html = document.documentElement;
  if (APP) html.classList.add('soxp');

  var TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

  /* ---------------------------------------------------------------- style */
  var css = document.createElement('style');
  css.id = 'soxp-css';
  css.textContent = [
    /* the reader, everywhere */
    '.soxp-read{display:flex;gap:10px;align-items:flex-start;margin:0 0 14px;padding:11px 13px;border:1px solid var(--border);border-left:3px solid var(--sky);border-radius:8px;background:var(--sky-wash);color:var(--ink);font-size:13.5px;line-height:1.45}',
    '.soxp-read b{font-weight:700}',
    '.soxp-read.bad{border-left-color:var(--warn)}',
    '.soxp-read .sp{flex:0 0 16px;width:16px;height:16px;margin-top:2px;border-radius:50%;border:2px solid var(--sky-soft);border-top-color:var(--navy);animation:soxpSpin .8s linear infinite}',
    '.soxp-read .ok{flex:0 0 18px;width:18px;height:18px;margin-top:1px;fill:none;stroke:var(--good);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}',
    '@keyframes soxpSpin{to{transform:rotate(360deg)}}',
    '.xf.soxp-filled{box-shadow:0 0 0 2px var(--sky)!important;background-color:var(--sky-wash)!important;transition:box-shadow .3s,background-color .3s}',
    '@media (prefers-reduced-motion:reduce){.soxp-read .sp{animation:none}}',
    /* the install tip */
    '.soxp-tip{display:flex;align-items:center;gap:12px;margin:0 0 14px;padding:12px 14px;border:1px solid var(--border);border-left:3px solid var(--sky);border-radius:8px;background:var(--surface);color:var(--ink);font-size:13.5px;line-height:1.4}',
    '.soxp-tip img{width:40px;height:40px;border-radius:9px;flex:0 0 auto}',
    '.soxp-tip b{display:block}',
    '.soxp-tip small{display:block;color:var(--ink-2);font-size:12.5px}',
    '.soxp-tip .gobtn{margin-left:auto;white-space:nowrap}',
    '.soxp-tip .x{margin-left:auto;border:0;background:transparent;color:var(--ink-3);font-size:22px;line-height:1;cursor:pointer;padding:4px 6px}',
    '.soxp-tip .gobtn + .x{margin-left:0}',
    /* the app */
    'html.soxp .hq.rail,html.soxp #rail,html.soxp .railscrim,html.soxp #rail-scrim{display:none!important}',
    'html.soxp body{padding-left:0!important}',
    'html.soxp .hqtop,html.soxp main.wrap{margin-left:0!important;left:0!important;width:auto!important;max-width:none!important}',
    'html.soxp .hqtop{padding-top:env(safe-area-inset-top,0px)}',
    'html.soxp .hqtop .eyebrow-m{display:none}',
    'html.soxp .hqname{flex:0 0 auto;white-space:nowrap}',
    '@media (max-width:560px){html.soxp .logoplate{padding:6px 10px!important}html.soxp .logoplate .wordmark{height:18px!important;width:auto!important}html.soxp .hqtop .who{display:none!important}html.soxp .soxp-out{margin-left:auto}}',
    'html.soxp .hqname{font-size:0!important;letter-spacing:0!important}',
    'html.soxp .hqname::after{content:"My Expenses";font-size:16px;letter-spacing:normal;font-weight:600}',
    'html.soxp main.wrap{padding-bottom:calc(104px + env(safe-area-inset-bottom,0px))!important}',
    'html.soxp #view .psec{display:none!important}',
    'html.soxp #view .psec[data-name="My Expenses"]{display:block!important}',
    'html.soxp #view .psec[data-name="My Expenses"] #xp-new{display:none}',
    'html.soxp #view .psec[data-name="My Expenses"] .onebar:not(:has(#xp-send)){display:none}',
    'html.soxp .soxp-out{border:1px solid rgba(255,255,255,.45);background:transparent;color:#fff;font:inherit;font-size:12.5px;font-weight:600;border-radius:6px;padding:5px 10px;cursor:pointer;margin-left:8px;white-space:nowrap}',
    '.soxp-dock{display:none}',
    'html.soxp body:not(.signedout) .soxp-dock{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:60;gap:10px;padding:10px 14px calc(10px + env(safe-area-inset-bottom,0px));background:var(--surface);border-top:1px solid var(--border);box-shadow:0 -6px 20px rgba(6,32,47,.10)}',
    'html.soxp body.soxp-busy .soxp-dock,html.soxp body:has(#panel.on) .soxp-dock{display:none!important}',
    '.soxp-dock button{flex:1;display:flex;align-items:center;justify-content:center;gap:8px;min-height:52px;border-radius:8px;font:inherit;font-size:16px;font-weight:700;cursor:pointer;border:1px solid var(--navy);white-space:nowrap}',
    '.soxp-dock .snap{background:var(--navy);color:#fff}',
    '.soxp-dock .hand{background:var(--surface);color:var(--ink);border-color:var(--border-strong)}',
    ':root[data-theme="dark"] .soxp-dock .snap,body.dark .soxp-dock .snap{background:var(--sky);color:var(--navy-deep);border-color:var(--sky)}',
    '.soxp-dock svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}',
    '.soxp-none{max-width:520px;margin:24px auto;padding:20px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--ink);font-size:14px;line-height:1.5}',
    '.soxp-none h3{margin:0 0 6px;font-size:18px}',
    '.soxp-foot{margin:22px 0 0;font-size:13px;color:var(--ink-2)}',
    '.soxp-foot button{border:0;background:none;padding:0;font:inherit;color:var(--navy-mid);text-decoration:underline;cursor:pointer}'
  ].join('\n');
  document.head.appendChild(css);

  /* ============================================================ the reader */
  var READ = { tess: null, seq: 0 };

  function loadScript(src) {
    return new Promise(function (res, rej) {
      if (root.Tesseract) { res(); return; }
      var s = document.createElement('script');
      s.src = src; s.async = true; s.crossOrigin = 'anonymous';
      s.onload = function () { res(); };
      s.onerror = function () { rej(new Error('The reader could not be loaded.')); };
      document.head.appendChild(s);
    });
  }
  /* One worker, made once and kept: the second receipt reads in a moment. */
  function tess() {
    if (!READ.tess) {
      READ.tess = loadScript(TESS).then(function () { return root.Tesseract.createWorker('eng'); })
        .catch(function (e) { READ.tess = null; throw e; });
    }
    return READ.tess;
  }

  function fileUrl(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = function () { rej(new Error('The picture could not be opened.')); };
      fr.readAsDataURL(file);
    });
  }
  /* The picture, sized for reading: big enough for small print, small enough
     that a phone gets through it quickly. Grey, with the contrast lifted. */
  function canvasFor(file, edge, grey) {
    return fileUrl(file).then(function (url) {
      return new Promise(function (res, rej) {
        var img = new Image();
        img.onload = function () {
          var w = img.naturalWidth, h = img.naturalHeight;
          var sc = Math.min(1, edge / Math.max(w, h));
          var cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.round(w * sc)); cv.height = Math.max(1, Math.round(h * sc));
          var x = cv.getContext('2d');
          x.fillStyle = '#fff'; x.fillRect(0, 0, cv.width, cv.height);
          if (grey) x.filter = 'grayscale(1) contrast(1.35)';
          x.drawImage(img, 0, 0, cv.width, cv.height);
          res(cv);
        };
        img.onerror = function () { rej(new Error('The picture could not be opened.')); };
        img.src = url;
      });
    });
  }

  function session() {
    try { var s = JSON.parse(sget('session') || 'null'); return s && s.token ? s : null; } catch (e) { return null; }
  }
  function askKeys(s) {
    var all = (root.RELAY && root.RELAY.projects) || [];
    var acc = s && s.access, mine = [];
    if (Array.isArray(acc)) mine = acc.map(function (a) { return typeof a === 'string' ? a : (a && (a.project || a.key)); });
    else if (acc && typeof acc === 'object') mine = Object.keys(acc);
    mine = mine.filter(function (k) { return all.indexOf(k) >= 0; });
    return (mine.length ? mine : all).slice(0, 4);
  }

  function prompt(options) {
    return 'This is a photo of a receipt for a business travel expense. Read it and reply with JSON only, ' +
      'nothing before or after it, in exactly this shape: ' +
      '{"date":"MM/DD/YY","amount":0.00,"merchant":"","category":"","description":"","time":"HH:MM"}. ' +
      'amount is the final total actually paid, including tax and any tip written on it. ' +
      'category must be exactly one of these, or "" if none clearly fits: ' + options.join(' | ') + '. ' +
      'For a meal, choose breakfast, lunch, dinner or snack from the time printed on the receipt. ' +
      'description is a few words, for example "Lunch at Blue Door Cafe" or "Airport parking, 3 days". ' +
      'Use "" for anything you cannot read clearly. Never guess a number.';
  }

  /* The relay's ask route, when the company's key has it switched on. It is
     off today, and a key that says so is not asked again this session. */
  function ask(file, options) {
    var s = session();
    if (!s || !root.RELAY || !root.RELAY.base || sget('xp.ask') === 'off') return Promise.reject(new Error('off'));
    var base = String(root.RELAY.base).replace(/\/+$/, '');
    var keys = askKeys(s);
    var isPdf = /pdf$/i.test(file.type || '') || /\.pdf$/i.test(file.name || '');
    var data = isPdf
      ? fileUrl(file).then(function (u) { return { mediaType: 'application/pdf', data: u.split(',')[1] || '' }; })
      : canvasFor(file, 1600, false).then(function (cv) { return { mediaType: 'image/jpeg', data: cv.toDataURL('image/jpeg', 0.8).split(',')[1] }; });
    return data.then(function (f) {
      var i = 0, offs = 0;
      function next() {
        if (i >= keys.length) {
          if (offs === keys.length) sput('xp.ask', 'off');
          return Promise.reject(new Error('off'));
        }
        var k = keys[i++];
        return fetch(base + '/' + encodeURIComponent(k) + '/ask', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + s.token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: prompt(options), tier: 'default', files: [f] })
        }).then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (b) {
            if (r.ok && b && b.text) return b.text;
            if (r.status === 403 || r.status === 404) offs++;
            return next();
          });
        }, function () { return next(); });
      }
      return next();
    }).then(function (txt) {
      var got = readAnswer(txt, options);
      if (!got) throw new Error('unreadable');
      return got;
    });
  }

  function onPhone(file, options) {
    if (!/^image\//.test(file.type || '')) return Promise.reject(new Error('not a picture'));
    return Promise.all([tess(), canvasFor(file, 2000, true)]).then(function (a) {
      return a[0].recognize(a[1]);
    }).then(function (r) {
      return readText((r && r.data && r.data.text) || '', options);
    });
  }

  function readReceipt(file, options) {
    return ask(file, options).catch(function () { return onPhone(file, options); });
  }

  /* ---- what is on the screen ------------------------------------------ */
  var LABELS = { amt: 'Amount', date: 'Date', cat: 'What It Was For', desc: 'Description' };
  function field(k) { return document.querySelector('#panel-body .xf[data-k="' + k + '"]'); }
  function isNewPanel() {
    var t = document.getElementById('panel-title');
    return !!t && /^Add an Expense/.test(t.textContent || '');
  }
  function sameDay(v, d) {
    var got = findDate(String(v || ''), new Date(Date.now() + 864e5));
    return !!got && got === printDate(d);
  }
  /* A field may be filled when it is empty — or when nobody has touched it and
     what is in it is ours: the "today" a new expense opens with, or what this
     reader put there from an earlier picture. Never over something typed. */
  function fillable(el, k) {
    if (!el || el.disabled) return false;
    if (el.dataset.soxpT === '1') return false;
    var v = String(el.value || '').trim();
    if (!v) return true;
    if (el.dataset.soxpF === '1') return true;
    if (k === 'date' && isNewPanel() && sameDay(v, new Date())) return true;
    return false;
  }
  function put(el, k, v) {
    if (el.tagName === 'SELECT') {
      var ok = Array.prototype.some.call(el.options, function (o) { return o.value === v; });
      if (!ok) return false;
    }
    if (String(el.value) === String(v)) { el.dataset.soxpF = '1'; return true; }
    el.value = v;
    el.dataset.soxpF = '1';
    el.classList.add('soxp-filled');
    /* the date drives the trip — the page's own rule decides whether the
       trip follows it, exactly as if it had been typed */
    if (k === 'date') el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  function apply(found) {
    var filled = [];
    ['amt', 'date', 'cat', 'desc'].forEach(function (k) {
      var v = found[k];
      if (v === undefined || v === null || String(v).trim() === '') return;
      var el = field(k);
      if (!fillable(el, k)) return;
      if (put(el, k, String(v))) filled.push(k);
    });
    /* What the receipt says is the receipt's total, by definition. */
    if (found.amt) { var ra = field('rcptAmt'); if (fillable(ra, 'rcptAmt')) put(ra, 'rcptAmt', String(found.amt)); }
    return filled;
  }

  function banner(state, msg) {
    var body = document.getElementById('panel-body');
    if (!body) return;
    var el = document.getElementById('soxp-read');
    if (!el) {
      el = document.createElement('div');
      el.id = 'soxp-read';
      el.setAttribute('role', 'status');
      var grid = body.querySelector('.revgrid');
      if (grid) grid.parentNode.insertBefore(el, grid); else body.insertBefore(el, body.firstChild);
    }
    el.className = 'soxp-read' + (state === 'bad' ? ' bad' : '');
    el.innerHTML = (state === 'busy' ? '<span class="sp" aria-hidden="true"></span>'
      : state === 'ok' ? '<svg class="ok" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"/></svg>' : '') +
      '<span>' + msg + '</span>';
  }

  function onFile(file) {
    if (!file || file.size > 25 * 1048576) return;
    var isImg = /^image\//.test(file.type || ''), isPdf = /pdf$/i.test(file.type || '') || /\.pdf$/i.test(file.name || '');
    if (!isImg && !isPdf) return;
    var anchor = field('amt');
    if (!anchor || anchor.disabled) return;
    var sel = field('cat');
    var options = sel ? Array.prototype.map.call(sel.options, function (o) { return o.value; }).filter(Boolean) : [];
    var my = ++READ.seq;
    if (isPdf && sget('xp.ask') === 'off') return; // nothing on the phone reads a PDF
    banner('busy', '<b>Reading the receipt…</b> Keep going if you like — it only fills boxes you have left empty.');
    readReceipt(file, options).then(function (found) {
      if (my !== READ.seq || !document.body.contains(anchor)) return;
      var filled = apply(found || {});
      if (filled.length) {
        banner('ok', '<b>Filled in from the receipt:</b> ' + filled.map(function (k) { return LABELS[k]; }).join(', ') +
          '. Check them before you keep it — the ringed boxes are the ones it filled.');
      } else {
        banner('bad', '<b>Nothing new to fill in from that picture.</b> ' +
          (found && (found.amt || found.date) ? 'Everything it found was already filled in.' : 'Fill in the boxes by hand — the picture is still attached.'));
      }
    }).catch(function () {
      if (my !== READ.seq || !document.body.contains(anchor)) return;
      banner('bad', '<b>That picture could not be read.</b> Fill in the boxes by hand — the picture is still attached.');
    });
  }

  /* Listen at the top, before the page's own handlers — they still attach and
     shrink the picture exactly as before; this only reads it alongside. */
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t && (t.id === 'rcpt-file' || t.id === 'rcpt-cam') && t.files && t.files[0]) onFile(t.files[0]);
  }, true);
  document.addEventListener('drop', function (e) {
    var d = e.target && e.target.closest && e.target.closest('#rcpt-drop');
    var dt = e.dataTransfer;
    if (d && dt && dt.files && dt.files[0]) onFile(dt.files[0]);
  }, true);
  /* Anything a person types is theirs from then on. */
  function mine(e) {
    var t = e.target;
    if (!e.isTrusted || !t || !t.classList || !t.classList.contains('xf')) return;
    t.dataset.soxpT = '1';
    t.dataset.soxpF = '';
    t.classList.remove('soxp-filled');
  }
  document.addEventListener('input', mine, true);
  document.addEventListener('change', mine, true);

  /* Get the reader ready while the form is being opened, so the picture is
     read the moment it is taken. Only when the phone is the one reading. */
  function warm() {
    if (sget('xp.ask') !== 'off' && !APP) return;
    var c = root.navigator && navigator.connection;
    if (c && (c.saveData || /2g/.test(c.effectiveType || ''))) return;
    setTimeout(function () { tess().catch(function () {}); }, 400);
  }

  /* ============================================================== the app */
  var panel = null, view = null;
  var deferred = null;
  root.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; schedule(); });

  function el(tag, cls, htmlStr) { var x = document.createElement(tag); if (cls) x.className = cls; if (htmlStr != null) x.innerHTML = htmlStr; return x; }

  function expSec() { return view && view.querySelector('.psec[data-name="My Expenses"]'); }

  function fullPortal() {
    sput('xp.full', '1');
    location.href = location.pathname;
  }

  function tip(sec) {
    if (standalone || lget('xp.tip.x') === '1') return;
    if (!APP && root.innerWidth > 820) return;
    var b = sec.querySelector('.psec-b');
    if (!b || b.querySelector(':scope > .soxp-tip')) return;
    var t = el('div', 'soxp-tip');
    var img = el('img'); img.alt = ''; img.src = 'xp-icon-180.png'; img.onerror = function () { img.remove(); };
    t.appendChild(img);
    var tx = el('div');
    if (!APP) {
      tx.innerHTML = '<b>Put Expenses on your phone</b><small>Open it as an app, then add it to your home screen. ' +
        'Snap a receipt and it fills itself in.</small>';
      t.appendChild(tx);
      var go = el('button', 'gobtn', 'Open It');
      go.type = 'button';
      go.onclick = function () { location.href = location.pathname + '?app=expenses'; };
      t.appendChild(go);
    } else {
      tx.innerHTML = '<b>Add this to your home screen</b><small>' +
        (isiOS ? 'Tap Share, then Add to Home Screen. It opens straight to your expenses, like an app.'
          : deferred ? 'Install it and it opens straight to your expenses, like an app.'
            : 'Open the browser menu and tap Add to Home screen. It opens straight to your expenses, like an app.') +
        '</small>';
      t.appendChild(tx);
      if (deferred && !isiOS) {
        var ib = el('button', 'gobtn', 'Install');
        ib.type = 'button';
        ib.onclick = function () { var d = deferred; deferred = null; d.prompt(); t.remove(); };
        t.appendChild(ib);
      }
    }
    var x = el('button', 'x', '×');
    x.type = 'button'; x.setAttribute('aria-label', 'Hide this tip');
    x.onclick = function () { lput('xp.tip.x', '1'); t.remove(); };
    t.appendChild(x);
    b.insertBefore(t, b.firstChild);
  }

  function paint() {
    if (!view) return;
    var sec = expSec();
    if (sec) tip(sec);
    if (!APP) return;
    var signedOut = document.body.classList.contains('signedout');
    var sub = document.querySelector('.signsub');
    if (signedOut && sub && !sub.dataset.soxp) {
      sub.dataset.soxp = '1';
      sub.textContent = 'Your expenses for MISMO. Snap the receipt, check what it filled in, and send it when you are ready.';
    }
    /* Busy screens and the sign-in have no sections; nothing to judge yet. */
    var secs = view.querySelectorAll('.psec');
    document.body.classList.toggle('soxp-busy', !secs.length);
    var none = view.querySelector('.soxp-none');
    if (secs.length && !sec) {
      if (!none) {
        none = el('div', 'soxp-none',
          '<h3>Expenses are not switched on for this sign-in</h3>' +
          '<p>If you claim expenses for MISMO work, email <a href="mailto:jcritchley@mismo.org">Jonna Critchley</a> and she can switch them on.</p>' +
          '<p><button type="button" class="gobtn ghost">Open the Full Portal</button></p>');
        none.querySelector('button').onclick = fullPortal;
        view.insertBefore(none, view.firstChild);
      }
    } else if (none) none.remove();
    var emp = sec && sec.querySelector('.psec-b > p.empty');
    if (emp && !emp.dataset.soxp) {
      emp.dataset.soxp = '1';
      emp.innerHTML = '<b>Nothing yet.</b> Snap your first receipt with the button at the bottom \u2014 it fills itself in.';
    }
    if (sec && secs.length > 1) {
      var b = sec.querySelector('.psec-b');
      if (b && !b.querySelector(':scope > .soxp-foot')) {
        var f = el('p', 'soxp-foot', 'Looking for your hours or service orders? <button type="button">Open the full portal</button>');
        f.querySelector('button').onclick = fullPortal;
        b.appendChild(f);
      }
    }
    var top = document.querySelector('.hqtop-r');
    if (top && !top.querySelector('.soxp-out') && !signedOut) {
      var out = el('button', 'soxp-out', 'Sign Out');
      out.type = 'button';
      out.onclick = function () {
        var r = document.querySelector('#rail-nav .railout');
        if (r) r.click(); else { sdrop('session'); location.reload(); }
      };
      top.appendChild(out);
    }
    if (signedOut) { var o = document.querySelector('.soxp-out'); if (o) o.remove(); }
  }
  var pend = 0;
  function schedule() { if (pend) return; pend = requestAnimationFrame(function () { pend = 0; paint(); }); }
  /* Everything below needs the page itself, so it waits for it. The style and
     the app class above do not, so the full portal never flashes up first. */
  function boot() {
  panel = document.getElementById('panel');
  view = document.getElementById('view');
  if (view) new MutationObserver(schedule).observe(view, { childList: true, subtree: true });
  new MutationObserver(schedule).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  schedule();

  /* The dock: the two things the app is for. */
  if (APP) {
    var dock = el('div', 'soxp-dock',
      '<button type="button" class="snap"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>Snap a Receipt</button>' +
      '<button type="button" class="hand"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Add by Hand</button>');
    document.body.appendChild(dock);
    var open = function (cam) {
      var add = document.getElementById('xp-new');
      if (!add) return;
      add.click();
      /* in the same tap, so the phone allows the camera to open */
      if (cam) { var c = document.getElementById('rcpt-cam'); if (c) c.click(); }
    };
    dock.querySelector('.snap').onclick = function () { open(true); };
    dock.querySelector('.hand').onclick = function () { open(false); };
  }

  /* The panel: warm the reader when an expense opens, and in the app let the
     phone's Back button close it rather than leave the app. */
  if (panel) {
    var pushed = false, skip = false, was = false;
    new MutationObserver(function () {
      var on = panel.classList.contains('on');
      if (on === was) return;
      was = on;
      if (on && field('amt') && !field('amt').disabled) warm();
      if (!APP) return;
      if (on && !pushed) { try { history.pushState({ soxp: 'panel' }, ''); pushed = true; } catch (e) {} }
      if (!on && pushed) { pushed = false; skip = true; history.back(); }
    }).observe(panel, { attributes: true, attributeFilter: ['class'] });
    root.addEventListener('popstate', function () {
      if (skip) { skip = false; return; }
      if (!APP || !pushed) return;
      pushed = false;
      var x = document.getElementById('panel-x');
      if (x) x.click();
      /* An unsaved-work question kept it open: stay on it. */
      setTimeout(function () {
        if (panel.classList.contains('on') && !pushed) { try { history.pushState({ soxp: 'panel' }, ''); pushed = true; } catch (e) {} }
      }, 60);
    });
  }

  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  root.__soxp = { on: true, app: APP, read: readReceipt, api: API, warm: function () { return tess(); } };
})(typeof window !== 'undefined' ? window : this);
