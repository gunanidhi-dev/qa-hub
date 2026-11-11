// Converts the Markdown test-case library (one file per module) into data/library.json,
// the document QA Hub seeds from on first launch.
//
// Usage: node scripts/import-markdown.js [path/to/testcases] [--out data/library.json]
//
// Markdown layout expected:
//   # Module title
//   ## Feature / screen (N)
//   ### 12. Case title — scenario
//   **Test data:** ...
//   | Step | Action | Expected result |
//
// IDs, keys and timestamps are deterministic, so re-running the script on unchanged
// Markdown produces an identical file (clean Git diffs, clean merges between browsers).

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, basename, resolve } from 'node:path';
import { SCHEMA_VERSION, emptyDocument, normalizeCase, blankCase } from '../js/schema.js';
import { classifyCase, SUITES } from '../js/library-rules.js';
import { appPath } from './paths.js';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
if (outIdx >= 0 && (!args[outIdx + 1] || args[outIdx + 1].startsWith('--'))) {
  console.error('--out requires an output file path.');
  process.exit(1);
}
const out = outIdx >= 0 ? resolve(args[outIdx + 1]) : appPath('data/library.json');
const sourceArg = args.find((a, i) => !a.startsWith('--') && (outIdx < 0 || i !== outIdx + 1));
const srcDir = sourceArg ? resolve(sourceArg)
  : appPath('../../patientmanager-testing-analysis/testing-analysis/testcases');

if (!existsSync(srcDir)) {
  console.error(`Test case folder not found: ${srcDir}`);
  process.exit(1);
}

const SEED_TIME = '2026-01-01T00:00:00.000Z';
const ADMIN = 'mbr-dossmk'; // library owner: every imported record is created by this Admin

/** file stem -> [display order, key prefix, short description] */
const MODULE_META = {
  login: [1, 'LOGIN', 'Login, two-factor, provider/office selection, passcode reset, logout and session.'],
  'users-companies-settings': [2, 'USR', 'Users, merchants, companies, help center and registration settings.'],
  'patient-management': [3, 'PAT', 'Patient chart, demographics, search, chart tabs, insurance and eligibility.'],
  'appointments-scheduling': [4, 'APPT', 'Scheduling, booking, provider availability, requests and reminders.'],
  'clinical-documentation': [5, 'CLIN', 'Clinical notes, EMR templates, anesthesia, treatment plans, transcription.'],
  'forms-registration': [6, 'FORM', 'Documents, sent forms, e-signature and the registration form builder.'],
  'images-attachments': [7, 'IMG', 'Image albums, categories, DICOM and patient attachments.'],
  'ledger-charges-claims': [8, 'LEDG', 'Ledger, charges, adjustments, discounts, EOB payments and claims.'],
  'payments-invoices-ar': [9, 'PAY', 'Invoices, card transactions, recurring payments, refunds, voids and AR.'],
  'practice-setup': [10, 'SETUP', 'Fee schedules, materials, providers, payers, UCR, departments and letters.'],
  'referrals-collaboration': [11, 'REF', 'Collaborators, letters, referral practices and inbound referrals.'],
  'messaging-communication': [12, 'MSG', 'Staff chat, campaigns, SMS inbox, notifications and portal messages.'],
  'workflows-tasks': [13, 'WF', 'Patient tasks, workflow templates and the task board.'],
  'reports-dashboards': [14, 'RPT', 'Practice, transaction and org reports and provider dashboard widgets.'],
  'practice-subscription-billing': [15, 'SUB', 'Practice subscription payment methods and bills.'],
  security: [16, 'SEC', 'Cross-cutting access control, input attacks, error handling and private data.'],
  'end-to-end-flows': [17, 'E2E', 'Business flows that cross several modules.'],
  'data-checks': [18, 'DATA', 'Database-level integrity, encryption, rounding, logging and performance.'],
  'external-services': [19, 'EXT', 'Third-party integrations: payments, claims, SMS, email, storage, lookups.'],
};

/** 7 team members. Credentials are NOT stored here — see scripts/create-users.js. */
const MEMBERS = [
  ['dossmk', 'DossMK', 'Admin'],
  ['gunanidhi', 'Gunanidhi', 'Admin'],
  ['selshiya', 'Selshiya', 'Maintainer'],
  ['sujitha', 'Sujitha', 'Contributor'],
  ['santhiya', 'Santhiya', 'Contributor'],
  ['marivijayakumar', 'Marivijayakumar', 'Contributor'],
  ['samnikesh', 'Samnikesh', 'Contributor'],
  ['vignesh', 'Vignesh', 'Contributor'],
];

const slug = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const clean = (s) => s.replace(/\*\*/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim();
const base = (extra) => ({ version: 1, createdBy: ADMIN, createdAt: SEED_TIME, updatedBy: ADMIN, updatedAt: SEED_TIME, ...extra });

function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

function parseFile(text, stem) {
  const lines = text.split(/\r?\n/);
  const mod = { title: '', note: '', features: [] };
  let feature = null;
  let tc = null;
  const finish = () => { if (tc && feature) feature.cases.push(tc); tc = null; };

  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if ((m = /^# (.+)$/.exec(line))) { mod.title = clean(m[1]); continue; }
    if ((m = /^> (.+)$/.exec(line))) { mod.note += `${clean(m[1])} `; continue; }
    if ((m = /^## (.+?)(?:\s*\((\d+)\))?$/.exec(line))) {
      finish();
      feature = { name: clean(m[1]), declared: m[2] ? Number(m[2]) : null, cases: [] };
      mod.features.push(feature);
      continue;
    }
    if ((m = /^### (\d+)\.\s+(.+)$/.exec(line))) {
      finish();
      tc = { number: Number(m[1]), title: clean(m[2]), testData: '', steps: [] };
      continue;
    }
    if (!tc) continue;
    if ((m = /^\*\*Test data:\*\*\s*(.*)$/.exec(line))) { tc.testData = clean(m[1]); continue; }
    if (line.startsWith('|')) {
      const cells = splitRow(line);
      if (cells.length < 3 || /^-+$/.test(cells[0]) || /^step$/i.test(cells[0])) continue;
      tc.steps.push({ action: clean(cells[1]), expected: clean(cells.slice(2).join(' | ')) });
    }
  }
  finish();
  if (!mod.title) throw new Error(`${stem}.md has no "# Module" heading`);
  return mod;
}

const files = readdirSync(srcDir).filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md');
const doc = emptyDocument('Patient Manager QA');
doc.project = { id: 'qa-hub', name: 'Patient Manager QA' };
doc.members = MEMBERS.map(([mid, name, role]) => base({ id: `mbr-${mid}`, memberId: mid, displayName: name, role, active: true }));
doc.accounts = [
  base({ id: 'acct-company-a', name: 'Company A', description: 'Primary tenant used by most cases (full and limited access users).' }),
  base({ id: 'acct-company-b', name: 'Company B', description: 'Second tenant used to prove data isolation.' }),
];
doc.testSuites = SUITES.map(([id, name, description], order) => base({ id: `suite-${id}`, name, description, order }));

const problems = [];
const sorted = files.map((f) => basename(f, '.md')).sort((a, b) => (MODULE_META[a]?.[0] ?? 99) - (MODULE_META[b]?.[0] ?? 99) || a.localeCompare(b));
const usedPrefixes = new Set();

for (const stem of sorted) {
  const parsed = parseFile(readFileSync(join(srcDir, `${stem}.md`), 'utf8'), stem);
  const [order, prefixGuess, description] = MODULE_META[stem] || [99, stem.replace(/[^a-z]/gi, '').slice(0, 5).toUpperCase(), parsed.note.trim()];
  let prefix = prefixGuess;
  for (let i = 2; usedPrefixes.has(prefix); i++) prefix = `${prefixGuess}${i}`;
  usedPrefixes.add(prefix);
  const moduleId = `mod-${stem}`;
  doc.modules.push(base({
    id: moduleId, name: parsed.title, keyPrefix: prefix, description, ownerId: '', // the Admin assigns module owners in the app
    targetCases: parsed.features.reduce((n, f) => n + f.cases.length, 0), archived: false, order: order - 1, sourceFile: `${stem}.md`,
  }));

  let n = 0;
  const featureIds = new Set();
  parsed.features.forEach((f, fi) => {
    let fid = `feat-${stem}-${slug(f.name)}`;
    for (let i = 2; featureIds.has(fid); i++) fid = `feat-${stem}-${slug(f.name)}-${i}`;
    featureIds.add(fid);
    doc.features.push(base({ id: fid, moduleId, name: f.name.slice(0, 80), description: '', ownerId: '', archived: false, order: fi }));
    if (f.declared !== null && f.declared !== f.cases.length) problems.push(`${stem}.md › ${f.name}: heading says ${f.declared}, found ${f.cases.length}`);

    for (const c of f.cases) {
      n += 1;
      const key = `${prefix}-${String(n).padStart(3, '0')}`;
      const info = classifyCase({ moduleStem: stem, featureName: f.name, title: c.title, steps: c.steps });
      let title = c.title;
      if (title.length < 5) title = `${f.name}: ${title}`;
      if (title.length > 200) title = `${title.slice(0, 197)}…`;
      const lastExpected = c.steps.at(-1)?.expected || '';
      doc.testCases.push(normalizeCase(base({
        id: `case-${stem}-${String(c.number).padStart(4, '0')}`,
        caseKey: key,
        title,
        moduleId,
        featureId: fid,
        objective: info.objective,
        description: `${parsed.title} › ${f.name}. Source: ${stem}.md #${c.number}.`,
        preconditions: parsed.note.trim(),
        steps: c.steps.length ? c.steps : [{ action: '', expected: '' }],
        expectedResult: lastExpected,
        priority: info.priority,
        status: 'Ready for Review',
        testLevel: info.testLevel,
        suites: info.suites.map((s) => `suite-${s}`),
        automationStatus: 'Not Planned',
        tags: info.tags,
        accountIds: info.crossTenant ? ['acct-company-a', 'acct-company-b'] : ['acct-company-a'],
        assignedTo: '', // unassigned: the Admin assigns work in the app (Assign work page)
        requirementRef: `${stem}.md#${c.number}`,
        risk: info.risk,
        testDataNotes: c.testData,
      })));
      if (!c.steps.length) problems.push(`${key} (${stem}.md #${c.number}) has no steps`);
    }
  });
}

doc.activity = [{
  eventId: 'evt-seed-library',
  entityType: 'project',
  entityId: 'qa-hub',
  entityLabel: 'Library import',
  moduleId: null,
  action: 'import',
  actorId: ADMIN,
  timestamp: SEED_TIME,
  changedFields: [],
  note: `Imported ${doc.testCases.length} cases in ${doc.modules.length} modules from Markdown.`,
}];
doc.schemaVersion = SCHEMA_VERSION;
doc.exportedAt = SEED_TIME;

// Drop fields that equal the blank-case default; normalizeCase() restores them on load.
const defaults = blankCase();
doc.testCases = doc.testCases.map((tc) => Object.fromEntries(Object.entries(tc).filter(([k, v]) =>
  !(k in defaults) || ['id', 'version', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy'].includes(k) || JSON.stringify(v) !== JSON.stringify(defaults[k]))));

// Revision lets browsers that seeded an older library notice the new one and reload it.
doc.libraryRevision = createHash('sha256').update(JSON.stringify(doc)).digest('hex').slice(0, 16);
writeFileSync(out, `${JSON.stringify(doc)}\n`);
const metaOut = out.replace(/\.json$/, '.meta.json');
writeFileSync(metaOut, `${JSON.stringify({ libraryRevision: doc.libraryRevision, cases: doc.testCases.length, modules: doc.modules.length }, null, 2)}\n`);
const bySuite = Object.fromEntries(doc.testSuites.map((s) => [s.name, doc.testCases.filter((c) => c.suites.includes(s.id)).length]));
console.log(`Wrote ${out}: ${doc.modules.length} modules, ${doc.features.length} features, ${doc.testCases.length} cases.`);
console.log('Cases per suite:', bySuite);
if (problems.length) console.warn(`Warnings (${problems.length}):\n  ${problems.join('\n  ')}`);
