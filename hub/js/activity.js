// Activity log helpers. This is a local, editable activity log — NOT a tamper-proof audit trail.

import { uuid, nowIso, isEqual, clone } from './utils.js';

export const ACTIONS = {
  create: 'Created',
  update: 'Updated',
  duplicate: 'Duplicated',
  delete: 'Moved to trash',
  restore: 'Restored',
  purge: 'Permanently deleted',
  review_submit: 'Submitted for review',
  approve: 'Approved',
  reject: 'Sent back to draft',
  bulk_update: 'Bulk updated',
  archive: 'Archived',
  unarchive: 'Unarchived',
  import: 'Imported',
  export: 'Exported',
  profile_switch: 'Switched profile',
  settings: 'Changed settings',
  clear_demo: 'Cleared demo data',
};

const IGNORED_DIFF_FIELDS = new Set(['version', 'updatedAt', 'updatedBy']);

/** Field-level before/after list for two versions of a record. */
export function diffFields(before, after) {
  const changes = [];
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const field of keys) {
    if (IGNORED_DIFF_FIELDS.has(field)) continue;
    const a = before?.[field];
    const b = after?.[field];
    const empty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    if (empty(a) && empty(b)) continue;
    if (!isEqual(a, b)) changes.push({ field, before: clone(a) ?? null, after: clone(b) ?? null });
  }
  return changes;
}

export function makeEvent({ entityType, entityId, entityLabel = '', moduleId = null, action, actorId, changedFields = [], note = '' }) {
  return {
    eventId: uuid(),
    entityType,
    entityId,
    entityLabel,
    moduleId,
    action,
    actorId: actorId || null,
    timestamp: nowIso(),
    changedFields,
    note,
  };
}
