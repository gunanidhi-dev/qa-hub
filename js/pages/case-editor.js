import { h, icon, clone, isEqual, debounce, fmtRelative } from '../utils.js';
import { PRIORITIES, CASE_STATUSES, TEST_LEVELS, AUTOMATION_STATUSES, RISKS, CASE_CONTENT_FIELDS, blankCase, normalizeCase, LIMITS } from '../schema.js';
import { card, field, fieldError, select, showErrors, banner, emptyState } from '../components/ui.js';
import { toast, toastError } from '../components/toast.js';

// The editor manages its own state; a store change from another tab must not wipe inputs.
export const keepAliveOnChange = true;

const editable = (tc) => {
  const out = {};
  for (const f of [...CASE_CONTENT_FIELDS, 'caseKey']) out[f] = clone(tc[f]);
  return out;
};

export function render(ctx) {
  const { store, root, params, query, setCrumbs, router } = ctx;
  const isEdit = Boolean(params.id);
  const existing = isEdit ? store.get('testCases', params.id) : null;
  const source = !isEdit && query.from ? store.get('testCases', query.from) : null;

  if (!store.can('case.edit')) {
    setCrumbs([{ label: 'Test Cases', href: '#/cases' }, { label: isEdit ? 'Edit' : 'New case' }]);
    root.append(card({ body: emptyState({ iconName: 'user', title: 'Your profile cannot edit cases', text: `Role: ${store.actor()?.role || 'none'}. Roles are a convenience setting; switch profile if you should be editing.`, action: h('button', { type: 'button', class: 'btn', onClick: () => ctx.profilePicker({ switching: true }) }, 'Switch profile') }) }));
    return;
  }
  if (isEdit && (!existing || existing.deletedAt)) {
    setCrumbs([{ label: 'Test Cases', href: '#/cases' }, { label: 'Edit' }]);
    root.append(card({ body: emptyState({ iconName: 'alert', title: existing ? 'This case is in the trash' : 'Case not found', text: existing ? 'Restore it before editing.' : '', action: h('a', { class: 'btn', href: existing ? `#/cases/${existing.id}` : '#/cases' }, 'Back') }) }));
    return;
  }

  // ---- initial model ----
  let initial;
  if (existing) initial = editable(normalizeCase(existing));
  else if (source) {
    initial = editable(normalizeCase(source));
    Object.assign(initial, { caseKey: '', title: `Copy of ${source.title}`.slice(0, LIMITS.titleMax), status: 'Draft' });
  } else {
    initial = editable(blankCase());
    const mods = store.data.modules.filter((m) => !m.archived);
    initial.moduleId = query.module && store.get('modules', query.module) ? query.module : '';
    if (query.feature && store.get('features', query.feature)?.moduleId === initial.moduleId) initial.featureId = query.feature;
    if (!initial.moduleId && mods.length === 1) initial.moduleId = mods[0].id;
  }
  if (!initial.steps.length) initial.steps = [{ action: '', expected: '' }];
  let model = clone(initial);
  const draftKey = existing ? `case:${existing.id}` : source ? `case:new:from:${source.id}` : 'case:new';
  let saving = false;

  const mod = () => store.get('modules', model.moduleId);
  setCrumbs([
    { label: 'Test Cases', href: '#/cases' },
    ...(existing ? [{ label: mod()?.name || 'Module', href: `#/cases?module=${existing.moduleId}` }, { label: existing.caseKey, href: `#/cases/${existing.id}` }, { label: 'Edit' }] : [{ label: source ? `Duplicate ${source.caseKey}` : 'New case' }]),
  ]);

  const isDirty = () => !isEqual(normalizeForCompare(model), normalizeForCompare(initial));
  const dirtyIndicator = h('span', { class: 'row small muted', hidden: true }, h('span', { class: 'dirty-dot', 'aria-hidden': 'true' }), 'Unsaved changes');
  const saveDraft = debounce(() => {
    if (isDirty()) store.drafts.put(draftKey, { values: model, savedAt: new Date().toISOString(), baseVersion: existing?.version ?? null });
    else store.drafts.remove(draftKey);
  }, 500);
  const changed = () => {
    dirtyIndicator.hidden = !isDirty();
    saveDraft();
  };

  // ---- inputs ----
  const form = h('form', { novalidate: true, class: 'stack', 'aria-label': existing ? `Edit ${existing.caseKey}` : 'New test case' });
  const bindText = (name, el) => {
    el.name = name;
    el.value = model[name] ?? '';
    el.addEventListener('input', () => { model[name] = el.value; changed(); });
    return el;
  };
  const text = (name, attrs = {}) => bindText(name, h('input', { type: 'text', autocomplete: 'off', ...attrs }));
  const area = (name, rows = 3, attrs = {}) => bindText(name, h('textarea', { rows, ...attrs }));
  const pick = (name, options, onChange) => {
    const el = select(options, model[name], { name });
    el.addEventListener('change', () => { model[name] = el.value; onChange?.(); changed(); });
    return el;
  };
  const listInput = (name, placeholder) => {
    const el = h('input', { type: 'text', name, placeholder, autocomplete: 'off', value: (model[name] || []).join(', ') });
    el.addEventListener('input', () => { model[name] = el.value.split(',').map((t) => t.trim()).filter(Boolean); changed(); });
    return el;
  };
  const checks = (name, items) => h('div', { class: 'check-list', role: 'group' }, items.map((it) => {
    const cb = h('input', { type: 'checkbox', value: it.id, checked: model[name].includes(it.id) });
    cb.addEventListener('change', () => {
      const set = new Set(model[name]);
      if (cb.checked) set.add(it.id); else set.delete(it.id);
      model[name] = items.map((x) => x.id).filter((id) => set.has(id));
      changed();
    });
    return h('label', { class: 'check-pill' }, cb, it.name);
  }));

  const titleIn = text('title', { maxlength: LIMITS.titleMax, placeholder: 'e.g. Front desk can reschedule an appointment to another provider' });
  const modules = store.data.modules.filter((m) => !m.archived || m.id === model.moduleId);
  const featureSel = h('select', { name: 'featureId' });
  const keyIn = text('caseKey', { placeholder: 'Auto', style: { textTransform: 'uppercase' }, disabled: Boolean(existing) });
  const keyHint = h('div', { class: 'hint' });
  const refreshFeatures = () => {
    const feats = store.data.features.filter((f) => f.moduleId === model.moduleId && (!f.archived || f.id === model.featureId));
    if (!feats.some((f) => f.id === model.featureId)) model.featureId = '';
    featureSel.replaceChildren(
      h('option', { value: '' }, !model.moduleId ? 'Choose a module first' : feats.length ? 'Choose feature / operation' : 'No features (optional)'),
      ...feats.map((f) => h('option', { value: f.id, selected: f.id === model.featureId }, f.name)));
    featureSel.disabled = !feats.length;
    if (!existing) {
      let next = '';
      try { next = model.moduleId ? store.nextCaseKey(model.moduleId) : ''; } catch { /* no module */ }
      keyIn.placeholder = next || 'Auto';
      keyHint.textContent = next ? `Leave blank to use ${next}. Keys are never reused.` : 'Assigned from the module prefix.';
    } else keyHint.textContent = 'Keys are permanent so references in bugs, commits and scripts stay valid.';
  };
  featureSel.addEventListener('change', () => { model.featureId = featureSel.value; changed(); });
  const moduleSel = pick('moduleId', [{ value: '', label: 'Choose module' }, ...modules.map((m) => ({ value: m.id, label: m.name }))], refreshFeatures);
  refreshFeatures();

  const canApprove = store.can('case.review');
  const statusOpts = CASE_STATUSES.filter((s) => s !== 'Approved' || canApprove || initial.status === 'Approved');
  const members = store.data.members.filter((m) => m.active !== false || m.id === model.assignedTo);

  // ---- steps editor ----
  const stepsWrap = h('div', { class: 'steps-edit' });
  const renderSteps = (focusIndex = null, focusField = 'action') => {
    stepsWrap.replaceChildren(...model.steps.map((s, i) => {
      const a = h('textarea', { rows: 2, placeholder: 'Action — what the tester does', 'aria-label': `Step ${i + 1} action`, value: s.action });
      const e = h('textarea', { rows: 2, placeholder: 'Expected result for this step', 'aria-label': `Step ${i + 1} expected result`, value: s.expected });
      a.addEventListener('input', () => { model.steps[i].action = a.value; changed(); });
      e.addEventListener('input', () => { model.steps[i].expected = e.value; changed(); });
      e.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey) === false && ev.altKey) { ev.preventDefault(); addStep(i + 1); }
      });
      const move = (d) => {
        const j = i + d;
        if (j < 0 || j >= model.steps.length) return;
        [model.steps[i], model.steps[j]] = [model.steps[j], model.steps[i]];
        changed();
        renderSteps(j);
      };
      const tool = (label, ic, fn, disabled = false) => h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': `${label} step ${i + 1}`, title: label, disabled, onClick: fn }, icon(ic, 15));
      const row = h('div', { class: 'step-edit' },
        h('span', { class: 'step-num', 'aria-hidden': 'true' }, String(i + 1)), a, e,
        h('div', { class: 'step-tools' },
          tool('Move up', 'up', () => move(-1), i === 0),
          tool('Move down', 'down', () => move(1), i === model.steps.length - 1),
          tool('Remove', 'x', () => { model.steps.splice(i, 1); if (!model.steps.length) model.steps.push({ action: '', expected: '' }); changed(); renderSteps(Math.max(0, i - 1)); })));
      if (focusIndex === i) requestAnimationFrame(() => (focusField === 'expected' ? e : a).focus());
      return row;
    }));
  };
  const addStep = (at = model.steps.length) => {
    if (model.steps.length >= LIMITS.stepsMax) return toast(`Maximum ${LIMITS.stepsMax} steps`, { type: 'error' });
    model.steps.splice(at, 0, { action: '', expected: '' });
    changed();
    renderSteps(at);
  };
  renderSteps();

  // ---- layout ----
  const sec = (id, title, body, subtitle = '') => h('section', { class: 'card editor-section', id, 'aria-labelledby': `${id}-h` },
    h('div', { class: 'card-head' }, h('div', null, h('h2', { id: `${id}-h` }, title), subtitle && h('p', { class: 'muted small' }, subtitle))),
    h('div', { class: 'card-body' }, body));

  form.append(
    sec('basics', 'Basics', h('div', { class: 'form-grid' },
      field({ label: 'Title', input: titleIn, name: 'title', required: true, full: true, hint: `${LIMITS.titleMin}–${LIMITS.titleMax} characters. Describe the behaviour, not the steps.` }),
      field({ label: 'Module', input: moduleSel, name: 'moduleId', required: true }),
      field({ label: 'Feature / operation', input: featureSel, name: 'featureId' }),
      h('div', { class: 'field' }, h('label', { for: 'f-caseKey' }, 'Case key'), Object.assign(keyIn, { id: 'f-caseKey' }), keyHint, fieldError('caseKey')),
      field({ label: 'Priority', input: pick('priority', PRIORITIES), name: 'priority', required: true }),
      field({ label: 'Status', input: pick('status', statusOpts), name: 'status', required: true, hint: canApprove ? '' : 'Approval is done by a Maintainer/Admin from the case page.' }),
      field({ label: 'Test level', input: pick('testLevel', TEST_LEVELS), name: 'testLevel' }),
      field({ label: 'Objective / expected business behaviour', input: area('objective', 2, { placeholder: 'What must be true for the business when this passes?' }), name: 'objective', required: true, full: true }),
      field({ label: 'Description', input: area('description', 2), name: 'description', full: true }),
      field({ label: 'Preconditions', input: area('preconditions', 2, { placeholder: 'Roles, configuration, existing synthetic records…' }), name: 'preconditions', full: true }),
    )),
    sec('steps', 'Steps', h('div', { class: 'stack', style: { gap: '10px' } },
      stepsWrap,
      fieldError('steps'),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn btn-sm', onClick: () => addStep() }, icon('plus', 15), 'Add step'), h('span', { class: 'muted small' }, 'Tip: Alt+Enter in an expected result adds a step below.')),
      field({ label: 'Overall expected result', input: area('expectedResult', 2), name: 'expectedResult', full: true }),
    ), 'One action and its expected result per step.'),
    sec('classification', 'Classification', h('div', { class: 'form-grid' },
      h('div', { class: 'field full' }, h('span', { class: 'field-label', id: 'suites-label' }, 'Suites'), Object.assign(checks('suites', store.data.testSuites), { 'aria-labelledby': 'suites-label' }), fieldError('suites')),
      field({ label: 'Automation status', input: pick('automationStatus', AUTOMATION_STATUSES), name: 'automationStatus' }),
      field({ label: 'Automation script path', input: text('automationPath', { placeholder: 'tests/e2e/auth/login.spec.js' }), name: 'automationPath', hint: 'Repo-relative path, if automated.' }),
      field({ label: 'Tags', input: listInput('tags', 'comma separated, e.g. login, mfa'), name: 'tags' }),
      field({
        label: 'Assignee',
        input: Object.assign(pick('assignedTo', [{ value: '', label: 'Unassigned' }, ...members.map((m) => ({ value: m.id, label: `${m.displayName} (${m.role})` }))]), { disabled: !store.can('case.assign') }),
        name: 'assignedTo',
        hint: store.can('case.assign') ? undefined : 'Only an Admin assigns cases.',
      }),
      store.data.accounts.length ? h('div', { class: 'field full' }, h('span', { class: 'field-label', id: 'acc-label' }, 'Accounts'), Object.assign(checks('accountIds', store.data.accounts), { 'aria-labelledby': 'acc-label' }), fieldError('accountIds')) : null,
    )),
    sec('references', 'References & test data', h('div', { class: 'form-grid' },
      field({ label: 'Requirement reference', input: text('requirementRef', { placeholder: 'e.g. JIRA-1234 or spec section' }), name: 'requirementRef' }),
      field({ label: 'Bug references', input: listInput('bugRefs', 'comma separated'), name: 'bugRefs' }),
      field({ label: 'Risk', input: pick('risk', RISKS.map((r) => ({ value: r, label: r || 'Not set' }))), name: 'risk' }),
      field({ label: 'Test data notes', input: area('testDataNotes', 2, { placeholder: 'Describe synthetic data to use. Never real patient data or credentials.' }), name: 'testDataNotes', full: true }),
      h('div', { class: 'full' }, banner('warn', 'Use synthetic data only. Do not paste patient information, passwords, API tokens or payment details into any field.')),
    )),
  );

  const formError = h('div', { dataset: { error: '_form' }, hidden: true, class: 'banner banner-danger', role: 'alert' });
  const draftBanner = h('div');
  const saveBtn = h('button', { type: 'submit', class: 'btn btn-primary' }, icon('check', 16), existing ? 'Save changes' : 'Create case');
  const saveNewBtn = !existing ? h('button', { type: 'button', class: 'btn', onClick: () => save({ andNew: true }) }, 'Create & add another') : null;
  const cancelBtn = h('a', { class: 'btn btn-ghost', href: existing ? `#/cases/${existing.id}` : '#/cases' }, 'Cancel');
  form.append(h('div', { class: 'editor-actions' }, saveBtn, saveNewBtn, cancelBtn, h('span', { class: 'spacer' }), dirtyIndicator, h('span', { class: 'muted small hide-sm' }, h('kbd', null, 'Ctrl'), ' + ', h('kbd', null, 'S'), ' to save')));
  form.addEventListener('submit', (e) => { e.preventDefault(); save(); });

  root.append(
    h('div', { class: 'page-head' }, h('div', null,
      h('h1', null, existing ? `Edit ${existing.caseKey}` : source ? `Duplicate ${source.caseKey}` : 'New test case'),
      h('p', null, existing ? `Version ${existing.version}. Changes are recorded field by field in the case history.` : 'Required fields are marked *. A local draft is kept while you type.'))),
    draftBanner, formError, form,
  );

  async function save({ andNew = false } = {}) {
    if (saving) return;
    saving = true;
    saveBtn.disabled = true;
    showErrors(form.parentElement, {});
    try {
      const payload = { ...model, steps: model.steps };
      const rec = existing
        ? await store.updateCase(existing.id, payload, { expectedVersion: existing.version })
        : await store.createCase(payload, { duplicatedFrom: source?.id || null });
      saveDraft.cancel();
      await store.drafts.remove(draftKey);
      initial = clone(model);
      dirtyIndicator.hidden = true;
      if (existing && rec === existing) toast('No changes to save');
      else toast(existing ? `${rec.caseKey} saved` : `${rec.caseKey} created`);
      if (andNew) router.go('/cases/new', { module: rec.moduleId, feature: rec.featureId }, { replace: true });
      else router.go(`/cases/${rec.id}`);
    } catch (e) {
      if (e.errors) {
        showErrors(form.parentElement, Object.keys(e.errors).length ? e.errors : { _form: e.message });
        if (Object.keys(e.errors).length) {
          formError.hidden = false;
          formError.textContent = `${e.message} (${Object.keys(e.errors).length} issue${Object.keys(e.errors).length > 1 ? 's' : ''})`;
        }
      } else if (e.name === 'ConflictError') {
        formError.hidden = false;
        formError.textContent = `${e.message} Your edits are kept as a local draft.`;
        formError.scrollIntoView({ block: 'center' });
        saveDraft.flush();
      } else toastError(e);
    } finally {
      saving = false;
      saveBtn.disabled = false;
    }
  }

  ctx.registerEditor({ isDirty, save: () => save() });

  // ---- draft recovery ----
  store.drafts.get(draftKey).then((draft) => {
    if (!draft?.values || isEqual(normalizeForCompare(draft.values), normalizeForCompare(initial))) return;
    const stale = existing && draft.baseVersion !== null && draft.baseVersion !== existing.version;
    draftBanner.replaceChildren(h('div', { style: { marginBottom: '16px' } }, banner(stale ? 'warn' : 'info', [
      h('strong', null, `Unsaved draft from ${fmtRelative(draft.savedAt)} found.`),
      stale ? h('span', null, `It was started from version ${draft.baseVersion}; the case is now version ${existing.version}. Restoring may overwrite newer changes.`) : null,
      h('div', { class: 'row', style: { marginTop: '6px' } },
        h('button', { type: 'button', class: 'btn btn-sm btn-primary', onClick: () => { model = { ...clone(initial), ...clone(draft.values) }; draftBanner.replaceChildren(); rerenderForm(); } }, 'Restore draft'),
        h('button', { type: 'button', class: 'btn btn-sm', onClick: () => { store.drafts.remove(draftKey); draftBanner.replaceChildren(); } }, 'Discard draft')),
    ])));
  });

  function rerenderForm() {
    // Simplest correct approach: push model values into controls.
    for (const el of form.querySelectorAll('input[name], textarea[name], select[name]')) {
      const v = model[el.name];
      if (el.name === 'featureId') continue;
      if (Array.isArray(v)) el.value = v.join(', ');
      else if (v !== undefined) el.value = v ?? '';
    }
    for (const cb of form.querySelectorAll('.check-list input[type=checkbox]')) {
      cb.checked = model.suites.includes(cb.value) || model.accountIds.includes(cb.value);
    }
    refreshFeatures();
    renderSteps();
    changed();
  }

  if (!existing) requestAnimationFrame(() => titleIn.focus());
  return () => saveDraft.flush();
}

function normalizeForCompare(m) {
  const x = clone(m);
  x.steps = (x.steps || []).filter((s) => (s.action || '').trim() || (s.expected || '').trim());
  for (const k of Object.keys(x)) if (typeof x[k] === 'string') x[k] = x[k].trim();
  return x;
}
