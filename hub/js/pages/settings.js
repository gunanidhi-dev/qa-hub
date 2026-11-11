import { h, icon, prefs, plural, fmtDate } from '../utils.js';
import { SCHEMA_VERSION } from '../schema.js';
import { pageHead, card, banner, field, select, showErrors, menu, emptyState } from '../components/ui.js';
import { confirmDialog } from '../components/modal.js';
import { toast, toastError } from '../components/toast.js';
import { labelDialog, deleteLabel } from './suites.js';
import { downloadFullJson } from './data.js';

function fmtBytes(n) {
  if (!Number.isFinite(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function render({ store, root, setCrumbs }) {
  setCrumbs([{ label: 'Settings' }]);
  const canEdit = store.can('settings.edit');
  const isAdmin = store.can('data.reset');
  root.append(pageHead({ title: 'Settings', subtitle: 'Project, appearance, labels, storage and data management.' }));

  // ---- project ----
  const nameIn = h('input', { type: 'text', name: 'name', value: store.meta.project.name, disabled: !canEdit, maxlength: 80 });
  const reminderSel = select([
    { value: '0', label: 'Off' }, { value: '8', label: 'After 8 hours' }, { value: '24', label: 'After 1 day' }, { value: '72', label: 'After 3 days' }, { value: '168', label: 'After 1 week' },
  ], String(store.meta.settings.backupReminderHours ?? 24), { name: 'backupReminderHours', disabled: !canEdit });
  const projectForm = h('form', { class: 'form-grid', novalidate: true },
    field({ label: 'Project name', input: nameIn, name: 'name' }),
    field({ label: 'Backup reminder', input: reminderSel, name: 'backupReminderHours', hint: 'Reminds you on launch when changes have not been exported.' }),
    canEdit && h('div', { class: 'full' }, h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save project settings')));
  projectForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!nameIn.value.trim()) return showErrors(projectForm, { name: 'Project name is required.' });
    try {
      await store.updateProject({ name: nameIn.value, settings: { backupReminderHours: Number(reminderSel.value) } });
      toast('Settings saved');
    } catch (err) { toastError(err); }
  });

  // ---- appearance ----
  const themePref = prefs.get('theme', 'system');
  const themeGroup = h('div', { class: 'check-list', role: 'radiogroup', 'aria-label': 'Theme' }, ['system', 'light', 'dark'].map((t) => h('label', { class: 'check-pill' },
    h('input', {
      type: 'radio', name: 'theme', value: t, checked: themePref === t,
      onChange: () => {
        prefs.set('theme', t);
        const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
        document.documentElement.dataset.theme = dark ? 'dark' : 'light';
        toast(`Theme: ${t}`);
      },
    }), t[0].toUpperCase() + t.slice(1))));

  // ---- accounts ----
  const accounts = store.data.accounts;
  const accountsBody = accounts.length
    ? h('div', { class: 'list' }, accounts.map((a) => {
      const n = store.labelUsage('accounts', a.id).length;
      return h('div', { class: 'list-item' },
        h('span', { class: 'grow' }, h('span', { class: 'title' }, a.name), a.description && h('span', { class: 'muted small' }, a.description)),
        h('a', { class: 'muted small', href: `#/cases?account=${a.id}` }, plural(n, 'case')),
        store.can('structure.edit') && menu(null, [
          { label: 'Rename', icon: 'edit', onClick: () => labelDialog(store, 'accounts', a) },
          { label: 'Delete', icon: 'trash', danger: true, onClick: () => deleteLabel(store, 'accounts', a) },
        ], { label: `Actions for ${a.name}` }));
    }))
    : emptyState({ iconName: 'info', title: 'No account labels', text: 'Account labels tag cases that apply to specific customer accounts or tenants.' });

  // ---- storage ----
  const storageInfo = h('dl', { class: 'kv' },
    h('dt', null, 'Storage engine'), h('dd', null, store.persistenceKind === 'indexeddb' ? 'IndexedDB (this browser profile only)' : 'Memory only — data is lost on reload'),
    h('dt', null, 'Schema version'), h('dd', null, String(SCHEMA_VERSION)),
    h('dt', null, 'Records'), h('dd', null, `${plural(store.data.testCases.length, 'case')}, ${plural(store.data.modules.length, 'module')}, ${plural(store.data.features.length, 'feature')}, ${plural(store.data.members.length, 'profile')}, ${plural(store.data.activity.length, 'history event')}`),
    h('dt', null, 'Last full export'), h('dd', null, store.meta.lastExportAt ? fmtDate(store.meta.lastExportAt) : 'Never'));
  const usage = h('dd', null, 'Checking…');
  const persisted = h('dd', null, 'Checking…');
  storageInfo.append(h('dt', null, 'Usage / quota'), usage, h('dt', null, 'Persistent storage'), persisted);
  if (navigator.storage?.estimate) {
    navigator.storage.estimate().then((e) => { usage.textContent = `${fmtBytes(e.usage)} of ${fmtBytes(e.quota)}`; }).catch(() => { usage.textContent = 'Unavailable'; });
  } else usage.textContent = 'Unavailable';
  if (navigator.storage?.persisted) {
    navigator.storage.persisted().then((p) => {
      persisted.replaceChildren(p ? 'Granted — the browser will not evict data automatically' : h('span', null, 'Not granted — the browser may evict data under storage pressure. ',
        h('button', { type: 'button', class: 'btn-link', onClick: () => navigator.storage.persist().then((ok) => { toast(ok ? 'Persistent storage granted' : 'The browser declined persistent storage', { type: ok ? 'success' : 'error' }); }) }, 'Request')));
    });
  } else persisted.textContent = 'Unavailable';

  // ---- danger zone ----
  const demoCount = store.data.testCases.filter((c) => c.demo).length;
  const sampleCb = h('input', { type: 'checkbox' });
  const clearDemo = async () => {
    const ok = await confirmDialog({
      title: 'Clear demo data?',
      message: `Removes ${plural(demoCount, 'demo case')} and their history.${sampleCb.checked ? ' Also removes unchanged sample modules/features that have no other cases.' : ''} Profiles, settings and your own cases are kept.`,
      confirmLabel: 'Clear demo data', danger: true,
    });
    if (!ok) return;
    try {
      const r = await store.clearDemoData({ includeSampleStructure: sampleCb.checked });
      toast(`Removed ${plural(r.cases, 'demo case')}${r.modules ? `, ${plural(r.modules, 'module')}` : ''}${r.features ? `, ${plural(r.features, 'feature')}` : ''}`);
    } catch (e) { toastError(e); }
  };
  const resetAll = async () => {
    const ok = await confirmDialog({
      title: 'Erase all local data?',
      message: 'Every case, module, profile and history event in this browser is deleted and the starter content is re-created. A JSON backup is downloaded first.',
      confirmLabel: 'Erase local data', danger: true, typed: 'RESET',
    });
    if (!ok) return;
    try {
      downloadFullJson(store, { silent: true });
      await store.resetAll();
      prefs.remove('activeProfile');
      toast('Local data erased. Choose your profile again.');
      setTimeout(() => location.reload(), 600);
    } catch (e) { toastError(e); }
  };

  root.append(h('div', { class: 'grid grid-2', style: { alignItems: 'start' } },
    h('div', { class: 'stack' },
      card({ title: 'Project', body: h('div', { class: 'stack' }, projectForm, !canEdit ? h('p', { class: 'muted small' }, 'Only Maintainers/Admins can change project settings.') : null) }),
      card({ title: 'Appearance', body: h('div', { class: 'stack' }, themeGroup, h('p', { class: 'muted small' }, 'Theme is stored in this browser only. Motion is reduced automatically when your OS requests it.')) }),
      card({
        title: 'Account labels',
        actions: store.can('structure.edit') && h('button', { type: 'button', class: 'btn btn-sm', onClick: () => labelDialog(store, 'accounts') }, icon('plus', 14), 'Add'),
        flush: true,
        body: accountsBody,
      }),
      card({ title: 'Keyboard shortcuts', body: h('dl', { class: 'kv' },
        ...[['/', 'Focus search'], ['N', 'New test case'], ['Ctrl/⌘ + S', 'Save in editor'], ['Esc', 'Close dialog'], ['?', 'Shortcut help']].flatMap(([k, v]) => [h('dt', null, h('kbd', null, k)), h('dd', null, v)])) })),
    h('div', { class: 'stack' },
      card({ title: 'Security & trust limitations', body: h('div', { class: 'stack', style: { gap: '10px' } },
        banner('warn', [h('strong', null, 'Roles are UI conveniences, not access control.'), h('span', null, 'Anyone with the static files, browser DevTools or the JSON can switch profile, change roles or edit data.')]),
        banner('info', [h('strong', null, 'Activity log, not an audit trail.'), h('span', null, 'Actor names and timestamps come from this browser and can be edited. For regulated auditability a backend with real authentication and server-side append-only logs is required.')]),
        banner('info', [h('strong', null, 'No live sync.'), h('span', null, 'Edits are visible to teammates only after you export and they import (via Git).')]),
        banner('danger', [h('strong', null, 'No PHI or secrets.'), h('span', null, 'Use synthetic data only. Never enter patient information, credentials, API tokens or payment details.')])) }),
      card({ title: 'Storage', body: storageInfo }),
      card({ title: 'Data management', body: h('div', { class: 'stack' },
        h('div', { class: 'stack', style: { gap: '8px' } },
          h('strong', null, 'Demo data'),
          h('p', { class: 'muted small' }, demoCount ? `${plural(demoCount, 'demonstration case')} (AUTH-001, PAT-001) present.` : 'No demo cases remain.'),
          h('label', { class: 'check small' }, sampleCb, 'Also remove unchanged sample modules/features with no other cases'),
          h('div', null, h('button', { type: 'button', class: 'btn', disabled: !demoCount || !isAdmin, onClick: clearDemo }, 'Clear demo data'))),
        h('div', { class: 'menu-sep' }),
        h('div', { class: 'stack', style: { gap: '8px' } },
          h('strong', null, 'Erase local data'),
          h('p', { class: 'muted small' }, 'Deletes everything stored by QA Hub in this browser (a backup JSON is downloaded first).'),
          h('div', null, h('button', { type: 'button', class: 'btn btn-danger', disabled: !isAdmin, onClick: resetAll }, 'Erase local data…'))),
        !isAdmin ? h('p', { class: 'muted small' }, 'Admin profile required for these actions.') : null) }))));
}
