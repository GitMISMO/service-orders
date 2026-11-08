// Service Orders checks. Run with:  npm test   (or: node tests/run.js)
//
//   node tests/run.js                     checks the newest saved version in releases/
//   node tests/run.js --version 20261108a checks that version (Publish a Version does this)
//   node tests/run.js "sign-in"           runs only the checks whose name contains the words
//
// Every browser check opens the page against a pretend sign-in and a pretend relay with
// made-up companies (harness.js, fixtures.js), so nothing real is read or changed. The run
// fails (exit code 1) if any check fails; GitHub then emails whoever uploaded the change,
// and Publish a Version refuses to publish.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { chromium } = require('playwright');
const { open, mkStore, FX, ROOT } = require('./harness');

/* ------------------------------------------------------------------ what to check */
const argv = process.argv.slice(2);
let VERSION = process.env.SO_VERSION || '';
const only = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--version') VERSION = argv[++i];
  else only.push(argv[i]);
}
const versions = fs.existsSync(path.join(ROOT, 'releases'))
  ? fs.readdirSync(path.join(ROOT, 'releases')).filter(v => /^\d{8}[a-z]$/.test(v)).sort() : [];
if (!VERSION) VERSION = versions[versions.length - 1];
if (!VERSION || !fs.existsSync(path.join(ROOT, 'releases', VERSION))) {
  console.error('No saved version to check' + (VERSION ? ': releases/' + VERSION + ' is missing' : '') + '.');
  process.exit(1);
}
const DIR = path.join(ROOT, 'releases', VERSION);
console.log('Checking version ' + VERSION + ' (releases/' + VERSION + ')\n');

/* The page safety list: the only outside places a page may use. A new outside service is
   added to the page's Content-Security-Policy AND here, or this check fails. */
const RELAY = 'https://rgvdi67cg27o5kcmiytcqbqnrm0hmztx.lambda-url.us-east-1.on.aws';
const SAFETY_LIST = {
  'index.html': [RELAY, 'https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net', 'https://tessdata.projectnaptha.com'],
  'review.html': [RELAY, 'https://fonts.googleapis.com', 'https://fonts.gstatic.com']
};
const SAFETY_MUST = ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"];

const results = [];
let browser;
async function check(name, fn) {
  if (only.length && !only.some(o => name.toLowerCase().includes(o.toLowerCase()))) return;
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true }); console.log('  PASS  ' + name + '  (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)'); }
  catch (e) { results.push({ name, ok: false, why: e.message }); console.log('  FAIL  ' + name + '\n        ' + String(e.message).split('\n').join('\n        ')); }
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }
const noErrors = (errs, where) => expect(!errs.length, 'Page errors' + (where ? ' (' + where + ')' : '') + ':\n' + errs.join('\n'));
const read = f => fs.readFileSync(f, 'utf8');
const wait = (s, ms) => s.page.waitForTimeout(ms);
async function nav(page, name) {
  await page.evaluate(n => { const b = [...document.querySelectorAll('#rail-nav button')].find(x => x.textContent.trim().startsWith(n)); if (b) b.click(); }, name);
  await page.waitForTimeout(500);
}
function notices(store, slug) { return ((store.S['so-' + slug + '|notify/' + slug + '.json'] || {}).notices) || []; }
function inlineScripts(html) {
  const out = []; const re = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g; let m;
  while ((m = re.exec(html))) { if (/type=["'](?!text\/javascript|module)/.test(m[1])) continue; out.push(m[2]); }
  return out;
}
function tracked(dir) {
  const out = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d)) {
      if (f === '.git' || f === 'node_modules' || f === 'test-results') continue;
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p); else out.push(p);
    }
  })(dir);
  return out;
}

(async () => {
  /* ================================================================ without a browser */

  await check('Every script in the version and the live page parses', async () => {
    const bad = [];
    for (const dir of [DIR, ROOT]) {
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f), where = path.relative(ROOT, p);
        if (f.endsWith('.html')) inlineScripts(read(p)).forEach((src, i) => {
          try { new vm.Script(src, { filename: where + ' script ' + (i + 1) }); } catch (e) { bad.push(where + ' script ' + (i + 1) + ': ' + e.message); }
        });
        if (f.endsWith('.js') && dir === DIR) { try { new vm.Script(read(p), { filename: where }); } catch (e) { bad.push(where + ': ' + e.message); } }
      }
    }
    expect(!bad.length, bad.join('\n'));
  });

  await check('No keys, tokens or passwords anywhere in the repository', async () => {
    const pats = [
      [/gh[pousr]_[A-Za-z0-9]{30,}/, 'a GitHub token'], [/github_pat_[A-Za-z0-9_]{40,}/, 'a GitHub token'],
      [/sk-ant-[A-Za-z0-9_-]{20,}/, 'an Anthropic key'], [/AKIA[0-9A-Z]{16}/, 'an AWS key'],
      [/xox[abprs]-[A-Za-z0-9-]{10,}/, 'a Slack token'], [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
      [/Bearer [A-Za-z0-9._~+\/-]{30,}/, 'a sign-in token'],
      [/["']?(password|passwd|secret|api[_-]?key)["']?\s*[:=]\s*["'][^"'\s]{8,}["']/i, 'a password or key']
    ];
    const bad = [];
    for (const p of tracked(ROOT)) {
      if (/\.(png|pdf|jpg|ico)$/i.test(p)) continue;
      const t = read(p), rel = path.relative(ROOT, p);
      for (const [re, what] of pats) { const m = t.match(re); if (m) bad.push(rel + ': looks like ' + what + ' (' + m[0].slice(0, 12) + '…)'); }
    }
    expect(!bad.length, bad.join('\n'));
  });

  await check('Saving is set right', async () => {
    const html = read(path.join(DIR, 'index.html'));
    const m = html.match(/<script>window\.RELAY=(\{[\s\S]*?\});<\/script>/);
    expect(m, 'index.html has no window.RELAY settings');
    const cfg = JSON.parse(m[1]);
    expect(cfg.base === RELAY, 'window.RELAY.base is not the save relay: ' + cfg.base);
    expect(Array.isArray(cfg.projects) && cfg.projects.length, 'window.RELAY.projects is empty');
    const bad = [];
    cfg.projects.forEach(k => {
      if (!/^so-[a-z0-9]+(-hours)?$/.test(k)) bad.push('project key ' + k + ' is not a Service Orders key');
      if (!cfg.slugs || !cfg.slugs[k]) bad.push('project key ' + k + ' has no slug');
    });
    (cfg.lite || []).forEach(k => {
      if (!/-hours$/.test(k)) bad.push('hours-only key ' + k + ' does not end in -hours');
      if (cfg.projects.indexOf(k) < 0) bad.push('hours-only key ' + k + ' is not in projects');
    });
    cfg.projects.filter(k => /-hours$/.test(k)).forEach(k => { if ((cfg.lite || []).indexOf(k) < 0) bad.push(k + ' must be listed as hours-only (lite)'); });
    // Every save goes through the relay module, which retries on a version clash instead of overwriting.
    if (!/if \(e\.conflict && tries > 1\) return update\(/.test(html)) bad.push('update() no longer retries on a version clash');
    if (!/\(e\.conflict \|\| e\.status === 409\) && tries > 1\) return updateData\(/.test(html)) bad.push('updateData() no longer retries on a version clash');
    if (!/parentSha/.test(html)) bad.push('saves no longer send the version they read (parentSha)');
    const fetches = (html.match(/\bfetch\(/g) || []).length;
    if (fetches !== 2) bad.push('index.html calls fetch() ' + fetches + ' times; only the relay module may (sign-in and send), so every save goes through it');
    const rv = read(path.join(DIR, 'review.html'));
    if (!/e\.status === 409 && tries > 1\) return decide\(/.test(rv)) bad.push('review.html no longer re-reads on a version clash');
    expect(!bad.length, bad.join('\n'));
  });

  await check('Every page has its safety list', async () => {
    const bad = [];
    for (const f of Object.keys(SAFETY_LIST)) {
      const html = read(path.join(DIR, f));
      const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
      if (!m) { bad.push(f + ': no Content-Security-Policy'); continue; }
      const csp = m[1];
      SAFETY_MUST.forEach(d => { if (csp.indexOf(d) < 0) bad.push(f + ': safety list is missing ' + d); });
      if (/(^|[\s;])\*(\s|;|$)|https:(\s|;|$)/.test(csp)) bad.push(f + ': safety list allows any site');
      if (/'unsafe-eval'/.test(csp)) bad.push(f + ': safety list allows eval');
      const hosts = (csp.match(/https:\/\/[a-z0-9.-]+/g) || []);
      hosts.forEach(h => { if (SAFETY_LIST[f].indexOf(h) < 0) bad.push(f + ': ' + h + ' is in the page safety list but not in tests/run.js SAFETY_LIST'); });
      // every outside address the page (and its scripts) uses must be on its list
      let used = html;
      if (f === 'index.html') used += read(path.join(DIR, 'expenses-app.js'));
      (used.match(/https:\/\/[a-z0-9.-]+\.[a-z]{2,}/g) || []).forEach(h => {
        if (h === 'https://resources.mismo.org' || h === 'https://www.w3.org') return;
        if (hosts.indexOf(h) < 0 && bad.indexOf(f + ': uses ' + h + ', which is not on its safety list') < 0) bad.push(f + ': uses ' + h + ', which is not on its safety list');
      });
    }
    expect(!bad.length, bad.join('\n'));
  });

  await check('The version is stamped on the page', async () => {
    const bad = [];
    ['index.html', 'review.html'].forEach(f => {
      const m = read(path.join(DIR, f)).match(/<meta name="so-version" content="([^"]+)">/);
      if (!m) bad.push(f + ': no version stamp');
      else if (m[1] !== VERSION) bad.push(f + ': stamped ' + m[1] + ' but saved as ' + VERSION);
    });
    const live = (read(path.join(ROOT, 'index.html')).match(/<meta name="so-version" content="([^"]+)">/) || [])[1];
    const LIVE = fs.existsSync(path.join(ROOT, 'LIVE')) ? read(path.join(ROOT, 'LIVE')).trim() : '';
    if (live && LIVE && live !== LIVE) bad.push('the live page is ' + live + ' but LIVE says ' + LIVE + ' (was index.html uploaded by hand?)');
    if (live && !fs.existsSync(path.join(ROOT, 'releases', live))) bad.push('the live page is version ' + live + ', which is not saved in releases/');
    if (live && fs.existsSync(path.join(ROOT, 'releases', live))) {
      ['index.html', 'review.html', 'expenses-app.js'].forEach(f => {
        if (read(path.join(ROOT, f)) !== read(path.join(ROOT, 'releases', live, f))) bad.push('the live ' + f + ' differs from releases/' + live + ' (it was changed by hand; publish a version instead)');
      });
    }
    expect(!bad.length, bad.join('\n'));
  });

  await check('The checks use made-up companies only', async () => {
    const real = JSON.parse(read(path.join(DIR, 'index.html')).match(/<script>window\.RELAY=(\{[\s\S]*?\});<\/script>/)[1]);
    const realSlugs = new Set(Object.values(real.slugs || {}));
    const bad = [];
    Object.keys(FX.companies).forEach(s => { if (realSlugs.has(s)) bad.push('the sample company ' + s + ' is a real one'); });
    const text = read(path.join(__dirname, 'fixtures.js'));
    (text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]+/g) || []).forEach(e => { if (!/\.test$/.test(e)) bad.push('sample email ' + e + ' is not on the .test domain'); });
    expect(!bad.length, bad.join('\n'));
  });

  /* ================================================================ in a browser */
  browser = await chromium.launch();
  const opts = o => Object.assign({ browser, version: VERSION }, o || {});

  await check('Every screen opens without errors (staff, VP, President, company, contractor)', async () => {
    const broken = [];
    const store = mkStore();
    for (const who of ['admin', 'vp', 'president', 'sam', 'casey']) {
      const s = await open(opts({ who, store }));
      await wait(s, 3500);
      const names = await s.page.evaluate(() => [...document.querySelectorAll('#rail-nav button')].map(b => b.textContent.trim().replace(/\d+$/, '').trim()));
      if (!names.length && who === 'admin') broken.push('admin: no sections in the menu');
      for (const n of names) {
        const before = s.errs.length;
        await nav(s.page, n);
        if (s.errs.length > before) broken.push(who + ' › ' + n + ': ' + s.errs.slice(before).join(' | '));
      }
      if (s.errs.length) broken.push(who + ': ' + s.errs.join(' | '));
      const help = await s.page.evaluate(() => { const v = document.querySelector('.so-ver'); return v ? v.textContent : ''; });
      if (help.indexOf(VERSION) < 0 && names.indexOf('Help') >= 0) { await nav(s.page, 'Help'); }
      await s.close();
    }
    expect(!broken.length, [...new Set(broken)].join('\n'));
  });

  await check('Help shows the version, and the Test Copy says what it is', async () => {
    const s = await open(opts({ who: 'admin' }));
    await wait(s, 3500); await nav(s.page, 'Help');
    const ver = await s.page.evaluate(() => (document.querySelector('.so-ver') || {}).textContent || '');
    expect(ver.indexOf(VERSION) >= 0, 'Help does not show version ' + VERSION + ' (shows "' + ver + '")');
    const banner = await s.page.evaluate(() => (document.getElementById('so-testcopy') || {}).textContent || '');
    expect(/Test Copy/.test(banner) && banner.indexOf(VERSION) >= 0, 'the Test Copy banner is missing');
    noErrors(s.errs); await s.close();
  });

  await check('Sign-in: a wrong password counts once, and a locked account is told how to unlock', async () => {
    const store = mkStore();
    const s = await open(opts({ who: 'casey', store, noSession: true }));
    await wait(s, 2000);
    const email = await s.page.$('input[type=email]') || (await s.page.$$('input'))[0];
    await email.fill('casey@northwind.test');
    await s.page.fill('input[type=password]', 'wrong');
    await s.page.click('button:has-text("Sign In")'); await wait(s, 1500);
    expect(store.logins === 1, 'one wrong password was tried ' + store.logins + ' times (each try counts toward the lockout)');
    for (let i = 0; i < 5; i++) { await s.page.fill('input[type=password]', 'wrong'); await s.page.click('button:has-text("Sign In")'); await wait(s, 900); }
    const text = await s.page.evaluate(() => document.body.innerText);
    expect(/locked/i.test(text) && /reset/i.test(text), 'a locked account is not told how to unlock it');
    await s.close();
  });

  await check('A save made on an out-of-date copy merges instead of overwriting', async () => {
    const store = mkStore();
    const s = await open(opts({ who: 'admin', store }));
    await wait(s, 3500); await nav(s.page, 'New Service Order');
    // a teammate saves to the same file just before this save arrives
    store.beforeCommit = (body, proj, bump) => {
      const k = 'so-northwind|revisions/northwind.json';
      const cur = store.S[k] || { additions: [] };
      cur.additions = (cur.additions || []).concat([{ id: 'new-teammate', subject: 'Teammate order', raisedBy: 'A Teammate' }]);
      store.S[k] = cur; bump();
    };
    await s.page.selectOption('select[data-k="__slug"]', 'northwind'); await wait(s, 200);
    await s.page.fill('.nof[data-k="subject"]', 'FY 2027 Merge Check Order');
    await s.page.selectOption('.nof[data-k="soaLine"]', { index: 1 });
    await s.page.click('.no-go'); await wait(s, 2500);
    const adds = ((store.S['so-northwind|revisions/northwind.json'] || {}).additions || []).map(a => a.subject);
    expect(adds.indexOf('Teammate order') >= 0, "the teammate's save was overwritten: " + JSON.stringify(adds));
    expect(adds.indexOf('FY 2027 Merge Check Order') >= 0, 'this save was lost: ' + JSON.stringify(adds));
    noErrors(s.errs); await s.close();
  });

  await check('A new order goes requester › Jonna › VP › company › President, with reminders', async () => {
    const store = mkStore();
    let s = await open(opts({ who: 'admin', store }));
    await wait(s, 3500); await nav(s.page, 'New Service Order');
    await s.page.selectOption('select[data-k="__slug"]', 'northwind'); await wait(s, 200);
    await s.page.fill('.nof[data-k="subject"]', 'FY 2027 Sample Summit Workshop Facilitation');
    await s.page.selectOption('.nof[data-k="soaLine"]', { index: 1 });
    await s.page.fill('.nof[data-k="hourlyRate"]', '100'); await s.page.fill('.nof[data-k="estimatedHours"]', '20');
    await s.page.fill('.nof[data-k="services"]', 'Plan the workshop\n[enter further services here]');
    await s.page.click('.no-go'); await wait(s, 800);
    expect(!(store.S['so-northwind|revisions/northwind.json'] || {}).additions, 'an order with [bracketed] gaps went out with nobody to fill them in');
    await s.page.selectOption('select.no-rev', 'riley@mismo.test');
    await s.page.click('.no-go'); await wait(s, 2500);
    noErrors(s.errs, 'raising'); await s.close();
    const rid = Object.keys((store.S['team-hq|data/soreviews.json'] || {}).docs || {})[0];
    expect(rid, 'no review was requested');
    expect(notices(store, 'northwind').some(n => n.kind === 'order-review-requested' && n.to === 'riley@mismo.test'), 'the requester was not emailed');

    // the requester cannot approve with gaps; fills them in and sends it back
    s = await open(opts({ who: 'riley', store, path: 'review.html#r=' + rid }));
    await wait(s, 2500);
    expect(!(await s.page.$('#ok')), 'the requester could approve an order that still has [bracketed] gaps');
    await s.page.fill('#e-services', 'Plan the workshop\nRun the workshop at the summit');
    await s.page.click('#no'); await wait(s, 1500);
    expect(store.S['team-hq|data/soreviews.json'].docs[rid].state === 'revised', 'the requester\'s changes were not sent back');
    noErrors(s.errs, 'review page'); await s.close();

    // back to Jonna in Needs You; she uses the changes and it goes to the VP
    s = await open(opts({ who: 'admin', store }));
    await wait(s, 4000); await nav(s.page, 'Needs You');
    const row = await s.page.evaluateHandle(() => [...document.querySelectorAll('.row, tr, button, a')].find(e => /Changes From Riley/.test(e.textContent) && e.offsetParent));
    expect(row.asElement(), 'the requester\'s changes are not in Needs You');
    await row.asElement().click(); await wait(s, 800);
    await s.page.click('[data-rvuse]'); await wait(s, 2000);
    noErrors(s.errs, 'Needs You'); await s.close();
    expect(notices(store, 'northwind').some(n => n.kind === 'order-review-approved' && n.to === 'victor@mismo.test'), 'the VP was not emailed');

    // the VP approves: it goes to the company with Jonna copied, and reminders are scheduled
    s = await open(opts({ who: 'vp', store }));
    await wait(s, 3500);
    const vrow = await s.page.evaluateHandle(() => [...document.querySelectorAll('.row, tr, button, a, [data-row]')].find(e => /Summit Workshop/.test(e.textContent) && e.offsetParent && e.children.length < 8));
    if (vrow.asElement()) { await vrow.asElement().click(); await wait(s, 800); }
    await s.page.click('.vpone'); await wait(s, 2500);
    noErrors(s.errs, 'VP'); await s.close();
    const N = notices(store, 'northwind');
    const sent = N.find(n => n.kind === 'order-sent-to-company');
    expect(sent && sent.to === 'sam@northwind.test' && sent.cc === 'jcritchley@mismo.org', 'the company was not emailed with Jonna copied');
    expect(N.filter(n => n.kind === 'order-reminder' && n.sent === 'scheduled').length === 3, 'three weekly reminders were not scheduled');
    expect(N.some(n => n.kind === 'order-not-signed' && n.sent === 'scheduled'), 'the four-week notice to Jonna was not scheduled');

    // the company accepts: reminders stop and the President is emailed with Jonna copied
    s = await open(opts({ who: 'sam', store }));
    await wait(s, 3500); await nav(s.page, 'To Review');
    for (const t of await s.page.$$('.qtick')) await t.check();
    await s.page.fill('#ackname', 'Sam Signer'); await s.page.fill('#acktitle', 'Director');
    await s.page.click('button:has-text("Accept the Ticked Orders")'); await wait(s, 2500);
    noErrors(s.errs, 'company'); await s.close();
    const N2 = notices(store, 'northwind');
    expect(!N2.some(n => n.sent === 'scheduled'), 'reminders were still waiting after the company accepted');
    const pres = N2.find(n => n.kind === 'order-to-president');
    expect(pres && pres.to === 'pat@mismo.test' && pres.cc === 'jcritchley@mismo.org', 'the President was not emailed with Jonna copied');
  });

  await check('New Service Order drafts save, reopen and send', async () => {
    const store = mkStore();
    let s = await open(opts({ who: 'admin', store }));
    await wait(s, 3500); await nav(s.page, 'New Service Order');
    await s.page.selectOption('select[data-k="__slug"]', 'northwind'); await wait(s, 200);
    await s.page.selectOption('select.no-rev', 'riley@mismo.test');
    await s.page.fill('.nof[data-k="subject"]', 'FY 2027 Draft Check Order');
    await s.page.selectOption('.nof[data-k="soaLine"]', { index: 1 });
    await s.page.click('.no-save'); await wait(s, 1500);
    const docs = (store.S['team-hq|data/sodrafts.json'] || {}).docs || {};
    expect(Object.keys(docs).length === 1, 'the draft was not saved');
    expect(!(store.S['so-northwind|revisions/northwind.json'] || {}).additions, 'saving a draft sent it');
    noErrors(s.errs); await s.close();
    s = await open(opts({ who: 'admin', store }));
    await wait(s, 3500); await nav(s.page, 'New Service Order');
    await s.page.check('#nod-all'); await s.page.click('#nod-send'); await wait(s, 2500);
    expect(Object.keys(store.S['team-hq|data/sodrafts.json'].docs).length === 0, 'a sent draft stayed on Your Drafts');
    expect((store.S['so-northwind|revisions/northwind.json'].additions || []).some(a => a.subject === 'FY 2027 Draft Check Order'), 'the draft was not sent');
    noErrors(s.errs); await s.close();
  });

  await check('An approved expense invoice goes to accounts payable with its PDF, Jonna copied', async () => {
    const store = mkStore();
    store.S['so-northwind|hours/casey-c-fy2027.json'] = { person: 'Casey Contractor', slug: 'casey-c', fiscalYear: 'FY 2027', weeks: [], expenses: [
      { id: 'x1', date: '11/02/26', cat: 'Taxi/Uber/Lyft', amt: 30, desc: 'Taxi to the hotel', trip: 'Sample Summit', receipt: true, rcptAmt: 30, state: 'draft' }] };
    let s = await open(opts({ who: 'casey', store }));
    await wait(s, 2500); await nav(s.page, 'My Expenses');
    await s.page.click('#xp-send'); await wait(s, 1200);
    noErrors(s.errs, 'contractor'); await s.close();
    expect(store.S['so-northwind|hours/casey-c-fy2027.json'].expenses[0].state === 'submitted', 'the expense report was not submitted');
    s = await open(opts({ who: 'sam', store }));
    await wait(s, 2500); await nav(s.page, 'My Invoices');
    await s.page.click('[data-panel="clm-0"]'); await wait(s, 400);
    await s.page.setInputFiles('#panel-body [data-clm-file="0"]', path.join(__dirname, 'sample-invoice.pdf')); await wait(s, 800);
    await s.page.fill('#panel-body [data-clm-num="0"]', 'INV-1');
    await s.page.fill('#panel-body [data-clm-total="0"]', '30.00'); await s.page.dispatchEvent('#panel-body [data-clm-total="0"]', 'input');
    await s.page.click('#panel-body [data-clm-go="0"]'); await wait(s, 1500);
    noErrors(s.errs, 'company invoice'); await s.close();
    s = await open(opts({ who: 'admin', store }));
    await wait(s, 3500); await nav(s.page, 'Invoices');
    await s.page.click('.row .row-h'); await wait(s, 300);
    await s.page.click('[data-ivok]'); await wait(s, 1500);
    noErrors(s.errs, 'approving'); await s.close();
    const ap = notices(store, 'northwind').find(n => n.kind === 'invoice-to-payable');
    expect(ap, 'no accounts payable email was queued');
    expect(ap.to === 'Accounts.Payable@mortgagebankers.org' && ap.cc === 'jcritchley@mismo.org', 'the accounts payable email is not to AP with Jonna copied');
    expect(ap.file && /^invoices\/files\//.test(ap.file) && store.S['so-northwind|' + ap.file], 'the invoice PDF is not attached');
    expect(/^Invoice to Process/.test(ap.title || ''), 'the accounts payable email is not titled Invoice to Process');
  });

  await check('The Expenses phone app opens on a phone', async () => {
    const s = await open(opts({ who: 'casey', path: '?app=expenses', viewport: { width: 390, height: 844 } }));
    await wait(s, 3000);
    const app = await s.page.evaluate(() => document.documentElement.classList.contains('soxp'));
    expect(app, 'the phone app did not start');
    noErrors(s.errs); await s.close();
  });

  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log('\n' + (results.length - failed.length) + ' passed, ' + failed.length + ' failed');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
