import { h, icon, prefs, plural } from '../utils.js';
import { pageHead, card, person, emptyState, menu, plainChip } from '../components/ui.js';
import { formDialog, confirmDialog } from '../components/modal.js';
import { toast, toastError } from '../components/toast.js';

export function moduleDialog(store, existing = null) {
  const owners = [{ value: '', label: 'No owner' }, ...store.data.members.filter((m) => m.active !== false).map((m) => ({ value: m.id, label: m.displayName }))];
  return formDialog({
    title: existing ? `Edit ${existing.name}` : 'New module',
    description: existing ? 'Changing the key prefix affects only new cases; existing keys never change.' : 'Modules group features/operations and their test cases.',
    fields: [
      { name: 'name', label: 'Name', required: true, value: existing?.name, placeholder: 'e.g. Patients' },
      { name: 'keyPrefix', label: 'Case key prefix', required: true, value: existing?.keyPrefix, placeholder: 'e.g. PAT', hint: 'Cases get keys like PAT-001.' },
      { name: 'ownerId', label: 'Owner', type: 'select', options: owners, value: existing?.ownerId || '' },
      { name: 'targetCases', label: 'Target number of cases', type: 'number', min: 0, value: existing?.targetCases ?? '', hint: 'Optional. Used for documented-coverage progress.' },
      { name: 'description', label: 'Description', type: 'textarea', full: true, value: existing?.description },
    ],
    submitLabel: existing ? 'Save module' : 'Create module',
    onSubmit: async (v) => {
      const rec = await store.saveModule({ ...v, id: existing?.id });
      toast(existing ? 'Module saved' : `Module ${rec.name} created`);
      return rec;
    },
  });
}

export function featureDialog(store, moduleId, existing = null) {
  const mod = store.get('modules', moduleId);
  const owners = [{ value: '', label: 'Module owner' }, ...store.data.members.filter((m) => m.active !== false).map((m) => ({ value: m.id, label: m.displayName }))];
  return formDialog({
    title: existing ? `Edit ${existing.name}` : `New feature in ${mod?.name}`,
    description: 'A feature or operation, e.g. "Create Patient" or "Reschedule Appointment".',
    fields: [
      { name: 'name', label: 'Name', required: true, value: existing?.name, full: true },
      { name: 'ownerId', label: 'Owner', type: 'select', options: owners, value: existing?.ownerId || '' },
      { name: 'description', label: 'Description', type: 'textarea', full: true, value: existing?.description },
    ],
    submitLabel: existing ? 'Save feature' : 'Add feature',
    onSubmit: async (v) => {
      const rec = await store.saveFeature({ ...v, id: existing?.id, moduleId });
      toast(existing ? 'Feature saved' : `Feature ${rec.name} added`);
      return rec;
    },
  });
}

export function render({ store, root, setCrumbs, router }) {
  setCrumbs([{ label: 'Modules & Features' }]);
  const canEdit = store.can('structure.edit');
  const showArchived = prefs.get('showArchivedModules', false);
  const active = store.activeCases();
  const live = active.filter((c) => c.status !== 'Deprecated');

  const toggle = h('label', { class: 'check small' }, h('input', {
    type: 'checkbox', checked: showArchived, onChange: (e) => { prefs.set('showArchivedModules', e.target.checked); router.refresh(); },
  }), 'Show archived');

  root.append(pageHead({
    title: 'Modules & Features',
    subtitle: 'Organise cases by module → feature/operation. Archive instead of deleting so history and keys stay intact.',
    actions: [toggle, canEdit && h('button', { type: 'button', class: 'btn btn-primary', onClick: () => moduleDialog(store) }, icon('plus', 16), 'New module')],
  }));

  const mods = store.data.modules.filter((m) => showArchived || !m.archived).sort((a, b) => (a.archived - b.archived) || (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
  if (!mods.length) {
    root.append(card({ body: emptyState({ iconName: 'modules', title: 'No modules yet', text: 'Add the modules of the application under test, e.g. Patients or Billing.', action: canEdit && h('button', { type: 'button', class: 'btn btn-primary', onClick: () => moduleDialog(store) }, 'New module') }) }));
    return;
  }

  const archive = async (collection, item, archived) => {
    const n = active.filter((c) => (collection === 'modules' ? c.moduleId : c.featureId) === item.id).length;
    if (archived) {
      const ok = await confirmDialog({
        title: `Archive ${item.name}?`,
        message: `It will be hidden from pickers and the dashboard. ${n ? `Its ${plural(n, 'case')} stay in the library and keep their keys.` : ''} You can unarchive at any time.`,
        confirmLabel: 'Archive',
      });
      if (!ok) return;
    }
    try {
      await store.setArchived(collection, item.id, archived);
      toast(`${item.name} ${archived ? 'archived' : 'restored'}`);
    } catch (e) { toastError(e); }
  };

  root.append(h('div', { class: 'grid grid-3' }, mods.map((m) => {
    const mCases = live.filter((c) => c.moduleId === m.id);
    const feats = store.data.features.filter((f) => f.moduleId === m.id && (showArchived || !f.archived)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const target = m.targetCases;
    const pct = target ? Math.min(100, Math.round((mCases.length / target) * 100)) : null;
    const approved = mCases.filter((c) => c.status === 'Approved').length;
    return h('section', { class: ['card module-card', m.archived && 'archived'], 'aria-labelledby': `mod-${m.id}` },
      h('div', { class: 'card-head' },
        h('div', { style: { minWidth: 0 } },
          h('div', { class: 'row' }, h('h2', { id: `mod-${m.id}` }, h('a', { href: `#/cases?module=${m.id}`, style: { color: 'inherit' } }, m.name)), plainChip(m.keyPrefix, 'mono'), m.archived && plainChip('Archived'))),
        canEdit && menu(null, [
          { label: 'Edit module', icon: 'edit', onClick: () => moduleDialog(store, m) },
          { label: 'Add feature', icon: 'plus', onClick: () => featureDialog(store, m.id) },
          { label: 'New case in module', icon: 'cases', onClick: () => router.go('/cases/new', { module: m.id }) },
          { label: 'Export module JSON', icon: 'data', onClick: () => router.go('/data', { module: m.id }) },
          'sep',
          m.archived ? { label: 'Unarchive', icon: 'restore', onClick: () => archive('modules', m, false) } : { label: 'Archive module', icon: 'archive', onClick: () => archive('modules', m, true) },
        ], { label: `Actions for ${m.name}` })),
      h('div', { class: 'card-body' },
        m.description ? h('p', { class: 'muted small' }, m.description) : null,
        h('div', { class: 'row small' },
          h('span', null, h('strong', null, String(mCases.length)), ' cases'),
          h('span', { class: 'muted' }, '·'),
          h('span', null, `${approved} approved`),
          h('span', { class: 'spacer' }),
          person(store.get('members', m.ownerId), { fallback: 'No owner' })),
        target
          ? h('div', null, h('div', { class: 'row small muted', style: { justifyContent: 'space-between', marginBottom: '4px' } }, h('span', null, 'Documented vs. target'), h('span', null, `${mCases.length} / ${target} (${pct}%)`)),
            h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': `${m.name} documented cases versus target` }, h('span', { style: { width: `${pct}%` } })))
          : h('p', { class: 'muted small' }, canEdit ? h('button', { type: 'button', class: 'btn-link small', onClick: () => moduleDialog(store, m) }, 'Set a target') : 'No target set', ' to track documented coverage.'),
        feats.length
          ? h('div', { class: 'feature-list' }, feats.map((f) => {
            const n = mCases.filter((c) => c.featureId === f.id).length;
            return h('div', { class: ['feature-row', f.archived && 'archived'] },
              h('a', { href: `#/cases?module=${m.id}&feature=${f.id}` }, f.name),
              h('span', { class: 'muted small' }, String(n)),
              canEdit && menu(null, [
                { label: 'Edit feature', icon: 'edit', onClick: () => featureDialog(store, m.id, f) },
                { label: 'New case here', icon: 'plus', onClick: () => router.go('/cases/new', { module: m.id, feature: f.id }) },
                f.archived ? { label: 'Unarchive', icon: 'restore', onClick: () => archive('features', f, false) } : { label: 'Archive', icon: 'archive', onClick: () => archive('features', f, true) },
              ], { label: `Actions for ${f.name}` }));
          }))
          : h('p', { class: 'muted small' }, 'No features/operations yet.'),
        canEdit && h('div', { class: 'row', style: { marginTop: 'auto' } },
          h('button', { type: 'button', class: 'btn btn-sm', onClick: () => featureDialog(store, m.id) }, icon('plus', 14), 'Feature'),
          h('a', { class: 'btn btn-sm btn-ghost', href: `#/cases?module=${m.id}` }, 'View cases'))));
  })));
}
