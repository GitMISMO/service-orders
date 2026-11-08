"""Builds review.html: where a staff member reviews a new service order they
asked for. Takes the theme tokens, the logo and the version from the portal's
own index.html so the two read as one tool.

    python3 tools/make_review.py releases/<version>/index.html releases/<version>/review.html

Never edit review.html by hand: change this script and run it again."""
import re, sys
so = open(sys.argv[1], encoding='utf-8').read()
out = sys.argv[2]

tokens = so[so.index(':root{'):so.index('*{box-sizing:border-box}')]
i = so.index('<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><symbol id="mismo-logo"')
logo = so[i:so.index('</defs></svg>', i) + 13]
m = re.search(r'<meta name="so-version" content="([^"]+)">', so)
version = m.group(1) if m else 'not versioned'
# The page safety list for the review page: the sign-in script and the relay, nothing else.
CSP = ("default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
       "font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; "
       "connect-src 'self' https://rgvdi67cg27o5kcmiytcqbqnrm0hmztx.lambda-url.us-east-1.on.aws; "
       "object-src 'none'; base-uri 'self'; form-action 'self'")

PAGE = r'''<!DOCTYPE html>
<html lang="en" data-rs-gate>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="__CSP__">
<meta name="so-version" content="__VERSION__">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#0d314c">
<title>Service Order Review</title>
<script>try{var t=localStorage.getItem("mismo.portal.theme");if(t)document.documentElement.setAttribute("data-theme",t);}catch(e){}</script>
<script src="/assets/session.js"></script>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">
<style>__TOKENS__
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:var(--ground);color:var(--ink);font-family:var(--display);font-size:14px;line-height:1.55;font-variant-numeric:tabular-nums;-webkit-text-size-adjust:100%}
h1,h2,h3,h4{letter-spacing:-.012em;margin:0}
.top{position:sticky;top:0;z-index:50;height:64px;background:var(--navy);color:#fff;display:flex;align-items:center;padding:0 22px;box-shadow:0 1px 0 rgba(80,164,219,.28)}
.logoplate{background:#fff;border-radius:7px;padding:8px 14px;display:flex;align-items:center;line-height:0;flex:0 0 auto}
.logoplate svg{height:24px;width:auto;display:block}
.mastrule{display:block;width:2px;height:34px;margin-inline:20px;border-radius:1px;background:var(--sky);flex:0 0 auto}
.hqname{font-size:15.5px;font-weight:700;color:var(--sky);white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis}
.top-r{margin-left:auto;display:flex;align-items:center;gap:12px}
.themeb{font:inherit;font-size:12.5px;font-weight:600;color:#fff;background:transparent;border:1px solid rgba(255,255,255,.35);border-radius:4px;padding:6px 11px;cursor:pointer;white-space:nowrap;min-width:max-content}
.themeb:hover{background:rgba(255,255,255,.1)}
@media(max-width:640px){.mastrule{margin-inline:12px}.top{padding:0 14px}.themeb{display:none}}
.wrap{padding:26px 30px 70px}
@media(max-width:640px){.wrap{padding:18px 16px 60px}}
.eyebrow{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3)}
.vhead h1{font-size:24px;font-weight:700;margin:4px 0 2px}
.vhead p{margin:0;color:var(--ink-2)}
.band{background:var(--navy);border-radius:8px;padding:18px 20px;margin:18px 0}
.tiles{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}
@media(max-width:1000px){.tiles{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:560px){.tiles{grid-template-columns:repeat(2,minmax(0,1fr))}}
.tile{background:rgba(255,255,255,.07);border:1px solid rgba(116,191,235,.28);border-radius:7px;padding:12px 14px;min-width:0}
.tile b{display:block;font-size:22px;font-weight:700;line-height:1.15;color:#fff;overflow-wrap:anywhere}
.tile span{display:block;font-size:12.5px;color:var(--sky-soft);margin-top:3px}
.grid{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:18px;align-items:start}
@media(max-width:980px){.grid{grid-template-columns:1fr}}
.card{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px 18px}
.card + .card{margin-top:12px}
.grid > .card{margin-top:0}
.sec{padding:12px 0;border-bottom:1px solid var(--rule)}
.sec:first-child{padding-top:0}.sec:last-child{border-bottom:0;padding-bottom:0}
.sec h3{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);margin:0 0 5px}
.sec p{margin:0;white-space:pre-wrap}
.sec ul{margin:0;padding-left:20px}
.decide{position:sticky;top:82px}
.decide h2{font-size:16px;margin:0 0 4px}
.decide .say{color:var(--ink-2);margin:0 0 12px;font-size:13px}
.btn{display:inline-flex;align-items:center;justify-content:center;font:inherit;font-size:13.5px;font-weight:600;padding:10px 18px;border-radius:7px;border:1px solid var(--navy);background:var(--navy);color:#fff;cursor:pointer;white-space:nowrap;min-width:max-content}
.btn:hover:not(:disabled){background:var(--navy-mid);border-color:var(--navy-mid)}
.btn:disabled{opacity:.45;cursor:not-allowed}
.btn.ghost{background:var(--surface);color:var(--ink);border-color:var(--border-strong)}
.btn.ghost:hover:not(:disabled){background:var(--surface-3)}
.btn.wide{width:100%}
label.l{display:block;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);margin:14px 0 5px}
textarea,input[type=text]{width:100%;font:inherit;font-size:14px;color:var(--ink);background:var(--surface);border:1px solid var(--border-strong);border-radius:6px;padding:9px 11px}
textarea{min-height:84px;resize:vertical}
textarea:focus,input:focus{outline:2px solid var(--sky);outline-offset:1px}
.ed{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0 14px}
@media(max-width:640px){.ed{grid-template-columns:repeat(2,minmax(0,1fr))}}
.ed .w{grid-column:1/-1}
.ed label.l{margin-top:12px}
.ed > div:first-child label.l{margin-top:0}
.ed .hint{font-size:12px;color:var(--ink-3);margin:3px 0 0}
.ed textarea.chg,.ed input.chg{border-color:var(--warn);background:rgba(162,112,26,.06)}
.lead{margin:0 0 14px;color:var(--ink-2)}
.ed textarea.gap,.ed input.gap{border-color:var(--bad);background:rgba(179,55,44,.06)}
.chg-n.bad{color:var(--bad)}
.chg-n{font-size:12.5px;color:var(--warn);font-weight:600;margin:10px 0 0;min-height:1em}
.or{display:flex;align-items:center;gap:10px;color:var(--ink-3);font-size:12px;margin:14px 0 0}
.or:before,.or:after{content:"";flex:1;height:1px;background:var(--rule)}
.note{border-left:3px solid var(--warn);background:rgba(162,112,26,.08);padding:10px 14px;border-radius:0 6px 6px 0;margin:0 0 12px}
.note.ok{border-color:var(--good);background:rgba(15,123,92,.08)}
.note.bad{border-color:var(--bad);background:rgba(179,55,44,.08)}
.steps{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--ink-2)}
.steps li{display:flex;gap:8px;align-items:flex-start}
.steps i{flex:0 0 auto;width:20px;height:20px;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-style:normal;font-size:11px;font-weight:700;background:var(--surface-3);color:var(--ink-2)}
.steps li.on i{background:var(--sky);color:var(--navy-deep)}
.steps li.done i{background:var(--good);color:#fff}
.rows{background:var(--surface);border:1px solid var(--border);border-radius:8px;overflow:hidden}
.row{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;padding:12px 16px;border-bottom:1px solid var(--rule);color:inherit;text-decoration:none}
.row:last-child{border-bottom:0}
.row:hover{background:var(--surface-2)}
.row .t{flex:1 1 280px;font-weight:600;min-width:0}
.row .t small{display:block;font-weight:400;color:var(--ink-3);font-size:12.5px}
.tag{display:inline-flex;align-items:center;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:3px 8px;border-radius:4px;background:var(--surface-3);color:var(--ink-2);white-space:nowrap}
.tag.warn{background:rgba(162,112,26,.16);color:var(--warn)}.tag.good{background:rgba(15,123,92,.14);color:var(--good)}.tag.bad{background:rgba(179,55,44,.12);color:var(--bad)}
.subh{font-size:12.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);margin:22px 0 8px;font-weight:700}
.empty{color:var(--ink-2);background:var(--surface);border:1px dashed var(--border-strong);border-radius:8px;padding:16px 18px;margin:0}
.loading{display:flex;align-items:center;gap:10px;color:var(--ink-2);padding:30px 0}
.sp{width:18px;height:18px;border-radius:50%;border:2px solid var(--border-strong);border-top-color:var(--navy-mid);animation:sp 1s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
#rs-account{flex:0 0 auto;display:inline-flex;align-items:center}
#rs-account .rs-who,#rs-account .rs-signin{border-radius:4px}
:root[data-theme="dark"] .btn{background:var(--sky);color:var(--navy-deep);border-color:var(--sky)}
:root[data-theme="dark"] .btn.ghost{background:var(--surface-2);color:var(--ink);border-color:var(--border-strong)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .btn{background:var(--sky);color:var(--navy-deep);border-color:var(--sky)}
:root:not([data-theme="light"]) .btn.ghost{background:var(--surface-2);color:var(--ink);border-color:var(--border-strong)}}
</style>
</head>
<body>
__LOGO__
<header class="top">
  <span class="logoplate"><svg role="img" aria-label="MISMO" viewBox="0 0 708 108"><use href="#mismo-logo"/></svg></span>
  <span class="mastrule"></span>
  <span class="hqname">Service Order Review</span>
  <span class="top-r"><button class="themeb" type="button" id="themeb">Dark Mode</button><div id="rs-account"></div></span>
</header>
<main class="wrap" id="main"><div class="loading"><span class="sp"></span>Opening the review…</div></main>
<script>
(function () {
  'use strict';
  var RELAY = 'https://rgvdi67cg27o5kcmiytcqbqnrm0hmztx.lambda-url.us-east-1.on.aws';
  var main = document.getElementById('main');
  var DOCS = {}, SHA = null, ME = null;

  /* ---- light and dark, the same choice every MISMO page shares ---- */
  var tb = document.getElementById('themeb');
  function isDark() {
    var t = document.documentElement.getAttribute('data-theme');
    return t ? t === 'dark' : (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function themeLabel() { tb.textContent = isDark() ? 'Light Mode' : 'Dark Mode'; }
  tb.addEventListener('click', function () {
    var t = isDark() ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('mismo.portal.theme', t); } catch (e) {}
    themeLabel();
  });
  themeLabel();

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(v) { return v == null || v === '' ? '—' : '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function when(iso) { var d = iso ? new Date(iso) : null; return d && !isNaN(d) ? d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''; }
  function first(n) { return String(n || '').split(' ')[0]; }
  /* jcritchley@mba.org and jcritchley@mismo.org are the same mailbox */
  function same(a, b) {
    a = String(a || '').toLowerCase().trim(); b = String(b || '').toLowerCase().trim();
    if (!a || !b) return false; if (a === b) return true;
    var A = a.split('@'), B = b.split('@'), ours = /^(mba\.org|mismo\.org)$/;
    return A[0] === B[0] && ours.test(A[1] || '') && ours.test(B[1] || '');
  }
  function call(method, body) {
    var tok = window.ResourcesSession && ResourcesSession.token();
    var h = { 'Authorization': 'Bearer ' + tok }; if (body) h['Content-Type'] = 'application/json';
    return fetch(RELAY + '/team-hq/data/soreviews', { method: method, cache: 'no-store', headers: h, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) {
        if (r.ok) return b; var e = new Error((b && b.message) || ('HTTP ' + r.status)); e.status = r.status; throw e; }); });
  }
  function load() {
    return call('GET').then(function (b) { DOCS = (b && b.data && b.data.docs) || {}; SHA = (b && b.sha) || null; });
  }
  /* The decision is laid onto the newest copy; a clash re-reads and tries again, so nobody else's is lost. */
  function decide(id, change, tries) {
    tries = tries == null ? 4 : tries;
    return load().then(function () {
      var d = DOCS[id]; if (!d) throw new Error('That review is no longer on file.');
      if (d.state !== 'pending') { var e = new Error('already'); e.already = d; throw e; }
      change(d);
      return call('PUT', { content: { docs: DOCS }, sha: SHA || undefined });
    }).catch(function (e) {
      if (e.status === 409 && tries > 1) return decide(id, change, tries - 1);
      throw e;
    });
  }

  function idFromHash() { var m = /[#&]r=([A-Za-z0-9-]+)/.exec(location.hash || ''); return m ? m[1] : ''; }
  function list(rs, title) {
    return '<h2 class="subh">' + esc(title) + '</h2><div class="rows">' + rs.map(function (d) {
      var st = stateOf(d);
      return '<a class="row" href="#r=' + esc(d.id) + '"><span class="t">' + esc((d.order || {}).subject || 'Service order') +
        '<small>' + esc(d.company) + ' · from ' + esc(d.requestedBy) + ' · ' + esc(when(d.requestedAt)) + '</small></span>' +
        '<span class="tag ' + st.tone + '">' + esc(st.label) + '</span></a>';
    }).join('') + '</div>';
  }
  function stateOf(d) {
    return ({ pending: { label: 'Waiting for ' + first((d.reviewer || {}).name), tone: 'warn' },
              approved: { label: 'Approved', tone: 'good' },
              changes: { label: 'Sent Back for Changes', tone: 'bad' },
              revised: { label: 'Changes Sent to ' + first(d.requestedBy), tone: 'warn' },
              withdrawn: { label: 'Replaced by a Newer Version', tone: '' } })[d.state] || { label: d.state, tone: '' };
  }
  function home() {
    var all = Object.keys(DOCS).map(function (k) { return DOCS[k]; }).sort(function (a, b) { return String(b.requestedAt).localeCompare(String(a.requestedAt)); });
    var mine = all.filter(function (d) { return same((d.reviewer || {}).email, ME.email); });
    var waiting = mine.filter(function (d) { return d.state === 'pending'; });
    var asked = all.filter(function (d) { return same(d.requestedByEmail, ME.email) && d.state !== 'withdrawn'; });
    var html = '<div class="vhead"><div class="eyebrow">Service Orders and Agreements</div><h1>' +
      (waiting.length ? waiting.length + (waiting.length === 1 ? ' Service Order' : ' Service Orders') + ' for You to Review' : 'Nothing Waiting for Your Review') +
      '</h1><p>New service orders you asked for come here before they go to the contracting company.</p></div>';
    if (waiting.length) html += list(waiting, 'Waiting for You');
    var done = mine.filter(function (d) { return d.state !== 'pending' && d.state !== 'withdrawn'; }).slice(0, 12);
    if (done.length) html += list(done, 'Already Reviewed');
    if (asked.length) html += list(asked.slice(0, 20), 'Orders You Sent for Review');
    if (!waiting.length && !done.length && !asked.length)
      html += '<p class="empty" style="margin-top:18px">When somebody drafts a service order you asked for, you get an email with a button that opens it here.</p>';
    main.innerHTML = html;
  }
  function changedCount(d) {
    var n = Object.keys(d.proposed || {}).length;
    return n === 1 ? 'one detail' : n + ' details';
  }
  function sec(title, v) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '';
    return '<div class="sec"><h3>' + esc(title) + '</h3>' + (Array.isArray(v)
      ? '<ul>' + v.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'
      : '<p>' + esc(v) + '</p>') + '</div>';
  }
  /* What the requester may change, in the order it reads on the printed order. */
  var EDIT = [
    { k: 'subject', label: 'Service Order Title', w: 1 },
    { k: 'hourlyRate', label: 'Hourly Rate', num: 1, hourly: 1 },
    { k: 'estimatedHours', label: 'Estimated Hours', perLabel: 'Estimated Reviews', num: 1 },
    { k: 'maximumFee', label: 'Maximum Fee', num: 1 },
    { k: 'startDate', label: 'Start Date' },
    { k: 'endDate', label: 'End Date' },
    { k: 'description', label: 'Description', area: 1 },
    { k: 'services', label: 'Services', area: 1, list: 1 },
    { k: 'deliverables', label: 'Deliverables', area: 1, list: 1 },
    { k: 'deliverySchedule', label: 'Delivery Schedule', area: 1 },
    { k: 'paymentSchedule', label: 'Payment Schedule', area: 1 },
    { k: 'tasksFromMismo', label: 'What MISMO Provides', area: 1 },
    { k: 'modifications', label: 'Agreed Modifications', area: 1 }
  ];
  /* Anything in [square brackets] is a gap the requester has to fill in. */
  var PH_RE = /\[[^\]\n]{2,}\]/;
  function hasGaps(o) { return EDIT.some(function (f) { return PH_RE.test(asText(o[f.k])); }); }
  function asText(v) { return Array.isArray(v) ? v.join('\n') : (v == null ? '' : String(v)); }
  function asList(s) { return String(s || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean); }
  function editForm(o, hourly) {
    return '<div class="ed">' + EDIT.filter(function (f) { return hourly || !f.hourly; }).map(function (f) {
      var lab = (!hourly && f.perLabel) || f.label, v = asText(o[f.k]), id = 'e-' + f.k;
      var input = f.area
        ? '<textarea id="' + id + '" data-k="' + f.k + '" rows="' + (f.list ? 4 : 3) + '">' + esc(v) + '</textarea>'
        : '<input type="text" id="' + id + '" data-k="' + f.k + '" value="' + esc(v) + '"' + (f.num ? ' inputmode="decimal"' : '') + '>';
      return '<div class="' + (f.area || f.w ? 'w' : '') + '"><label class="l" for="' + id + '">' + esc(lab) + '</label>' + input +
        (f.list ? '<p class="hint">One per line.</p>' : '') + '</div>';
    }).join('') + '</div>';
  }
  /* Only the fields that are different from what was sent, in the shape the portal keeps them. */
  function changesIn(o) {
    var out = {};
    EDIT.forEach(function (f) {
      var e = document.getElementById('e-' + f.k); if (!e) return;
      var now = String(e.value || '').replace(/\r/g, ''), was = asText(o[f.k]);
      var same = f.list ? JSON.stringify(asList(now)) === JSON.stringify(asList(was)) : now.trim() === was.trim();
      e.classList.toggle('chg', !same);
      if (same) return;
      if (f.list) out[f.k] = asList(now);
      else if (f.num) { var n = now.replace(/[$,\s]/g, ''); out[f.k] = n === '' ? null : (isFinite(Number(n)) ? Number(n) : now.trim()); }
      else out[f.k] = now.trim();
    });
    return out;
  }
  function show(id) {
    var d = DOCS[id];
    if (!d) {
      main.innerHTML = '<div class="vhead"><h1>That Review Could Not Be Found</h1><p>It may have been replaced by a newer version. ' +
        '<a href="#">See everything waiting for you</a>.</p></div>';
      return;
    }
    var o = d.order || {}, hourly = o.feeType !== 'perReview';
    var mineToDo = d.state === 'pending' && same((d.reviewer || {}).email, ME.email);
    var vp = d.vpName || 'the VP';
    var tiles = '<div class="band"><div class="tiles">' +
      '<div class="tile"><b>' + (hourly ? 'Hourly' : 'Per Review') + '</b><span>How It Is Paid</span></div>' +
      (hourly ? '<div class="tile"><b>' + money(o.hourlyRate) + '</b><span>Hourly Rate</span></div>' +
                '<div class="tile"><b>' + (o.estimatedHours != null ? Number(o.estimatedHours).toLocaleString('en-US') : '—') + '</b><span>Estimated Hours</span></div>' +
                '<div class="tile"><b>' + money(o.maximumFee) + '</b><span>Maximum Fee</span></div>'
              : '<div class="tile"><b>Fee Schedule</b><span>No Hourly Rate</span></div>' +
                '<div class="tile"><b>' + (o.estimatedHours != null ? o.estimatedHours : '—') + '</b><span>Estimated Reviews</span></div>' +
                '<div class="tile"><b>' + money(o.maximumFee) + '</b><span>Maximum Fee</span></div>') +
      '<div class="tile"><b>' + esc(o.startDate || '—') + (o.endDate ? ' – ' + esc(o.endDate) : '') + '</b><span>Start to End</span></div>' +
      '</div></div>';
    var body = sec('Description', o.description) + sec('Services', o.services) + sec('Deliverables', o.deliverables) +
      sec('Delivery Schedule', o.deliverySchedule) + sec('Payment Schedule', o.paymentSchedule) +
      sec('What MISMO Provides', o.tasksFromMismo) + sec('Agreed Modifications', o.modifications) +
      sec('Why This Order Exists', o.raisedWhy) + sec('Written Under', o.msaFlavour ? o.msaFlavour + ' Master Services Agreement' : '');
    if (!body) body = '<p style="margin:0;color:var(--ink-2)">Only the title and the figures above have been filled in so far.</p>';
    if (mineToDo) body = '<p class="lead">' + (gaps ? 'Fill in every part in [brackets], and change anything else that is not right \u2014 ' +
      'what you change is marked.' : 'Change anything that is not right \u2014 what you change is marked. Leave the rest as it is.') + '</p>' + editForm(o, hourly) +
      (o.raisedWhy ? '<div class="sec" style="margin-top:14px;padding-top:12px;border-top:1px solid var(--rule)"><h3>Why This Order Exists</h3><p>' + esc(o.raisedWhy) + '</p></div>' : '');
    else if (d.state === 'revised') {
      var P = d.proposed || {};
      body = '<div class="sec"><h3>What You Changed</h3></div>' + EDIT.filter(function (f) { return P[f.k] !== undefined; }).map(function (f) {
        return sec(f.label + ' \u2014 Now', P[f.k] == null ? '(left empty)' : P[f.k]);
      }).join('') + '<div class="subh" style="margin-top:18px">As It Was Sent</div>' + body;
    }
    var stepsHtml = '<ol class="steps">' + [
        ['You review it and send it back', d.state === 'pending' ? 'on' : (d.state === 'approved' || d.state === 'revised') ? 'done' : ''],
        [first(d.requestedBy) + ' sends it to ' + vp, ''], [vp + ' approves it, and it goes to ' + d.company, ''],
        [d.company + ' accepts it from the email', ''], ['The President approves it', '']
      ].map(function (s, i) { return '<li class="' + s[1] + '"><i>' + (s[1] === 'done' ? '✓' : (i + 1)) + '</i>' + esc(s[0]) + '</li>'; }).join('') + '</ol>';
    var side;
    var gaps = mineToDo && hasGaps(o);
    if (gaps) {
      side = '<div class="card decide"><h2>Fill In the Gaps</h2><p class="say">' + esc(d.requestedBy) + ' drafted this for you and left ' +
        'some parts in <b>[brackets]</b> for you to fill in \u2014 they are outlined in red. Replace each one with the real details, change ' +
        'anything else that needs it, and send it back to ' + esc(first(d.requestedBy)) + '. It cannot be approved until they are filled in, ' +
        'and nothing reaches ' + esc(d.company) + ' until ' + esc(vp) + ' approves it.</p>' +
        '<label class="l" for="why">Anything Else to Say</label>' +
        '<textarea id="why" placeholder="Optional. ' + esc(first(d.requestedBy)) + ' reads exactly this."></textarea>' +
        '<div style="margin-top:10px"><button class="btn wide" type="button" id="no">Send It Back to ' + esc(first(d.requestedBy)) + '</button></div>' +
        '<p class="chg-n" id="chgn"></p>' + stepsHtml + '</div>';
    } else if (mineToDo) {
      side = '<div class="card decide"><h2>Your Decision</h2><p class="say">' + esc(d.requestedBy) + ' drafted this for you. ' +
        'If it is right, approve it. If anything is wrong, change it on the left and send your changes. Either way it goes back to ' +
        esc(first(d.requestedBy)) + ', who sends it to ' + esc(vp) + '. Nothing reaches ' + esc(d.company) + ' until ' + esc(vp) + ' approves it.</p>' +
        '<button class="btn wide" type="button" id="ok">Approve This Service Order</button>' +
        '<div class="or">or</div>' +
        '<label class="l" for="why">Anything Else to Say</label>' +
        '<textarea id="why" placeholder="Optional when you changed the details. ' + esc(first(d.requestedBy)) + ' reads exactly this."></textarea>' +
        '<div style="margin-top:10px"><button class="btn ghost wide" type="button" id="no">Send My Changes to ' + esc(first(d.requestedBy)) + '</button></div>' +
        '<p class="chg-n" id="chgn"></p>' +
        stepsHtml + '</div>';
    } else {
      var st = stateOf(d);
      side = '<div class="card decide"><h2>' + esc(st.label) + '</h2>' +
        (d.state === 'approved' ? '<p class="say">' + esc((d.reviewer || {}).name) + ' approved it ' + esc(when(d.decidedAt)) + '. It is back with ' + esc(first(d.requestedBy)) + ' to send to ' + esc(vp) + '.</p>'
          : d.state === 'changes' ? '<p class="say">' + esc((d.reviewer || {}).name) + ' sent it back ' + esc(when(d.decidedAt)) + ':</p><div class="note bad">' + esc(d.comments || '') + '</div>'
          : d.state === 'revised' ? '<p class="say">' + esc((d.reviewer || {}).name) + ' changed ' + changedCount(d) + ' and sent it back to ' +
            esc(first(d.requestedBy)) + ' ' + esc(when(d.decidedAt)) + '. Once ' + esc(first(d.requestedBy)) + ' puts the changes in, it goes to ' + esc(vp) + '.</p>' +
            (d.comments ? '<div class="note">' + esc(d.comments) + '</div>' : '')
          : d.state === 'withdrawn' ? '<p class="say">A newer version of this order was sent for review. Open the latest email to review that one.</p>'
          : '<p class="say">Waiting for ' + esc((d.reviewer || {}).name) + ' to review it.' +
            (same(d.requestedByEmail, ME.email) ? '' : ' Only they can approve it.') + '</p>') +
        stepsHtml + '</div>';
    }
    main.innerHTML = '<p style="margin:0 0 10px"><a href="#" style="color:var(--ink-2)">← Everything for you to review</a></p>' +
      '<div class="vhead"><div class="eyebrow">' + esc(d.company) + ' · New Service Order</div><h1>' + esc(o.subject || 'Service order') + '</h1>' +
      '<p>Drafted by ' + esc(d.requestedBy) + ' and sent to ' + esc((d.reviewer || {}).name) + ' to review on ' + esc(when(d.requestedAt)) + '.</p></div>' +
      tiles + '<div class="grid"><div class="card">' + body + '</div>' + side + '</div>';
    if (!mineToDo) return;
    var ok = document.getElementById('ok'), no = document.getElementById('no'), why = document.getElementById('why');
    function busy(on) { if (ok) ok.disabled = on; no.disabled = on; }
    function done(e) {
      if (e && e.already) { DOCS[id] = e.already; show(id); return; }
      busy(false); alert('That did not save: ' + ((e && e.message) || 'please try again') + '.');
    }
    var chgn = document.getElementById('chgn');
    function gapsLeft() {
      var left = 0;
      main.querySelectorAll('.ed input, .ed textarea').forEach(function (e) { var g = PH_RE.test(e.value || ''); e.classList.toggle('gap', g); if (g) left++; });
      return left;
    }
    function refresh() {
      var n = Object.keys(changesIn(o)).length, left = gapsLeft();
      if (gaps) {
        no.disabled = left > 0;
        chgn.className = 'chg-n' + (left ? ' bad' : '');
        chgn.textContent = left ? (left === 1 ? 'One part' : left + ' parts') + ' in [brackets] still to fill in.'
          : 'All filled in. Send it back to ' + first(d.requestedBy) + '.';
        return;
      }
      ok.disabled = n > 0;
      ok.textContent = n > 0 ? 'Approve As It Was Sent' : 'Approve This Service Order';
      chgn.textContent = n ? 'You changed ' + (n === 1 ? 'one detail' : n + ' details') + '. Send them to ' + first(d.requestedBy) +
        ' to put in, or put them back to approve it as it was sent.' : '';
    }
    refresh();
    main.querySelectorAll('.ed input, .ed textarea').forEach(function (e) { e.addEventListener('input', refresh); });
    if (ok) ok.addEventListener('click', function () {
      if (Object.keys(changesIn(o)).length || hasGaps(o)) return;
      busy(true); ok.textContent = 'Approving…';
      decide(id, function (x) { x.state = 'approved'; x.decidedAt = new Date().toISOString(); x.decidedBy = ME.name || ME.email; x.comments = ''; })
        .then(function () { return load(); }).then(function () { show(id); }, done);
    });
    no.addEventListener('click', function () {
      var t = String(why.value || '').trim(), ch = changesIn(o), n = Object.keys(ch).length;
      if (gaps && gapsLeft()) { refresh(); return; }
      if (!t && !n) { why.focus(); why.placeholder = 'Change a detail on the left, or say what needs changing here.'; return; }
      busy(true); no.textContent = 'Sending…';
      decide(id, function (x) {
        x.state = n ? 'revised' : 'changes'; x.decidedAt = new Date().toISOString(); x.decidedBy = ME.name || ME.email; x.comments = t;
        if (n) x.proposed = ch;
      }).then(function () { return load(); }).then(function () { show(id); window.scrollTo(0, 0); }, done);
    });
  }
  function route() { var id = idFromHash(); if (id) show(id); else home(); window.scrollTo(0, 0); }

  function start() {
    var RS = window.ResourcesSession;
    if (!RS) { main.innerHTML = '<p class="empty">The resources.mismo.org sign-in did not load. Reload the page.</p>'; return; }
    RS.requireAccess('team-hq', { toolName: 'Service Order Review', eyebrow: 'Programs & Operations' }).then(function () {
      ME = RS.current() || {};
      return load();
    }).then(function () { route(); window.addEventListener('hashchange', route); }, function (e) {
      if (e && e.message === 'cancelled') return;
      main.innerHTML = '<p class="empty">The review could not be opened: ' + esc((e && e.message) || 'something went wrong') + '. Reload to try again.</p>';
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
</script>
</body>
</html>
'''
open(out, 'w', encoding='utf-8').write(PAGE.replace('__TOKENS__', tokens).replace('__LOGO__', logo)
                                        .replace('__CSP__', CSP).replace('__VERSION__', version))
print('wrote', out, len(PAGE))
