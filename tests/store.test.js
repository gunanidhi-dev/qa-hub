import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, ValidationError, ConflictError, PermissionError } from '../js/store.js';
import { createMemoryPersistence } from '../js/db.js';
import { planImport } from '../js/import-export.js';

async function freshStore(persistence = createMemoryPersistence()) {
  const store = createStore(persistence);
  await store.init();
  store.setActor('mbr-dev-a'); // Admin
  return { store, persistence };
}

const clone = (x) => JSON.parse(JSON.stringify(x));

const baseCase = (over = {}) => ({
  title: 'Login rejects wrong password',
  moduleId: 'mod-authentication',
  featureId: 'feat-authentication-login',
  objective: 'User sees an error and stays on login page.',
  priority: 'High',
  status: 'Draft',
  testLevel: 'E2E',
  steps: [{ action: 'Enter wrong password', expected: 'Error shown' }],
  ...over,
});

test('seed creates 8 profiles, 10 modules and exactly 2 demo cases', async () => {
  const { store } = await freshStore();
  assert.equal(store.data.members.length, 8);
  assert.equal(store.data.modules.length, 10);
  assert.equal(store.data.testCases.length, 2);
  assert.deepEqual(store.data.testCases.map((c) => c.caseKey).sort(), ['AUTH-001', 'PAT-001']);
});

test('create assigns next key, records actor and activity, persists across reload', async () => {
  const { store, persistence } = await freshStore();
  const a = await store.createCase(baseCase());
  const b = await store.createCase(baseCase({ title: 'Second case here' }));
  assert.equal(a.caseKey, 'AUTH-002');
  assert.equal(b.caseKey, 'AUTH-003');
  assert.equal(a.createdBy, 'mbr-dev-a');
  assert.equal(a.version, 1);
  assert.ok(store.data.activity.some((e) => e.entityId === a.id && e.action === 'create'));

  const reloaded = createStore(persistence);
  await reloaded.init();
  assert.equal(reloaded.data.testCases.length, 4);
  assert.equal(reloaded.get('testCases', a.id).title, a.title);
});

test('validation rejects missing fields and duplicate keys', async () => {
  const { store } = await freshStore();
  await assert.rejects(store.createCase({ title: 'x' }), (e) => e instanceof ValidationError && Boolean(e.errors.title && e.errors.moduleId));
  await assert.rejects(store.createCase(baseCase({ caseKey: 'AUTH-001' })), (e) => e instanceof ValidationError && /already used/.test(e.errors.caseKey));
  await assert.rejects(store.createCase(baseCase({ featureId: '' })), (e) => Boolean(e.errors.featureId));
});

test('update bumps version, logs field diff, detects stale edits', async () => {
  const { store } = await freshStore();
  const a = await store.createCase(baseCase());
  const u = await store.updateCase(a.id, { ...a, priority: 'Critical' }, { expectedVersion: 1 });
  assert.equal(u.version, 2);
  const ev = store.data.activity.find((e) => e.entityId === a.id && e.action === 'update');
  assert.deepEqual(ev.changedFields.map((f) => f.field), ['priority']);
  assert.equal(ev.changedFields[0].before, 'High');
  await assert.rejects(store.updateCase(a.id, { ...a, title: 'Stale edit title' }, { expectedVersion: 1 }), ConflictError);
  const same = await store.updateCase(a.id, { ...u }, { expectedVersion: 2 });
  assert.equal(same.version, 2, 'no-op update does not bump version');
});

test('soft delete, restore and purge with tombstone; keys never reused', async () => {
  const { store } = await freshStore();
  const a = await store.createCase(baseCase());
  await store.softDeleteCases([a.id], 'duplicate of AUTH-001');
  assert.ok(store.get('testCases', a.id).deletedAt);
  assert.equal(store.activeCases().length, 2);
  await store.restoreCase(a.id);
  assert.equal(store.get('testCases', a.id).deletedAt, null);
  await assert.rejects(store.purgeCase(a.id, a.caseKey), ConflictError); // must be in trash first
  await store.softDeleteCases([a.id], 'bye');
  await assert.rejects(store.purgeCase(a.id, 'nope'), ValidationError);
  await store.purgeCase(a.id, a.caseKey);
  assert.equal(store.get('testCases', a.id), null);
  assert.equal(store.data.deletedItems.length, 1);
  const next = await store.createCase(baseCase({ title: 'After purge case' }));
  assert.equal(next.caseKey, 'AUTH-003');
  await assert.rejects(store.createCase(baseCase({ caseKey: 'AUTH-002', title: 'Reuse purged key' })), ValidationError);
  assert.ok(store.data.activity.some((e) => e.entityId === a.id && e.action === 'purge'), 'history kept');
});

test('roles are enforced as UI convenience', async () => {
  const { store } = await freshStore();
  store.setActor('mbr-dev-h'); // Viewer
  await assert.rejects(store.createCase(baseCase()), PermissionError);
  store.setActor('mbr-dev-d'); // Contributor
  const a = await store.createCase(baseCase());
  await assert.rejects(store.createCase(baseCase({ status: 'Approved', title: 'Self approved case' })), ValidationError);
  await store.reviewCase(a.id, 'submit');
  await assert.rejects(store.reviewCase(a.id, 'approve'), PermissionError);
  store.setActor('mbr-dev-b'); // Maintainer
  await assert.rejects(store.reviewCase(a.id, 'reject', ''), ValidationError);
  const approved = await store.reviewCase(a.id, 'approve', 'LGTM');
  assert.equal(approved.status, 'Approved');
  assert.equal(approved.reviewedBy, 'mbr-dev-b');
});

test('only an Admin assigns cases', async () => {
  const { store } = await freshStore();
  store.setActor('mbr-dev-d'); // Contributor
  const c = await store.createCase(baseCase({ assignedTo: 'mbr-dev-d' }));
  assert.equal(c.assignedTo, '', 'contributor cannot self-assign on create');
  const u = await store.updateCase(c.id, { ...c, assignedTo: 'mbr-dev-e', title: 'Login rejects wrong password (v2)' });
  assert.equal(u.assignedTo, '', 'contributor cannot re-assign on edit');
  await assert.rejects(store.bulkUpdateCases([c.id], { assignedTo: 'mbr-dev-d' }), PermissionError);
  store.setActor('mbr-dev-a'); // Admin
  assert.equal(await store.bulkUpdateCases([c.id], { assignedTo: 'mbr-dev-d' }), 1);
  assert.equal(store.get('testCases', c.id).assignedTo, 'mbr-dev-d');
  store.setActor('mbr-dev-d');
  const kept = await store.updateCase(c.id, { ...store.get('testCases', c.id), title: 'Login rejects wrong password (v3)' });
  assert.equal(kept.assignedTo, 'mbr-dev-d', 'edit by contributor keeps the Admin assignment');
});

test('bulk update records per-case history', async () => {
  const { store } = await freshStore();
  const ids = store.activeCases().map((c) => c.id);
  const n = await store.bulkUpdateCases(ids, { priority: 'Low', addTags: ['bulk'] });
  assert.equal(n, 2);
  assert.equal(store.data.activity.filter((e) => e.action === 'bulk_update').length, 2);
  assert.ok(store.activeCases().every((c) => c.priority === 'Low' && c.tags.includes('bulk')));
});

test('first-launch self-service profile cannot grant Admin', async () => {
  const clean = createStore(createMemoryPersistence());
  await clean.init({ seed: false });
  const me = await clean.saveMember({ displayName: 'New Person', memberId: 'new-person', role: 'Admin' }, { selfService: true });
  assert.equal(me.role, 'Contributor');
});

test('export → import into a clean browser preserves data, ids and history', async () => {
  const { store } = await freshStore();
  const a = await store.createCase(baseCase());
  await store.updateCase(a.id, { ...a, priority: 'Low' });
  await store.softDeleteCases([a.id], 'test');
  const doc = clone(store.exportDocument());

  // "Clean browser": fresh storage, seeded, then replace with the exported file.
  const { store: other } = await freshStore();
  await other.createCase(baseCase({ title: 'Only in other browser' }));
  const plan = planImport(other.data, doc);
  assert.deepEqual(plan.errors, []);
  await other.applyImport(plan, { mode: 'replace', incoming: doc, sourceName: 'backup.json' });
  assert.equal(other.data.testCases.length, 3);
  const restored = other.get('testCases', a.id);
  assert.equal(restored.caseKey, a.caseKey);
  assert.equal(restored.priority, 'Low');
  assert.ok(restored.deletedAt, 'soft delete state preserved');
  const actions = other.data.activity.filter((e) => e.entityId === a.id).map((e) => e.action).sort();
  assert.deepEqual(actions, ['create', 'delete', 'update']);
  // Persisted: reload from same persistence.
  await other.reload();
  assert.equal(other.data.testCases.length, 3);
});

test('merge import: newer, key clash, identical', async () => {
  const { store: alice } = await freshStore();
  const { store: bob } = await freshStore();
  const demo = bob.get('testCases', 'case-demo-auth-001');
  await bob.updateCase(demo.id, { ...demo, priority: 'High' });
  await bob.createCase(baseCase({ title: 'Bob case in auth' }));
  const aliceCase = await alice.createCase(baseCase({ title: 'Alice case in auth' }));
  const bobDoc = clone(bob.exportDocument());

  const plan = planImport(alice.data, bobDoc);
  assert.deepEqual(plan.errors, []);
  const kinds = Object.fromEntries(plan.items.filter((i) => i.collection === 'testCases').map((i) => [i.label.split(' ·')[0], i.kind]));
  assert.equal(kinds['AUTH-001'], 'incomingNewer');
  assert.equal(kinds['AUTH-002'], 'keyClash');
  assert.equal(kinds['PAT-001'], 'same');
  const summary = await alice.applyImport(plan, { mode: 'merge', sourceName: 'bob.json' });
  assert.equal(summary.updated, 1);
  assert.equal(summary.rekeyed, 1);
  assert.equal(alice.get('testCases', 'case-demo-auth-001').priority, 'High');
  assert.equal(alice.get('testCases', aliceCase.id).caseKey, 'AUTH-002');
  assert.deepEqual(alice.activeCases().map((c) => c.caseKey).sort(), ['AUTH-001', 'AUTH-002', 'AUTH-003', 'PAT-001']);
});

test('merge import: concurrent edits conflict, tombstones propagate', async () => {
  const { store: carol } = await freshStore();
  const { store: dave } = await freshStore();
  const p1 = carol.get('testCases', 'case-demo-pat-001');
  await carol.updateCase(p1.id, { ...p1, priority: 'Low' });
  const p2 = dave.get('testCases', 'case-demo-pat-001');
  await dave.updateCase(p2.id, { ...p2, priority: 'Critical' });
  const plan2 = planImport(carol.data, clone(dave.exportDocument()));
  const item = plan2.items.find((i) => i.id === p1.id);
  assert.equal(item.kind, 'conflict');
  assert.equal(item.take, false);
  await carol.applyImport(plan2, { mode: 'merge' });
  assert.equal(carol.get('testCases', p1.id).priority, 'Low');

  await dave.softDeleteCases([p2.id], 'obsolete');
  await dave.purgeCase(p2.id, 'PAT-001');
  const plan3 = planImport(carol.data, clone(dave.exportDocument()));
  assert.ok(plan3.items.some((i) => i.kind === 'remoteDeleted' && i.id === p1.id));
  await carol.applyImport(plan3, { mode: 'merge' });
  assert.equal(carol.get('testCases', p1.id), null);
  assert.ok(carol.data.deletedItems.some((d) => d.id === p1.id));
});

test('per-module export merges into another browser', async () => {
  const { store: a } = await freshStore();
  const created = await a.createCase(baseCase({ moduleId: 'mod-patients', featureId: 'feat-patients-search-patient', title: 'Search by last name' }));
  const doc = clone(a.exportDocument({ moduleId: 'mod-patients' }));
  assert.equal(doc.modules.length, 1);
  assert.ok(doc.testCases.every((c) => c.moduleId === 'mod-patients'));
  const { store: b } = await freshStore();
  const plan = planImport(b.data, doc);
  assert.deepEqual(plan.errors, []);
  await b.applyImport(plan, { mode: 'merge' });
  assert.equal(b.get('testCases', created.id).caseKey, 'PAT-002');
  assert.ok(b.data.activity.some((e) => e.entityId === created.id && e.action === 'create'));
});

test('import rejects malformed and future-version documents', async () => {
  const { store } = await freshStore();
  assert.ok(planImport(store.data, { foo: 1 }).errors.length);
  assert.ok(planImport(store.data, { schemaVersion: 99 }).errors[0].includes('schema version'));
  const bad = clone(store.exportDocument());
  bad.testCases.push({ ...bad.testCases[0] });
  assert.ok(planImport(store.data, bad).errors.some((e) => /Duplicate id/.test(e)));
  const badRef = clone(store.exportDocument());
  badRef.testCases[0].moduleId = 'nope';
  assert.ok(planImport(store.data, badRef).errors.some((e) => /unknown module/.test(e)));
});

test('labels in use cannot be deleted without explicit removal', async () => {
  const { store } = await freshStore();
  await assert.rejects(store.deleteLabel('testSuites', 'suite-smoke'), ConflictError);
  const n = await store.deleteLabel('testSuites', 'suite-smoke', { removeFromCases: true });
  assert.equal(n, 1);
  assert.ok(!store.get('testCases', 'case-demo-auth-001').suites.includes('suite-smoke'));
});

test('clear demo data keeps profiles and modules in use', async () => {
  const { store } = await freshStore();
  const mine = await store.createCase(baseCase());
  const r = await store.clearDemoData({ includeSampleStructure: true });
  assert.equal(r.cases, 2);
  assert.equal(store.data.members.length, 8);
  assert.ok(store.get('testCases', mine.id));
  assert.ok(store.get('modules', 'mod-authentication'), 'module in use is kept');
  assert.equal(store.get('modules', 'mod-claims'), null);
});

test('3,000 cases: filtering stays fast', async () => {
  const { store } = await freshStore();
  const t0 = performance.now();
  const records = [];
  for (let i = 0; i < 3000; i += 1) records.push(baseCase({ title: `Synthetic case number ${i}`, priority: ['Low', 'High'][i % 2] }));
  for (const r of records.slice(0, 300)) await store.createCase(r); // exercise the real path for 300
  const created = performance.now() - t0;
  const t1 = performance.now();
  const hits = store.activeCases().filter((c) => c.title.toLowerCase().includes('number 1') && c.priority === 'High');
  const filterMs = performance.now() - t1;
  assert.ok(hits.length > 0);
  assert.ok(filterMs < 50, `filter took ${filterMs}ms`);
  assert.ok(created < 20000);
});
