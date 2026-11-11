// Bootstrap: storage, store, app shell, profile gate, router, shortcuts, cross-tab sync.

import { createIndexedDbPersistence, createMemoryPersistence } from './db.js';
import { createStore } from './store.js';
import { createRouter } from './router.js';
import { h, icon, clear, prefs, fmtRelative } from './utils.js';
import { openModal, confirmDialog, isModalOpen } from './components/modal.js';
import { toast, toastError } from './components/toast.js';
import { avatar, banner, field, fieldError, showErrors } from './components/ui.js';
import { loadCredentials, verifyLogin, saveSession, readSession, clearSession, lockoutRemaining, recordFailure, clearFailures } from './auth.js';
import { renderLogin } from './pages/login.js';

import * as dashboard from './pages/dashboard.js';
import * as cases from './pages/cases.js';
import * as caseDetail from './pages/case-detail.js';
import * as caseEditor from './pages/case-editor.js';
import * as modules from './pages/modules.js';
import * as suites from './pages/suites.js';
import * as activity from './pages/activity.js';
import * as trash from './pages/trash.js';
import * as team from './pages/team.js';
import * as data from './pages/data.js';
import * as settings from './pages/settings.js';
import * as assign from './pages/assign.js';

const NAV = [
  { section: 'Workspace' },
  { href: '#/dashboard', label: 'Dashboard', icon: 'dashboard', match: /^\/dashboard/ },
  { href: '#/cases', label: 'Test Cases', icon: 'cases', match: /^\/cases/, count: (s) => s.activeCases().length },
  { href: '#/modules', label: 'Modules & Features', icon: 'modules', match: /^\/modules/ },
  { href: '#/suites', label: 'Test Suites', icon: 'suites', match: /^\/suites/ },
  { section: 'Records' },
  { href: '#/activity', label: 'Activity', icon: 'activity', match: /^\/activity/ },
  { href: '#/trash', label: 'Trash', icon: 'trash', match: /^\/trash/, count: (s) => s.data.testCases.filter((c) => c.deletedAt).length || '' },
  { section: 'Team & data' },
  { href: '#/team', label: 'Team', icon: 'team', match: /^\/team/ },
  { href: '#/assign', label: 'Assign work', icon: 'user', match: /^\/assign/, show: (s) => s.can('case.assign'), count: (s) => s.activeCases().filter((c) => !c.assignedTo).length || '' },
  { href: '#/data', label: 'Import / Export', icon: 'data', match: /^\/data/ },
  { href: '#/settings', label: 'Settings', icon: 'settings', match: /^\/settings/ },
];

const ROUTES = [
  { path: '/dashboard', page: dashboard },
  { path: '/cases', page: cases },
  { path: '/cases/new', page: caseEditor },
  { path: '/cases/:id', page: caseDetail },
  { path: '/cases/:id/edit', page: caseEditor },
  { path: '/modules', page: modules },
  { path: '/suites', page: suites },
  { path: '/activity', page: activity },
  { path: '/trash', page: trash },
  { path: '/team', page: team },
  { path: '/data', page: data },
  { path: '/settings', page: settings },
  { path: '/assign', page: assign },
];

const appEl = document.getElementById('app');
let store;
let router;
let storageWarning = null;
let currentPage = null;
let pageCleanup = null;
let dirtyCheck = null; // () => boolean, registered by the editor
let saveHandler = null; // Ctrl/Cmd+S handler registered by the editor
let credentials = null; // data/users.local.json when present: password sign-in mode
const LIBRARY_URL = 'data/library.json';
const LIBRARY_META_URL = 'data/library.meta.json';

/**
 * When data/library.json was regenerated, browsers that seeded an older copy reload it.
 * Automatic only when this browser has no unexported edits; otherwise the user is asked.
 */
async function checkLibraryUpdate(persistence) {
  let latest;
  try {
    const res = await fetch(LIBRARY_META_URL, { cache: 'no-store' });
    if (!res.ok) return;
    latest = (await res.json()).libraryRevision;
  } catch { return; }
  if (!latest || store.meta.libraryRevision === latest) return;
  // Only data that came from a library (current marker, or the first library without one) is offered an update.
  const fromLibrary = Boolean(store.meta.libraryRevision) || Boolean(store.get('testCases', 'case-login-0001'));
  if (!fromLibrary) return;
  const reload = async () => { await persistence.clearAll(); await store.init({ seed: true }); };
  // Replace silently only when nothing was ever edited in this browser since seeding.
  if (!store.meta.lastChangeAt) {
    await reload();
    return 'auto';
  }
  return reload;
}

const shell = {};

// ---- theme ------------------------------------------------------------------------------
export function applyTheme(pref = prefs.get('theme', 'system')) {
  const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme());

// ---- shell ------------------------------------------------------------------------------
function buildShell() {
  clear(appEl);
  if (prefs.get('sidebarCollapsed', false)) appEl.classList.add('collapsed');
  shell.nav = h('nav', { class: 'nav', 'aria-label': 'Main' });
  shell.project = h('div', { class: 'brand-project' });
  const collapseBtn = h('button', {
    type: 'button', class: 'btn btn-ghost btn-sm collapse-btn', 'aria-label': 'Collapse sidebar',
    onClick: () => {
      const c = appEl.classList.toggle('collapsed');
      prefs.set('sidebarCollapsed', c);
      collapseBtn.replaceChildren(icon(c ? 'chevronRight' : 'chevronLeft', 16), h('span', { class: 'nav-label' }, 'Collapse'));
      collapseBtn.setAttribute('aria-label', c ? 'Expand sidebar' : 'Collapse sidebar');
    },
  }, icon(appEl.classList.contains('collapsed') ? 'chevronRight' : 'chevronLeft', 16), h('span', { class: 'nav-label' }, 'Collapse'));

  const sidebar = h('aside', { class: 'sidebar', id: 'sidebar' },
    h('a', { class: 'brand', href: '#/dashboard', 'aria-label': 'QA Hub home' },
      h('span', { class: 'brand-mark' }, icon('logo', 18)),
      h('span', { class: 'brand-text' }, h('div', { class: 'brand-name' }, 'QA Hub'), shell.project)),
    shell.nav,
    h('div', { class: 'sidebar-foot' }, collapseBtn));

  shell.crumbs = h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' });
  shell.search = h('input', { type: 'search', placeholder: 'Search cases…', 'aria-label': 'Search test cases', id: 'global-search' });
  shell.search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      router.go('/cases', { q: shell.search.value.trim() });
      shell.search.blur();
    }
    if (e.key === 'Escape') shell.search.blur();
  });
  shell.unexported = h('a', { class: 'unexported hide-sm', href: '#/data', hidden: true, title: 'You have changes that are not in any exported JSON file yet.' }, icon('alert', 14), 'Unexported changes');
  shell.newBtn = h('a', { class: 'btn btn-primary', href: '#/cases/new', title: 'New test case (N)' }, icon('plus', 16), h('span', { class: 'hide-sm' }, 'New case'));
  shell.themeBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-icon', onClick: toggleTheme });
  shell.userBtn = h('button', { type: 'button', class: 'user-btn', 'aria-haspopup': 'dialog', onClick: () => profilePicker({ switching: true }) });
  if (credentials) shell.userBtn.title = 'Account';
  const menuBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-icon menu-btn', 'aria-label': 'Open navigation', 'aria-controls': 'sidebar', onClick: () => toggleNav(true) }, icon('menu'));

  const topbar = h('header', { class: 'topbar' },
    menuBtn,
    shell.crumbs,
    h('div', { class: 'topbar-search' }, icon('search', 16), shell.search, h('kbd', null, '/')),
    h('div', { class: 'topbar-actions' }, shell.unexported, shell.newBtn, shell.themeBtn, shell.userBtn));

  shell.content = h('main', { class: 'content', id: 'main', tabindex: '-1' });
  shell.storage = h('div');
  appEl.append(sidebar, h('div', { class: 'main' }, topbar, shell.storage, shell.content));
  shell.nav.addEventListener('click', (e) => { if (e.target.closest('a')) toggleNav(false); });
}

function toggleNav(open) {
  appEl.classList.toggle('nav-open', open);
  document.querySelector('.scrim')?.remove();
  if (open) {
    const scrim = h('div', { class: 'scrim', onClick: () => toggleNav(false) });
    document.body.append(scrim);
    shell.nav.querySelector('a')?.focus();
  }
}

function toggleTheme() {
  const isDark = document.documentElement.dataset.theme === 'dark';
  prefs.set('theme', isDark ? 'light' : 'dark');
  applyTheme();
  renderChrome();
}

function renderChrome() {
  const path = router?.current?.path || '';
  shell.nav.replaceChildren(...NAV.filter((n) => !n.show || n.show(store)).map((n) => {
    if (n.section) return h('div', { class: 'nav-section' }, n.section);
    const count = n.count ? n.count(store) : '';
    return h('a', { href: n.href, 'aria-current': n.match.test(path) ? 'page' : undefined, title: n.label },
      icon(n.icon), h('span', { class: 'nav-label' }, n.label), count !== '' ? h('span', { class: 'count' }, String(count)) : null);
  }));
  shell.project.textContent = store.meta.project.name;
  document.title = `QA Hub · ${store.meta.project.name}`;
  shell.unexported.hidden = !store.hasUnexportedChanges();
  const me = store.actor();
  shell.newBtn.hidden = !store.can('case.edit');
  const dark = document.documentElement.dataset.theme === 'dark';
  shell.themeBtn.replaceChildren(icon(dark ? 'sun' : 'moon'));
  shell.themeBtn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  shell.userBtn.replaceChildren(...(me
    ? [avatar(me), h('span', { class: 'hide-sm' }, h('div', { style: { fontWeight: 600, fontSize: '13px', lineHeight: 1.2 } }, me.displayName), h('div', { class: 'role' }, `${me.role} · ${credentials ? 'signed in locally' : 'not authenticated'}`))]
    : [icon('user'), 'Choose profile']));
  shell.userBtn.setAttribute('aria-label', me ? `${credentials ? 'Signed in as' : 'Active profile'} ${me.displayName}, ${me.role}. ${credentials ? 'Account menu' : 'Switch profile'}` : 'Choose profile');
  shell.storage.replaceChildren(...(storageWarning ? [h('div', { style: { padding: '12px 24px 0' } }, banner('danger', storageWarning))] : []));
}

function setCrumbs(items) {
  const out = [];
  items.forEach((it, i) => {
    if (i) out.push(h('span', { class: 'sep', 'aria-hidden': 'true' }, '/'));
    out.push(it.href && i < items.length - 1 ? h('a', { href: it.href }, it.label) : h('span', { 'aria-current': i === items.length - 1 ? 'page' : undefined }, it.label));
  });
  shell.crumbs.replaceChildren(...out);
}

// ---- pages ------------------------------------------------------------------------------
function renderPage(current, { keepScroll = false } = {}) {
  const page = current.route.page;
  const scroll = keepScroll ? window.scrollY : 0;
  if (pageCleanup) { try { pageCleanup(); } catch (e) { console.error(e); } }
  pageCleanup = null;
  if (currentPage !== page || !keepScroll) { dirtyCheck = null; saveHandler = null; }
  currentPage = page;
  clear(shell.content);
  renderChrome();
  const ctx = {
    store, router, params: current.params, query: current.query, root: shell.content, setCrumbs,
    go: (path, query, opts) => router.go(path, query, opts),
    registerEditor({ isDirty, save }) { dirtyCheck = isDirty; saveHandler = save; },
    profilePicker,
    authMode: credentials ? 'password' : 'profile',
  };
  try {
    const cleanup = page.render(ctx);
    if (typeof cleanup === 'function') pageCleanup = cleanup;
  } catch (e) {
    console.error(e);
    shell.content.append(banner('danger', [h('strong', null, 'This page failed to render.'), h('span', null, e.message)]));
  }
  if (keepScroll) window.scrollTo(0, scroll);
  else {
    window.scrollTo(0, 0);
    if (!isModalOpen() && document.activeElement === document.body) shell.content.focus({ preventScroll: true });
  }
}

async function leaveGuard() {
  if (!dirtyCheck || !dirtyCheck()) return true;
  const ok = await confirmDialog({
    title: 'Discard unsaved changes?',
    message: 'You have unsaved edits on this case. A local draft is kept and will be offered next time you open it, but nothing is saved to the library.',
    confirmLabel: 'Leave page',
    danger: true,
  });
  return Boolean(ok);
}

// ---- sign-in ----------------------------------------------------------------------------
/** Full-screen sign-in. Resolves once a username/password pair matches users.local.json. */
async function signIn(persistence) {
  const hasTeam = () => credentials.users.some((u) => store.get('members', u.memberId));
  // A browser that still holds only the built-in demo seed is upgraded to the library automatically.
  // Real local work (any non-demo case) is never erased without the user confirming "Load library".
  if (!hasTeam() && store.data.testCases.every((c) => c.demo)) {
    try {
      await persistence.clearAll();
      await store.init({ seed: true });
    } catch (e) { console.error(e); }
  }
  const staleData = !hasTeam();
  return new Promise((resolve) => {
    appEl.classList.add('login-mode');
    renderLogin(appEl, {
      store,
      lockoutRemaining,
      staleData,
      async loadLibrary() {
        await persistence.clearAll();
        await store.init({ seed: true });
      },
      async submit({ username, password, remember }) {
        const wait = lockoutRemaining();
        if (wait) return { ok: false, reason: `Too many attempts. Try again in ${wait}s.` };
        const res = await verifyLogin(credentials, username, password);
        if (!res.ok) { recordFailure(); return res; }
        const member = store.get('members', res.memberId);
        if (!member) {
          return { ok: false, reason: 'Password is correct, but the data in this browser has no account for you yet. Use "Load library" above (export anything you need first).' };
        }
        if (member.active === false) {
          return { ok: false, reason: 'Password is correct, but this member is deactivated. Ask an Admin to reactivate you on the Team page.' };
        }
        clearFailures();
        saveSession(res, remember);
        appEl.classList.remove('login-mode');
        resolve(res);
        return { ok: true };
      },
    });
  });
}

async function signOut() {
  if (!(await leaveGuard())) return;
  clearSession();
  prefs.set('activeProfile', null);
  location.hash = '#/dashboard';
  location.reload();
}

async function accountDialog() {
  const me = store.actor();
  const session = readSession();
  const choice = await openModal({
    title: me.displayName,
    description: `${me.role} · @${session?.username || me.memberId}`,
    body: h('div', { class: 'stack' },
      h('dl', { class: 'kv' },
        h('dt', null, 'Member ID'), h('dd', null, h('code', null, me.id)),
        h('dt', null, 'Signed in'), h('dd', null, session?.at ? fmtRelative(new Date(session.at).toISOString()) : '—'),
        h('dt', null, 'Session'), h('dd', null, session?.until ? 'Remembered on this browser for 12 hours' : 'Ends when this tab closes')),
      banner('info', [h('strong', null, 'Local sign-in only.'), h('span', null, 'There is no server: this login keeps honest teammates on their own name in the activity log. It does not protect the data.')])),
    actions: [{ label: 'Close', value: null }, { label: 'Sign out', variant: 'primary', value: 'logout' }],
  });
  if (choice === 'logout') signOut();
}

// ---- profiles ---------------------------------------------------------------------------
export async function profilePicker({ switching = false } = {}) {
  if (credentials && store.actor()) return accountDialog();
  const current = store.actor();
  const members = store.data.members.filter((m) => m.active !== false);
  let createdMember = null;

  const nameIn = h('input', { type: 'text', name: 'displayName', placeholder: 'e.g. Priya S.', autocomplete: 'off' });
  const idIn = h('input', { type: 'text', name: 'memberId', placeholder: 'e.g. priya.s', autocomplete: 'off' });
  nameIn.addEventListener('input', () => {
    if (!idIn.dataset.touched) idIn.value = nameIn.value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
  });
  idIn.addEventListener('input', () => { idIn.dataset.touched = '1'; });
  const createForm = h('form', { class: 'form-grid', novalidate: true },
    field({ label: 'Display name', input: nameIn, name: 'displayName', required: true }),
    field({ label: 'Team member ID', input: idIn, name: 'memberId', required: true, hint: 'Unique, lowercase. Used in exports and history.' }),
    h('div', { class: 'full row' }, h('button', { type: 'submit', class: 'btn' }, icon('plus', 16), 'Create profile & continue'), fieldError('role')));

  let resolveChoice;
  const choice = new Promise((r) => { resolveChoice = r; });
  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      createdMember = await store.saveMember({ displayName: nameIn.value, memberId: idIn.value, role: 'Contributor' }, { selfService: true });
      resolveChoice(createdMember.id);
    } catch (err) {
      if (err.errors) showErrors(createForm, err.errors); else toastError(err);
    }
  });

  const body = h('div', { class: 'stack' },
    banner('info', [
      h('strong', null, 'Profiles are local labels, not logins.'),
      h('span', null, 'QA Hub has no backend, so it cannot verify who you are. Your choice is stored in this browser and recorded on your edits.'),
    ]),
    h('div', null, h('div', { class: 'section-title' }, 'Select your profile'),
      h('div', { class: 'profile-grid' }, members.map((m) => h('button', {
        type: 'button', class: 'profile-option', 'aria-pressed': m.id === current?.id ? 'true' : 'false',
        onClick: () => resolveChoice(m.id),
      }, avatar(m), h('span', null, h('div', { style: { fontWeight: 600 } }, m.displayName), h('div', { class: 'muted small' }, `${m.role} · ${m.memberId}`)))))),
    h('details', { open: members.length === 0 }, h('summary', { style: { cursor: 'pointer', fontWeight: 600, marginBottom: '12px' } }, 'Not listed? Create your profile'), createForm),
  );

  const modalPromise = openModal({
    title: switching ? 'Switch profile' : 'Welcome to QA Hub',
    description: switching ? 'Edits after switching are recorded under the new profile.' : 'Choose who you are on this team to get started.',
    body,
    wide: true,
    dismissible: Boolean(current),
    actions: current ? [{ label: 'Cancel', value: null }] : [],
    onReady: (close) => { choice.then((id) => close(id)); },
  });
  const chosen = await modalPromise;
  if (!chosen || chosen === current?.id) return current;
  if (current && switching) {
    const target = store.get('members', chosen);
    const ok = await confirmDialog({ title: `Switch to ${target.displayName}?`, message: 'The switch is written to the activity log.', confirmLabel: 'Switch profile' });
    if (!ok) return current;
  }
  const prev = current?.id || null;
  store.setActor(chosen);
  prefs.set('activeProfile', chosen);
  try { await store.logProfileSwitch(prev, chosen); } catch (e) { toastError(e); }
  toast(`Signed in locally as ${store.actor().displayName}`);
  if (router?.current) renderPage(router.current, { keepScroll: true });
  return store.actor();
}

// ---- keyboard shortcuts -----------------------------------------------------------------
function isTyping(e) {
  const t = e.target;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}

function onKeydown(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    if (saveHandler && !isModalOpen()) {
      e.preventDefault();
      saveHandler();
    }
    return;
  }
  if (isModalOpen() || isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '/') {
    e.preventDefault();
    const local = document.querySelector('[data-primary-search]');
    (local || shell.search).focus();
    (local || shell.search).select?.();
  } else if (e.key === 'n' || e.key === 'N') {
    if (store.can('case.edit')) { e.preventDefault(); router.go('/cases/new', router.current?.query?.module ? { module: router.current.query.module } : {}); }
  } else if (e.key === '?') {
    e.preventDefault();
    showShortcuts();
  }
}

function showShortcuts() {
  const rows = [['/', 'Focus search'], ['N', 'New test case'], ['Ctrl / ⌘ + S', 'Save in the case editor'], ['Esc', 'Close dialog or menu'], ['?', 'Show this help']];
  openModal({
    title: 'Keyboard shortcuts',
    body: h('dl', { class: 'kv' }, rows.flatMap(([k, v]) => [h('dt', null, h('kbd', null, k)), h('dd', null, v)])),
    actions: [{ label: 'Close', variant: 'primary' }],
  });
}

// ---- boot -------------------------------------------------------------------------------
async function boot() {
  let persistence;
  try {
    persistence = await createIndexedDbPersistence();
  } catch (e) {
    console.error(e);
    persistence = createMemoryPersistence();
    storageWarning = [h('strong', null, 'Browser storage is unavailable — changes will be lost on reload.'),
      h('span', null, `${e.message} Export JSON before closing this tab (private browsing can cause this).`)];
  }
  store = createStore(persistence);
  try {
    await store.init({
      seedSource: async () => {
        const res = await fetch(LIBRARY_URL, { cache: 'no-store' });
        if (!res.ok) throw new Error(`${LIBRARY_URL}: HTTP ${res.status}`);
        return res.json();
      },
    });
  } catch (e) {
    clear(appEl).append(h('div', { class: 'content' }, banner('danger', [h('strong', null, 'QA Hub could not load its data.'), h('span', null, e.message)])));
    return;
  }
  window.qaHub = { store }; // handy for debugging in DevTools

  let pendingLibraryUpdate = null;
  try {
    const upd = await checkLibraryUpdate(persistence);
    if (typeof upd === 'function') pendingLibraryUpdate = upd;
    else if (upd === 'auto') setTimeout(() => toast('Loaded the updated test library.'), 400);
  } catch (e) { console.error(e); }

  credentials = await loadCredentials();
  if (credentials) {
    const session = readSession();
    const valid = session && store.get('members', session.memberId)?.active !== false
      && credentials.users.some((u) => u.memberId === session.memberId);
    if (!valid) {
      clearSession();
      const res = await signIn(persistence);
      store.setActor(res.memberId);
      try { await store.logProfileSwitch(null, res.memberId); } catch (e) { console.error(e); }
    } else store.setActor(session.memberId);
    prefs.set('activeProfile', store.actor().id);
  }

  buildShell();
  router = createRouter(ROUTES, (current) => renderPage(current));

  const saved = prefs.get('activeProfile');
  if (!credentials && saved && store.get('members', saved)?.active !== false) store.setActor(saved);

  store.subscribe((change) => {
    if (change.type === 'actor') return;
    if (change.type === 'change' || change.type === 'reload' || change.type === 'export') {
      if (change.type !== 'export') channel?.postMessage({ type: 'changed', at: Date.now() });
      if (router.current) {
        // Pages with live editors (editor) handle changes themselves.
        if (currentPage?.keepAliveOnChange) renderChrome();
        else renderPage(router.current, { keepScroll: true });
      }
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (dirtyCheck && dirtyCheck()) { e.preventDefault(); e.returnValue = ''; }
  });
  document.addEventListener('keydown', onKeydown);

  // Permanent guard: asks only when the current page reports unsaved changes.
  router.setGuard(leaveGuard);
  router.start();

  if (!store.actor()) await profilePicker();

  if (persistence.kind === 'indexeddb' && navigator.storage?.persist) {
    navigator.storage.persisted?.().then((p) => { if (!p) navigator.storage.persist().catch(() => {}); });
  }
  maybeRemindBackup();
  if (pendingLibraryUpdate) {
    toast('A newer test library is available. Loading it replaces the data in this browser — export your changes first.', {
      type: 'success', timeout: 20000,
      action: {
        label: 'Load library',
        onClick: async () => {
          const ok = await confirmDialog({ title: 'Load the new test library?', message: 'All QA Hub data in this browser is erased and replaced with data/library.json. Export first if you need your local edits.', confirmLabel: 'Erase and load', danger: true });
          if (!ok) return;
          await pendingLibraryUpdate();
          location.reload();
        },
      },
    });
  }
}

function maybeRemindBackup() {
  const hours = store.meta.settings.backupReminderHours;
  if (!hours || !store.hasUnexportedChanges()) return;
  const since = store.meta.lastExportAt || store.meta.seededAt;
  const last = since ? new Date(since).getTime() : 0;
  if (Date.now() - last < hours * 3600 * 1000) return;
  toast(store.meta.lastExportAt
    ? `Last JSON export was ${fmtRelative(store.meta.lastExportAt)}. Export to back up and share your changes.`
    : 'Your changes have never been exported. Clearing browser data would lose them.', {
    type: 'success', action: { label: 'Export', onClick: () => router.go('/data') }, timeout: 10000,
  });
}

// ---- cross-tab sync ---------------------------------------------------------------------
let channel = null;
try {
  channel = new BroadcastChannel('qa-hub');
  channel.onmessage = (e) => {
    if (e.data?.type === 'changed' && store) store.reload().catch(toastError);
  };
} catch { /* BroadcastChannel unsupported: tabs refresh on reload only */ }

boot();
