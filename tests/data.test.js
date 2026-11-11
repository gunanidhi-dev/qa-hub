import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStore } from '../js/store.js';
import { createMemoryPersistence } from '../js/db.js';
import { planImport, casesToCsv } from '../js/import-export.js';
import { validateDocument, validateCase } from '../js/validation.js';
import { csvCell } from '../js/utils.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));

test('committed data files are valid and match the built-in seed', async () => {
  const store = createStore(createMemoryPersistence());
  await store.init();
  for (const file of ['data/sample-data.json', 'data/modules/authentication.json', 'data/modules/patients.json']) {
    const doc = read(file);
    assert.deepEqual(validateDocument(doc, store.data).errors, [], file);
    const plan = planImport(store.data, doc);
    assert.ok(plan.items.every((i) => i.kind === 'same'), `${file} should be identical to a freshly seeded browser`);
  }
});

test('no PHI-like or secret-like content in fixtures', () => {
  const text = readFileSync(new URL('../data/sample-data.json', import.meta.url), 'utf8');
  assert.doesNotMatch(text, /\b\d{3}-\d{2}-\d{4}\b/, 'no SSN-like numbers');
  assert.doesNotMatch(text, /password\s*[:=]\s*\S+/i, 'no inline passwords');
  assert.doesNotMatch(text, /\b(?:\d[ -]*?){13,16}\b/, 'no card-like numbers');
});

test('validateCase flags bad automation paths and step ordering', () => {
  const ctx = { testCases: [], modules: [{ id: 'm', keyPrefix: 'M' }], features: [], members: [], testSuites: [], accounts: [] };
  const base = { title: 'Valid title', moduleId: 'm', objective: 'x', priority: 'High', status: 'Draft' };
  assert.deepEqual(validateCase(base, ctx), {});
  assert.ok(validateCase({ ...base, automationPath: '../secret' }, ctx).automationPath);
  assert.ok(validateCase({ ...base, automationPath: 'https://x' }, ctx).automationPath);
  assert.ok(validateCase({ ...base, steps: [{ action: '', expected: 'orphan' }] }, ctx).steps);
  assert.ok(validateCase({ ...base, caseKey: 'bad key' }, ctx).caseKey);
});

test('CSV export escapes quotes, newlines and formula injection', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  const csv = casesToCsv([{ caseKey: 'A-001', title: '=1+1', steps: [{ action: 'a', expected: 'b' }], suites: [], tags: [], accountIds: [], bugRefs: [] }], {
    moduleName: () => '', featureName: () => '', suiteName: () => '', accountName: () => '', memberName: () => '',
  });
  assert.ok(csv.includes("'=1+1"));
});
