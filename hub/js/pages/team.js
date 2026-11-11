import { h, icon } from '../utils.js';
import { ROLES } from '../schema.js';
import { pageHead, card, avatar, banner, plainChip, menu } from '../components/ui.js';
import { formDialog } from '../components/modal.js';
import { toast, toastError } from '../components/toast.js';

const ROLE_HELP = {
  Admin: 'Everything, incl. team edits, permanent delete, reset',
  Maintainer: 'Modules/suites, review & approve, import',
  Contributor: 'Create, edit, submit for review, bulk edit',
  Viewer: 'Read-only',
};

function memberDialog(store, existing = null) {
  return formDialog({
    title: existing ? `Edit ${existing.displayName}` : 'Add team member',
    description: 'Profiles are local labels. They are not accounts and are not authenticated.',
    fields: [
      { name: 'displayName', label: 'Display name', required: true, value: existing?.displayName },
      { name: 'memberId', label: 'Team member ID', required: true, value: existing?.memberId, hint: 'Unique, lowercase, e.g. priya.s' },
      { name: 'role', label: 'Role', type: 'select', value: existing?.role || 'Contributor', options: ROLES.map((r) => ({ value: r, label: `${r} — ${ROLE_HELP[r]}` })) },
      existing && { name: 'active', label: 'Active (can be selected and assigned)', type: 'checkbox', value: existing.active !== false },
    ].filter(Boolean),
    submitLabel: existing ? 'Save' : 'Add member',
    onSubmit: async (v) => {
      await store.saveMember({ ...v, id: existing?.id });
      toast(existing ? 'Member saved' : `${v.displayName} added`);
    },
  });
}

export function render({ store, root, setCrumbs, profilePicker, authMode }) {
  const pw = authMode === 'password';
  setCrumbs([{ label: 'Team' }]);
  const canEdit = store.can('team.edit');
  const me = store.actor();
  const active = store.activeCases();

  root.append(pageHead({
    title: 'Team',
    subtitle: pw ? 'Team members, roles, module ownership and workload.' : 'Local profiles, ownership and workload.',
    actions: [
      h('button', { type: 'button', class: 'btn', onClick: () => profilePicker({ switching: true }) }, icon('user', 16), pw ? 'Account' : 'Switch profile'),
      canEdit && h('button', { type: 'button', class: 'btn btn-primary', onClick: () => memberDialog(store) }, icon('plus', 16), 'Add member'),
    ],
  }));
  root.append(h('div', { style: { marginBottom: '16px' } }, banner('info', [
    h('strong', null, 'Roles are a convenience, not access control.'),
    h('span', null, pw
      ? 'Sign-in is checked in the browser only. Anyone with these files or DevTools can bypass it or edit data. Use Git pull-request review for shared data. A new member can sign in only after an Admin adds them to data/users.local.json with scripts/create-users.js.'
      : 'Anyone with these files or browser DevTools can switch profile or edit data. Use Git pull-request review for shared data.'),
  ])));
  if (store.data.members.some((m) => m.placeholder)) {
    root.append(h('div', { style: { marginBottom: '16px' } }, banner('warn', 'Developer A–H are editable placeholders. Rename them to your team members (Admin) or add new profiles.')));
  }

  const rows = store.data.members.slice().sort((a, b) => (a.active === false) - (b.active === false) || ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || a.displayName.localeCompare(b.displayName)).map((m) => {
    const assigned = active.filter((c) => c.assignedTo === m.id);
    const open = assigned.filter((c) => c.status === 'Draft' || c.status === 'Ready for Review').length;
    const created = active.filter((c) => c.createdBy === m.id).length;
    const owns = store.data.modules.filter((x) => x.ownerId === m.id && !x.archived).map((x) => x.name);
    return h('tr', { style: m.active === false ? { opacity: 0.6 } : null },
      h('td', { class: 'title-cell' }, h('div', { class: 'person' }, avatar(m), h('div', null,
        h('div', { style: { fontWeight: 600 } }, m.displayName, m.id === me?.id ? h('span', { class: 'chip chip-approved plain', style: { marginLeft: '6px' } }, 'You') : null),
        h('div', { class: 'muted small mono' }, m.memberId)))),
      h('td', { 'data-label': 'Role' }, plainChip(m.role), m.active === false ? plainChip('Inactive') : null),
      h('td', { 'data-label': 'Assigned' }, h('a', { href: `#/cases?assignee=${m.id}` }, String(assigned.length)), open ? h('span', { class: 'muted small' }, ` (${open} open)`) : null),
      h('td', { 'data-label': 'Created' }, String(created)),
      h('td', { 'data-label': 'Owns', class: 'small' }, owns.length ? owns.join(', ') : h('span', { class: 'muted' }, '—')),
      h('td', { class: 'col-actions' }, canEdit && menu(null, [
        { label: 'Edit', icon: 'edit', onClick: () => memberDialog(store, m) },
        m.active !== false
          ? { label: 'Deactivate', icon: 'archive', onClick: () => store.saveMember({ ...m, active: false }).then(() => toast(`${m.displayName} deactivated`)).catch(toastError) }
          : { label: 'Reactivate', icon: 'restore', onClick: () => store.saveMember({ ...m, active: true }).then(() => toast(`${m.displayName} reactivated`)).catch(toastError) },
      ], { label: `Actions for ${m.displayName}` })));
  });

  root.append(card({
    title: `${store.data.members.length} ${pw ? 'members' : 'profiles'}`,
    flush: true,
    body: h('div', { class: 'table-wrap', style: { maxHeight: 'none' } }, h('table', { class: 'table cards' },
      h('thead', null, h('tr', null, ['Member', 'Role', 'Assigned', 'Created', 'Owns modules'].map((t) => h('th', { scope: 'col' }, t)), h('th', { class: 'col-actions' }, h('span', { class: 'sr-only' }, 'Actions')))),
      h('tbody', null, rows))),
  }));

  root.append(h('div', { style: { marginTop: '16px' } }, card({
    title: 'Role reference',
    body: h('dl', { class: 'kv' }, ROLES.flatMap((r) => [h('dt', null, r), h('dd', null, ROLE_HELP[r])])),
  })));
}
