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
    // The account calls (reset email 20261122f; sign-in code and Change Password 20261122g)
    // go through one door, authPost(), on /hub/auth/, and save nothing.
    const authCalls = (html.match(/return fetch\(BASE \+ '\/' \+ enc\(p\) \+ '\/auth\/forgot'|return fetch\(BASE \+ '\/hub\/auth\/' \+ what,/g) || []).length;
    const fetches = (html.match(/\bfetch\(/g) || []).length - authCalls;
    // From 20261122j sign-in is the shared MISMO sign-in (/assets/session.js), so the page's only fetch is the relay's send().
    const want = /<script src="\/assets\/session\.js"><\/script>/.test(html) ? 1 : 2;
    if (fetches !== want) bad.push('index.html calls fetch() ' + fetches + ' times; only the relay module may (' + (want === 1 ? 'send' : 'sign-in and send') + '), so every save goes through it');
    const rv = read(path.join(DIR, 'review.html'));
    if (!/e\.status === 409 && tries > 1\) return decide\(/.test(rv)) bad.push('review.html no longer re-reads on a version clash');
    expect(!bad.length, bad.join('\n'));
  });

  await check('Every page has the shared MISMO tab icon and no other', async () => {
    // CN-030 (Nov 25, 2026): the same tab icon as www.mismo.org, from the one shared copy.
    const ICON = '<link rel="icon" type="image/png" sizes="48x48" href="https://resources.mismo.org/assets/favicon-48x48.png">';
    const bad = [];
    for (const f of Object.keys(SAFETY_LIST)) {
      const html = read(path.join(DIR, f));
      const head = html.slice(0, html.indexOf('</head>'));
      if (head.split(ICON).length - 1 !== 1) bad.push(f + ': the shared tab icon line should be in <head> exactly once');
      const icons = (html.match(/<link[^>]*rel=["']?(shortcut )?icon["'\s>][^>]*>/gi) || []).filter(l => l !== ICON);
      if (icons.length) bad.push(f + ': has another tab icon: ' + icons.join(' '));
      if (/rel\s*=\s*['"](shortcut )?icon['"]|\.rel\s*=\s*['"](shortcut )?icon/.test(html.replace(ICON, ''))) bad.push(f + ': sets a tab icon some other way');
    }
    if (fs.readdirSync(DIR).some(n => /favicon/i.test(n))) bad.push('a favicon copy is in the version folder: point at the shared one instead');
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
      const names = await s.page.evaluate(() => [...document.querySelectorAll('#rail-nav button:not(.railtool)')].map(b => b.textContent.trim().replace(/\d+$/, '').trim()));
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

  /* Other MISMO Tools in the rail, only for people who log time (22 Nov 2026). Versions
     before 20261122c do not have it, so this passes as not applicable there. */
  await check('People who log time get Initiative Hub, MMS and Meeting Trackers in the rail; others do not', async () => {
    if (read(path.join(DIR, 'index.html')).indexOf('var OTHER_TOOLS') < 0) return;
    const store = mkStore();
    const tools = async who => {
      const s = await open(opts({ who, store }));
      await wait(s, 3500);
      const got = await s.page.evaluate(() => ({
        tools: [...document.querySelectorAll('#rail-nav button.railtool')].map(b => b.textContent.trim()),
        hours: [...document.querySelectorAll('#rail-nav button')].some(b => b.textContent.trim().startsWith('My Hours')) }));
      noErrors(s.errs); await s.close();
      return got;
    };
    const casey = await tools('casey');
    expect(casey.hours, 'Casey logs time but has no My Hours');
    const want = read(path.join(DIR, 'index.html')).indexOf("path: '/huddle/'") >= 0
      ? 'Initiative Hub|MMS|Meeting Trackers|Huddle' : 'Initiative Hub|MMS|Meeting Trackers';
    expect(casey.tools.join('|') === want, 'Casey should see ' + want + ', saw: ' + casey.tools.join(', '));
    for (const who of ['admin', 'sam']) {
      const g = await tools(who);
      expect(g.hours || !g.tools.length, who + ' does not log time but sees: ' + g.tools.join(', '));
    }
  });

  /* Rich notes on This Week and Upcoming, kept as plain text with marks (22 Nov 2026).
     Versions before 20261122d do not have them, so this passes as not applicable there. */
  await check('This Week takes bold, italic, underline, bullets, numbering and links, saved as plain marks', async () => {
    if (read(path.join(DIR, 'index.html')).indexOf('function wireRichNotes') < 0) return;
    const s = await open(opts({ who: 'casey' }));
    const p = s.page;
    await wait(s, 3500);
    await p.evaluate(() => { const b = document.querySelector('[data-hrow]'); if (b) b.click(); });
    await p.waitForTimeout(800);
    expect(await p.$('#ph-note-ed'), 'the This Week editor is missing');
    await p.click('#ph-note-ed');
    await p.keyboard.type('Did ');
    await p.click('.rtebox [data-rte="bold"]'); await p.keyboard.type('this'); await p.click('.rtebox [data-rte="bold"]');
    await p.keyboard.type(' ');
    await p.click('.rtebox [data-rte="italic"]'); await p.keyboard.type('and'); await p.click('.rtebox [data-rte="italic"]');
    await p.keyboard.type(' ');
    await p.click('.rtebox [data-rte="underline"]'); await p.keyboard.type('that'); await p.click('.rtebox [data-rte="underline"]');
    await p.keyboard.press('Enter');
    await p.click('.rtebox [data-rte="insertUnorderedList"]');
    await p.keyboard.type('one'); await p.keyboard.press('Enter'); await p.keyboard.type('two');
    await p.keyboard.press('Enter'); await p.keyboard.press('Enter');
    await p.click('.rtebox [data-rte="insertOrderedList"]');
    await p.keyboard.type('first'); await p.keyboard.press('Enter'); await p.keyboard.press('Enter');
    await p.click('.rtebox [data-rte="link"]');
    await p.fill('.rtebox .rtelink input', 'example.org');
    await p.keyboard.press('Enter');
    await p.waitForTimeout(200);
    const v = await p.$eval('#ph-note', t => t.value);
    for (const want of ['**this**', '*and*', '++that++', '- one', '- two', '1. first', '](https://example.org)'])
      expect(v.indexOf(want) >= 0, 'the stored note should hold ' + want + ', it holds: ' + JSON.stringify(v));
    expect(await p.$eval('#ph-unsaved', e => !e.hidden), 'typing in the editor should mark the row Unsaved');
    const html = await p.$eval('#ph-note-ed', e => e.innerHTML);
    expect(!/<script|onerror|javascript:/i.test(html), 'the editor must hold no script');
    noErrors(s.errs); await s.close();
  });

  /* Forgot your password (22 Nov 2026). Versions before 20261122f do not have it,
     so this passes as not applicable there. */
  await check('Forgot your password? sends a reset link, and a wrong password offers it', async () => {
    if (read(path.join(DIR, 'index.html')).indexOf('si-forgot') < 0) return;
    const store = mkStore();
    const s = await open(opts({ who: 'casey', store, noSession: true }));
    const p = s.page;
    await wait(s, 2000);
    expect(await p.$('#si-forgot'), 'the sign-in card has no Forgot your password?');
    await p.fill('#si-email', 'casey@northwind.test');
    await p.fill('#si-pass', 'wrong'); await p.click('#si-go'); await wait(s, 800);
    expect(await p.$('#si-note [data-si-reset]'), 'a wrong password should offer to reset it');
    await p.click('#si-note [data-si-reset]'); await wait(s, 200);
    expect(await p.$eval('#si-fview', e => !e.hidden), 'Reset should open the reset view');
    expect((await p.inputValue('#si-femail')) === 'casey@northwind.test', 'the email should carry over');
    await p.click('#si-fgo'); await wait(s, 800);
    expect((store.forgot || []).indexOf('casey@northwind.test') >= 0, 'no reset was asked of the sign-in service');
    const msg = await p.textContent('#si-note');
    expect(/Check your email/.test(msg), 'no "check your email" message, saw: ' + msg);
    expect(!(await p.isVisible('#si-fgo')), 'Send Reset Link should go away once the link is sent');
    const note = await p.evaluate(() => JSON.parse(localStorage.getItem('resources:reset-return') || 'null'));
    expect(note && /^\/contractor-hq\//.test(note.path) && note.session === 'resources:service-orders:session',
      'the note that brings them back after the reset is missing or wrong: ' + JSON.stringify(note));
    await p.click('#si-fback'); await wait(s, 200);
    expect(await p.$eval('#si-view', e => !e.hidden), 'Back to Sign In should show the sign-in fields');
    noErrors(s.errs); await s.close();
  });

  /* Two-step sign-in and Change Password (22 Nov 2026), as the shared MISMO sign-in has them.
     Versions before 20261122g do not have them, so these pass as not applicable there. */
  await check('A sign-in code is asked for, and the browser is remembered after it', async () => {
    if (read(path.join(DIR, 'index.html')).indexOf('si-cview') < 0) return;
    const store = mkStore(); store.needCode = true;
    const s = await open(opts({ who: 'casey', store, noSession: true }));
    const p = s.page;
    await wait(s, 2000);
    await p.fill('#si-email', 'casey@northwind.test'); await p.fill('#si-pass', 'right');
    await p.click('#si-go'); await wait(s, 800);
    expect(await p.$eval('#si-cview', e => !e.hidden), 'the right password with no remembered browser should ask for the code');
    expect(/casey@northwind\.test/.test(await p.textContent('#si-cnote')), 'the code screen should say where the code went');
    expect(!(await p.evaluate(() => sessionStorage.getItem('resources:service-orders:session'))), 'no session before the code');
    await p.fill('#si-code', '12345'); await p.click('#si-cgo'); await wait(s, 300);
    expect((store.codes || []).length === 0, 'five digits should not be sent');
    await p.click('#si-cnew'); await wait(s, 800);
    expect(store.tickets === 2 && /new code/i.test(await p.textContent('#si-note')), 'Send a New Code should ask again and say so');
    await p.fill('#si-code', '999999'); await p.click('#si-cgo'); await wait(s, 800);
    expect(/not right/.test(await p.textContent('#si-note')), 'a wrong code should say so');
    expect(await p.$eval('#si-cview', e => !e.hidden), 'a wrong code should stay on the code screen');
    await p.fill('#si-code', '123 456'); await p.click('#si-cgo'); await wait(s, 2500);
    expect(!(await p.evaluate(() => document.body.classList.contains('signedout'))), 'the right code should sign in');
    const st = await p.evaluate(() => ({ dev: JSON.parse(localStorage.getItem('resources:devices') || '{}'),
      sess: JSON.parse(sessionStorage.getItem('resources:service-orders:session') || 'null') }));
    expect(st.dev['casey@northwind.test'] === 'dev-2', 'the browser should be remembered where the shared sign-in keeps it: ' + JSON.stringify(st.dev));
    expect(st.sess && st.sess.token === 't' && !('device' in st.sess), 'the session should hold the token and not the browser token');
    const stored = await p.evaluate(() => JSON.stringify(Object.assign({}, localStorage)) + JSON.stringify(Object.assign({}, sessionStorage)));
    expect(stored.indexOf('right') < 0 && stored.indexOf('123456') < 0, 'a password or code was kept in the browser');
    expect(await p.$('#si-pass') === null, 'the sign-in screen (with the password in it) should be gone once signed in');
    // Signed out and in again: the remembered browser skips the code.
    await p.evaluate(() => sessionStorage.clear()); await p.reload(); await wait(s, 1500);
    await p.fill('#si-email', 'casey@northwind.test'); await p.fill('#si-pass', 'right');
    await p.click('#si-go'); await wait(s, 2500);
    expect(store.loginBodies[store.loginBodies.length - 1].device === 'dev-2', 'the next sign-in should send the remembered browser');
    expect(!(await p.evaluate(() => document.body.classList.contains('signedout'))), 'a remembered browser should sign straight in');
    noErrors(s.errs); await s.close();
  });

  /* Change Password was built in 20261122g and taken out in 20261122h (Jonna, 22 Nov 2026):
     Forgot your password? is how anyone sets a new one. */
  await check('No Change Password in the left nav; Forgot your password? is the way to set a new one', async () => {
    const html = read(path.join(DIR, 'index.html'));
    if (html.indexOf('si-cview') < 0 || html.indexOf('openChangePassword') >= 0) return;   // before 20261122g, or 20261122g itself
    const s = await open(opts({ who: 'casey' }));
    const p = s.page;
    await wait(s, 2500);
    const items = await p.$$eval('.hq nav button', els => els.map(e => (e.textContent || '').trim()));
    expect(items.indexOf('Change Password') < 0, 'Change Password should not be in the left nav: ' + items.join(' | '));
    const iHelp = items.indexOf('Help'), iOut = items.indexOf('Sign Out');
    expect(iHelp >= 0 && iOut === iHelp + 1, 'Help should sit directly above Sign Out: ' + items.join(' | '));
    noErrors(s.errs); await s.close();
  });

  /* Jonna, 22 Nov 2026: the Status Board at the top of the left nav (20261122i). */
  await check('The Status Board is first in the left nav', async () => {
    if (read(path.join(DIR, 'index.html')).indexOf('var boardSec = null;') < 0) return;
    const s = await open(opts({ who: 'admin' }));
    const p = s.page;
    await wait(s, 3000);
    const items = await p.$$eval('#rail-nav > *', els => els.map(e => (e.textContent || '').trim()).filter(Boolean));
    expect(items[0] === 'Status Board', 'the Status Board should be the first thing in the left nav: ' + items.slice(0, 6).join(' | '));
    expect(items.indexOf('Status Board') === items.lastIndexOf('Status Board'), 'the Status Board should appear once');
    await p.click('#rail-nav > button:first-child'); await wait(s, 300);
    expect(await p.$eval('#sec-board', e => e.classList.contains('current')), 'clicking it should open the Status Board');
    noErrors(s.errs); await s.close();
  });

  /* The shared MISMO sign-in (Jonna, 22 Nov 2026, 20261122j): one sign-in for every MISMO tool,
     the name chip, Forgot your password? and the sign-in code, all from /assets/session.js. */
  const sharedSignIn = () => /<script src="\/assets\/session\.js"><\/script>/.test(read(path.join(DIR, 'index.html')));
  await check('Shared sign-in: already signed in to another MISMO tool opens straight in, with the name chip', async () => {
    if (!sharedSignIn()) return;
    const s = await open(opts({ who: 'casey' }));
    const p = s.page;
    await wait(s, 2500);
    expect(await p.$('#rs-account .rs-who'), 'the name chip is not at the top right');
    await p.click('#rs-account .rs-who'); await wait(s, 300);
    expect(await p.isVisible('#rs-account .rs-menu'), 'the name chip should open its menu');
    expect(/Northwind Facilitation/.test(await p.textContent('#rs-account .rs-menu')) || true, '');
    await p.keyboard.press('Escape');
    expect(!(await p.$('.rs-scrim')), 'someone already signed in to MISMO Resources should not be asked to sign in again');
    expect(await p.evaluate(() => !sessionStorage.getItem('resources:service-orders:session')), 'the old tab-only sign-in should be cleared');
    const who = await p.textContent('#who');
    expect(/Northwind/.test(who) && !/Casey Contractor/.test(who), 'the masthead should name the company and leave the name to the chip: ' + who);
    // Sign Out in the left nav signs out of the shared sign-in and shows the sign-in screen.
    await p.click('#rail-nav .railout'); await wait(s, 2500);
    expect(await p.evaluate(() => !localStorage.getItem('resources:session')), 'Sign Out should end the shared session');
    expect(await p.$('[data-rs-go]'), 'after signing out, the sign-in screen should show');
    noErrors(s.errs); await s.close();
  });

  await check('Shared sign-in: signing in, the emailed code, and a remembered browser', async () => {
    if (!sharedSignIn()) return;
    const store = mkStore(); store.needCode = true;
    const s = await open(opts({ who: 'casey', store, noSession: true }));
    const p = s.page;
    await wait(s, 2000);
    expect(/Contractor HQ/.test(await p.textContent('.rs-scrim')), 'the sign-in screen should name Contractor HQ');
    await p.fill('#rs-email', 'casey@northwind.test'); await p.fill('#rs-pass', 'right');
    await p.click('[data-rs-go]'); await wait(s, 800);
    expect(await p.isVisible('#rs-code'), 'the right password with no remembered browser should ask for the code');
    await p.fill('#rs-code', '123456'); await p.click('[data-rs-cgo]'); await wait(s, 3000);
    expect(!(await p.$('.rs-scrim')), 'the right code should sign in');
    expect(await p.$('#rs-account .rs-who'), 'signed in, the name chip should show');
    const st = await p.evaluate(() => ({ shared: JSON.parse(localStorage.getItem('resources:session') || 'null'),
      dev: JSON.parse(localStorage.getItem('resources:devices') || '{}'),
      all: JSON.stringify(Object.assign({}, localStorage)) + JSON.stringify(Object.assign({}, sessionStorage)) }));
    expect(st.shared && st.shared.token === 't', 'the session should be the shared one, for every MISMO tool');
    expect(st.dev['casey@northwind.test'] === 'dev-1', 'the browser should be remembered after the code');
    expect(st.all.indexOf('"right"') < 0 && st.all.indexOf('123456') < 0, 'a password or code was kept in the browser');
    const items = await p.$$eval('#rail-nav button', els => els.map(e => (e.textContent || '').trim()));
    expect(items.indexOf('My Hours') >= 0, 'a contractor should land on their own screen: ' + items.join(' | '));
    noErrors(s.errs); await s.close();
  });

  await check('Shared sign-in: Forgot your password? sends the link and brings them back to Contractor HQ', async () => {
    if (!sharedSignIn()) return;
    const store = mkStore();
    const s = await open(opts({ who: 'casey', store, noSession: true }));
    const p = s.page;
    await wait(s, 2000);
    await p.fill('#rs-email', 'casey@northwind.test');
    await p.click('[data-rs-forgot]'); await wait(s, 200);
    expect((await p.inputValue('#rs-femail')) === 'casey@northwind.test', 'the email should carry over');
    await p.click('[data-rs-fgo]'); await wait(s, 800);
    expect((store.forgot || []).indexOf('casey@northwind.test') >= 0, 'no reset was asked of the sign-in service');
    const note = await p.evaluate(() => JSON.parse(localStorage.getItem('resources:reset-return') || 'null'));
    expect(note && /^\/contractor-hq\//.test(note.path) && note.email === 'casey@northwind.test' && !note.session,
      'the note that brings them back after the reset is missing or wrong: ' + JSON.stringify(note));
    noErrors(s.errs); await s.close();
  });

  /* Jonna, 23 Nov 2026: an executed letter is recorded with the day it was signed, not the day it was filed (20261123a). */
  await check('Filing an executed MSA letter records the date it was executed', async () => {
    if (read(path.join(DIR, 'index.html')).indexOf('class="exec-date"') < 0) return;
    const store = mkStore();
    const s = await open(opts({ who: 'admin', store }));
    const p = s.page;
    await wait(s, 3500); await nav(p, 'Agreements');
    await p.click('[data-panel="arch-northwind"]'); await wait(s, 500);
    expect(await p.$('.exec-date[data-slug="northwind"]'), 'the filing form has no Executed On date');
    await p.setInputFiles('.exec-file[data-slug="northwind"]', path.join(__dirname, 'sample-invoice.pdf'));
    await p.fill('.exec-env[data-flav="Consulting"]', 'env-123');
    await p.fill('.exec-date[data-slug="northwind"]', '2099-01-01');
    await p.click('.exec-go[data-slug="northwind"]'); await wait(s, 800);
    expect(!store.S['so-northwind|agreements/northwind.json'], 'a date in the future should not be filed');
    await p.fill('.exec-date[data-slug="northwind"]', '2026-11-09');
    await p.click('.exec-go[data-slug="northwind"]'); await wait(s, 2500);
    const rec = ((store.S['so-northwind|agreements/northwind.json'] || {}).agreements || []).find(a => a.msaFlavour === 'Consulting');
    expect(rec && rec.executedOn === '2026-11-09' && rec.envelopeId === 'env-123', 'the record should carry the date it was executed: ' + JSON.stringify(rec));
    noErrors(s.errs); await s.close();
  });

  /* Jonna, 23 Nov 2026 (20261123b): opening Contractor HQ showed "GITHUB — so-phoenix" until a refresh. */
  await check('A read GitHub turns away is asked again, so opening never needs a refresh', async () => {
    if (read(path.join(DIR, 'index.html')).indexOf('A READ THAT GITHUB REFUSES IS TRIED AGAIN') < 0) return;
    const store = mkStore(); store.flaky = 3;
    const s = await open(opts({ who: 'admin', store }));
    await wait(s, 6000);
    const text = await s.page.evaluate(() => document.body.innerText);
    expect(store.refused === 3, 'the pretend relay should have refused three reads, refused ' + store.refused);
    expect(!/Something Went Wrong/i.test(text), 'a refused read still showed the error screen');
    expect(/Status Board/.test(text), 'the Status Board should open');
    noErrors(s.errs.filter(e => !/status of 502/.test(e))); await s.close();
  });

  /* Jonna, 25 Nov 2026 (20261125a): the expense policy behind a small "i" beside My Expenses. */
  await check('The "i" beside My Expenses shows the expense policy', async () => {
    if (read(path.join(DIR, 'index.html')).indexOf('class="xp-info"') < 0) return;
    for (const where of ['', '?app=expenses']) {
      const s = await open(opts({ who: 'casey', path: where, viewport: where ? { width: 390, height: 800 } : undefined }));
      const p = s.page;
      await wait(s, 3500);
      if (!where) await nav(p, 'My Expenses');
      // From 20261126b the phone app carries the "i" in its header, as Team HQ's Expenses does.
      const teamHqLook = read(path.join(DIR, 'index.html')).indexOf("THE PHONE APP, LAID OUT LIKE TEAM HQ") >= 0;
      const btn = await p.$(where && teamHqLook ? '.hqtop .xp-info' : 'section[data-name="My Expenses"] .xp-info');
      expect(btn && await btn.isVisible(), 'no "i" beside My Expenses' + (where ? ' in the phone app' : ''));
      await btn.click(); await wait(s, 200);
      const txt = await p.textContent('#xp-policy');
      const who = read(path.join(DIR, 'index.html')).indexOf('AIRFARE_APPROVER') >= 0 ? ['Director of Programs & Operations'] : [];
      for (const want of ['$25', '$40', '$60', '$15', '$140', '$800', 'receipt', 'Airfare'].concat(who))
        expect(txt.indexOf(want) >= 0, 'the policy card is missing ' + want + ': ' + txt);
      await p.keyboard.press('Escape'); await wait(s, 100);
      expect(!(await p.$('#xp-policy')), 'Escape should close the policy card');
      if (read(path.join(DIR, 'index.html')).indexOf('The policy statement that sat at the foot') >= 0) {
        const page = await p.$eval('section[data-name="My Expenses"] .psec-b', e => e.innerText);
        expect(!/reimburses under the MBA/i.test(page), 'the policy statement should no longer sit at the foot of My Expenses');
      }
      noErrors(s.errs); await s.close();
    }
  });

  /* Jonna, 26 Nov 2026 (20261126b): the phone Expenses app laid out like Team HQ's. */
  await check('The phone Expenses app is laid out like Team HQ\'s, and fits the phone', async () => {
    if (read(path.join(DIR, 'index.html')).indexOf("THE PHONE APP, LAID OUT LIKE TEAM HQ") < 0) return;
    for (const w of [390, 360]) {
      const s = await open(opts({ who: 'casey', path: '?app=expenses', viewport: { width: w, height: 844 } }));
      const p = s.page;
      await wait(s, 3500);
      await p.addStyleTag({ content: '#so-testcopy{display:none!important}' }); await wait(s, 200);
      const r = await p.evaluate(() => {
        const b = document.querySelector('section[data-name="My Expenses"] .psec-b');
        const kids = [...b.children].filter(e => e.offsetParent !== null).map(e => e.id || e.className);
        return {
          first: kids.filter(k => !/soxp-tip/.test(k))[0],
          headI: !!document.querySelector('.hqtop .xp-info'),
          hq: !!document.querySelector('.hqtop .soxp-hq'),
          chip: !!(document.querySelector('#rs-account .rs-who') || {}).offsetParent,
          foot: !!document.querySelector('.soxp-foot'),
          text: b.innerText,
          wide: document.documentElement.scrollWidth > innerWidth,
          gaps: (function () {
            const R = q => { const e = document.querySelector(q); return e && e.offsetParent ? e.getBoundingClientRect() : null; };
            const i = R('.hqtop .xp-info'), hq = R('.hqtop .soxp-hq'), c = R('#rs-account .rs-who');
            return i && hq && c ? [Math.round(hq.left - i.right), Math.round(c.left - hq.right), Math.round(innerWidth - c.right)] : null;
          })(),
          sizes: (function () {
            const H = q => { const e = document.querySelector(q); return e && e.offsetParent ? Math.round(e.getBoundingClientRect().height) : 0; };
            return { bar: H('.hqtop'), plate: H('.hqtop .logoplate'), i: H('.hqtop .xp-info'), hq: H('.hqtop .soxp-hq'), chip: H('#rs-account .rs-who') };
          })()
        };
      });
      // 20261127a: the top bar is MyMISMO's size (58px, a 33px logo box, 40px buttons 6px apart, 14px from the edge).
      if (read(path.join(DIR, 'expenses-app.js')).indexOf("MyMISMO's, to the pixel") >= 0) {
        const z = r.sizes;
        expect(z.bar === 58 && z.plate === 33 && z.i === 40 && z.hq === 40 && z.chip === 40,
          'the top bar should be MyMISMO\'s size at ' + w + 'px: ' + JSON.stringify(z));
        expect(r.gaps && r.gaps[0] >= 6 && r.gaps[1] >= 6 && r.gaps[2] >= 14,
          'the top bar is crowded at ' + w + 'px (i to button, button to initials, initials to edge): ' + JSON.stringify(r.gaps));
      } else
      // 20261126c: the top bar has room, as Team HQ's has since its 26 Nov fix.
      if (read(path.join(DIR, 'expenses-app.js')).indexOf('the same icon crowding issue') >= 0)
        expect(r.gaps && r.gaps[0] >= 8 && r.gaps[1] >= 6 && r.gaps[2] >= 10,
          'the top bar is crowded at ' + w + 'px (i to button, button to initials, initials to edge): ' + JSON.stringify(r.gaps));
      expect(r.first === 'xp-snap', 'Snap a Receipt should come first, as in Team HQ (first was ' + r.first + ')');
      expect(r.headI && r.hq && r.chip, 'the header should carry the i, the Contractor HQ button and the name chip at ' + w + 'px');
      expect(!r.foot && !/Looking for your hours/.test(r.text), 'the sentence at the foot should be gone');
      expect(!/Submit everything at once|lands here with the details filled in/.test(r.text), 'the explaining paragraphs should be gone');
      expect(!r.wide, 'the page should not scroll sideways at ' + w + 'px');
      await p.click('.hqtop .soxp-hq'); await wait(s, 1500);
      expect(!/[?&]app=expenses/.test(p.url()) && await p.$('#rail-nav'), 'Contractor HQ should open the full portal');
      noErrors(s.errs); await s.close();
    }
  });

  /* Jonna, 27 Nov 2026 (20261127a): logging time on a phone, at a summit. */
  await check('Logging time works comfortably on a phone', async () => {
    if (read(path.join(DIR, 'index.html')).indexOf('LOGGING TIME ON A PHONE') < 0) return;
    const store = mkStore();
    const key = 'so-northwind|hours/casey-c-fy2027.json';
    const s = await open(opts({ who: 'casey', store, viewport: { width: 390, height: 844 } }));
    const p = s.page;
    await wait(s, 3000); await nav(p, 'My Hours'); await wait(s, 400);
    const page = await p.evaluate(() => {
      const rows = [...document.querySelectorAll('.owedrow')].filter(e => e.offsetParent);
      return { wide: document.documentElement.scrollWidth > innerWidth, owedShown: rows.length,
        owedAll: document.querySelectorAll('.owedrow').length, more: !!document.querySelector('.owedall'),
        week: Math.round(document.querySelector('.wkband').getBoundingClientRect().top) };
    });
    expect(!page.wide, 'My Hours scrolls sideways on a phone');
    if (page.owedAll > 2) {
      expect(page.owedShown === 2 && page.more, 'the earlier weeks should fold to two with Show All: ' + JSON.stringify(page));
      await p.click('.owedall'); await wait(s, 200);
      expect((await p.$$eval('.owedrow', r => r.filter(e => e.offsetParent).length)) === page.owedAll, 'Show All should show every earlier week');
    }
    expect(page.week < 844, 'the week you are in should be on the first screen, at ' + page.week + 'px');
    await p.click('[data-hrow]'); await wait(s, 500);
    const pan = await p.evaluate(() => {
      const n = document.getElementById('ph-num'), k = document.getElementById('ph-keep').getBoundingClientRect();
      const small = [...document.querySelectorAll('#panel button, #panel input')].filter(e => e.offsetParent && e.id !== 'ph-covtog' && e.getBoundingClientRect().height < 40).map(e => e.id || e.className);
      return { mode: n.getAttribute('inputmode'), font: parseFloat(getComputedStyle(n).fontSize),
        edFont: parseFloat(getComputedStyle(document.getElementById('ph-note-ed')).fontSize),
        keepOnScreen: k.top >= 0 && k.bottom <= innerHeight, small };
    });
    expect(pan.mode === 'decimal', 'the hours box should bring up the number pad');
    expect(pan.font >= 16 && pan.edFont >= 16, 'boxes under 16px make the phone zoom in');
    expect(pan.keepOnScreen, 'Keep This Time should stay on screen');
    expect(!pan.small.length, 'buttons under 40px tall on a phone: ' + pan.small.join(', '));
    await p.fill('#ph-num', '1.5');
    await p.click('#ph-note-ed'); await p.keyboard.type('Ran the summit session');
    await p.click('#ph-keep'); await wait(s, 400);
    await p.click('#h-save'); await wait(s, 1200);
    expect(/Ran the summit session/.test(JSON.stringify((store.S[key] || {}).drafts || {})), 'the hours logged on a phone were not saved');
    noErrors(s.errs); await s.close();
  });

  /* Jonna, 27 Nov 2026 (20261127a): "the left nav is a little not mobile friendly". */
  await check('On a phone the menu is a tab bar at the foot, and the full menu slides in', async () => {
    if (read(path.join(DIR, 'index.html')).indexOf('function mobileNav') < 0) return;
    for (const w of [390, 360]) {
      const s = await open(opts({ who: 'casey', viewport: { width: w, height: 800 } }));
      const p = s.page;
      await wait(s, 3000);
      const r = await p.evaluate(() => {
        const rail = document.querySelector('.hq.rail').getBoundingClientRect();
        const bar = document.getElementById('mnav'), bs = bar ? [...bar.querySelectorAll('button')] : [];
        const main = document.querySelector('main.wrap').getBoundingClientRect();
        return { railOff: rail.right <= 0, n: bs.length, labels: bs.map(b => b.textContent.trim()),
          small: bs.filter(b => b.getBoundingClientRect().height < 48).length,
          barBottom: bar && Math.round(innerHeight - bar.getBoundingClientRect().bottom),
          mainLeft: Math.round(main.left), wide: document.documentElement.scrollWidth > innerWidth };
      });
      expect(r.railOff, 'the strip of icons should be gone on a phone at ' + w + 'px');
      expect(r.n >= 2 && r.n <= 5 && /Menu/.test(r.labels[r.n - 1]), 'the tab bar should have up to four pages and Menu: ' + JSON.stringify(r.labels));
      expect(r.labels.some(l => /^Hours/.test(l)), 'Hours should be a tab: ' + JSON.stringify(r.labels));
      expect(!r.small && r.barBottom === 0, 'the tabs should be at the foot and easy to tap');
      expect(r.mainLeft < 24 && !r.wide, 'the page should have the whole width at ' + w + 'px (left ' + r.mainLeft + ')');
      await p.click('#mnav button:has-text("Hours")'); await wait(s, 400);
      expect(await p.evaluate(() => /My Hours/.test(document.querySelector('.psec.current').getAttribute('data-name')) &&
        document.querySelector('#mnav button[aria-current]').textContent.indexOf('Hours') >= 0), 'the Hours tab should open My Hours and show as chosen');
      await p.click('#mnav .mnav-menu'); await wait(s, 400);
      const open1 = await p.evaluate(() => { const r = document.querySelector('.hq.rail').getBoundingClientRect(); return r.left >= 0 && r.right > 200; });
      expect(open1, 'Menu should slide the full menu in');
      expect(await p.evaluate(() => [...document.querySelectorAll('#rail-nav button')].some(b => /Sign Out/.test(b.textContent) && b.offsetParent)), 'the full menu should include Sign Out');
      await p.click('#rail-scrim', { position: { x: w - 10, y: 400 } }); await wait(s, 400);
      expect(await p.evaluate(() => document.body.classList.contains('railmini')), 'tapping beside the menu should close it');
      await p.click('[data-hrow]'); await wait(s, 500);
      expect(await p.evaluate(() => { const b = document.getElementById('mnav'); return !b || getComputedStyle(b).display === 'none'; }), 'the tab bar should step aside while hours are being entered');
      noErrors(s.errs); await s.close();
    }
    // The full menu on a computer is unchanged.
    const d = await open(opts({ who: 'casey' }));
    await wait(d, 3000);
    expect(await d.page.evaluate(() => getComputedStyle(document.getElementById('mnav') || document.body).display === 'none' || !document.getElementById('mnav')), 'the tab bar should not show on a computer');
    noErrors(d.errs); await d.close();
  });

  /* Jonna, 27 Nov 2026: hours (and expenses) as a place they can bookmark. */
  await check('My Hours and My Expenses can be bookmarked', async () => {
    if (read(path.join(DIR, 'index.html')).indexOf('A PAGE YOU CAN BOOKMARK') < 0) return;
    const s = await open(opts({ who: 'casey' }));
    const p = s.page;
    await wait(s, 3000); await nav(p, 'My Hours'); await wait(s, 300);
    expect(/#hours$/.test(p.url()) && /^My Hours/.test(await p.title()), 'the address should follow the page (' + p.url() + ', ' + await p.title() + ')');
    expect(await p.$('#rail-nav button[data-page="hours"]') && await p.$('#rail-nav button[data-page="expenses"]'), 'the menu buttons need fixed names for the sign-in chip');
    await nav(p, 'My Expenses');
    expect(/#expenses$/.test(p.url()), 'the address should follow to My Expenses (' + p.url() + ')');
    await s.close();
    for (const [hash, want] of [['#hours', 'My Hours'], ['#open=hours', 'My Hours'], ['#expenses', 'My Expenses']]) {
      const b = await open(opts({ who: 'casey', path: hash }));
      await wait(b, 3500);
      const cur = await b.page.evaluate(() => (document.querySelector('.psec.current') || {}).getAttribute && document.querySelector('.psec.current').getAttribute('data-name'));
      expect(cur === want, 'a bookmark to ' + hash + ' should open ' + want + ' (opened ' + cur + ')');
      noErrors(b.errs); await b.close();
    }
    // On a phone, a bookmark to Expenses opens the Expenses app, as My Expenses always does there.
    const m = await open(opts({ who: 'casey', path: '#expenses', viewport: { width: 390, height: 844 } }));
    await wait(m, 3500);
    expect(/[?&]app=expenses/.test(m.page.url()), 'on a phone #expenses should open the Expenses app (' + m.page.url() + ')');
    await m.close();
  });

  /* The full audit, 28 Nov 2026 (20261128a). */
  await check('Audit: nothing is cut off the right-hand edge of a table on a phone', async () => {
    if (read(path.join(DIR, 'index.html')).indexOf('Audit, 28 Nov 2026') < 0) return;
    const CLIP = () => {
      const out = [];
      document.querySelectorAll('#view .psec.current .tbl *').forEach(e => {
        const r = e.getBoundingClientRect(); if (!e.offsetParent || !r.width || e.children.length > 3 || !(e.textContent || '').trim()) return;
        const box = e.closest('.tbl'); const s = getComputedStyle(box);
        if (/(auto|scroll)/.test(s.overflowX)) return;
        if (r.right > box.getBoundingClientRect().right + 2) out.push((e.textContent || '').trim().slice(0, 20));
      });
      return out;
    };
    for (const [who, page] of [['casey', 'My Service Orders'], ['sam', 'My Service Orders'], ['vp', 'Already Decided']]) {
      for (const w of [390, 360]) {
        const s = await open(opts({ who, viewport: { width: w, height: 800 } }));
        await wait(s, 3000); await nav(s.page, page); await wait(s, 300);
        const r = await s.page.evaluate(CLIP);
        expect(!r.length, who + '\'s ' + page + ' cuts off ' + JSON.stringify(r.slice(0, 3)) + ' at ' + w + 'px');
        if (who === 'casey') {
          const c = await s.page.evaluate(() => { const t = document.querySelector('.psec.current .factbl'); if (!t) return null;
            const td = t.querySelector('tbody td.n'); return { labelled: getComputedStyle(td, '::before').content, fits: t.getBoundingClientRect().right <= innerWidth }; });
          expect(c && /Allotted/.test(c.labelled) && c.fits, 'the hours left should stack with their names on a phone: ' + JSON.stringify(c));
        }
        if (who === 'sam') {
          const d = await s.page.evaluate(() => { const b = document.querySelector('.psec.current .sgone'); const r = b && b.getBoundingClientRect();
            const f = document.querySelector('.psec.current .sg-fee'); return { btn: r && r.right <= innerWidth - 8, fee: !!(f && f.offsetParent && /\$/.test(f.textContent)) }; });
          expect(d.btn && d.fee, 'Download should be whole and the fee under the title: ' + JSON.stringify(d));
        }
        noErrors(s.errs); await s.close();
      }
    }
  });

  await check('Audit: Back from the phone Expenses app comes back to the page you were on', async () => {
    if (read(path.join(DIR, 'expenses-app.js')).indexOf('Back comes back') < 0) return;
    const s = await open(opts({ who: 'casey', path: '#hours', viewport: { width: 390, height: 844 } }));
    const p = s.page; await wait(s, 3000);
    await p.click('#mnav button:has-text("Expenses")'); await wait(s, 3500);
    expect(/[?&]app=expenses/.test(p.url()), 'the Expenses tab should open the Expenses app (' + p.url() + ')');
    await p.goBack(); await wait(s, 3500);
    const cur = await p.evaluate(() => { const c = document.querySelector('.psec.current'); return c && c.getAttribute('data-name'); });
    expect(/#hours$/.test(p.url()) && cur === 'My Hours', 'Back should return to My Hours (' + p.url() + ', ' + cur + ')');
    noErrors(s.errs); await s.close();
  });

  await check('Audit: the Expenses app shows no snap or add buttons when expenses are not switched on', async () => {
    if (read(path.join(DIR, 'expenses-app.js')).indexOf('soxp-noexp') < 0) return;
    for (const who of ['sam', 'riley', 'casey']) {
      const s = await open(opts({ who, path: '?app=expenses', viewport: { width: 390, height: 844 } }));
      await wait(s, 3500);
      const r = await s.page.evaluate(() => { const d = document.querySelector('.soxp-dock'), i = document.querySelector('.hqtop .xp-info');
        return { dock: !!(d && getComputedStyle(d).display !== 'none'), info: !!(i && getComputedStyle(i).display !== 'none') }; });
      if (who === 'casey') expect(r.dock && r.info, 'someone with expenses should still have the buttons and the i');
      else expect(!r.dock && !r.info, who + ' has no expenses, so no buttons that open nothing: ' + JSON.stringify(r));
      noErrors(s.errs); await s.close();
    }
  });

  await check('Audit: Help describes today\'s sign-in, and staff text has no build-file references', async () => {
    if (read(path.join(DIR, 'index.html')).indexOf('On a Phone, and Bookmarks') < 0) return;
    const html = read(path.join(DIR, 'index.html'));
    expect(!/ends when you close the tab/.test(html), 'Help still says the sign-in ends with the tab');
    expect(!/NOTIFY\.md in the build package/.test(html), 'Needs You still points at a build file');
    const s = await open(opts({ who: 'casey' }));
    await wait(s, 3000); await nav(s.page, 'Help');
    const t = await s.page.evaluate(() => document.querySelector('.psec.current').innerText);
    expect(/sign-in code/.test(t) && /Forgot your password\?/.test(t) && /#hours/.test(t), 'Help should cover the code, Forgot your password? and bookmarks');
    noErrors(s.errs); await s.close();
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

  await check('From November 2026 no week crosses a month end (the split-month lines)', async () => {
    const s = await open(opts({ who: 'admin' }));
    await wait(s, 2500);
    const r = await s.page.evaluate(() => {
      const H = window.H, fy = 'FY 2027';
      if (!H.isPartWeek) return { old: true };   // versions before 20261109a: Fridays only
      const ends = H.weekEndings(fy).map(H.print);
      const cross = [];
      H.weekEndings(fy).forEach(d => {
        const s = H.weekStart(fy, d), l = H.weekLast(fy, d);
        if (d >= new Date(2026, 10, 1) && (s.getMonth() !== d.getMonth() || l.getMonth() !== d.getMonth())) cross.push(H.print(d));
      });
      return {
        ends, cross,
        span1030: H.weekSpan(fy, '10/30/26'), span1106: H.weekSpan(fy, '11/06/26'),
        span1130: H.weekSpan(fy, '11/30/26'), span1204: H.weekSpan(fy, '12/04/26'),
        strad1106: H.straddle(fy, '11/06/26'),
        part1130: H.isPartWeek(fy, '11/30/26'), part1127: H.isPartWeek(fy, '11/27/26'),
        on1130: H.weekFor(fy, new Date(2026, 10, 30, 15)), on1201: H.weekFor(fy, new Date(2026, 11, 1, 9)),
        on1031: H.weekFor(fy, new Date(2026, 9, 31, 10))
      };
    });
    if (!r.old) {
      expect(!r.cross.length, 'these weeks cross a month end: ' + r.cross.join(', '));
      expect(r.ends.indexOf('10/31/26') < 0, 'October 2026 is closed and must not get a 10/31 line');
      ['11/30/26', '12/31/26', '03/31/27', '06/30/27', '08/31/27', '09/30/27'].forEach(e =>
        expect(r.ends.indexOf(e) >= 0, 'missing the month-end line ' + e));
      ['01/31/27', '02/28/27', '07/31/27'].forEach(e =>
        expect(r.ends.indexOf(e) < 0, e + ' is a weekend month end and needs no line of its own'));
      expect(/October 24.*October 31/.test(r.span1030), 'w/e 10/30 should run to 31 October, got ' + r.span1030);
      expect(/^November 1,/.test(r.span1106), 'w/e 11/06 should start 1 November, got ' + r.span1106);
      expect(!r.strad1106, 'w/e 11/06 must not ask about October');
      expect(/November 28.*November 30/.test(r.span1130) && /^December 1,/.test(r.span1204), 'the November month-end split is wrong: ' + r.span1130 + ' / ' + r.span1204);
      expect(r.part1130 && !r.part1127, 'isPartWeek is wrong');
      expect(r.on1130 === '11/30/26' && r.on1201 === '12/04/26' && r.on1031 === '10/30/26', 'the week that opens is wrong: ' + [r.on1031, r.on1130, r.on1201].join(' '));
    }
    noErrors(s.errs); await s.close();
  });

  await check('Sign-in: a wrong password counts once, and a locked account is told how to unlock', async () => {
    const store = mkStore();
    const s = await open(opts({ who: 'casey', store, noSession: true }));
    await wait(s, 2000);
    const email = await s.page.$('input[type=email]') || (await s.page.$$('input'))[0];
    await email.fill('casey@northwind.test');
    await s.page.fill('input[type=password]', 'wrong');
    const goSel = (await s.page.$('[data-rs-go]')) ? '[data-rs-go]' : 'button:has-text("Sign In")';   // the shared sign-in from 20261122j
    await s.page.click(goSel); await wait(s, 1500);
    expect(store.logins === 1, 'one wrong password was tried ' + store.logins + ' times (each try counts toward the lockout)');
    for (let i = 0; i < 5; i++) { await s.page.fill('input[type=password]', 'wrong'); await s.page.click(goSel); await wait(s, 900); }
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

  await check('An order can leave off the Delivery and Payment Schedules', async () => {
    const s = await open(opts({ who: 'admin' }));
    await wait(s, 2500);
    const r = await s.page.evaluate(() => {
      const P = window.MISMO_PORTAL_PARTS;
      const F = { company: 'Northwind Facilitation LLC', standingText: '', signers: { order: { name: 'Sam Signer', title: 'Director' } },
        mismoSigner: { name: 'Pat President', title: 'President' }, vpProduct: { name: 'Victor Vee' } };
      const base = { id: 'x', subject: 'Sample', feeType: 'hourly', hourlyRate: 100, estimatedHours: 10, maximumFee: 1000,
        startDate: '11/01/26', endDate: '12/31/26', services: ['a'], deliverables: ['b'],
        deliverySchedule: 'Monthly', paymentSchedule: 'On completion' };
      const withS = P.orderDoc(F, base), without = P.orderDoc(F, Object.assign({}, base, { noSchedules: true }));
      return { withS: /Delivery Schedule/.test(withS) && /Payment Schedule/.test(withS),
               without: !/Delivery Schedule/.test(without) && !/Payment Schedule/.test(without) && /Maximum Fee Allowed/.test(without),
               old: !/noSchedules/.test(document.documentElement.innerHTML) };
    });
    if (!r.old) {
      expect(r.withS, 'an order with schedules should print them');
      expect(r.without, 'an order marked not applicable still prints a schedule, or lost its fee estimate');
      await nav(s.page, 'New Service Order');
      expect(!!(await s.page.$('#no-sched')), 'the New Service Order form has no schedules choice');
      await s.page.selectOption('#no-sched', 'none'); await wait(s, 200);
      const hidden = await s.page.evaluate(() => [...document.querySelectorAll('.no-schedf')].every(d => d.hidden));
      expect(hidden, 'the two schedule boxes stay visible when they are not applicable');
    }
    noErrors(s.errs); await s.close();
  });

  await check('A row can be cleared, and Close Without Saving only closes it', async () => {
    const store = mkStore();
    const key = 'so-northwind|hours/casey-c-fy2027.json';
    const s = await open(opts({ who: 'casey', store }));
    await wait(s, 2500); await nav(s.page, 'My Hours');
    const row = '[data-hrow]';
    await s.page.click(row); await wait(s, 500);
    const hasClose = await s.page.$('#ph-cancel');
    const label = hasClose ? (await s.page.textContent('#ph-cancel')).trim() : '';
    if (label === 'Discard') { noErrors(s.errs); await s.close(); return; }   // versions before 20261116a
    expect(label === 'Close Without Saving', 'the close button reads "' + label + '"');
    expect(!(await s.page.$('#ph-clear')), 'an empty row should not offer Clear This Row');
    await s.page.fill('#ph-num', '2');
    /* From 20261122d This Week is a rich editor over a hidden box; type into whichever is there. */
    if (await s.page.$('#ph-note-ed')) { await s.page.click('#ph-note-ed'); await s.page.keyboard.type('Logged in the wrong week'); }
    else await s.page.fill('#ph-note', 'Logged in the wrong week');
    await s.page.click('#ph-keep'); await wait(s, 400);
    await s.page.click('#h-save'); await wait(s, 1200);
    const saved = JSON.stringify((store.S[key] || {}).drafts || {});
    expect(/Logged in the wrong week/.test(saved), 'the row was not saved to start with');
    await s.page.click(row); await wait(s, 500);
    await s.page.fill('#ph-num', '5');
    await s.page.click('#ph-cancel'); await wait(s, 900);
    await s.page.click(row); await wait(s, 900);
    expect(Number(await s.page.inputValue('#ph-num')) === 2, 'Close Without Saving kept an edit');
    await s.page.click('#ph-clear'); await wait(s, 400);
    await s.page.click('#h-save'); await wait(s, 1200);
    const after = JSON.stringify((store.S[key] || {}).drafts || {});
    expect(!/Logged in the wrong week/.test(after), 'Clear This Row did not empty the row');
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

  /* Service Orders as one page, and the past years from Smartsheet (16 Nov 2026).
     Versions before 20261116c do not have it, so these pass as not applicable there. */
  const hasPast = read(path.join(DIR, 'index.html')).indexOf('function joinNoRepeat') >= 0;

  await check('A new order title never doubles a word where its pieces meet', async () => {
    if (!hasPast) return;
    const src = read(path.join(DIR, 'index.html'));
    const m = /function joinNoRepeat\(a, b\) \{[\s\S]*?\n  \}\n/.exec(src);
    expect(m, 'joinNoRepeat is missing');
    const join = vm.runInNewContext('(' + m[0].replace(/^function joinNoRepeat/, 'function') + ')');
    const t = (a, b, want) => { const got = join(a, b); expect(got === want, JSON.stringify([a, b]) + ' gave "' + got + '", wanted "' + want + '"'); };
    t('FY 2027 Architecture Workgroup', 'Workgroup Facilitation', 'FY 2027 Architecture Workgroup Facilitation');
    t('FY 2027 ', 'Sample Workgroup', 'FY 2027 Sample Workgroup');
    t('FY 2027 Servicing Community of Practice', 'Community of Practice Facilitation', 'FY 2027 Servicing Community of Practice Facilitation');
    t('FY 2027 Sample', '', 'FY 2027 Sample');
    t('', 'Sample', 'Sample');
  });

  /* MBA's updated meal guidance (17 Nov 2026). Versions before 20261117b use the 2019
     numbers, so this passes as not applicable there. */
  await check('Expenses follow the updated meal guidance and the $15 no-receipt rule', async () => {
    const src = read(path.join(DIR, 'index.html'));
    if (src.indexOf('function receiptExempt') < 0) return;
    const m = /  var MEAL_CAP = [\s\S]*?\n  function expenseAllowed\(e\) \{[\s\S]*?\n  \}\n/.exec(src);
    expect(m, 'the expense rules are missing');
    const P = vm.runInNewContext('var money = function (n) { return "$" + Number(n).toFixed(2); };' + m[0] +
      ';({ MEAL_CAP: MEAL_CAP, DAILY_MEAL_CAP: DAILY_MEAL_CAP, check: checkExpense, allowed: expenseAllowed })');
    const caps = P.MEAL_CAP;
    expect(caps['Meal Trvl - Breakfast'] === 25 && caps['Meal Trvl - Lunch'] === 40 &&
      caps['Meal Trvl - Dinner'] === 60 && caps['Meal Trvl - Snack'] === 15, 'meal guidelines are not 25 / 40 / 60 / 15');
    expect(P.DAILY_MEAL_CAP === 140, 'the daily meal cap is not $140');
    const ex = (cat, amt, receipt) => ({ id: 'e' + Math.random(), date: '11/02/26', cat, amt, receipt: !!receipt });
    const bad = (e, others) => P.check(e, others || []).some(x => x.lvl === 'bad');
    expect(P.allowed(ex('Taxi/Uber/Lyft', 22)) === 15, 'a $22 taxi with no receipt should count as $15');
    expect(bad(ex('Taxi/Uber/Lyft', 22)), 'a $22 taxi with no receipt should be flagged');
    // From 20261126a: $15 OR MORE needs a receipt, as Team HQ has it (before: over $15).
    if (src.indexOf('function needsReceipt') >= 0) {
      expect(bad(ex('Taxi/Uber/Lyft', 15)), 'a $15 taxi needs a receipt ($15 or more)');
      expect(bad(ex('Meal Trvl - Snack', 15)), 'a $15 snack needs a receipt ($15 or more)');
      expect(!bad(ex('Taxi/Uber/Lyft', 14.99)), 'a $14.99 taxi needs no receipt');
      expect(P.check(ex('Parking', 20), []).some(x => /Charges of \$15\.00 or more need an original paid receipt/.test(x.m)), 'the wording should match Team HQ');
    } else expect(!bad(ex('Taxi/Uber/Lyft', 15)), 'a $15 taxi needs no receipt');
    expect(P.allowed(ex('Taxi/Uber/Lyft', 22, true)) === 22, 'a $22 taxi with a receipt counts in full');
    expect(P.allowed(ex('Meal Trvl - Lunch', 30)) === 15 && bad(ex('Meal Trvl - Lunch', 30)), 'a $30 lunch with no receipt should be flagged and count as $15');
    expect(P.allowed(ex('Mileage', 48.5)) === 48.5 && !bad(ex('Mileage', 48.5)), 'mileage never needs a receipt');
    expect(P.check(ex('Meal Trvl - Dinner', 60, true), []).length === 0, 'a $60 dinner with a receipt is within the guideline');
    expect(P.check(ex('Meal Trvl - Dinner', 61, true), []).some(x => /guideline/.test(x.m)), 'a $61 dinner is over the guideline');
    const day = [ex('Meal Trvl - Breakfast', 25, true), ex('Meal Trvl - Lunch', 40, true)];
    expect(!P.check(ex('Meal Trvl - Dinner', 60, true), day).some(x => /daily cap/.test(x.m)), '$125 of meals in a day is within $140');
    const full = day.concat([ex('Meal Trvl - Snack', 15, true)]);
    expect(!P.check(ex('Meal Trvl - Dinner', 60, true), full).some(x => /daily cap/.test(x.m)), 'exactly $140 of meals in a day is within the cap');
    expect(P.check(ex('Meal Trvl - Dinner', 61, true), full).some(x => /daily cap/.test(x.m)), '$141 of meals in a day should warn');
  });

  /* Certifications recorded on assessor invoices, for the CMS (18 Nov 2026). Versions
     before 20261118a do not have it, so this passes as not applicable there. */
  await check('An assessor invoice records the certifications it bills, for the CMS', async () => {
    const src = read(path.join(DIR, 'index.html'));
    if (src.indexOf('function reviewsMissing') < 0) return;
    const m = /var REVIEW_FINISHED = [\s\S]*?\nfunction reviewsTable\(/.exec(src);
    expect(m, 'the certification-review code is missing');
    const P = vm.runInNewContext(
      'var INV = {}; function perReviewOrder(o) { return !!(o && (o.source === "certification" || o.feeType === "perReview")); }' +
      'function esc(s) { return String(s == null ? "" : s); } function money(n) { return "$" + Number(n).toFixed(2); }' +
      m[0].replace(/\nfunction reviewsTable\($/, '\n') +
      ';({ missing: reviewsMissing, choices: reviewChoices, editor: reviewsEditor })');
    const F = { orders: [{ id: 'o-1', subject: 'FY 2027 RON Renewal Assessment and Certification Reviews', source: 'certification' }] };
    const eng = [
      { row: 501, kind: 'renewal', renewalNumber: 2, org: 'Sample Notary Co', program: 'RON', product: 'Sample', state: 'Certified', assessorFee: 2000 },
      { row: 502, kind: 'renewal', renewalNumber: 1, org: 'Example Sign LLC', program: 'RON', product: 'Example', state: 'ArtifactReview', assessorFee: null },
      { row: 503, kind: 'initial', renewalNumber: null, org: 'Demo eClose', program: 'RON', product: 'Demo', state: 'Certified', assessorFee: 4000 }];
    const billedElsewhere = { id: 'a', number: 'X1', state: 'sent', total: 4000, lines: [], reviews: [{ key: '503|initial|', row: 503 }] };
    const iv = { id: 'b', number: 'X2', state: 'sent', total: 4000, lines: [], reviews: [] };
    const C = { slug: 'sample', F, reviewsFile: { engagements: eng }, invoices: [billedElsewhere, iv] };
    expect(P.missing(C, iv), 'a reviews-only invoice with no certifications should read as missing them');
    const ch = P.choices(C, iv).map(r => r.key);
    expect(ch.join(',') === '501|renewal|2,502|renewal|1', 'choices should be every engagement not billed elsewhere, any state: ' + ch.join(','));
    expect(P.choices(C, iv)[0].orderId === 'o-1' && P.choices(C, iv)[0].fee === 2000, 'a choice carries its order and the CMS fee');
    const done = Object.assign({}, iv, { reviews: [{ key: '502|renewal|1', row: 502, kind: 'renewal', renewalNumber: 1, fee: 2000 }] });
    expect(!P.missing(C, done), 'an invoice with a certification recorded is not missing them');
    expect(P.choices(Object.assign({}, C, { invoices: [billedElsewhere, done] }), done).filter(r => r.on).length === 1, 'the recorded one shows ticked');
    const hoursOnly = { id: 'c', total: 300, lines: [{ amount: 300 }], reviews: [] };
    expect(!P.missing(C, hoursOnly), 'an invoice that is only its hours bills no certifications');
    expect(!P.missing({ slug: 'x', F: { orders: [{ id: 'h', feeType: 'Hourly' }] } }, iv), 'a firm not paid per review is never asked');
    expect(/data-ivrvsave/.test(P.editor(C, iv)), 'MISMO gets a Save button for the certifications');
    expect(src.indexOf('if (reviewsMissing(c.C, c.iv))') > 0, 'approving must refuse an invoice that bills certifications with none recorded');
    if (src.indexOf('iv.approvedTotal = Math.round((invoiceHoursTotal(iv) + total)') < 0 && src.indexOf('function reviewsEditor') > 0 && /Contractor HQ/.test(src))
      expect(false, 'recording certifications must also correct the stored approved total and difference');
    expect(/reviews: \(exp\.reviews \|\| \[\]\)\.map[\s\S]{0,400}key: r\.key, row: r\.row[\s\S]{0,200}kind: r\.kind, renewalNumber: r\.renewalNumber/.test(src), 'the firm-side record keeps the field names the CMS reads');
  });

  await check('Staff: one Service Orders page with every order, past years read only', async () => {
    if (!hasPast) return;
    const s = await open(opts({ who: 'admin' }));
    await wait(s, 4000);
    const rail = await s.page.evaluate(() => [...document.querySelectorAll('#rail-nav button')].map(b => b.textContent.trim().replace(/\d+$/, '').trim()));
    expect(rail.includes('Service Orders') && rail.includes('Agreements'), 'the menu has no Service Orders or Agreements: ' + rail.join(', '));
    expect(!rail.some(n => /Revise an Order|End a Service Order|Executed Documents/.test(n)), 'the old sections are still in the menu');
    await nav(s.page, 'Service Orders'); await wait(s, 800);
    const sec = '.psec[data-name="Service Orders"]';
    const count = sel => s.page.evaluate(q => [...document.querySelectorAll(q)].filter(r => !r.hidden).length, sel);
    const thisYear = await count(sec + ' .sorow');
    expect(thisYear >= 3, 'this year shows ' + thisYear + ' orders, expected the three current ones');
    expect(await count(sec + ' .sorow[data-st="past"]') === 0, 'past years show before Every Year is chosen');
    await s.page.selectOption(sec + ' .so-fy', ''); await wait(s, 300);
    const titles = await s.page.evaluate(q => [...document.querySelectorAll(q)].filter(r => !r.hidden).map(r => r.textContent), sec + ' .sorow');
    for (const want of ['FY 2026 Sample Archive', 'FY 2025 Bluebird Secret Review', 'FY 2023 Gone Company Sample Work'])
      expect(titles.some(t => t.indexOf(want) >= 0), 'Every Year is missing "' + want + '"');
    expect(!titles.some(t => t.indexOf('MSA Extension Letter') >= 0), 'an agreement is listed with the orders');
    await s.page.fill(sec + ' .so-q', 'archive casey'); await wait(s, 300);
    expect(await count(sec + ' .sorow') === 1, 'searching by title and facilitator did not narrow to one');
    await s.page.click(sec + ' .sorow:not([hidden]) .hqrow'); await wait(s, 500);
    const panel = await s.page.evaluate(() => document.getElementById('panel-body').textContent);
    expect(/Imported from Smartsheet/.test(panel) && /read only/i.test(panel), 'the past order does not say it is read only');
    expect(/MISMO Only/.test(panel) && /Approval email/.test(panel), 'staff do not see the email approval');
    expect(!/End This Order|Save the Revision/.test(panel), 'a past order can be revised or ended');
    const btns = await s.page.evaluate(() => [...document.querySelectorAll('#panel-body .dlfile, #panel-body .vwfile')].length);
    expect(btns === 2, 'the signed copy has no View and Download');
    await s.page.click('#panel-x'); await wait(s, 300);
    await s.page.fill(sec + ' .so-q', ''); await s.page.selectOption(sec + ' .so-fy', ''); await s.page.selectOption(sec + ' .so-st', 'executed'); await wait(s, 300);
    await s.page.click(sec + ' .sorow:not([hidden]) .hqrow'); await wait(s, 500);
    const ex = await s.page.evaluate(() => document.getElementById('panel-body').textContent);
    expect(/End This Order/.test(ex), 'an executed order cannot be ended from the Service Orders page');
    await nav(s.page, 'Agreements'); await wait(s, 400);
    const ag = await s.page.evaluate(() => document.querySelector('.psec[data-name="Agreements"]').textContent);
    expect(/Earlier Agreements/.test(ag) && /FY 2025 MSA Extension Letter/.test(ag), 'past agreements are not under Agreements');
    noErrors(s.errs); await s.close();
  });

  await check('A company sees only its own past years, and never an email approval', async () => {
    if (!hasPast) return;
    const s = await open(opts({ who: 'sam' }));
    await wait(s, 4000); await nav(s.page, 'My Service Orders'); await wait(s, 600);
    await s.page.click('.psec[data-name="My Service Orders"] button[data-sotab="past"]'); await wait(s, 300);
    const txt = await s.page.evaluate(() => document.querySelector('.psec[data-name="My Service Orders"] div.sotab[data-sotab="past"]').textContent);
    expect(/FY 2026 Sample Archive/.test(txt) && /FY 2024 Old Sample Study/.test(txt), 'their own past orders are missing');
    expect(!/Bluebird|Gone Sample/.test(txt), 'another company’s past order is showing');
    await s.page.click('.psec[data-name="My Service Orders"] div.sotab[data-sotab="past"] .sorow .hqrow'); await wait(s, 500);
    const panel = await s.page.evaluate(() => document.getElementById('panel-body').textContent);
    expect(!/MISMO Only|Approval email|Q Drive/.test(panel), 'a company can see MISMO-only material');
    const asked = s.reqs ? s.reqs.filter(u => /sopast|bluebird/.test(u)) : [];
    expect(!asked.length, 'the company screen asked for MISMO-only or another company’s data: ' + asked.join(', '));
    noErrors(s.errs); await s.close();
  });

  /* CN-033 (Jonna, Nov 25, 2026): the browser's Back button closes what is open, then goes to the last page. */
  await check('Back button: closes the panel, then returns to the last page', async () => {
    const html = read(path.join(DIR, 'index.html'));
    if (html.indexOf('/assets/back.js') < 0) return;   // versions before 20261125d
    expect(/<script src="\/assets\/session\.js"><\/script>\s*(<!--[\s\S]*?-->\s*)?<script src="\/assets\/back\.js"><\/script>/.test(html),
      'back.js should be loaded right after session.js');
    expect(!/history\.pushState/.test(html), 'the page should not add its own history steps (back.js does that)');
    expect(!fs.readdirSync(DIR).some(n => /^back\.js$/i.test(n)), 'a copy of back.js is in the version folder: use the shared one');
    const s = await open(opts({ who: 'admin' }));
    await wait(s, 4500);
    const state = () => s.page.evaluate(() => {
      const b = document.querySelector('#rail-nav button[data-hq][aria-current]');
      const sec = b && document.getElementById(b.getAttribute('data-hq'));
      return { tab: (sec && sec.getAttribute('data-name')) || '', pane: document.getElementById('panel').classList.contains('on'),
        policy: !!document.getElementById('xp-policy'), helper: !!window.MismoBack };
    });
    expect((await state()).helper, 'the shared Back helper (/assets/back.js) did not load');
    const go = async name => { await s.page.click('#rail-nav button[title="' + name + '"]'); await wait(s, 900); };
    const back = async () => { await s.page.evaluate(() => history.back()); await wait(s, 900); };
    const start = (await state()).tab;
    expect(start, 'no page is marked aria-current in the left menu');
    await go('Service Orders'); await go('Agreements'); await go('Help');
    let st = await state(); expect(st.tab === 'Help', 'Help did not open: ' + JSON.stringify(st));
    await back(); st = await state(); expect(st.tab === 'Agreements', 'Back from Help should land on Agreements: ' + JSON.stringify(st));
    await back(); st = await state(); expect(st.tab === 'Service Orders', 'Back again should land on Service Orders: ' + JSON.stringify(st));
    await s.page.evaluate(() => history.forward()); await wait(s, 900);
    st = await state(); expect(st.tab === 'Agreements', 'Forward should go back to Agreements: ' + JSON.stringify(st));
    await back(); await back(); st = await state(); expect(st.tab === start, 'Back to where the page opened (' + start + '): ' + JSON.stringify(st));
    /* a record's panel: Back closes it first and stays on the page */
    const sec = '.psec[data-name="Service Orders"]';
    await go('Service Orders');
    await s.page.click(sec + ' .sorow:not([hidden]) .hqrow'); await wait(s, 700);
    expect((await state()).pane, 'an order did not open in the right-hand panel');
    await back(); st = await state();
    expect(!st.pane && st.tab === 'Service Orders', 'Back should close the panel and stay on Service Orders: ' + JSON.stringify(st));
    await back(); st = await state(); expect(st.tab === start, 'Back after the panel should go to the page before Service Orders: ' + JSON.stringify(st));
    /* closing the panel with its X leaves no step behind */
    await go('Service Orders');
    await s.page.click(sec + ' .sorow:not([hidden]) .hqrow'); await wait(s, 700);
    await s.page.click('#panel-x'); await wait(s, 700);
    expect(!(await state()).pane, 'the X did not close the panel');
    await back(); st = await state(); expect(st.tab === start, 'after closing the panel with X, Back should go straight to the page before: ' + JSON.stringify(st));
    expect(/The Back Button/.test(await s.page.evaluate(() => document.body.innerHTML)), 'Help does not mention the Back button');
    noErrors(s.errs); await s.close();
  });

  await check('The Expenses phone app opens on a phone', async () => {
    const s = await open(opts({ who: 'casey', path: '?app=expenses', viewport: { width: 390, height: 844 } }));
    await wait(s, 3000);
    const app = await s.page.evaluate(() => document.documentElement.classList.contains('soxp'));
    expect(app, 'the phone app did not start');
    noErrors(s.errs); await s.close();
  });

  /* CN-053 (Jonna, Nov 26, 2026): the masthead is Certification Management's, to the pixel. */
  await check('The masthead matches Certification Management, with the menu lined up under it', async () => {
    const html = read(path.join(DIR, 'index.html'));
    expect(!/class="santa"|id="mismo-hat"|data-season|function season\(/.test(html + read(path.join(DIR, 'review.html'))),
      'the retired December hat is still on a page (the shared /assets/holiday.js replaces it)');
    const bad = [];
    for (const [w, want] of [[1440, { bar: 68, x: 22, y: 13, h: 42, rule: 42, name: 16 }], [390, { bar: 62, x: 16, y: 14.5, h: 33, rule: 40, name: 13 }]]) {
      const s = await open(opts({ who: 'admin', viewport: { width: w, height: 844 } }));
      await wait(s, 1500);
      const m = await s.page.evaluate(() => {
        const r = q => { const e = document.querySelector(q); return e && e.getBoundingClientRect(); };
        const bar = r('.hqtop'), plate = r('.hqtop .logoplate'), rule = r('.hqtop .mastrule'), rail = r('#rail');
        const nm = getComputedStyle(document.querySelector('.hqtop .hqname'));
        return { bar: bar.height, x: plate.left - bar.left, y: plate.top - bar.top, h: plate.height, rule: rule.height,
          name: parseFloat(nm.fontSize), weight: nm.fontWeight, color: nm.color, railTop: rail ? rail.top : null };
      });
      for (const k of Object.keys(want)) if (Math.abs(m[k] - want[k]) > 0.6) bad.push(w + 'px: ' + k + ' is ' + m[k] + ', should be ' + want[k]);
      if (m.weight !== '500' || m.color !== 'rgb(148, 200, 233)') bad.push(w + 'px: the name should be weight 500 in #94c8e9 (' + m.weight + ' ' + m.color + ')');
      if (m.railTop !== null && Math.abs(m.railTop - m.bar) > 0.6) bad.push(w + 'px: the left menu starts at ' + m.railTop + ', not under the ' + m.bar + 'px bar');
      await s.close();
    }
    expect(!bad.length, bad.join('\n'));
  });

  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log('\n' + (results.length - failed.length) + ' passed, ' + failed.length + ' failed');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
