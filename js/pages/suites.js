import { h, icon, plural } from '../utils.js';
import { pageHead, card, emptyState, menu, priorityChip, statusChip } from '../components/ui.js';
import { formDialog, confirmDialog } from '../components/modal.js';
import { toast, toastError } from '../components/toast.js';

/** Shared editor for configurable labels (suites, accounts). */
export function labelDialog(store, collection, existing = null) {
  const noun = collection === 'testSuites' ? 'suite' : 'account';
  return formDialog({
    title: existing ? `Edit ${existing.name}` : `New ${noun}`,
    fields: [
      { name: 'name', label: 'Name', required: true, value: existing?.name, full: true },
      { name: 'description', label: 'Description', type: 'textarea', value: existing?.description, full: true },
    ],
    submitLabel: existing ? 'Save' : `Create ${noun}`,
    onSubmit: async (v) => {
      await store.saveLabel(collection, { ...v, id: existing?.id });
      toast(existing ? `${v.name} saved` : `${noun[0].toUpperCase()}${noun.slice(1)} ${v.name} created`);
    },
  });
}

export async function deleteLabel(store, collection, item) {
  const users = store.labelUsage(collection, item.id);
  const noun = collection === 'testSuites' ? 'suite' : 'account';
  const ok = await confirmDialog({
    title: `Delete ${noun} "${item.name}"?`,
    message: users.length
      ? `This ${noun} is used by ${plural(users.length, 'case')} (including any in trash). Deleting it removes it from those cases; each change is recorded in their history.`
      : `No cases use this ${noun}.`,
    confirmLabel: users.length ? `Remove from ${users.length} and delete` : 'Delete',
    danger: true,
    typed: users.length ? item.name : null,
  });
  if (!ok) return;
  try {
    await store.deleteLabel(collection, item.id, { removeFromCases: true });
    toast(`${item.name} deleted`);
  } catch (e) { toastError(e); }
}

export function render({ store, root, setCrumbs }) {
  setCrumbs([{ label: 'Test Suites' }]);
  const canEdit = store.can('structure.edit');
  root.append(pageHead({
    title: 'Test Suites',
    subtitle: 'Curated collections such as Smoke or Regression. A case can belong to several suites. Suites are separate from test level and status.',
    actions: [canEdit && h('button', { type: 'button', class: 'btn btn-primary', onClick: () => labelDialog(store, 'testSuites') }, icon('plus', 16), 'New suite')],
  }));
  const suites = [...store.data.testSuites].sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name));
  if (!suites.length) {
    root.append(card({ body: emptyState({ iconName: 'suites', title: 'No suites', text: 'Create suites like Smoke, Sanity or Regression.' }) }));
    return;
  }
  const active = store.activeCases();
  root.append(h('div', { class: 'grid grid-2' }, suites.map((s) => {
    const cases = active.filter((c) => c.suites.includes(s.id));
    const crit = cases.filter((c) => c.priority === 'Critical').length;
    const approved = cases.filter((c) => c.status === 'Approved').length;
    const auto = cases.filter((c) => c.automationStatus === 'Automated').length;
    const top = [...cases].sort((a, b) => a.caseKey.localeCompare(b.caseKey, undefined, { numeric: true })).slice(0, 5);
    return card({
      title: h('div', null, h('h2', null, s.name), s.description && h('p', { class: 'muted small' }, s.description)),
      actions: canEdit && menu(null, [
        { label: 'Edit', icon: 'edit', onClick: () => labelDialog(store, 'testSuites', s) },
        { label: 'Delete', icon: 'trash', danger: true, onClick: () => deleteLabel(store, 'testSuites', s) },
      ], { label: `Actions for ${s.name}` }),
      flush: true,
      body: h('div', null,
        h('div', { class: 'row small', style: { padding: '12px 18px', gap: '16px' } },
          h('span', null, h('strong', null, String(cases.length)), ' cases'),
          h('span', null, `${approved} approved`),
          h('span', null, `${crit} critical`),
          h('span', null, `${auto} automated`)),
        top.length ? h('div', { class: 'list' }, top.map((c) => h('a', { class: 'list-item', href: `#/cases/${c.id}` },
          h('span', { class: 'key' }, c.caseKey), h('span', { class: 'grow' }, h('span', { class: 'title' }, c.title)), statusChip(c.status), priorityChip(c.priority))))
          : h('p', { class: 'muted small', style: { padding: '0 18px 14px' } }, 'No cases in this suite yet. Add it from the case editor or with bulk edit.')),
      foot: h('a', { class: 'btn btn-sm', href: `#/cases?suite=${s.id}` }, `Open all ${cases.length} in library`),
    });
  })));
}
