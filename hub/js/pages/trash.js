import { h, icon, fmtDate, fmtRelative, plural } from '../utils.js';
import { pageHead, card, emptyState, person, banner, lookups } from '../components/ui.js';
import { confirmDialog } from '../components/modal.js';
import { toast, toastError } from '../components/toast.js';

export function render({ store, root, setCrumbs }) {
  setCrumbs([{ label: 'Trash' }]);
  const look = lookups(store);
  const canRestore = store.can('case.edit');
  const canPurge = store.can('case.purge');
  const deleted = store.data.testCases.filter((c) => c.deletedAt).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  const tombstones = store.data.deletedItems.filter((d) => d.entityType === 'testCase').sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));

  root.append(pageHead({ title: 'Trash', subtitle: 'Soft-deleted cases are hidden everywhere else but keep their history. Restore them at any time.' }));

  const restore = async (c) => {
    try { await store.restoreCase(c.id); toast(`${c.caseKey} restored`); } catch (e) { toastError(e); }
  };
  const purge = async (c) => {
    const ok = await confirmDialog({
      title: `Permanently delete ${c.caseKey}?`,
      message: h('div', { class: 'stack', style: { gap: '8px' } },
        h('p', null, `“${c.title}” will be removed from this browser. Its key ${c.caseKey} will never be reused and its activity history is kept.`),
        banner('warn', [h('span', null, 'Admin-only is a UI convenience — it does not enforce security. Copies in exported JSON files, Git history or other browsers still exist until they are re-exported and merged.')])),
      confirmLabel: 'Delete permanently', danger: true, typed: c.caseKey,
    });
    if (!ok) return;
    try { await store.purgeCase(c.id, c.caseKey); toast(`${c.caseKey} permanently deleted`); } catch (e) { toastError(e); }
  };

  if (!deleted.length) {
    root.append(card({ body: emptyState({ iconName: 'trash', title: 'Trash is empty', text: 'Deleted cases appear here and can be restored.' }) }));
  } else {
    root.append(card({
      title: plural(deleted.length, 'case') + ' in trash',
      flush: true,
      body: h('div', { class: 'table-wrap', style: { maxHeight: 'none' } }, h('table', { class: 'table cards' },
        h('thead', null, h('tr', null, ['Key', 'Title', 'Module', 'Deleted', 'By', 'Reason'].map((t) => h('th', { scope: 'col' }, t)), h('th', { class: 'col-actions' }, h('span', { class: 'sr-only' }, 'Actions')))),
        h('tbody', null, deleted.map((c) => h('tr', null,
          h('td', { 'data-label': 'Key' }, h('span', { class: 'key' }, c.caseKey)),
          h('td', { class: 'title-cell' }, h('a', { href: `#/cases/${c.id}` }, c.title)),
          h('td', { 'data-label': 'Module' }, look.moduleName(c.moduleId)),
          h('td', { 'data-label': 'Deleted', class: 'nowrap small', title: fmtDate(c.deletedAt) }, fmtRelative(c.deletedAt)),
          h('td', { 'data-label': 'By' }, person(store.get('members', c.deletedBy), { fallback: 'Unknown' })),
          h('td', { 'data-label': 'Reason', class: 'small' }, c.deletionReason || h('span', { class: 'muted' }, '—')),
          h('td', { class: 'col-actions' }, h('div', { class: 'row', style: { flexWrap: 'nowrap', justifyContent: 'flex-end' } },
            canRestore && h('button', { type: 'button', class: 'btn btn-sm', onClick: () => restore(c) }, icon('restore', 14), 'Restore'),
            canPurge && h('button', { type: 'button', class: 'btn btn-sm btn-ghost', style: { color: 'var(--danger)' }, onClick: () => purge(c) }, 'Delete forever')))))))),
    }));
  }

  if (tombstones.length) {
    root.append(h('div', { style: { marginTop: '16px' } }, card({
      title: 'Permanently deleted (tombstones)',
      actions: h('span', { class: 'muted small' }, 'kept so keys are never reused and imports do not resurrect them'),
      flush: true,
      body: h('div', { class: 'list' }, tombstones.slice(0, 50).map((t) => h('div', { class: 'list-item' },
        h('span', { class: 'key' }, t.caseKey), h('span', { class: 'grow' }, h('span', { class: 'title' }, t.title || '')),
        h('span', { class: 'muted small' }, `${fmtDate(t.deletedAt, false)} · ${look.memberName(t.deletedBy)}`)))),
    })));
  }
}
