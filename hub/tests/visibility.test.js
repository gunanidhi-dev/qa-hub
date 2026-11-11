import test from 'node:test';
import assert from 'node:assert/strict';
import { assignedStore, developerProgress } from '../js/visibility.js';

function fixture() {
  let actor = { id: 'a', displayName: 'Alice', role: 'Contributor' };
  const data = {
    members: [actor, { id: 'b', displayName: 'Bob', role: 'Contributor' }, { id: 'c', displayName: 'Carol', active: false }],
    testCases: [
      { id: 'one', assignedTo: 'a', moduleId: 'm1', completionStatus: 'Completed' },
      { id: 'two', assignedTo: 'a', moduleId: 'm1' },
      { id: 'three', assignedTo: 'b', moduleId: 'm2' },
      { id: 'four', assignedTo: '', moduleId: 'm2' },
      { id: 'trash', assignedTo: 'a', moduleId: 'm1', deletedAt: '2026-01-01' },
      { id: 'inactive', assignedTo: 'c', moduleId: 'm2', completionStatus: 'Completed' },
    ],
    modules: [{ id: 'm1' }, { id: 'm2' }], features: [],
    activity: [{ entityId: 'one' }, { entityId: 'three' }], deletedItems: [{ id: 'secret' }], testRuns: [],
  };
  let changed = null;
  const store = {
    data, actor: () => actor, can: () => true,
    activeCases: () => data.testCases.filter((c) => !c.deletedAt),
    get: (collection, id) => data[collection].find((c) => c.id === id) || null,
    updateCase: async (id) => { changed = id; },
    bulkUpdateCases: async (ids) => { changed = ids; },
  };
  return { store, view: assignedStore(store), setActor: (next) => { actor = next; }, changed: () => changed };
}

test('assigned view scopes lists, direct lookups, activity and metadata for all non-admin roles', () => {
  const { view, setActor } = fixture();
  for (const role of ['Contributor', 'Viewer', 'Maintainer']) {
    setActor({ id: 'a', role });
    assert.deepEqual(view.activeCases().map((c) => c.id), ['one', 'two']);
    assert.equal(view.get('testCases', 'three'), null);
    assert.equal(view.get('testCases', 'four'), null);
    assert.equal(view.get('testCases', 'one').id, 'one');
    assert.deepEqual(view.data.modules.map((m) => m.id), ['m1']);
    assert.deepEqual(view.data.activity.map((e) => e.entityId), ['one']);
    assert.equal(view.can('data.import'), false);
    assert.equal(view.can('case.create'), false);
  }
  setActor(null);
  assert.deepEqual(view.activeCases(), []);
  setActor({ id: 'a', role: 'Contributor', active: false });
  assert.deepEqual(view.activeCases(), []);
});

test('assigned mutation wrapper rejects foreign cases and mixed bulk operations before writing', async () => {
  const { view, changed } = fixture();
  await assert.rejects(view.updateCase('three', {}), /assigned to you/);
  await assert.rejects(view.bulkUpdateCases(['one', 'three'], {}), /assigned to you/);
  assert.equal(changed(), null);
  await view.updateCase('one', { completionStatus: 'Completed' });
  assert.equal(changed(), 'one');
});

test('admins see all cases and developer report reconciles active totals including unassigned', () => {
  const { store, view, setActor } = fixture();
  setActor({ id: 'admin', role: 'Admin' });
  assert.equal(view.activeCases().length, 5);
  assert.equal(view.get('testCases', 'three').id, 'three');
  const rows = developerProgress(store);
  assert.equal(rows.reduce((sum, row) => sum + row.total, 0), 5);
  assert.deepEqual(rows.find((r) => r.id === 'a'), { id: 'a', name: 'Alice', active: true, total: 2, completed: 1, pending: 1, percent: 50 });
  assert.equal(rows.find((r) => r.id === '').pending, 1);
  assert.equal(rows.find((r) => r.id === 'c').completed, 1);
});
