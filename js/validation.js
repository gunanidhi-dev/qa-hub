// Pure validation helpers (no DOM). Return plain objects so the UI can show inline errors.

import {
  SCHEMA_VERSION, PRIORITIES, CASE_STATUSES, TEST_LEVELS, AUTOMATION_STATUSES, ROLES, LIMITS, COLLECTIONS, idOf,
} from './schema.js';

const isIso = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const str = (v) => (typeof v === 'string' ? v.trim() : '');

export const CASE_KEY_RE = /^[A-Z][A-Z0-9]{1,9}-\d{3,6}$/;
export const KEY_PREFIX_RE = /^[A-Z][A-Z0-9]{1,9}$/;
export const MEMBER_ID_RE = /^[a-z0-9][a-z0-9._-]{1,39}$/;

/**
 * Validate a test case draft.
 * @param {object} tc   draft (id may be null for new cases)
 * @param {object} ctx  { testCases, modules, features, members, testSuites, accounts, reservedKeys:Set }
 * @returns {Record<string,string>} field -> message (empty when valid)
 */
export function validateCase(tc, ctx) {
  const errors = {};
  const title = str(tc.title);
  if (!title) errors.title = 'Title is required.';
  else if (title.length < LIMITS.titleMin) errors.title = `Title must be at least ${LIMITS.titleMin} characters.`;
  else if (title.length > LIMITS.titleMax) errors.title = `Title must be ${LIMITS.titleMax} characters or fewer.`;

  const module = ctx.modules.find((m) => m.id === tc.moduleId);
  if (!tc.moduleId) errors.moduleId = 'Choose a module.';
  else if (!module) errors.moduleId = 'Selected module no longer exists.';

  if (tc.featureId) {
    const feature = ctx.features.find((f) => f.id === tc.featureId);
    if (!feature) errors.featureId = 'Selected feature no longer exists.';
    else if (feature.moduleId !== tc.moduleId) errors.featureId = 'Feature does not belong to the selected module.';
  } else if (module && ctx.features.some((f) => f.moduleId === module.id && !f.archived)) {
    errors.featureId = 'Choose a feature/operation for this module.';
  }

  if (!str(tc.objective)) errors.objective = 'Describe the objective or expected business behaviour.';
  if (!PRIORITIES.includes(tc.priority)) errors.priority = 'Choose a priority.';
  if (!CASE_STATUSES.includes(tc.status)) errors.status = 'Choose a status.';
  if (tc.testLevel && !TEST_LEVELS.includes(tc.testLevel)) errors.testLevel = 'Unknown test level.';
  if (tc.automationStatus && !AUTOMATION_STATUSES.includes(tc.automationStatus)) errors.automationStatus = 'Unknown automation status.';

  const key = str(tc.caseKey).toUpperCase();
  if (key) {
    if (!CASE_KEY_RE.test(key)) errors.caseKey = 'Use the format PREFIX-001 (capital letters/digits, dash, 3–6 digits).';
    else {
      const clash = ctx.testCases.find((c) => c.caseKey === key && c.id !== tc.id);
      if (clash) errors.caseKey = `${key} is already used by another case.`;
      else if (ctx.reservedKeys?.has(key) && !ctx.testCases.some((c) => c.id === tc.id && c.caseKey === key)) {
        errors.caseKey = `${key} belonged to a permanently deleted case and cannot be reused.`;
      }
    }
  }

  const steps = Array.isArray(tc.steps) ? tc.steps : [];
  if (steps.length > LIMITS.stepsMax) errors.steps = `No more than ${LIMITS.stepsMax} steps.`;
  const stepErrors = [];
  steps.forEach((s, i) => {
    const a = str(s.action);
    const e = str(s.expected);
    if (!a && e) stepErrors.push(`Step ${i + 1} has an expected result but no action.`);
  });
  if (stepErrors.length) errors.steps = stepErrors.join(' ');

  if ((tc.tags || []).length > LIMITS.tagsMax) errors.tags = `No more than ${LIMITS.tagsMax} tags.`;
  if ((tc.tags || []).some((t) => t.length > 40)) errors.tags = 'Tags must be 40 characters or fewer.';

  for (const field of ['objective', 'description', 'preconditions', 'expectedResult', 'testDataNotes']) {
    if (str(tc[field]).length > LIMITS.textMax) errors[field] = `Keep this under ${LIMITS.textMax} characters.`;
  }

  if (tc.automationPath) {
    const p = str(tc.automationPath);
    if (/^[a-z]+:\/\//i.test(p) || p.startsWith('/') || /^[a-z]:\\/i.test(p) || p.includes('..')) {
      errors.automationPath = 'Use a repo-relative path such as tests/e2e/login.spec.js.';
    }
  }

  if (tc.assignedTo && !ctx.members.some((m) => m.id === tc.assignedTo)) errors.assignedTo = 'Assignee not found.';
  for (const sid of tc.suites || []) {
    if (!ctx.testSuites.some((s) => s.id === sid)) { errors.suites = 'One of the selected suites no longer exists.'; break; }
  }
  for (const aid of tc.accountIds || []) {
    if (!ctx.accounts.some((a) => a.id === aid)) { errors.accountIds = 'One of the selected accounts no longer exists.'; break; }
  }
  return errors;
}

export function validateModule(mod, modules) {
  const errors = {};
  const name = str(mod.name);
  if (!name) errors.name = 'Name is required.';
  else if (name.length > LIMITS.nameMax) errors.name = `Keep the name under ${LIMITS.nameMax} characters.`;
  else if (modules.some((m) => m.id !== mod.id && m.name.toLowerCase() === name.toLowerCase())) errors.name = 'A module with this name already exists.';
  const prefix = str(mod.keyPrefix).toUpperCase();
  if (!prefix) errors.keyPrefix = 'Key prefix is required (e.g. PAT).';
  else if (!KEY_PREFIX_RE.test(prefix)) errors.keyPrefix = '2–10 capital letters/digits, starting with a letter.';
  else if (modules.some((m) => m.id !== mod.id && m.keyPrefix === prefix)) errors.keyPrefix = 'Another module already uses this prefix.';
  if (mod.targetCases !== '' && mod.targetCases !== null && mod.targetCases !== undefined) {
    const n = Number(mod.targetCases);
    if (!Number.isInteger(n) || n < 0 || n > 100000) errors.targetCases = 'Enter a whole number (0 or more), or leave blank.';
  }
  return errors;
}

export function validateFeature(feat, features) {
  const errors = {};
  const name = str(feat.name);
  if (!name) errors.name = 'Name is required.';
  else if (name.length > LIMITS.nameMax) errors.name = `Keep the name under ${LIMITS.nameMax} characters.`;
  else if (features.some((f) => f.id !== feat.id && f.moduleId === feat.moduleId && f.name.toLowerCase() === name.toLowerCase())) {
    errors.name = 'This module already has a feature with this name.';
  }
  return errors;
}

export function validateMember(member, members) {
  const errors = {};
  const name = str(member.displayName);
  if (!name) errors.displayName = 'Display name is required.';
  else if (name.length > LIMITS.nameMax) errors.displayName = 'Display name is too long.';
  const mid = str(member.memberId).toLowerCase();
  if (!mid) errors.memberId = 'Team member ID is required.';
  else if (!MEMBER_ID_RE.test(mid)) errors.memberId = 'Use 2–40 lowercase letters, digits, dot, dash or underscore.';
  else if (members.some((m) => m.id !== member.id && m.memberId === mid)) errors.memberId = 'This team member ID is already taken.';
  if (!ROLES.includes(member.role)) errors.role = 'Choose a role.';
  return errors;
}

export function validateNamedLabel(item, list, label = 'label') {
  const errors = {};
  const name = str(item.name);
  if (!name) errors.name = `${label} name is required.`;
  else if (name.length > LIMITS.nameMax) errors.name = 'Name is too long.';
  else if (list.some((x) => x.id !== item.id && x.name.toLowerCase() === name.toLowerCase())) errors.name = `A ${label.toLowerCase()} with this name already exists.`;
  return errors;
}

/**
 * Validate an imported JSON document (full or per-module export).
 * @param {any} doc
 * @param {object} [known] local collections used to resolve references that live outside a partial export
 * @returns {{errors:string[], warnings:string[]}}
 */
export function validateDocument(doc, known = {}) {
  const errors = [];
  const warnings = [];
  const err = (m) => { if (errors.length < 60) errors.push(m); };
  const warn = (m) => { if (warnings.length < 60) warnings.push(m); };

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { errors: ['File is not a QA Hub JSON document (expected an object).'], warnings };
  }
  if (typeof doc.schemaVersion !== 'number') err('Missing "schemaVersion" — this does not look like a QA Hub export.');
  else if (doc.schemaVersion > SCHEMA_VERSION) err(`File uses schema version ${doc.schemaVersion}, but this app supports up to ${SCHEMA_VERSION}. Update QA Hub before importing.`);
  else if (doc.schemaVersion < 1) err(`Unsupported schema version ${doc.schemaVersion}.`);

  for (const c of COLLECTIONS) {
    if (doc[c] !== undefined && !Array.isArray(doc[c])) err(`"${c}" must be an array.`);
  }
  if (errors.length) return { errors, warnings };

  const ids = {};
  for (const c of COLLECTIONS) {
    ids[c] = new Set();
    for (const [i, rec] of (doc[c] || []).entries()) {
      const id = idOf(c, rec);
      if (!rec || typeof rec !== 'object') { err(`${c}[${i}] is not an object.`); continue; }
      if (typeof id !== 'string' || !id) { err(`${c}[${i}] is missing a string id.`); continue; }
      if (ids[c].has(id)) err(`Duplicate id ${id} in ${c}.`);
      ids[c].add(id);
    }
  }

  const has = (c, id) => ids[c].has(id) || (known[c] || []).some((r) => idOf(c, r) === id);

  for (const m of doc.modules || []) {
    if (!str(m.name)) err(`Module ${m.id} has no name.`);
    if (!KEY_PREFIX_RE.test(m.keyPrefix || '')) err(`Module ${m.name || m.id} has an invalid key prefix "${m.keyPrefix}".`);
  }
  for (const f of doc.features || []) {
    if (!str(f.name)) err(`Feature ${f.id} has no name.`);
    if (!has('modules', f.moduleId)) err(`Feature "${f.name}" references unknown module ${f.moduleId}.`);
  }
  for (const m of doc.members || []) {
    if (!str(m.displayName) || !str(m.memberId)) err(`Member ${m.id} needs displayName and memberId.`);
    if (m.role && !ROLES.includes(m.role)) err(`Member ${m.displayName} has unknown role "${m.role}".`);
  }

  const keys = new Map();
  for (const tc of doc.testCases || []) {
    const label = tc.caseKey || tc.id;
    for (const f of ['caseKey', 'title', 'moduleId', 'priority', 'status', 'createdAt', 'updatedAt']) {
      if (tc[f] === undefined || tc[f] === null || tc[f] === '') err(`Case ${label} is missing required field "${f}".`);
    }
    if (tc.caseKey && !CASE_KEY_RE.test(tc.caseKey)) err(`Case ${label} has an invalid case key.`);
    if (tc.caseKey) {
      if (keys.has(tc.caseKey)) err(`Case key ${tc.caseKey} is used by two cases (${keys.get(tc.caseKey)}, ${tc.id}).`);
      keys.set(tc.caseKey, tc.id);
    }
    if (tc.priority && !PRIORITIES.includes(tc.priority)) err(`Case ${label} has unknown priority "${tc.priority}".`);
    if (tc.status && !CASE_STATUSES.includes(tc.status)) err(`Case ${label} has unknown status "${tc.status}".`);
    if (tc.testLevel && !TEST_LEVELS.includes(tc.testLevel)) err(`Case ${label} has unknown test level "${tc.testLevel}".`);
    if (tc.automationStatus && !AUTOMATION_STATUSES.includes(tc.automationStatus)) err(`Case ${label} has unknown automation status.`);
    for (const f of ['createdAt', 'updatedAt', 'deletedAt', 'reviewedAt']) {
      if (tc[f] && !isIso(tc[f])) err(`Case ${label} has an invalid ${f} timestamp.`);
    }
    if (tc.version !== undefined && (!Number.isInteger(tc.version) || tc.version < 0)) err(`Case ${label} has an invalid version.`);
    if (tc.steps !== undefined && !Array.isArray(tc.steps)) err(`Case ${label}: steps must be an array.`);
    if (tc.moduleId && !has('modules', tc.moduleId)) err(`Case ${label} references unknown module ${tc.moduleId}.`);
    if (tc.featureId && !has('features', tc.featureId)) err(`Case ${label} references unknown feature ${tc.featureId}.`);
    for (const sid of tc.suites || []) if (!has('testSuites', sid)) err(`Case ${label} references unknown suite ${sid}.`);
    for (const aid of tc.accountIds || []) if (!has('accounts', aid)) err(`Case ${label} references unknown account ${aid}.`);
    for (const f of ['createdBy', 'updatedBy', 'assignedTo', 'reviewedBy', 'deletedBy']) {
      if (tc[f] && !has('members', tc[f])) warn(`Case ${label}: ${f} refers to a member not in this file or your team list.`);
    }
  }
  for (const ev of doc.activity || []) {
    if (!ev.entityType || !ev.action || !isIso(ev.timestamp)) err(`Activity event ${ev.eventId} is missing entityType/action/timestamp.`);
  }
  if (!(doc.testCases || []).length && !(doc.modules || []).length) warn('File contains no modules and no test cases.');
  return { errors, warnings };
}
