// End-to-end smoke test of the real UI in headless Chrome/Edge via the DevTools protocol.
// No npm dependencies: uses Node's global WebSocket/fetch (Node 22+).
//   node tests/ui/smoke.mjs [--shots <dir>]
// Covers the Phase 1 acceptance flow: sign in, create two cases, reload, edit, delete/restore,
// export JSON, import into a clean browser profile with data + history intact, sign out.
// The real data/users.local.json is never read: the test serves its own throwaway credential
// file through the DevTools Fetch domain.

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { hashPassword, randomSalt } from '../../js/auth.js';

const PORT = 5199;
const TEST_USER = 'gunanidhi';
const TEST_PASS = `smoke-${Math.random().toString(36).slice(2)}`;
const testSalt = randomSalt();
const TEST_CREDS = JSON.stringify({ users: [{ username: TEST_USER, memberId: `mbr-${TEST_USER}`, salt: testSalt, hash: await hashPassword(TEST_PASS, testSalt, 1000), iterations: 1000 }] });
const DEBUG_PORT = 9333;
const shotsArg = process.argv.indexOf('--shots');
const SHOTS = shotsArg > -1 ? resolve(process.argv[shotsArg + 1]) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const BROWSERS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);
const browserPath = BROWSERS.find((p) => existsSync(p));
if (!browserPath) { console.log('SKIP: no Chrome/Edge found (set CHROME_PATH).'); process.exit(0); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, ['scripts/serve.js', String(PORT)], { stdio: 'pipe' });
const profileDir = mkdtempSync(join(tmpdir(), 'qahub-smoke-'));
const browser = spawn(browserPath, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profileDir}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1440,1000', 'about:blank',
], { stdio: 'ignore' });

let ws; let msgId = 0;
const pending = new Map();
const errors = [];
let step = 'startup';

function send(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej, method }));
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`eval failed (${step}): ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}\n${expression.slice(0, 200)}`);
  return r.result.value;
}

async function waitFor(expression, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { if (await evaluate(`Boolean(${expression})`)) return; } catch { /* page navigating */ }
    await sleep(80);
  }
  throw new Error(`Timed out (${step}) waiting for: ${expression}`);
}

async function shot(name) {
  if (!SHOTS) return;
  await sleep(150);
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
}

const click = (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error('no element ${sel.replace(/'/g, '')}'); el.click(); return true; })()`);
const clickText = (sel, text) => evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.trim().includes(${JSON.stringify(text)})); if (!el) throw new Error('no ${sel} with text ${text}'); el.click(); return true; })()`);
const setValue = (sel, value) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error('no field ${sel}'); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true; })()`);
const go = async (hash) => { await evaluate(`location.hash = ${JSON.stringify(hash)}`); await sleep(120); };
const store = (expr) => evaluate(`(() => { const s = window.qaHub.store; return ${expr}; })()`);

async function fillCase({ title, moduleId, featureId, objective, steps }) {
  await waitFor(`document.querySelector('input[name=title]')`);
  await setValue('input[name=title]', title);
  await setValue('select[name=moduleId]', moduleId);
  if (featureId) await setValue('select[name=featureId]', featureId);
  await setValue('textarea[name=objective]', objective);
  await setValue('textarea[aria-label="Step 1 action"]', steps[0][0]);
  await setValue('textarea[aria-label="Step 1 expected result"]', steps[0][1]);
}

async function signIn(password = TEST_PASS, { expectOk = true } = {}) {
  await waitFor(`!window.__stalePage && document.querySelector('#login-user')`, 30000);
  await setValue('#login-user', TEST_USER);
  await setValue('#login-pass', password);
  await evaluate(`document.querySelector('.login-form').requestSubmit()`);
  if (expectOk) await waitFor(`!document.querySelector('.login') && window.qaHub?.store.actor() && document.querySelector('.topbar')`, 30000);
}

async function reloadPage() {
  await evaluate('window.__stalePage = true');
  await send('Page.reload');
}

async function main() {
  // Connect
  let target;
  for (let i = 0; i < 50 && !target; i += 1) {
    try { target = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch { await sleep(150); }
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      if (msg.error) p.rej(new Error(`${p.method}: ${msg.error.message}`)); else p.res(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(`[${step}] ${msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text}`);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(`[${step}] console.error: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error' && !/favicon/.test(msg.params.entry.url || '')) {
      errors.push(`[${step}] ${msg.params.entry.text} ${msg.params.entry.url || ''}`);
    }
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method !== 'Fetch.requestPaused') return;
    send('Fetch.fulfillRequest', {
      requestId: msg.params.requestId, responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Cache-Control', value: 'no-store' }],
      body: Buffer.from(TEST_CREDS).toString('base64'),
    });
  });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*users.local.json*', requestStage: 'Request' }] });
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable'); await send('DOM.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

  step = 'first launch';
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await waitFor(`document.querySelector('#login-user')`, 30000);
  await shot('00-login');
  step = 'wrong password rejected';
  await signIn('not-the-password', { expectOk: false });
  await waitFor(`document.querySelector('.login-error:not([hidden])')`);
  assert.equal(await evaluate('Boolean(window.qaHub.store.actor())'), false, 'no actor after a wrong password');
  step = 'sign in';
  await signIn();
  await waitFor(`document.querySelector('.stats')`);
  await shot('01-dashboard');
  const LIB = await store('s.data.testCases.length');
  assert.equal(LIB, 3815, 'library seeded from data/library.json');
  assert.equal(await store('s.actor().id'), 'mbr-gunanidhi');
  assert.equal(await store(`s.data.testCases.filter((c) => c.createdBy !== 'mbr-dossmk').length`), 0, 'library cases created by DossMK');
  assert.equal(await store(`s.data.testCases.filter((c) => c.assignedTo).length`), 0, 'library cases start unassigned');
  assert.equal(await store(`s.get('members', 'mbr-dossmk').role`), 'Admin');
  const loginFeat = await store(`s.data.features.find((f) => f.moduleId === 'mod-login').id`);
  const patFeat = await store(`s.data.features.find((f) => f.moduleId === 'mod-patient-management').id`);
  const nextKey = (prefix, mod) => store(`'${prefix}-' + String(s.data.testCases.filter((c) => c.moduleId === '${mod}').length + 1).padStart(3, '0')`);
  const key1 = await nextKey('LOGIN', 'mod-login');
  const key2 = await nextKey('PAT', 'mod-patient-management');

  step = 'create case 1';
  await go('#/cases/new');
  await fillCase({ title: 'Zqxsmoke login rejects an incorrect password', moduleId: 'mod-login', featureId: loginFeat, objective: 'User stays on login page with a clear error.', steps: [['Enter a wrong password', 'Error message is shown']] });
  await shot('02-editor');
  await click('form .editor-actions button[type=submit]');
  await waitFor(`/^#\\/cases\\/[0-9a-f-]{36}$/.test(location.hash)`);
  const id1 = await evaluate(`location.hash.split('/')[2]`);
  assert.equal(await store(`s.get('testCases', '${id1}').caseKey`), key1);
  await shot('03-detail');

  step = 'create case 2 (validation first)';
  await go('#/cases/new?module=mod-patient-management');
  await waitFor(`document.querySelector('input[name=title]')`);
  await click('form .editor-actions button[type=submit]');
  await waitFor(`document.querySelector('[data-error=title]:not([hidden])')`);
  assert.ok(await evaluate(`document.querySelector('input[name=title]').getAttribute('aria-invalid') === 'true'`), 'inline error on title');
  await fillCase({ title: 'Zqxsmoke patient search by last name', moduleId: 'mod-patient-management', featureId: patFeat, objective: 'Matching patients are listed.', steps: [['Search "Test"', 'Synthetic patients named Test are listed']] });
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }))`);
  await waitFor(`/^#\\/cases\\/[0-9a-f-]{36}$/.test(location.hash)`);
  const id2 = await evaluate(`location.hash.split('/')[2]`);
  assert.equal(await store(`s.get('testCases', '${id2}').caseKey`), key2);

  step = 'reload persists';
  await reloadPage();
  await waitFor(`!window.__stalePage && window.qaHub?.store && document.querySelector('.content h1')`);
  assert.equal(await store('s.data.testCases.length'), LIB + 2, 'cases survive reload');
  assert.equal(await store('s.actor()?.displayName'), 'Gunanidhi', 'session survives reload');

  step = 'edit';
  await go(`#/cases/${id1}/edit`);
  await waitFor(`document.querySelector('input[name=title]')?.value`);
  await setValue('input[name=title]', 'Zqxsmoke login rejects an incorrect password (edited)');
  await setValue('select[name=priority]', 'Critical');
  await click('form .editor-actions button[type=submit]');
  await waitFor(`location.hash === '#/cases/${id1}'`);
  assert.equal(await store(`s.get('testCases', '${id1}').version`), 2);
  assert.ok(await evaluate(`document.querySelector('.timeline').textContent.includes('Priority')`), 'history shows field diff');

  step = 'unsaved-change guard';
  await go(`#/cases/${id1}/edit`);
  await waitFor(`document.querySelector('input[name=title]')?.value`);
  await setValue('input[name=title]', 'Unsaved title change');
  await evaluate(`location.hash = '#/dashboard'`);
  await waitFor(`document.querySelector('dialog.modal[open]')?.textContent.includes('Discard unsaved')`);
  await clickText('dialog.modal[open] .modal-foot button', 'Cancel');
  await sleep(200);
  assert.ok(await evaluate(`location.hash.endsWith('/edit')`), 'stayed on editor');
  await evaluate(`location.hash = '#/dashboard'`);
  await waitFor(`document.querySelector('dialog.modal[open]')`);
  await clickText('dialog.modal[open] .modal-foot button', 'Leave page');
  await waitFor(`location.hash === '#/dashboard'`);

  step = 'library';
  await go('#/cases');
  await waitFor(`document.querySelectorAll('table.table tbody tr').length > 10`);
  await setValue('[data-primary-search]', 'zqxsmoke patient');
  await waitFor(`document.querySelectorAll('table.table tbody tr').length === 1`);
  await shot('04-library');

  step = 'admin assigns work';
  await go('#/assign');
  await waitFor(`document.querySelector('form select[name=module]')`);
  await setValue('form select[name=module]', 'mod-login');
  await waitFor(`!document.querySelector('form select[name=feature]').disabled`);
  await setValue('form select[name=member]', 'mbr-selshiya');
  await waitFor(`!document.querySelector('form button[type=submit]').disabled`);
  await shot('05a-assign');
  await click('form button[type=submit]');
  await waitFor(`document.querySelector('dialog.modal[open]')`);
  await clickText('dialog.modal[open] .modal-foot button', 'Assign');
  await waitFor(`window.qaHub.store.data.testCases.filter((c) => c.moduleId === 'mod-login' && c.assignedTo === 'mbr-selshiya').length === window.qaHub.store.data.testCases.filter((c) => c.moduleId === 'mod-login' && !c.deletedAt).length`);

  step = 'soft delete + restore via UI';
  await go(`#/cases/${id2}`);
  await waitFor(`document.querySelector('.page-actions [aria-haspopup=menu]')`);
  await click('.page-actions [aria-haspopup=menu]');
  await clickText('.popover-panel .menu-item', 'Move to trash');
  await waitFor(`document.querySelector('dialog.modal[open] textarea')`);
  await setValue('dialog.modal[open] textarea', 'Covered elsewhere');
  await clickText('dialog.modal[open] .modal-foot button', 'Move to trash');
  await waitFor(`window.qaHub.store.get('testCases', '${id2}').deletedAt`);
  await go('#/trash');
  await waitFor(`document.querySelector('table.table')?.textContent.includes('${key2}')`);
  await shot('05-trash');
  await clickText('table.table button', 'Restore');
  await waitFor(`!window.qaHub.store.get('testCases', '${id2}').deletedAt`);

  step = 'other pages render';
  for (const r of ['#/dashboard', '#/modules', '#/suites', '#/activity', '#/team', '#/assign', '#/data', '#/settings']) {
    await go(r);
    await waitFor(`document.querySelector('.content h1')`);
    await shot(`06-${r.slice(2)}`);
  }

  step = 'export';
  const exported = await store('JSON.stringify(s.exportDocument())');
  const exportFile = join(profileDir, 'export.json');
  writeFileSync(exportFile, exported);
  const before = JSON.parse(exported);

  step = 'clean browser';
  await evaluate(`new Promise((r) => { localStorage.clear(); sessionStorage.clear(); const req = indexedDB.deleteDatabase('qa-hub'); req.onsuccess = req.onerror = req.onblocked = () => r(true); })`);
  // Close the open DB connection by navigating away first, then delete again to be sure.
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(200);
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await sleep(300);
  await evaluate(`new Promise((r) => { const req = indexedDB.deleteDatabase('qa-hub'); req.onsuccess = req.onerror = req.onblocked = () => r(true); })`);
  await reloadPage();
  await signIn();
  assert.equal(await store('s.data.testCases.length'), LIB, 'clean browser has only the library');

  step = 'import (replace)';
  await go('#/data');
  await waitFor(`document.querySelector('#import-file')`);
  const { root } = await send('DOM.getDocument');
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#import-file' });
  await send('DOM.setFileInputFiles', { nodeId, files: [exportFile] });
  await waitFor(`document.querySelector('input[name=mode][value=replace]')`);
  await shot('07-import-preview');
  await click('input[name=mode][value=replace]');
  await evaluate(`[...document.querySelectorAll('label.check')].find((l) => l.textContent.includes('backup'))?.querySelector('input').click()`); // skip backup download
  await clickText('button', 'Apply import');
  await waitFor(`document.querySelector('dialog.modal[open] input')`);
  await setValue('dialog.modal[open] input', 'REPLACE');
  await clickText('dialog.modal[open] .modal-foot button', 'Replace local data');
  await waitFor(`window.qaHub.store.data.testCases.length === ${LIB + 2}`, 60000);

  const after = JSON.parse(await store('JSON.stringify(s.exportDocument())'));
  for (const c of before.testCases) {
    const m = after.testCases.find((x) => x.id === c.id);
    assert.ok(m, `case ${c.caseKey} present after import`);
    assert.equal(m.caseKey, c.caseKey);
    assert.equal(m.version, c.version);
    assert.equal(m.title, c.title);
  }
  const beforeEvents = new Set(before.activity.map((e) => e.eventId));
  assert.ok([...beforeEvents].every((id) => after.activity.some((e) => e.eventId === id)), 'all history events preserved');

  step = 'sign out';
  await go('#/dashboard');
  await click('.user-btn');
  await waitFor(`document.querySelector('dialog.modal[open]')?.textContent.includes('Sign out')`);
  await evaluate('window.__stalePage = true');
  await clickText('dialog.modal[open] .modal-foot button', 'Sign out');
  await waitFor(`!window.__stalePage && document.querySelector('#login-user')`, 30000);
  await signIn();

  step = 'mobile + dark';
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await go('#/cases');
  await waitFor(`document.querySelector('table.cards')`);
  const overflow = await evaluate('document.documentElement.scrollWidth - window.innerWidth');
  assert.ok(overflow <= 1, `no horizontal page scroll on mobile (overflow ${overflow}px)`);
  await shot('08-mobile-library');
  await evaluate(`document.documentElement.dataset.theme = 'dark'`);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await go('#/dashboard');
  await waitFor(`document.querySelector('.stats')`);
  await shot('09-dashboard-dark');
  await go(`#/cases/${id1}`);
  await waitFor(`document.querySelector('.steps-view')`);
  await shot('10-detail-dark');

  assert.deepEqual(errors, [], `browser errors:\n${errors.join('\n')}`);
  console.log('UI smoke test passed.');
}

main()
  .catch((e) => { console.error(`FAILED at step "${step}":`, e.message); if (errors.length) console.error(errors.join('\n')); process.exitCode = 1; })
  .finally(async () => {
    try { ws?.close(); } catch { /* ignore */ }
    browser.kill();
    server.kill();
    await sleep(300);
    try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* locked on Windows sometimes */ }
  });
