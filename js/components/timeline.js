import { h, fmtDate, fmtRelative } from '../utils.js';
import { ACTIONS } from '../activity.js';
import { FIELD_LABELS } from '../schema.js';
import { avatar, emptyState } from './ui.js';

/** Turn a stored value into readable text, resolving ids to names where possible. */
export function describeValue(store, field, value) {
  if (value === null || value === undefined || value === '') return '∅';
  const name = (c, f = 'name') => (id) => store.get(c, id)?.[f] || id;
  if (field === 'moduleId') return name('modules')(value);
  if (field === 'featureId') return name('features')(value);
  if (['assignedTo', 'reviewedBy', 'ownerId', 'createdBy', 'updatedBy', 'deletedBy'].includes(field)) return name('members', 'displayName')(value);
  if (field === 'suites') return value.map(name('testSuites')).join(', ') || '∅';
  if (field === 'accountIds') return value.map(name('accounts')).join(', ') || '∅';
  if (field === 'steps') return `${value.length} step${value.length === 1 ? '' : 's'}`;
  if (/At$/.test(field)) return fmtDate(value);
  if (Array.isArray(value)) return value.join(', ') || '∅';
  if (typeof value === 'object') return JSON.stringify(value);
  const s = String(value);
  return s.length > 160 ? `${s.slice(0, 157)}…` : s;
}

export function timeline(store, events, { showEntity = true, empty = 'No history recorded yet.' } = {}) {
  if (!events.length) return emptyState({ iconName: 'activity', title: 'No activity', text: empty });
  return h('div', { class: 'timeline' }, events.map((e) => {
    const actor = store.get('members', e.actorId);
    const entityLink = showEntity && e.entityType === 'testCase' && store.get('testCases', e.entityId)
      ? h('a', { href: `#/cases/${e.entityId}`, class: 'key' }, e.entityLabel)
      : showEntity && e.entityLabel ? h('span', { class: 'key' }, e.entityLabel) : null;
    return h('article', { class: 'tl-item' },
      actor ? avatar(actor, true) : h('span', { class: 'avatar avatar-sm', style: { background: 'var(--text-3)' } }, '?'),
      h('div', { style: { minWidth: 0 } },
        h('div', { class: 'tl-head' },
          h('strong', null, actor?.displayName || 'Unknown profile'),
          h('span', { class: 'muted' }, (ACTIONS[e.action] || e.action).toLowerCase()),
          showEntity && h('span', { class: 'muted small' }, e.entityType === 'testCase' ? '' : e.entityType),
          entityLink,
          h('time', { class: 'tl-time', datetime: e.timestamp, title: fmtDate(e.timestamp) }, fmtRelative(e.timestamp))),
        e.note && h('div', { class: 'tl-note' }, e.note),
        e.changedFields?.length ? h('div', { class: 'tl-changes' }, e.changedFields.slice(0, 12).map((c) => h('div', { class: 'tl-change' },
          h('span', { class: 'field-name' }, FIELD_LABELS[c.field] || c.field),
          h('span', null,
            h('span', { class: 'diff-before' }, describeValue(store, c.field, c.before)), ' → ',
            h('span', { class: 'diff-after' }, describeValue(store, c.field, c.after))))),
        e.changedFields.length > 12 ? h('div', { class: 'muted small' }, `+${e.changedFields.length - 12} more fields`) : null) : null));
  }));
}
