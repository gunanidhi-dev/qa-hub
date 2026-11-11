// Starter content: 8 placeholder profiles, example modules/features, suites, and exactly
// two clearly labelled demonstration cases. Seed IDs and timestamps are fixed so that
// two browsers seeded independently produce identical records (clean Git merges).

import { SCHEMA_VERSION, emptyDocument, normalizeCase } from './schema.js';

const SEED_TIME = '2026-01-01T00:00:00.000Z';

const MEMBERS = [
  ['dev-a', 'Developer A', 'Admin'],
  ['dev-b', 'Developer B', 'Maintainer'],
  ['dev-c', 'Developer C', 'Maintainer'],
  ['dev-d', 'Developer D', 'Contributor'],
  ['dev-e', 'Developer E', 'Contributor'],
  ['dev-f', 'Developer F', 'Contributor'],
  ['dev-g', 'Developer G', 'Contributor'],
  ['dev-h', 'Developer H', 'Viewer'],
];

const MODULES = [
  ['authentication', 'Authentication', 'AUTH', 'Login, logout, password reset, session handling.', ['Login', 'Password Reset', 'Session Timeout']],
  ['patients', 'Patients', 'PAT', 'Patient registration, search and demographics.', ['Create Patient', 'Search Patient', 'Edit Patient']],
  ['appointments', 'Appointments', 'APPT', 'Scheduling, rescheduling and cancellations.', []],
  ['clinical-notes', 'Clinical Notes', 'NOTE', 'Encounter notes, templates and sign-off.', []],
  ['ledger', 'Ledger', 'LEDG', 'Patient ledger entries and balances.', []],
  ['billing', 'Billing', 'BILL', 'Charges, statements and fee schedules.', []],
  ['claims', 'Claims', 'CLM', 'Claim creation, submission and status tracking.', []],
  ['payments', 'Payments', 'PAY', 'Payment posting and refunds (synthetic data only).', []],
  ['reports', 'Reports', 'RPT', 'Operational and financial reports.', []],
  ['administration', 'Administration', 'ADM', 'Users, roles, practice settings.', []],
];

const SUITES = [
  ['smoke', 'Smoke', 'Fast checks that the build is usable.'],
  ['sanity', 'Sanity', 'Focused checks after a small change.'],
  ['regression', 'Regression', 'Broad checks before release.'],
  ['release-critical', 'Release Critical', 'Must pass before any production release.'],
];

const ACCOUNTS = [
  ['account-a', 'Example Account A'],
  ['account-b', 'Example Account B'],
];

const base = (extra) => ({ version: 1, createdBy: 'mbr-dev-a', createdAt: SEED_TIME, updatedBy: 'mbr-dev-a', updatedAt: SEED_TIME, sample: true, ...extra });

export function buildSeedDocument() {
  const doc = emptyDocument();
  doc.members = MEMBERS.map(([mid, name, role]) => base({ id: `mbr-${mid}`, memberId: mid, displayName: name, role, active: true, placeholder: true }));
  doc.accounts = ACCOUNTS.map(([id, name]) => base({ id: `acct-${id}`, name, description: 'Editable example account label.' }));
  doc.testSuites = SUITES.map(([id, name, description]) => base({ id: `suite-${id}`, name, description }));
  doc.modules = MODULES.map(([id, name, keyPrefix, description], i) => base({
    id: `mod-${id}`, name, keyPrefix, description, ownerId: i < 2 ? 'mbr-dev-b' : '', targetCases: null, archived: false, order: i,
  }));
  doc.features = MODULES.flatMap(([mid, , , , feats]) => feats.map((name, i) => base({
    id: `feat-${mid}-${name.toLowerCase().replace(/\s+/g, '-')}`, moduleId: `mod-${mid}`, name, description: '', ownerId: '', archived: false, order: i,
  })));

  doc.testCases = [
    normalizeCase(base({
      id: 'case-demo-auth-001',
      caseKey: 'AUTH-001',
      title: '[Demo] Valid user can log in',
      moduleId: 'mod-authentication',
      featureId: 'feat-authentication-login',
      objective: 'A registered user with valid credentials reaches the home dashboard after signing in.',
      description: 'Demonstration case — replace or delete once real coverage is documented.',
      preconditions: 'A synthetic test user exists in the QA environment. Use credentials from the team secret store; never write them here.',
      steps: [
        { action: 'Open the login page.', expected: 'Login form shows username and password fields.' },
        { action: 'Enter the synthetic test user\'s username and password.', expected: 'Fields accept input; password is masked.' },
        { action: 'Select "Sign in".', expected: 'User is redirected to the home dashboard and their display name is shown.' },
      ],
      expectedResult: 'User is authenticated and lands on the dashboard without errors.',
      priority: 'Critical',
      status: 'Approved',
      testLevel: 'E2E',
      suites: ['suite-smoke', 'suite-regression'],
      automationStatus: 'Planned',
      tags: ['demo', 'login'],
      assignedTo: 'mbr-dev-d',
      reviewedBy: 'mbr-dev-b',
      reviewedAt: SEED_TIME,
      testDataNotes: 'Synthetic user only.',
      demo: true,
    })),
    normalizeCase(base({
      id: 'case-demo-pat-001',
      caseKey: 'PAT-001',
      title: '[Demo] Required patient fields are validated',
      moduleId: 'mod-patients',
      featureId: 'feat-patients-create-patient',
      objective: 'The Create Patient form blocks submission and explains which required fields are missing.',
      description: 'Demonstration case — replace or delete once real coverage is documented.',
      preconditions: 'Signed in as a synthetic front-desk user.',
      steps: [
        { action: 'Open Patients → Create Patient.', expected: 'Empty patient form is displayed.' },
        { action: 'Leave first name, last name and date of birth empty and select "Save".', expected: 'Form is not submitted; each required field shows an inline error.' },
        { action: 'Fill in the required fields with synthetic values and save.', expected: 'Patient is created and a confirmation is shown.' },
      ],
      expectedResult: 'Required-field validation prevents incomplete patient records.',
      priority: 'High',
      status: 'Draft',
      testLevel: 'UI',
      suites: ['suite-regression'],
      automationStatus: 'Not Planned',
      tags: ['demo', 'validation'],
      assignedTo: 'mbr-dev-e',
      testDataNotes: 'Use obviously fake names such as "Test Patient". No real patient data.',
      demo: true,
    })),
  ];

  doc.activity = doc.testCases.map((tc) => ({
    eventId: `evt-seed-${tc.id}`,
    entityType: 'testCase',
    entityId: tc.id,
    entityLabel: tc.caseKey,
    moduleId: tc.moduleId,
    action: 'create',
    actorId: 'mbr-dev-a',
    timestamp: SEED_TIME,
    changedFields: [],
    note: 'Demonstration case seeded on first launch.',
  }));
  doc.schemaVersion = SCHEMA_VERSION;
  return doc;
}
