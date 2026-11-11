// Data shapes, enums and record factories for the portable JSON document.

export const SCHEMA_VERSION = 1;

export const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
export const COMPLETION_STATUSES = ['Pending', 'Completed'];
export const CASE_STATUSES = ['Draft', 'Ready for Review', 'Approved', 'Deprecated'];
export const TEST_LEVELS = ['Unit', 'API', 'Integration', 'E2E', 'UI', 'Database', 'Security', 'Performance', 'Other'];
export const AUTOMATION_STATUSES = ['Not Planned', 'Planned', 'In Progress', 'Automated', 'Not Applicable'];
export const ROLES = ['Admin', 'Maintainer', 'Contributor', 'Viewer'];
export const RISKS = ['', 'High', 'Medium', 'Low'];

/** Collections that hold records with stable `id`s (activity uses `eventId`). */
export const COLLECTIONS = ['members', 'accounts', 'modules', 'features', 'testCases', 'testSuites', 'testRuns', 'activity', 'deletedItems'];

export const ID_FIELD = { activity: 'eventId' };
export const idOf = (collection, record) => record?.[ID_FIELD[collection] || 'id'];

export const ENTITY_TYPE = {
  members: 'member',
  accounts: 'account',
  modules: 'module',
  features: 'feature',
  testCases: 'testCase',
  testSuites: 'testSuite',
  testRuns: 'testRun',
};

export const LIMITS = {
  titleMin: 5,
  titleMax: 200,
  nameMax: 80,
  textMax: 10000,
  stepsMax: 100,
  tagsMax: 30,
};

export function emptyDocument(projectName = 'Healthcare QA Hub') {
  return {
    schemaVersion: SCHEMA_VERSION,
    project: { id: 'qa-hub', name: projectName },
    members: [],
    accounts: [],
    modules: [],
    features: [],
    testCases: [],
    testSuites: [],
    testRuns: [],
    activity: [],
    deletedItems: [],
    exportedAt: null,
  };
}

/** Fields copied by duplicate / editable in the editor. */
export const CASE_CONTENT_FIELDS = [
  'title', 'moduleId', 'featureId', 'objective', 'description', 'preconditions', 'steps',
  'expectedResult', 'priority', 'status', 'testLevel', 'suites', 'automationStatus',
  'automationPath', 'tags', 'accountIds', 'assignedTo', 'requirementRef', 'bugRefs',
  'risk', 'testDataNotes', 'completionStatus',
];

export const FIELD_LABELS = {
  title: 'Title',
  caseKey: 'Case key',
  moduleId: 'Module',
  featureId: 'Feature',
  objective: 'Objective',
  description: 'Description',
  preconditions: 'Preconditions',
  steps: 'Steps',
  expectedResult: 'Expected result',
  priority: 'Priority',
  status: 'Status',
  completionStatus: 'Completion',
  testLevel: 'Test level',
  suites: 'Suites',
  automationStatus: 'Automation',
  automationPath: 'Automation path',
  tags: 'Tags',
  accountIds: 'Accounts',
  assignedTo: 'Assignee',
  requirementRef: 'Requirement ref',
  bugRefs: 'Bug refs',
  risk: 'Risk',
  testDataNotes: 'Test data notes',
  reviewedBy: 'Reviewed by',
  reviewedAt: 'Reviewed at',
  name: 'Name',
  keyPrefix: 'Key prefix',
  ownerId: 'Owner',
  targetCases: 'Target cases',
  archived: 'Archived',
  role: 'Role',
  memberId: 'Team member ID',
  displayName: 'Display name',
  active: 'Active',
  deletedAt: 'Deleted at',
  deletionReason: 'Deletion reason',
};

export function blankCase() {
  return {
    id: null,
    caseKey: '',
    title: '',
    moduleId: '',
    featureId: '',
    objective: '',
    description: '',
    preconditions: '',
    steps: [{ action: '', expected: '' }],
    expectedResult: '',
    priority: 'Medium',
    status: 'Draft',
    completionStatus: 'Pending',
    testLevel: 'E2E',
    suites: [],
    automationStatus: 'Not Planned',
    automationPath: '',
    tags: [],
    accountIds: [],
    assignedTo: '',
    requirementRef: '',
    bugRefs: [],
    risk: '',
    testDataNotes: '',
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: '',
    version: 0,
    createdBy: null,
    createdAt: null,
    updatedBy: null,
    updatedAt: null,
    deletedAt: null,
    deletedBy: null,
    deletionReason: '',
  };
}

/** Normalise a test case loaded from storage/import so missing optional fields get defaults. */
export function normalizeCase(tc) {
  const base = blankCase();
  const out = { ...base, ...tc };
  for (const key of ['steps', 'suites', 'tags', 'accountIds', 'bugRefs']) {
    if (!Array.isArray(out[key])) out[key] = [];
  }
  out.steps = out.steps.map((s) => ({ action: String(s?.action ?? ''), expected: String(s?.expected ?? '') }));
  if (!out.featureId) out.featureId = '';
  if (!out.assignedTo) out.assignedTo = '';
  return out;
}
