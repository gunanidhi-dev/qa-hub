// Regenerates data/sample-data.json and data/modules/*.json from the built-in seed.
// Usage: node scripts/build-sample-data.js
import { writeFileSync, mkdirSync } from 'node:fs';
import { buildSeedDocument } from '../js/seed.js';
import { buildExport, computeKeyCounters } from '../js/import-export.js';

const doc = buildSeedDocument();
const meta = { project: doc.project, keyCounters: computeKeyCounters(doc.testCases, []) };
const write = (path, value) => writeFileSync(path, `${JSON.stringify({ ...value, exportedAt: '2026-01-01T00:00:00.000Z' }, null, 2)}\n`);

mkdirSync('data/modules', { recursive: true });
write('data/sample-data.json', buildExport(doc, meta));
for (const [moduleId, file] of [['mod-authentication', 'authentication'], ['mod-patients', 'patients']]) {
  write(`data/modules/${file}.json`, buildExport(doc, meta, { moduleId }));
}
console.log('Wrote data/sample-data.json and data/modules/{authentication,patients}.json');
