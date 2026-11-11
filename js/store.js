// Application state + all mutations. Each mutation persists atomically first, then updates
// memory, then notifies subscribers. DOM-free so it can be exercised from Node tests.

import {
  COLLECTIONS, ID_FIELD, SCHEMA_VERSION, CASE_CONTENT_FIELDS, ENTITY_TYPE, normalizeCase, idOf,
} from './schema.js';
import { uuid, nowIso, clone, isEqual } from './utils.js';
import { makeEvent, diffFields } from './activity.js';
import { validateCase, validateModule, validateFeature, validateMember, validateNamedLabel } from './validation.js';
import { buildSeedDocument } from './seed.js';
import { buildExport, computeKeyCounters } from './import-export.js';

export class ValidationError extends Error {
  constructor(errors, message = 'Please fix the highlighted fields.') {
    super(message);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}
export class ConflictError extends Error {
  constructor(message) { super(message); this.name = 'ConflictError'; }
}
export class PermissionError extends Error {
  constructor(message) { super(message); this.name = 'PermissionError'; }
}
export class StorageError extends Error {
  constructor(cause) {
    const quota = cause?.name === 'QuotaExceededError' || /quota/i.test(cause?.message || '');
    super(quota
      ? 'Browser storage is full. Export your data as JSON now, then free space (e.g. clear old activity or other site data).'
      : `Could not save to browser storage: ${cause?.message || cause}. Export your data as JSON to avoid losing work.`);
    this.name = 'StorageError';
    this.quota = quota;
    this.cause = cause;
  }
}

/** Role-based UI conveniences. NOT security: anyone can edit local data or JSON directly. */
export const PERMISSIONS = {
  'case.edit': ['Admin', 'Maintainer', 'Contributor'],
  'case.review': ['Admin', 'Maintainer'],
  'case.purge': ['Admin'],
  'case.bulk': ['Admin', 'Maintainer', 'Contributor'],
  'case.assign': ['Admin'], // only an Admin assigns work
  'structure.edit': ['Admin', 'Maintainer'],
  'team.edit': ['Admin'],
  'data.import': ['Admin', 'Maintainer'],
  'settings.edit': ['Admin', 'Maintainer'],
  'data.reset': ['Admin'],
};

const DEFAULT_META = () => ({
  schemaVersion: SCHEMA_VERSION,
  project: { id: 'qa-hub', name: 'Healthcare QA Hub' },
  keyCounters: {},
  lastExportAt: null,
  lastChangeAt: null,
  settings: { backupReminderHours: 24 },
  seededAt: null,
});

export function createStore(persistence) {
  const data = Object.fromEntries(COLLECTIONS.map((c) => [c, []]));
  const index = Object.fromEntries(COLLECTIONS.map((c) => [c, new Map()]));
  let meta = DEFAULT_META();
  let actorId = null;
  const listeners = new Set();

  function rebuild(c) {
    index[c] = new Map(data[c].map((r) => [idOf(c, r), r]));
  }

  function emit(change) {
    for (const fn of listeners) {
      try { fn(change); } catch (e) { console.error(e); }
    }
  }

  async function load() {
    const loaded = await persistence.load();
    meta = { ...DEFAULT_META(), ...loaded.meta, settings: { ...DEFAULT_META().settings, ...(loaded.meta.settings || {}) } };
    for (const c of COLLECTIONS) {
      data[c] = (loaded.collections[c] || []).map((r) => (c === 'testCases' ? normalizeCase(r) : r));
      rebuild(c);
    }
  }

  let lastSeedSource = null;
  /**
   * @param {object} [opts]
   * @param {boolean} [opts.seed]         seed an empty store on first launch
   * @param {() => Promise<object>} [opts.seedSource]  loads the library document (data/library.json);
   *        falls back to the small built-in seed when absent or failing.
   */
  async function init({ seed = true, seedSource = null } = {}) {
    if (seedSource) lastSeedSource = seedSource;
    seedSource = seedSource || lastSeedSource;
    await load();
    if (seed && !meta.seededAt && !data.members.length && !data.testCases.length) {
      let doc = null;
      if (seedSource) {
        try {
          const loaded = await seedSource();
          if (loaded && Array.isArray(loaded.testCases) && Array.isArray(loaded.members)) {
            doc = { ...loaded };
            for (const c of COLLECTIONS) doc[c] = (loaded[c] || []).map((r) => (c === 'testCases' ? normalizeCase(r) : r));
          }
        } catch (e) {
          console.warn('Library seed unavailable, using built-in starter data.', e);
        }
      }
      doc = doc || buildSeedDocument();
      const put = {};
      for (const c of COLLECTIONS) if (doc[c].length) put[c] = doc[c];
      const seededMeta = {
        seededAt: nowIso(),
        project: doc.project,
        schemaVersion: SCHEMA_VERSION,
        keyCounters: computeKeyCounters(doc.testCases, []),
        libraryRevision: doc.libraryRevision || null,
      };
      await persistence.commit({ put, meta: seededMeta });
      await load();
    }
    emit({ type: 'init' });
  }

  /** Re-read from storage (another tab changed data). */
  async function reload() {
    await load();
    emit({ type: 'reload' });
  }

  // ---- generic commit -------------------------------------------------------------------
  async function commit({ put = {}, del = {}, events = [], metaPatch = {}, touch = true }, change = {}) {
    const stamp = nowIso();
    const metaUpdate = touch ? { ...metaPatch, lastChangeAt: stamp } : { ...metaPatch };
    const putAll = { ...put };
    if (events.length) putAll.activity = [...(putAll.activity || []), ...events];
    try {
      await persistence.commit({ put: putAll, del, meta: metaUpdate });
    } catch (e) {
      throw new StorageError(e);
    }
    for (const [c, ids] of Object.entries(del)) {
      const drop = new Set(ids);
      data[c] = data[c].filter((r) => !drop.has(idOf(c, r)));
      rebuild(c);
    }
    for (const [c, records] of Object.entries(putAll)) {
      for (const r of records) {
        const id = idOf(c, r);
        if (index[c].has(id)) {
          const i = data[c].indexOf(index[c].get(id));
          data[c][i] = r;
        } else data[c].push(r);
        index[c].set(id, r);
      }
    }
    meta = { ...meta, ...metaUpdate };
    emit({ type: 'change', ...change });
  }

  // ---- identity & permissions ---------------------------------------------------------
  const actor = () => (actorId ? index.members.get(actorId) : null);

  function can(permission, member = actor()) {
    if (!member || member.active === false) return false;
    return (PERMISSIONS[permission] || []).includes(member.role);
  }

  function requireActor(permission) {
    const m = actor();
    if (!m) throw new PermissionError('Select your team profile first.');
    if (permission && !can(permission, m)) {
      throw new PermissionError(`Your role (${m.role}) cannot do this. Roles are a convenience, not security — switch profile if appropriate.`);
    }
    return m;
  }

  function setActor(id) {
    actorId = id && index.members.has(id) ? id : null;
    emit({ type: 'actor' });
    return actor();
  }

  // ---- lookups --------------------------------------------------------------------------
  const get = (c, id) => index[c].get(id) || null;
  const activeCases = () => data.testCases.filter((tc) => !tc.deletedAt);
  const reservedKeys = () => new Set(data.deletedItems.filter((d) => d.caseKey).map((d) => d.caseKey));
  const caseCtx = () => ({
    testCases: data.testCases, modules: data.modules, features: data.features, members: data.members,
    testSuites: data.testSuites, accounts: data.accounts, reservedKeys: reservedKeys(),
  });

  function nextCaseKey(moduleId) {
    const mod = get('modules', moduleId);
    if (!mod) throw new ValidationError({ moduleId: 'Choose a module.' });
    const counters = computeKeyCounters(data.testCases, data.deletedItems, meta.keyCounters);
    const n = (counters[mod.keyPrefix] || 0) + 1;
    return `${mod.keyPrefix}-${String(n).padStart(3, '0')}`;
  }

  function counterPatchFor(key) {
    const m = /^([A-Z][A-Z0-9]*)-(\d+)$/.exec(key);
    if (!m) return {};
    const counters = { ...meta.keyCounters };
    counters[m[1]] = Math.max(counters[m[1]] || 0, Number(m[2]));
    return { keyCounters: counters };
  }

  function cleanCaseInput(input) {
    const out = {};
    for (const f of CASE_CONTENT_FIELDS) if (input[f] !== undefined) out[f] = clone(input[f]);
    for (const f of ['title', 'objective', 'description', 'preconditions', 'expectedResult', 'automationPath', 'requirementRef', 'testDataNotes']) {
      if (typeof out[f] === 'string') out[f] = out[f].trim();
    }
    if (Array.isArray(out.steps)) {
      out.steps = out.steps
        .map((s) => ({ action: String(s.action || '').trim(), expected: String(s.expected || '').trim() }))
        .filter((s) => s.action || s.expected);
    }
    for (const f of ['tags', 'bugRefs']) {
      if (Array.isArray(out[f])) out[f] = [...new Set(out[f].map((t) => String(t).trim()).filter(Boolean))];
    }
    if (out.featureId === null) out.featureId = '';
    return out;
  }

  // ---- test cases -----------------------------------------------------------------------
  async function createCase(input, { duplicatedFrom = null } = {}) {
    const me = requireActor('case.edit');
    const now = nowIso();
    const content = cleanCaseInput(input);
    if (!can('case.assign', me)) content.assignedTo = ''; // only an Admin assigns work
    const draft = normalizeCase({ ...content, id: uuid(), caseKey: String(input.caseKey || '').trim().toUpperCase() });
    if (draft.status === 'Approved' && !can('case.review', me)) {
      throw new ValidationError({ status: 'Only Maintainers/Admins can mark a case Approved. Use "Ready for Review".' });
    }
    const errors = validateCase(draft, caseCtx());
    if (Object.keys(errors).length) throw new ValidationError(errors);
    if (!draft.caseKey) draft.caseKey = nextCaseKey(draft.moduleId);
    const record = {
      ...draft,
      version: 1,
      createdBy: me.id, createdAt: now, updatedBy: me.id, updatedAt: now,
      reviewedBy: draft.status === 'Approved' ? me.id : null,
      reviewedAt: draft.status === 'Approved' ? now : null,
      deletedAt: null, deletedBy: null, deletionReason: '',
    };
    delete record.demo;
    const src = duplicatedFrom ? get('testCases', duplicatedFrom) : null;
    const event = makeEvent({
      entityType: 'testCase', entityId: record.id, entityLabel: record.caseKey, moduleId: record.moduleId,
      action: src ? 'duplicate' : 'create', actorId: me.id,
      note: src ? `Duplicated from ${src.caseKey}` : '',
    });
    await commit({ put: { testCases: [record] }, events: [event], metaPatch: counterPatchFor(record.caseKey) }, { entity: 'testCase', id: record.id });
    return record;
  }

  async function updateCase(id, input, { expectedVersion } = {}) {
    const me = requireActor('case.edit');
    const current = get('testCases', id);
    if (!current) throw new ConflictError('This case no longer exists (it may have been permanently deleted).');
    if (current.deletedAt) throw new ConflictError('This case is in the trash. Restore it before editing.');
    if (expectedVersion !== undefined && expectedVersion !== current.version) {
      throw new ConflictError(`This case was changed elsewhere (now version ${current.version}, you started from ${expectedVersion}). Reload it and re-apply your edits.`);
    }
    const content = cleanCaseInput(input);
    if (!can('case.assign', me)) content.assignedTo = current.assignedTo; // only an Admin re-assigns
    const nextKey = input.caseKey !== undefined ? String(input.caseKey).trim().toUpperCase() || current.caseKey : current.caseKey;
    const next = normalizeCase({ ...current, ...content, caseKey: nextKey });
    if (next.status === 'Approved' && current.status !== 'Approved' && !can('case.review', me)) {
      throw new ValidationError({ status: 'Only Maintainers/Admins can approve. Use "Ready for Review".' });
    }
    const errors = validateCase(next, caseCtx());
    if (Object.keys(errors).length) throw new ValidationError(errors);
    const changes = diffFields(current, next);
    if (!changes.length) return current;
    const now = nowIso();
    const record = { ...next, version: current.version + 1, updatedBy: me.id, updatedAt: now };
    if (record.status === 'Approved' && current.status !== 'Approved') {
      record.reviewedBy = me.id;
      record.reviewedAt = now;
    }
    const event = makeEvent({
      entityType: 'testCase', entityId: id, entityLabel: record.caseKey, moduleId: record.moduleId,
      action: 'update', actorId: me.id, changedFields: changes,
    });
    await commit({ put: { testCases: [record] }, events: [event], metaPatch: counterPatchFor(record.caseKey) }, { entity: 'testCase', id });
    return record;
  }

  async function softDeleteCases(ids, reason = '') {
    const me = requireActor(ids.length > 1 ? 'case.bulk' : 'case.edit');
    const now = nowIso();
    const records = [];
    const events = [];
    for (const id of ids) {
      const cur = get('testCases', id);
      if (!cur || cur.deletedAt) continue;
      const rec = { ...cur, deletedAt: now, deletedBy: me.id, deletionReason: reason.trim(), version: cur.version + 1, updatedAt: now, updatedBy: me.id };
      records.push(rec);
      events.push(makeEvent({
        entityType: 'testCase', entityId: id, entityLabel: cur.caseKey, moduleId: cur.moduleId, action: 'delete', actorId: me.id,
        note: reason.trim(), changedFields: [{ field: 'deletedAt', before: null, after: now }],
      }));
    }
    if (records.length) await commit({ put: { testCases: records }, events }, { entity: 'testCase', ids });
    return records.length;
  }

  async function restoreCase(id) {
    const me = requireActor('case.edit');
    const cur = get('testCases', id);
    if (!cur?.deletedAt) return cur;
    const errors = {};
    if (!get('modules', cur.moduleId)) errors.moduleId = 'Original module no longer exists.';
    if (Object.keys(errors).length) throw new ValidationError(errors, 'Cannot restore: original module is missing.');
    const now = nowIso();
    const rec = { ...cur, deletedAt: null, deletedBy: null, deletionReason: '', version: cur.version + 1, updatedAt: now, updatedBy: me.id };
    const event = makeEvent({
      entityType: 'testCase', entityId: id, entityLabel: cur.caseKey, moduleId: cur.moduleId, action: 'restore', actorId: me.id,
      changedFields: [{ field: 'deletedAt', before: cur.deletedAt, after: null }],
    });
    await commit({ put: { testCases: [rec] }, events: [event] }, { entity: 'testCase', id });
    return rec;
  }

  /** Admin-only UI affordance. Leaves a tombstone so the ID/key are never reused or re-imported. */
  async function purgeCase(id, typedConfirmation) {
    const me = requireActor('case.purge');
    const cur = get('testCases', id);
    if (!cur) return false;
    if (!cur.deletedAt) throw new ConflictError('Move the case to the trash before deleting it permanently.');
    if (typedConfirmation !== cur.caseKey) throw new ValidationError({ confirm: `Type ${cur.caseKey} to confirm.` });
    const now = nowIso();
    const tombstone = { id: cur.id, entityType: 'testCase', caseKey: cur.caseKey, moduleId: cur.moduleId, title: cur.title, deletedAt: now, deletedBy: me.id };
    const event = makeEvent({ entityType: 'testCase', entityId: id, entityLabel: cur.caseKey, moduleId: cur.moduleId, action: 'purge', actorId: me.id, note: cur.title });
    await commit({ put: { deletedItems: [tombstone] }, del: { testCases: [id] }, events: [event], metaPatch: counterPatchFor(cur.caseKey) }, { entity: 'testCase', id });
    return true;
  }

  async function reviewCase(id, decision, note = '') {
    const cur = get('testCases', id);
    if (!cur) throw new ConflictError('Case not found.');
    const me = requireActor(decision === 'submit' ? 'case.edit' : 'case.review');
    const now = nowIso();
    const rec = { ...cur, version: cur.version + 1, updatedAt: now, updatedBy: me.id };
    let action;
    if (decision === 'submit') {
      if (cur.status !== 'Draft') throw new ConflictError('Only Draft cases can be submitted for review.');
      rec.status = 'Ready for Review';
      action = 'review_submit';
    } else if (decision === 'approve') {
      if (cur.status !== 'Ready for Review') throw new ConflictError('Only cases that are Ready for Review can be approved.');
      Object.assign(rec, { status: 'Approved', reviewedBy: me.id, reviewedAt: now, reviewNote: note.trim() });
      action = 'approve';
    } else if (decision === 'reject') {
      if (cur.status !== 'Ready for Review') throw new ConflictError('Only cases that are Ready for Review can be sent back.');
      if (!note.trim()) throw new ValidationError({ note: 'Explain what needs to change.' });
      Object.assign(rec, { status: 'Draft', reviewNote: note.trim() });
      action = 'reject';
    } else throw new Error(`Unknown review decision ${decision}`);
    const event = makeEvent({
      entityType: 'testCase', entityId: id, entityLabel: cur.caseKey, moduleId: cur.moduleId, action, actorId: me.id,
      changedFields: diffFields(cur, rec), note: note.trim(),
    });
    await commit({ put: { testCases: [rec] }, events: [event] }, { entity: 'testCase', id });
    return rec;
  }

  /**
   * Bulk update. patch keys: status, priority, testLevel, automationStatus, assignedTo,
   * addSuites[], removeSuites[], addTags[], removeTags[].
   */
  async function bulkUpdateCases(ids, patch) {
    const me = requireActor('case.bulk');
    if (patch.status === 'Approved' && !can('case.review', me)) throw new PermissionError('Only Maintainers/Admins can approve cases.');
    if (patch.assignedTo !== undefined && !can('case.assign', me)) throw new PermissionError('Only an Admin can assign cases.');
    const now = nowIso();
    const records = [];
    const events = [];
    for (const id of ids) {
      const cur = get('testCases', id);
      if (!cur || cur.deletedAt) continue;
      const next = { ...cur };
      for (const f of ['status', 'completionStatus', 'priority', 'testLevel', 'automationStatus', 'assignedTo']) if (patch[f] !== undefined) next[f] = patch[f];
      if (patch.addSuites || patch.removeSuites) {
        const s = new Set(next.suites);
        (patch.addSuites || []).forEach((x) => s.add(x));
        (patch.removeSuites || []).forEach((x) => s.delete(x));
        next.suites = [...s];
      }
      if (patch.addTags || patch.removeTags) {
        const t = new Set(next.tags);
        (patch.addTags || []).forEach((x) => t.add(x));
        (patch.removeTags || []).forEach((x) => t.delete(x));
        next.tags = [...t];
      }
      if (next.status === 'Approved' && cur.status !== 'Approved') { next.reviewedBy = me.id; next.reviewedAt = now; }
      const changes = diffFields(cur, next);
      if (!changes.length) continue;
      const errors = validateCase(next, caseCtx());
      if (errors.completionStatus || errors.assignedTo || errors.suites || errors.status || errors.priority) throw new ValidationError(errors, `Bulk change invalid for ${cur.caseKey}.`);
      records.push({ ...next, version: cur.version + 1, updatedAt: now, updatedBy: me.id });
      events.push(makeEvent({
        entityType: 'testCase', entityId: id, entityLabel: cur.caseKey, moduleId: cur.moduleId, action: 'bulk_update', actorId: me.id, changedFields: changes,
      }));
    }
    if (records.length) await commit({ put: { testCases: records }, events }, { entity: 'testCase', ids });
    return records.length;
  }

  // ---- modules & features ---------------------------------------------------------------
  async function saveModule(input) {
    const me = requireActor('structure.edit');
    const cur = input.id ? get('modules', input.id) : null;
    const draft = {
      ...(cur || {}),
      id: cur?.id || uuid(),
      name: String(input.name || '').trim(),
      keyPrefix: String(input.keyPrefix || '').trim().toUpperCase(),
      description: String(input.description || '').trim(),
      ownerId: input.ownerId || '',
      targetCases: input.targetCases === '' || input.targetCases === null || input.targetCases === undefined ? null : Number(input.targetCases),
      archived: cur?.archived || false,
      order: cur?.order ?? data.modules.length,
    };
    // Existing case keys keep their old prefix if the prefix changes; only new cases use the new one.
    const errors = validateModule(draft, data.modules);
    if (Object.keys(errors).length) throw new ValidationError(errors);
    return saveVersioned('modules', cur, draft, me);
  }

  async function saveFeature(input) {
    const me = requireActor('structure.edit');
    const cur = input.id ? get('features', input.id) : null;
    const draft = {
      ...(cur || {}),
      id: cur?.id || uuid(),
      moduleId: cur?.moduleId || input.moduleId,
      name: String(input.name || '').trim(),
      description: String(input.description || '').trim(),
      ownerId: input.ownerId || '',
      archived: cur?.archived || false,
      order: cur?.order ?? data.features.filter((f) => f.moduleId === input.moduleId).length,
    };
    if (!get('modules', draft.moduleId)) throw new ValidationError({ moduleId: 'Module not found.' });
    const errors = validateFeature(draft, data.features);
    if (Object.keys(errors).length) throw new ValidationError(errors);
    return saveVersioned('features', cur, draft, me);
  }

  async function setArchived(collection, id, archived) {
    const me = requireActor('structure.edit');
    const cur = get(collection, id);
    if (!cur) throw new ConflictError('Item not found.');
    if (Boolean(cur.archived) === archived) return cur;
    return saveVersioned(collection, cur, { ...cur, archived }, me, archived ? 'archive' : 'unarchive');
  }

  async function saveVersioned(collection, cur, draft, me, actionOverride = null) {
    const now = nowIso();
    if (cur) {
      const changes = diffFields(cur, draft);
      if (!changes.length) return cur;
      const rec = { ...draft, version: (cur.version || 0) + 1, updatedAt: now, updatedBy: me.id };
      const event = makeEvent({
        entityType: ENTITY_TYPE[collection], entityId: rec.id, entityLabel: rec.name || rec.displayName,
        moduleId: collection === 'modules' ? rec.id : rec.moduleId || null,
        action: actionOverride || 'update', actorId: me.id, changedFields: changes,
      });
      await commit({ put: { [collection]: [rec] }, events: [event] }, { entity: ENTITY_TYPE[collection], id: rec.id });
      return rec;
    }
    const rec = { ...draft, version: 1, createdAt: now, createdBy: me.id, updatedAt: now, updatedBy: me.id };
    const event = makeEvent({
      entityType: ENTITY_TYPE[collection], entityId: rec.id, entityLabel: rec.name || rec.displayName,
      moduleId: collection === 'modules' ? rec.id : rec.moduleId || null, action: 'create', actorId: me.id,
    });
    await commit({ put: { [collection]: [rec] }, events: [event] }, { entity: ENTITY_TYPE[collection], id: rec.id });
    return rec;
  }

  // ---- members --------------------------------------------------------------------------
  /** Creating your own profile is always allowed (first launch); editing others requires Admin. */
  async function saveMember(input, { selfService = false } = {}) {
    const cur = input.id ? get('members', input.id) : null;
    let me = actor();
    if (!selfService || cur) me = requireActor('team.edit');
    const draft = {
      ...(cur || {}),
      id: cur?.id || uuid(),
      memberId: String(input.memberId || '').trim().toLowerCase(),
      displayName: String(input.displayName || '').trim(),
      role: input.role || 'Contributor',
      active: input.active !== undefined ? Boolean(input.active) : (cur?.active ?? true),
    };
    if (selfService && !cur && !['Contributor', 'Viewer'].includes(draft.role) && !can('team.edit', me)) draft.role = 'Contributor';
    const errors = validateMember(draft, data.members);
    if (cur && cur.role === 'Admin' && draft.role !== 'Admin' && data.members.filter((m) => m.role === 'Admin' && m.active !== false).length <= 1) {
      errors.role = 'Keep at least one active Admin.';
    }
    if (Object.keys(errors).length) throw new ValidationError(errors);
    if (draft.placeholder && cur && (cur.displayName !== draft.displayName || cur.memberId !== draft.memberId)) delete draft.placeholder;
    const author = me || { id: draft.id };
    return saveVersioned('members', cur, draft, author);
  }

  async function logProfileSwitch(fromId, toId) {
    const to = get('members', toId);
    if (!to) return;
    const from = fromId ? get('members', fromId) : null;
    const event = makeEvent({
      entityType: 'member', entityId: toId, entityLabel: to.displayName, action: 'profile_switch', actorId: toId,
      note: from ? `From ${from.displayName} to ${to.displayName}` : `Selected ${to.displayName}`,
    });
    // A profile switch is logged but does not count as an unexported data change.
    await commit({ events: [event], touch: false }, { entity: 'activity' });
  }

  // ---- suites & accounts (configurable labels) ----------------------------------------
  const LABEL_FIELD = { testSuites: 'suites', accounts: 'accountIds' };

  async function saveLabel(collection, input) {
    const me = requireActor('structure.edit');
    const cur = input.id ? get(collection, input.id) : null;
    const draft = { ...(cur || {}), id: cur?.id || uuid(), name: String(input.name || '').trim(), description: String(input.description || '').trim() };
    const errors = validateNamedLabel(draft, data[collection], collection === 'testSuites' ? 'Suite' : 'Account');
    if (Object.keys(errors).length) throw new ValidationError(errors);
    return saveVersioned(collection, cur, draft, me);
  }

  const labelUsage = (collection, id) => activeCasesAndTrash().filter((tc) => (tc[LABEL_FIELD[collection]] || []).includes(id));
  const activeCasesAndTrash = () => data.testCases;

  /** Delete a suite/account label. If in use, caller must opt in to removing it from those cases. */
  async function deleteLabel(collection, id, { removeFromCases = false } = {}) {
    const me = requireActor('structure.edit');
    const cur = get(collection, id);
    if (!cur) return 0;
    const users = labelUsage(collection, id);
    if (users.length && !removeFromCases) throw new ConflictError(`"${cur.name}" is used by ${users.length} case(s). Confirm removing it from them first.`);
    const now = nowIso();
    const field = LABEL_FIELD[collection];
    const records = users.map((tc) => ({ ...tc, [field]: tc[field].filter((x) => x !== id), version: tc.version + 1, updatedAt: now, updatedBy: me.id }));
    const events = users.map((tc, i) => makeEvent({
      entityType: 'testCase', entityId: tc.id, entityLabel: tc.caseKey, moduleId: tc.moduleId, action: 'update', actorId: me.id,
      changedFields: diffFields(tc, records[i]), note: `Removed deleted ${collection === 'testSuites' ? 'suite' : 'account'} "${cur.name}"`,
    }));
    events.push(makeEvent({ entityType: ENTITY_TYPE[collection], entityId: id, entityLabel: cur.name, action: 'purge', actorId: me.id }));
    const tombstone = { id, entityType: ENTITY_TYPE[collection], name: cur.name, deletedAt: now, deletedBy: me.id };
    await commit({ put: { testCases: records, deletedItems: [tombstone] }, del: { [collection]: [id] }, events }, { entity: ENTITY_TYPE[collection], id });
    return users.length;
  }

  // ---- settings, export, demo data ------------------------------------------------------
  async function updateProject(patch) {
    const me = requireActor('settings.edit');
    const project = { ...meta.project, ...patch, name: String(patch.name ?? meta.project.name).trim() || meta.project.name };
    const settings = { ...meta.settings, ...(patch.settings || {}) };
    delete project.settings;
    const event = makeEvent({
      entityType: 'project', entityId: project.id, entityLabel: project.name, action: 'settings', actorId: me.id,
      changedFields: diffFields({ ...meta.project, ...meta.settings }, { ...project, ...settings }),
    });
    await commit({ events: event.changedFields.length ? [event] : [], metaPatch: { project, settings } }, { entity: 'project' });
  }

  function exportDocument(options = {}) {
    return buildExport(data, meta, options);
  }

  async function markExported(full = true) {
    if (!full) return;
    const stamp = nowIso();
    try {
      await persistence.commit({ meta: { lastExportAt: stamp } });
    } catch (e) { throw new StorageError(e); }
    meta = { ...meta, lastExportAt: stamp };
    emit({ type: 'export' });
  }

  function hasUnexportedChanges() {
    if (!meta.lastChangeAt) return false;
    return !meta.lastExportAt || meta.lastChangeAt > meta.lastExportAt;
  }

  /** Remove demo cases (and optionally unused sample modules); keeps profiles & settings. */
  async function clearDemoData({ includeSampleStructure = false } = {}) {
    const me = requireActor('data.reset');
    const demoCases = data.testCases.filter((tc) => tc.demo);
    const del = { testCases: demoCases.map((tc) => tc.id) };
    const remaining = data.testCases.filter((tc) => !tc.demo);
    if (includeSampleStructure) {
      const usedModules = new Set(remaining.map((tc) => tc.moduleId));
      const usedFeatures = new Set(remaining.map((tc) => tc.featureId));
      del.modules = data.modules.filter((m) => m.sample && m.version === 1 && !usedModules.has(m.id)).map((m) => m.id);
      const dropMods = new Set(del.modules);
      del.features = data.features.filter((f) => f.sample && !usedFeatures.has(f.id) && (dropMods.has(f.moduleId) || f.version === 1)).map((f) => f.id);
    }
    const demoIds = new Set(del.testCases);
    del.activity = data.activity.filter((e) => demoIds.has(e.entityId)).map((e) => e.eventId);
    const event = makeEvent({
      entityType: 'project', entityId: meta.project.id, entityLabel: meta.project.name, action: 'clear_demo', actorId: me.id,
      note: `Removed ${demoCases.length} demo case(s)${includeSampleStructure ? `, ${del.modules.length} sample module(s), ${del.features.length} sample feature(s)` : ''}.`,
    });
    await commit({ del, events: [event] }, { entity: 'project' });
    return { cases: demoCases.length, modules: del.modules?.length || 0, features: del.features?.length || 0 };
  }

  async function resetAll() {
    requireActor('data.reset');
    try { await persistence.clearAll(); } catch (e) { throw new StorageError(e); }
    await init({ seed: true });
  }

  // ---- import ---------------------------------------------------------------------------
  /**
   * Apply a plan from planImport(). mode 'merge' honours item.take; mode 'replace' swaps all data.
   */
  async function applyImport(plan, { mode = 'merge', sourceName = 'file', incoming = null } = {}) {
    const me = requireActor('data.import');
    const now = nowIso();
    if (plan.errors.length) throw new ValidationError({}, 'Fix the import errors first.');

    if (mode === 'replace') {
      if (!incoming) throw new Error('Replace mode needs the incoming document.');
      const put = {};
      for (const c of COLLECTIONS) put[c] = clone(incoming[c] || []).map((r) => (c === 'testCases' ? normalizeCase(r) : r));
      // Keep the current profile so the user is not locked out after replacing.
      const meLocal = get('members', me.id);
      if (!put.members.some((m) => m.id === me.id)) put.members.push(clone(meLocal));
      const event = makeEvent({
        entityType: 'project', entityId: meta.project.id, entityLabel: sourceName, action: 'import', actorId: me.id,
        note: `Replaced all local data with ${sourceName} (${put.testCases.length} cases).`,
      });
      put.activity.push(event);
      const del = Object.fromEntries(COLLECTIONS.map((c) => [c, data[c].map((r) => idOf(c, r))]));
      const metaPatch = {
        project: incoming.project ? { ...meta.project, ...incoming.project } : meta.project,
        keyCounters: computeKeyCounters(put.testCases, put.deletedItems),
        lastChangeAt: now,
      };
      try {
        await persistence.commit({ del, put, meta: metaPatch }); // single atomic transaction
      } catch (e) { throw new StorageError(e); }
      await load();
      emit({ type: 'change', entity: 'import' });
      return { replaced: true, cases: put.testCases.length };
    }

    const put = Object.fromEntries(COLLECTIONS.map((c) => [c, []]));
    const del = Object.fromEntries(COLLECTIONS.map((c) => [c, []]));
    const events = [];
    const summary = { added: 0, updated: 0, deleted: 0, rekeyed: 0, skipped: 0, activity: plan.newActivity.length };
    const takenKeys = new Set(data.testCases.map((tc) => tc.caseKey));
    const counters = computeKeyCounters(data.testCases, data.deletedItems, meta.keyCounters);

    for (const item of plan.items) {
      if (!item.take) { summary.skipped += 1; continue; }
      const c = item.collection;
      if (item.kind === 'remoteDeleted') {
        del[c].push(item.id);
        events.push(makeEvent({
          entityType: item.entityType, entityId: item.id, entityLabel: item.localLabel, moduleId: item.local?.moduleId || null,
          action: 'import', actorId: me.id, note: `Removed: permanently deleted in ${sourceName}.`,
        }));
        summary.deleted += 1;
        continue;
      }
      if (item.kind === 'memberClash' || item.kind === 'skippedDeleted' || item.kind === 'same') { summary.skipped += 1; continue; }
      let rec = clone(item.incoming);
      if (item.kind === 'keyClash') {
        const m = /^([A-Z][A-Z0-9]*)-/.exec(rec.caseKey);
        const prefix = m ? m[1] : get('modules', rec.moduleId)?.keyPrefix;
        let n = (counters[prefix] || 0) + 1;
        while (takenKeys.has(`${prefix}-${String(n).padStart(3, '0')}`)) n += 1;
        const newKey = `${prefix}-${String(n).padStart(3, '0')}`;
        counters[prefix] = n;
        events.push(makeEvent({
          entityType: 'testCase', entityId: rec.id, entityLabel: newKey, moduleId: rec.moduleId, action: 'import', actorId: me.id,
          note: `Imported with new key ${newKey} (incoming ${rec.caseKey} was already used locally).`,
          changedFields: [{ field: 'caseKey', before: rec.caseKey, after: newKey }],
        }));
        rec = { ...rec, caseKey: newKey, version: Math.max(item.local?.version || 0, rec.version || 0) + 1, updatedAt: now };
        summary.rekeyed += 1;
      } else if (item.kind === 'conflict' && item.local) {
        // User chose the incoming copy over a concurrent local edit; bump past both versions.
        rec = { ...rec, version: Math.max(item.local.version || 0, rec.version || 0) + 1 };
      }
      if (c === 'testCases') takenKeys.add(rec.caseKey);
      put[c].push(rec);
      if (item.local) {
        summary.updated += 1;
        events.push(makeEvent({
          entityType: item.entityType, entityId: item.id, entityLabel: item.label, moduleId: rec.moduleId || (c === 'modules' ? rec.id : null),
          action: 'import', actorId: me.id, changedFields: diffFields(item.local, rec),
          note: item.kind === 'conflict' ? `Conflict resolved: took version from ${sourceName}.` : `Updated from ${sourceName}.`,
        }));
      } else summary.added += 1;
    }

    put.activity.push(...plan.newActivity);
    put.deletedItems.push(...plan.newTombstones);
    events.push(makeEvent({
      entityType: 'project', entityId: meta.project.id, entityLabel: sourceName, action: 'import', actorId: me.id,
      note: `Merged ${sourceName}: ${summary.added} added, ${summary.updated} updated, ${summary.deleted} removed, ${summary.rekeyed} re-keyed, ${summary.skipped} skipped, ${summary.activity} history events.`,
    }));

    for (const c of COLLECTIONS) { if (!put[c].length) delete put[c]; if (!del[c].length) delete del[c]; }
    const allCases = [...data.testCases.filter((tc) => !(del.testCases || []).includes(tc.id)), ...(put.testCases || [])];
    const metaPatch = { keyCounters: computeKeyCounters(allCases, [...data.deletedItems, ...(put.deletedItems || [])], counters) };
    await commit({ put, del, events, metaPatch }, { entity: 'import' });
    return summary;
  }

  // ---- drafts (unsaved editor state) ----------------------------------------------------
  const drafts = {
    get: (key) => persistence.getDraft(key).catch(() => null),
    put: (key, value) => persistence.putDraft(key, value).catch(() => {}),
    remove: (key) => persistence.deleteDraft(key).catch(() => {}),
  };

  return {
    init, reload,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get data() { return data; },
    get meta() { return meta; },
    get persistenceKind() { return persistence.kind; },
    get, activeCases, actor, setActor, can, nextCaseKey,
    createCase, updateCase, softDeleteCases, restoreCase, purgeCase, reviewCase, bulkUpdateCases,
    saveModule, saveFeature, setArchived,
    saveMember, logProfileSwitch,
    saveLabel, deleteLabel, labelUsage,
    updateProject, exportDocument, markExported, hasUnexportedChanges, clearDemoData, resetAll,
    applyImport, drafts,
  };
}

export { isEqual, ID_FIELD };
