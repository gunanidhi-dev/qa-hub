// Rules that turn a written test case into QA Hub metadata: suites (categories), priority,
// test level, risk and tags. Used by scripts/import-markdown.js. Pure functions, no DOM.
//
// Suites are categories that answer "when do I run this?":
//   Smoke            – the screen opens; run on every deploy (minutes)
//   Sanity           – one happy path per operation; run after a small change
//   Regression       – everything; run before a release
//   Negative         – invalid input, missing data, wrong state
//   Boundary         – limits, rounding, partial amounts, file sizes
//   Tenant Isolation – Company A must never see or change Company B data
//   Security         – authentication, access control, injection, XSS
//   Integration      – external services fail, time out or decline
//   End-to-End       – business flows across modules
//   Data Integrity   – what is actually stored in the database
//   Admin Features   – screens only an administrator uses: users, roles, companies, settings, setup, billing
//   Release Critical – must pass before production (login, money, isolation)

export const SUITES = [
  ['smoke', 'Smoke', 'Screen opens and loads. Run on every deploy; should take minutes.'],
  ['sanity', 'Sanity', 'One happy path per operation. Run after a small change or hotfix.'],
  ['regression', 'Regression', 'The full library. Run before every release.'],
  ['negative', 'Negative', 'Invalid input, missing fields, wrong state, deleted records.'],
  ['boundary', 'Boundary', 'Maximum lengths, size limits, zero/over-limit amounts, rounding.'],
  ['tenant-isolation', 'Tenant Isolation', 'Company A can never see or change Company B data.'],
  ['security', 'Security', 'Authentication, access control, injection, XSS, private data.'],
  ['integration', 'Integration', 'External services fail, time out or return unexpected data.'],
  ['e2e', 'End-to-End', 'Business flows that cross several modules.'],
  ['data-integrity', 'Data Integrity', 'Database checks: balances, encryption, links, logs.'],
  ['admin', 'Admin Features', 'Admin-only screens: users, roles and access, companies, settings, practice setup, subscription billing.'],
  ['release-critical', 'Release Critical', 'Must pass before any production release.'],
];

const ADMIN_MODULES = new Set(['users-companies-settings', 'practice-setup', 'practice-subscription-billing']);
const ADMIN_TEXT = /\badmin|\brole|permission|access level|full access|limited access|user management|help center|registration setting|office setting|practice setting/i;

const MONEY_MODULES = new Set(['ledger-charges-claims', 'payments-invoices-ar', 'practice-subscription-billing']);

/** Scenario = text after the em dash in "Operation — scenario". */
const SCENARIOS = [
  { re: /opens and loads its data/i, kind: 'smoke', suites: ['smoke', 'regression'], priority: 'High', tag: 'page-load' },
  { re: /saves with valid details|shows the correct data|deletes the record$|switches on and off|full amount|valid file uploads|output has the correct data/i, kind: 'happy', suites: ['sanity', 'regression'], priority: 'High', tag: 'happy-path' },
  { re: /cannot (see|create|change|delete|touch|upload)[^—]*another company|contains only own company/i, kind: 'tenant', suites: ['tenant-isolation', 'security', 'regression', 'release-critical'], priority: 'Critical', tag: 'tenant-isolation', level: 'Security', risk: 'High' },
  { re: /external service|declines or fails|fails or times out/i, kind: 'integration', suites: ['integration', 'regression'], priority: 'High', tag: 'external-service', level: 'Integration', risk: 'Medium' },
  { re: /maximum length|size limit|zero and over-limit|round correctly|partial amount/i, kind: 'boundary', suites: ['boundary', 'regression'], priority: 'Medium', tag: 'boundary' },
  { re: /rejected|invalid|missing|wrong file type|fake file|empty or broken|already deleted|not allowed|no data/i, kind: 'negative', suites: ['negative', 'regression'], priority: 'Medium', tag: 'negative' },
];

const MODULE_RULES = {
  login: { suites: ['security', 'regression'], level: 'Security', priority: 'High', risk: 'High', tag: 'auth' },
  security: { suites: ['security', 'regression', 'release-critical'], level: 'Security', priority: 'Critical', risk: 'High', tag: 'security' },
  'end-to-end-flows': { suites: ['e2e', 'regression', 'release-critical'], level: 'E2E', priority: 'High', risk: 'High', tag: 'e2e' },
  'data-checks': { suites: ['data-integrity', 'regression'], level: 'Database', priority: 'High', risk: 'High', tag: 'database' },
  'external-services': { suites: ['integration', 'regression'], level: 'Integration', priority: 'High', risk: 'Medium', tag: 'external-service' },
};

const PRIO_ORDER = ['Critical', 'High', 'Medium', 'Low'];
const higher = (a, b) => (PRIO_ORDER.indexOf(a) <= PRIO_ORDER.indexOf(b) ? a : b);
const slug = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export function classifyCase({ moduleStem, featureName, title, steps = [] }) {
  const [operation, scenarioText = ''] = title.split(/\s+—\s+/);
  const scenario = SCENARIOS.find((s) => s.re.test(scenarioText || title));
  const modRule = MODULE_RULES[moduleStem];
  const suites = new Set();
  const tags = new Set();
  let priority = 'Medium';
  let testLevel = 'UI';
  let risk = '';

  if (modRule) {
    modRule.suites.forEach((s) => suites.add(s));
    testLevel = modRule.level;
    priority = modRule.priority;
    risk = modRule.risk;
    tags.add(modRule.tag);
  }
  if (scenario) {
    scenario.suites.forEach((s) => suites.add(s));
    priority = modRule ? higher(priority, scenario.priority) : scenario.priority;
    if (scenario.level && !modRule) testLevel = scenario.level;
    if (scenario.risk) risk = risk || scenario.risk;
    tags.add(scenario.tag);
  }
  suites.add('regression');

  const text = `${title} ${steps.map((s) => `${s.action} ${s.expected}`).join(' ')}`;
  const crossTenant = /company b/i.test(text);
  if (crossTenant) { suites.add('tenant-isolation'); tags.add('tenant-isolation'); }

  // Money: happy paths and rounding are release-critical.
  if (MONEY_MODULES.has(moduleStem)) {
    tags.add('money');
    risk = risk || 'High';
    if (scenario?.kind === 'happy' || /round correctly/i.test(title)) { suites.add('release-critical'); priority = higher(priority, 'High'); }
  }
  if (moduleStem === 'login' && /correct email and passcode|^logout|session timeout|wrong passcode/i.test(title)) {
    suites.add('smoke'); suites.add('release-critical'); priority = 'Critical';
  }
  if (moduleStem === 'login') suites.add('smoke');
  if (suites.has('tenant-isolation')) { suites.add('release-critical'); priority = 'Critical'; risk = 'High'; }
  if (ADMIN_MODULES.has(moduleStem) || ADMIN_TEXT.test(`${featureName} ${title}`)) { suites.add('admin'); tags.add('admin'); }
  if (/upload|file/i.test(title)) tags.add('upload');
  if (/print|pdf|export|download/i.test(title)) tags.add('export');
  if (/sms|send .*mail|campaign|message/i.test(title)) tags.add('notification');
  if (featureName) tags.add(slug(featureName));

  const verb = scenario?.kind === 'negative' ? 'is handled safely when'
    : scenario?.kind === 'tenant' ? 'enforces company isolation:'
      : scenario?.kind === 'integration' ? 'recovers cleanly when'
        : scenario?.kind === 'boundary' ? 'respects limits:'
          : 'works:';
  const objective = scenarioText
    ? `Verify "${operation.trim()}" on ${featureName} ${verb} ${scenarioText.trim()}.`
    : `Verify ${title.trim()} (${featureName}).`;

  return {
    suites: [...suites],
    tags: [...tags].slice(0, 12),
    priority,
    testLevel,
    risk,
    crossTenant,
    objective,
    kind: scenario?.kind || modRule?.tag || 'general',
  };
}
