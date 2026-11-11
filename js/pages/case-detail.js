import { h, icon, fmtDate } from '../utils.js';
import {
  card, priorityChip, statusChip, automationChip, suiteChip, person, emptyState, banner, lookups, menu, plainChip,
} from '../components/ui.js';
import { timeline } from '../components/timeline.js';
import { confirmDialog } from '../components/modal.js';
import { toast, toastError } from '../components/toast.js';

export function render({ store, root, params, setCrumbs, router }) {
  const c = store.get('testCases', params.id);
  const look = lookups(store);
  if (!c) {
    const tomb = store.data.deletedItems.find((d) => d.id === params.id);
    setCrumbs([{ label: 'Test Cases', href: '#/cases' }, { label: 'Not found' }]);
    root.append(card({ body: emptyState({
      iconName: 'search',
      title: tomb ? `${tomb.caseKey} was permanently deleted` : 'Test case not found',
      text: tomb ? `Deleted ${fmtDate(tomb.deletedAt)} by ${look.memberName(tomb.deletedBy)}. Its history remains in the activity log.` : 'It may have been removed, or the link is wrong.',
      action: h('a', { class: 'btn', href: '#/cases' }, 'Back to library'),
    }) }));
    return;
  }
  const mod = store.get('modules', c.moduleId);
  const feat = store.get('features', c.featureId);
  setCrumbs([
    { label: 'Test Cases', href: '#/cases' },
    { label: mod?.name || 'Unknown module', href: `#/cases?module=${c.moduleId}` },
    ...(feat ? [{ label: feat.name, href: `#/cases?module=${c.moduleId}&feature=${feat.id}` }] : []),
    { label: c.caseKey },
  ]);

  const canEdit = store.can('case.edit') && !c.deletedAt;
  const canReview = store.can('case.review');

  const review = async (decision) => {
    try {
      if (decision === 'reject') {
        const ok = await confirmDialog({ title: `Send ${c.caseKey} back to draft?`, message: 'The author will see your note on the case and in its history.', confirmLabel: 'Send back', reason: { label: 'What needs to change?', required: true } });
        if (!ok) return;
        await store.reviewCase(c.id, 'reject', ok.reason);
        toast(`${c.caseKey} sent back to Draft`);
      } else if (decision === 'approve') {
        const ok = await confirmDialog({ title: `Approve ${c.caseKey}?`, message: 'You will be recorded as the reviewer.', confirmLabel: 'Approve', reason: { label: 'Review note (optional)' } });
        if (!ok) return;
        await store.reviewCase(c.id, 'approve', ok.reason);
        toast(`${c.caseKey} approved`);
      } else {
        await store.reviewCase(c.id, 'submit');
        toast(`${c.caseKey} submitted for review`);
      }
    } catch (e) { toastError(e); }
  };

  const del = async () => {
    const ok = await confirmDialog({ title: `Move ${c.caseKey} to trash?`, message: 'It will be hidden from the library. You can restore it from Trash.', confirmLabel: 'Move to trash', danger: true, reason: { label: 'Reason', required: true, placeholder: 'Why is this case being removed?' } });
    if (!ok) return;
    try {
      await store.softDeleteCases([c.id], ok.reason);
      toast(`${c.caseKey} moved to trash`, { action: { label: 'Undo', onClick: () => store.restoreCase(c.id).catch(toastError) } });
    } catch (e) { toastError(e); }
  };

  const actions = h('div', { class: 'page-actions' },
    c.deletedAt && store.can('case.edit') && h('button', { type: 'button', class: 'btn btn-primary', onClick: () => store.restoreCase(c.id).then(() => toast(`${c.caseKey} restored`)).catch(toastError) }, icon('restore', 16), 'Restore'),
    canEdit && c.status === 'Draft' && h('button', { type: 'button', class: 'btn', onClick: () => review('submit') }, icon('check', 16), 'Submit for review'),
    canReview && !c.deletedAt && c.status === 'Ready for Review' && h('button', { type: 'button', class: 'btn', onClick: () => review('reject') }, 'Send back'),
    canReview && !c.deletedAt && c.status === 'Ready for Review' && h('button', { type: 'button', class: 'btn btn-primary', onClick: () => review('approve') }, icon('check', 16), 'Approve'),
    canEdit && h('a', { class: 'btn btn-primary', href: `#/cases/${c.id}/edit` }, icon('edit', 16), 'Edit'),
    store.can('case.edit') && menu(null, [
      { label: 'Duplicate', icon: 'copy', onClick: () => router.go('/cases/new', { from: c.id }) },
      { label: 'Copy link', icon: 'file', onClick: () => navigator.clipboard?.writeText(location.href).then(() => toast('Link copied')).catch(() => toast('Copy failed — use the address bar', { type: 'error' })) },
      !c.deletedAt && 'sep',
      !c.deletedAt && { label: 'Move to trash', icon: 'trash', danger: true, onClick: del },
    ], { label: 'More actions' }),
  );

  root.append(h('div', { class: 'page-head' },
    h('div', { style: { minWidth: 0 } },
      h('div', { class: 'row', style: { marginBottom: '6px' } }, h('span', { class: 'key' }, c.caseKey), statusChip(c.status), priorityChip(c.priority), c.demo && h('span', { class: 'chip chip-demo plain' }, 'Demo data'), h('span', { class: 'muted small' }, `v${c.version}`)),
      h('h1', null, c.title)),
    actions));

  if (c.deletedAt) {
    root.append(h('div', { style: { marginBottom: '16px' } }, banner('danger', [
      h('strong', null, `In trash since ${fmtDate(c.deletedAt)} (by ${look.memberName(c.deletedBy)}).`),
      c.deletionReason && h('span', null, `Reason: ${c.deletionReason}`),
    ], 'trash')));
  }
  if (c.reviewNote && c.status === 'Draft') {
    root.append(h('div', { style: { marginBottom: '16px' } }, banner('warn', [h('strong', null, 'Reviewer feedback'), h('span', { class: 'prose' }, c.reviewNote)])));
  }

  const text = (label, value) => (value ? h('div', null, h('div', { class: 'section-title' }, label), h('p', { class: 'prose' }, value)) : null);
  const steps = c.steps.length
    ? h('div', { class: 'steps-view' }, c.steps.map((s, i) => h('div', { class: 'step-view' },
      h('span', { class: 'step-num' }, String(i + 1)),
      h('div', null, h('div', { class: 'step-col-label' }, 'Action'), h('div', { class: 'prose' }, s.action || '—')),
      h('div', null, h('div', { class: 'step-col-label' }, 'Expected'), h('div', { class: 'prose' }, s.expected || '—')))))
    : h('p', { class: 'muted' }, 'No steps documented.');

  const main = h('div', { class: 'stack' },
    card({ body: h('div', { class: 'stack' }, text('Objective', c.objective), text('Description', c.description), text('Preconditions', c.preconditions)) }),
    card({ title: `Steps (${c.steps.length})`, body: steps }),
    (c.expectedResult || c.testDataNotes) && card({ body: h('div', { class: 'stack' }, text('Overall expected result', c.expectedResult), text('Test data notes (synthetic only)', c.testDataNotes)) }),
    card({ title: 'History', flush: true, body: timeline(store, store.data.activity.filter((e) => e.entityId === c.id).sort((a, b) => b.timestamp.localeCompare(a.timestamp)), { showEntity: false }) }),
  );

  const dl = (rows) => h('dl', { class: 'detail-meta' }, rows.filter(Boolean).flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)]));
  const dash = h('span', { class: 'muted' }, '—');
  const side = h('div', { class: 'stack' },
    card({ title: 'Details', body: dl([
      ['Module', mod ? h('a', { href: `#/cases?module=${mod.id}` }, mod.name) : 'Unknown'],
      ['Feature', feat ? feat.name : dash.cloneNode(true)],
      ['Priority', priorityChip(c.priority)],
      ['Status', statusChip(c.status)],
      ['Test level', c.testLevel || dash.cloneNode(true)],
      ['Suites', c.suites.length ? h('div', { class: 'chips' }, c.suites.map((s) => suiteChip(look.suiteName(s)))) : dash.cloneNode(true)],
      ['Automation', automationChip(c.automationStatus)],
      c.automationPath && ['Script path', h('code', null, c.automationPath)],
      ['Accounts', c.accountIds.length ? h('div', { class: 'chips' }, c.accountIds.map((a) => plainChip(look.accountName(a)))) : dash.cloneNode(true)],
      ['Tags', c.tags.length ? h('div', { class: 'chips' }, c.tags.map((t) => h('a', { class: 'chip chip-outline plain', href: `#/cases?tag=${encodeURIComponent(t)}` }, `#${t}`))) : dash.cloneNode(true)],
      c.risk && ['Risk', c.risk],
      c.requirementRef && ['Requirement', c.requirementRef],
      c.bugRefs.length && ['Bugs', c.bugRefs.join(', ')],
    ]) }),
    card({ title: 'Ownership', body: dl([
      ['Assignee', person(store.get('members', c.assignedTo))],
      ['Created', h('span', null, person(store.get('members', c.createdBy), { fallback: 'Unknown' }), h('div', { class: 'muted small' }, fmtDate(c.createdAt)))],
      ['Updated', h('span', null, person(store.get('members', c.updatedBy), { fallback: 'Unknown' }), h('div', { class: 'muted small' }, fmtDate(c.updatedAt)))],
      ['Reviewed', c.reviewedBy ? h('span', null, person(store.get('members', c.reviewedBy)), h('div', { class: 'muted small' }, fmtDate(c.reviewedAt))) : dash.cloneNode(true)],
      ['Version', String(c.version)],
      ['ID', h('code', { class: 'small', style: { overflowWrap: 'anywhere' } }, c.id)],
    ]) }),
  );
  root.append(h('div', { class: 'split' }, main, side));
}
