// Admin-only "Assign work" page: bulk-assign cases by module / feature / suite / priority / status,
// see each member's workload, and set module owners. Assignment itself goes through
// store.bulkUpdateCases(), which enforces the 'case.assign' permission (Admin).

import { h, icon } from '../utils.js';
import { PRIORITIES, CASE_STATUSES } from '../schema.js';
import { pageHead, card, barList, emptyState, select, field, avatar, banner } from '../components/ui.js';
import { confirmDialog } from '../components/modal.js';
import { toast, toastError } from '../components/toast.js';
import { buildHash } from '../router.js';

// Kept across re-renders (the page re-renders after every store change).
const sel = { module: '', feature: '', suite: '', priority: '', status: '', onlyUnassigned: true, member: '' };

const fmt = (n) => n.toLocaleString('en-US');

function matching(store) {
  return store.activeCases().filter((c) => (!sel.module || c.moduleId === sel.module)
    && (!sel.feature || c.featureId === sel.feature)
    && (!sel.suite || c.suites.includes(sel.suite))
    && (!sel.priority || c.priority === sel.priority)
    && (!sel.status || c.status === sel.status)
    && (!sel.onlyUnassigned || !c.assignedTo));
}

export function render({ store, root, setCrumbs }) {
  setCrumbs([{ label: 'Assign work' }]);
  root.append(pageHead({ title: 'Assign work', subtitle: 'Admin only. Hand out test cases and module ownership to the team.' }));
  if (!store.can('case.assign')) {
    root.append(card({ body: emptyState({ iconName: 'user', title: 'Only an Admin assigns work', text: `Your role is ${store.actor()?.role || 'none'}.` }) }));
    return;
  }

  const active = store.activeCases();
  const members = store.data.members.filter((m) => m.active !== false);
  const unassigned = active.filter((c) => !c.assignedTo).length;
  const stat = (label, value, sub, href) => h('a', { class: 'card stat', href }, h('div', { class: 'stat-label' }, label), h('div', { class: 'stat-value' }, fmt(value)), sub && h('div', { class: 'stat-sub' }, sub));
  root.append(h('div', { class: 'stats' },
    stat('Active cases', active.length, 'not deprecated', '#/cases'),
    stat('Unassigned', unassigned, active.length ? `${Math.round((unassigned / active.length) * 100)}% of library` : '', buildHash('/cases', { assignee: 'none' })),
    stat('Assigned', active.length - unassigned, `${members.length} active members`, '#/team'),
    stat('Modules without owner', store.data.modules.filter((m) => !m.archived && !m.ownerId).length, 'set below', '#/assign')));

  // ---- bulk assign form --------------------------------------------------------------------
  const modules = store.data.modules.filter((m) => !m.archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (sel.feature && store.get('features', sel.feature)?.moduleId !== sel.module) sel.feature = '';
  const suites = [...store.data.testSuites].sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

  const count = h('strong');
  const preview = h('a', { class: 'small' }, 'Preview in library');
  const assignBtn = h('button', { type: 'submit', class: 'btn btn-primary' }, icon('user', 16), h('span'));
  const refresh = () => {
    const n = matching(store).length;
    count.textContent = fmt(n);
    preview.href = buildHash('/cases', { module: sel.module || undefined, feature: sel.feature || undefined, suite: sel.suite || undefined, priority: sel.priority || undefined, status: sel.status || undefined, assignee: sel.onlyUnassigned ? 'none' : undefined });
    const who = store.get('members', sel.member);
    assignBtn.lastChild.textContent = sel.member === '__none' ? `Unassign ${fmt(n)} cases` : who ? `Assign ${fmt(n)} to ${who.displayName}` : 'Choose a member';
    assignBtn.disabled = !n || !sel.member;
  };

  const bind = (key, el, rerender = false) => {
    el.addEventListener('change', () => {
      sel[key] = el.type === 'checkbox' ? el.checked : el.value;
      if (rerender) { if (key === 'module') sel.feature = ''; renderForm(); }
      refresh();
    });
    return el;
  };

  const formHost = h('div');
  function renderForm() {
    const feats = store.data.features.filter((f) => !f.archived && f.moduleId === sel.module);
    const onlyBox = bind('onlyUnassigned', h('input', { type: 'checkbox', checked: sel.onlyUnassigned }));
    formHost.replaceChildren(h('div', { class: 'form-grid' },
      field({ label: 'Module', input: bind('module', select([{ value: '', label: 'All modules' }, ...modules.map((m) => ({ value: m.id, label: `${m.keyPrefix} · ${m.name}` }))], sel.module, { name: 'module' }), true) }),
      field({ label: 'Feature', input: bind('feature', select([{ value: '', label: sel.module ? 'All features' : 'Choose a module first' }, ...feats.map((f) => ({ value: f.id, label: f.name }))], sel.feature, { name: 'feature', disabled: !sel.module })) }),
      field({ label: 'Suite', input: bind('suite', select([{ value: '', label: 'Any suite' }, ...suites.map((s) => ({ value: s.id, label: s.name }))], sel.suite, { name: 'suite' })) }),
      field({ label: 'Priority', input: bind('priority', select([{ value: '', label: 'Any priority' }, ...PRIORITIES], sel.priority, { name: 'priority' })) }),
      field({ label: 'Status', input: bind('status', select([{ value: '', label: 'Any status' }, ...CASE_STATUSES], sel.status, { name: 'status' })) }),
      field({ label: 'Assign to', input: bind('member', select([{ value: '', label: 'Choose a member…' }, ...members.map((m) => ({ value: m.id, label: `${m.displayName} (${m.role})` })), { value: '__none', label: 'Nobody (unassign)' }], sel.member, { name: 'member' })) }),
      h('label', { class: 'check full' }, onlyBox, h('span', null, 'Only cases that nobody is assigned to yet'))));
  }
  renderForm();

  const form = h('form', { class: 'stack', novalidate: true },
    formHost,
    h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      h('span', { class: 'muted' }, count, ' matching cases · ', preview),
      assignBtn));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ids = matching(store).map((c) => c.id);
    if (!ids.length || !sel.member) return;
    const who = store.get('members', sel.member);
    const label = sel.member === '__none' ? 'nobody' : who.displayName;
    const ok = await confirmDialog({ title: `Assign ${fmt(ids.length)} cases to ${label}?`, message: 'Each case gets a new version and an activity entry. You can re-assign later.', confirmLabel: 'Assign' });
    if (!ok) return;
    assignBtn.disabled = true;
    try {
      const n = await store.bulkUpdateCases(ids, { assignedTo: sel.member === '__none' ? '' : sel.member });
      toast(`${fmt(n)} cases assigned to ${label}`);
    } catch (err) { toastError(err); refresh(); }
  });
  refresh();

  // ---- workload ----------------------------------------------------------------------------
  const load = members.map((m) => {
    const mine = active.filter((c) => c.assignedTo === m.id);
    return { label: m.displayName, value: mine.length, display: `${fmt(mine.length)}`, href: buildHash('/cases', { assignee: m.id }) };
  }).sort((a, b) => b.value - a.value);

  root.append(h('div', { class: 'split', style: { marginBottom: '16px' } },
    card({ title: 'Assign cases in bulk', body: form }),
    card({ title: 'Workload', actions: h('span', { class: 'muted small' }, 'assigned cases'), body: barList(load, { empty: 'No members.' }) })));

  // ---- module ownership --------------------------------------------------------------------
  const rows = modules.map((m) => {
    const mc = active.filter((c) => c.moduleId === m.id);
    const open = mc.filter((c) => !c.assignedTo).length;
    const owner = select([{ value: '', label: 'No owner' }, ...members.map((x) => ({ value: x.id, label: x.displayName }))], m.ownerId, { 'aria-label': `Owner of ${m.name}` });
    owner.addEventListener('change', () => store.saveModule({ ...m, ownerId: owner.value }).then(() => toast(`${m.name}: owner updated`)).catch(toastError));
    const toOwner = h('button', {
      type: 'button', class: 'btn btn-sm', disabled: !m.ownerId || !open,
      title: m.ownerId ? 'Assign this module\'s unassigned cases to its owner' : 'Set an owner first',
      onClick: async () => {
        const who = store.get('members', m.ownerId);
        const ids = mc.filter((c) => !c.assignedTo).map((c) => c.id);
        const ok = await confirmDialog({ title: `Assign ${fmt(ids.length)} ${m.name} cases to ${who.displayName}?`, message: 'Only unassigned cases in this module are changed.', confirmLabel: 'Assign' });
        if (!ok) return;
        store.bulkUpdateCases(ids, { assignedTo: m.ownerId }).then((n) => toast(`${fmt(n)} cases assigned to ${who.displayName}`)).catch(toastError);
      },
    }, 'Unassigned → owner');
    const ownerMember = store.get('members', m.ownerId);
    return h('tr', null,
      h('td', { class: 'title-cell' }, h('div', { style: { fontWeight: 600 } }, m.name), h('div', { class: 'muted small mono' }, m.keyPrefix)),
      h('td', { 'data-label': 'Cases' }, h('a', { href: buildHash('/cases', { module: m.id }) }, fmt(mc.length))),
      h('td', { 'data-label': 'Unassigned' }, open ? h('a', { href: buildHash('/cases', { module: m.id, assignee: 'none' }) }, fmt(open)) : h('span', { class: 'muted' }, '0')),
      h('td', { 'data-label': 'Owner' }, h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, ownerMember ? avatar(ownerMember, true) : null, owner)),
      h('td', { 'data-label': 'Action' }, toOwner));
  });
  root.append(card({
    title: 'Modules and owners',
    flush: true,
    body: h('div', { class: 'stack', style: { gap: 0 } },
      h('div', { style: { padding: '12px 16px 0' } }, banner('info', 'Module owners are responsible for keeping a module\'s cases current. Setting an owner does not assign cases until you click "Unassigned → owner".')),
      h('div', { class: 'table-wrap', style: { maxHeight: 'none' } }, h('table', { class: 'table cards' },
        h('thead', null, h('tr', null, ['Module', 'Cases', 'Unassigned', 'Owner', ''].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', null, rows)))),
  }));
}
