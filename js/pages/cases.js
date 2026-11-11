import { h, icon, fmtRelative, fmtDate, debounce, prefs, downloadFile, plural, slug } from '../utils.js';
import { PRIORITIES, CASE_STATUSES, TEST_LEVELS, AUTOMATION_STATUSES } from '../schema.js';
import { casesToCsv } from '../import-export.js';
import {
  pageHead, priorityChip, statusChip, automationChip, suiteChip, person, emptyState, select, menu, lookups,
} from '../components/ui.js';
import { confirmDialog, formDialog } from '../components/modal.js';
import { toast, toastError } from '../components/toast.js';

const COLUMNS = [
  { key: 'caseKey', label: 'Key', sort: (c) => c.caseKey, always: true },
  { key: 'title', label: 'Title', sort: (c) => c.title.toLowerCase(), always: true },
  { key: 'priority', label: 'Priority', sort: (c) => PRIORITIES.indexOf(c.priority) },
  { key: 'status', label: 'Status', sort: (c) => CASE_STATUSES.indexOf(c.status) },
  { key: 'testLevel', label: 'Level', sort: (c) => c.testLevel || '' },
  { key: 'suites', label: 'Suites' },
  { key: 'automationStatus', label: 'Automation', sort: (c) => AUTOMATION_STATUSES.indexOf(c.automationStatus) },
  { key: 'assignedTo', label: 'Assignee', sort: null },
  { key: 'updatedAt', label: 'Updated', sort: (c) => c.updatedAt },
];
const DEFAULT_HIDDEN = ['testLevel'];
const FILTER_KEYS = ['q', 'module', 'feature', 'status', 'priority', 'level', 'suite', 'automation', 'assignee', 'account', 'tag'];

let selected = new Set();
let selectionScope = '';

/** Apply library filters; exported for reuse (dashboard links, CSV). */
export function filterCases(store, f) {
  const q = (f.q || '').trim().toLowerCase();
  const terms = q ? q.split(/\s+/) : [];
  return store.activeCases().filter((c) => {
    if (f.module && c.moduleId !== f.module) return false;
    if (f.feature && c.featureId !== f.feature) return false;
    if (f.status && c.status !== f.status) return false;
    if (f.priority && c.priority !== f.priority) return false;
    if (f.level && c.testLevel !== f.level) return false;
    if (f.suite && !c.suites.includes(f.suite)) return false;
    if (f.automation && c.automationStatus !== f.automation) return false;
    if (f.assignee === 'none' ? c.assignedTo : f.assignee && c.assignedTo !== f.assignee) return false;
    if (f.account && !c.accountIds.includes(f.account)) return false;
    if (f.tag && !c.tags.includes(f.tag)) return false;
    if (terms.length) {
      const hay = `${c.caseKey} ${c.title} ${c.objective} ${c.tags.join(' ')} ${c.requirementRef} ${c.bugRefs.join(' ')}`.toLowerCase();
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });
}

export function render(ctx) {
  const { store, root, setCrumbs, router } = ctx;
  const look = lookups(store);
  const canEdit = store.can('case.edit');
  const canBulk = store.can('case.bulk');
  const state = {
    f: Object.fromEntries(FILTER_KEYS.map((k) => [k, ctx.query[k] || ''])),
    sort: ctx.query.sort || 'caseKey',
    dir: ctx.query.dir || 'asc',
    page: Math.max(1, Number(ctx.query.page) || 1),
    size: Number(ctx.query.size) || prefs.get('pageSize', 25),
  };
  const hidden = new Set(prefs.get('hiddenColumns', DEFAULT_HIDDEN));
  const scope = JSON.stringify(state.f);
  if (scope !== selectionScope) { selected = new Set(); selectionScope = scope; }

  const mod = state.f.module ? store.get('modules', state.f.module) : null;
  const feat = state.f.feature ? store.get('features', state.f.feature) : null;
  setCrumbs([{ label: 'Test Cases', href: '#/cases' }, ...(mod ? [{ label: mod.name, href: `#/cases?module=${mod.id}` }] : []), ...(feat ? [{ label: feat.name }] : [])]);

  // ---- header ----
  const exportCsv = () => {
    const rows = sortCases(filterCases(store, state.f));
    downloadFile(`qa-hub-cases-${mod ? slug(mod.name) : 'all'}-${new Date().toISOString().slice(0, 10)}.csv`, casesToCsv(rows, look), 'text/csv');
    toast(`Exported ${plural(rows.length, 'case')} to CSV`);
  };
  root.append(pageHead({
    title: mod ? `${mod.name}${feat ? ` / ${feat.name}` : ''}` : 'Test Case Library',
    subtitle: mod?.description || 'Search, filter and manage documented test cases.',
    actions: [
      h('button', { type: 'button', class: 'btn', onClick: exportCsv }, icon('data', 16), 'Export CSV'),
      canEdit && h('a', { class: 'btn btn-primary', href: `#/cases/new${state.f.module ? `?module=${state.f.module}${state.f.feature ? `&feature=${state.f.feature}` : ''}` : ''}` }, icon('plus', 16), 'New case'),
    ],
  }));

  // ---- toolbar ----
  const search = h('input', { type: 'search', placeholder: 'Search key, title, objective, tags…', value: state.f.q, 'aria-label': 'Search cases', 'data-primary-search': '' });
  const mods = store.data.modules.filter((m) => !m.archived || m.id === state.f.module);
  const sel = (key, label, options) => {
    const s = select([{ value: '', label }, ...options], state.f[key], { 'aria-label': label });
    s.addEventListener('change', () => {
      state.f[key] = s.value;
      if (key === 'module') state.f.feature = '';
      state.page = 1;
      if (key === 'module') sync(true); else update();
    });
    return s;
  };
  const featureOpts = state.f.module ? store.data.features.filter((f) => f.moduleId === state.f.module && (!f.archived || f.id === state.f.feature)).map((f) => ({ value: f.id, label: f.name })) : [];
  const toolbar = h('div', { class: 'toolbar' },
    h('div', { class: 'search' }, icon('search', 16), search),
    sel('module', 'All modules', mods.map((m) => ({ value: m.id, label: m.name }))),
    featureOpts.length ? sel('feature', 'All features', featureOpts) : null,
    sel('status', 'Any status', CASE_STATUSES),
    sel('priority', 'Any priority', PRIORITIES),
    sel('suite', 'Any suite', store.data.testSuites.map((s) => ({ value: s.id, label: s.name }))),
    h('span', { class: 'spacer' }),
    menu(h('button', { type: 'button', class: 'btn btn-sm' }, icon('filter', 15), 'More filters'), () => [
      { node: moreFilters() },
    ], { label: 'More filters' }),
    savedFiltersMenu(),
    menu(h('button', { type: 'button', class: 'btn btn-sm btn-icon', 'aria-label': 'Choose columns', title: 'Columns' }, icon('columns', 16)), () => [
      { heading: 'Visible columns' },
      ...COLUMNS.filter((c) => !c.always).map((c) => ({
        node: h('label', { class: 'menu-item' }, h('input', {
          type: 'checkbox', checked: !hidden.has(c.key),
          onChange: (e) => { if (e.target.checked) hidden.delete(c.key); else hidden.add(c.key); prefs.set('hiddenColumns', [...hidden]); update(); },
        }), c.label),
      })),
    ]),
  );
  search.addEventListener('input', debounce(() => { state.f.q = search.value; state.page = 1; update(); }, 150));

  function moreFilters() {
    const wrap = h('div', { class: 'stack', style: { gap: '10px', padding: '6px', minWidth: '240px' } });
    const add = (key, label, options) => {
      const s = select([{ value: '', label: `Any ${label.toLowerCase()}` }, ...options], state.f[key], { 'aria-label': label });
      s.addEventListener('change', () => { state.f[key] = s.value; state.page = 1; update(); });
      wrap.append(h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), s));
    };
    add('level', 'Test level', TEST_LEVELS);
    add('automation', 'Automation', AUTOMATION_STATUSES);
    add('assignee', 'Assignee', [{ value: 'none', label: 'Unassigned' }, ...store.data.members.map((m) => ({ value: m.id, label: m.displayName }))]);
    add('account', 'Account', store.data.accounts.map((a) => ({ value: a.id, label: a.name })));
    const tags = [...new Set(store.activeCases().flatMap((c) => c.tags))].sort();
    add('tag', 'Tag', tags);
    return wrap;
  }

  function savedFiltersMenu() {
    return menu(h('button', { type: 'button', class: 'btn btn-sm' }, icon('star', 15), h('span', { class: 'hide-sm' }, 'Saved')), () => {
      const saved = prefs.get('savedFilters', []);
      return [
        { heading: 'Saved filters (this browser)' },
        ...(saved.length ? saved.map((s, i) => ({
          node: h('div', { class: 'row', style: { flexWrap: 'nowrap' } },
            h('button', { type: 'button', class: 'menu-item', role: 'menuitem', onClick: () => router.go('/cases', s.query) }, s.name),
            h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': `Delete saved filter ${s.name}`, onClick: () => { saved.splice(i, 1); prefs.set('savedFilters', saved); toast('Saved filter removed'); router.refresh(); } }, icon('x', 14))),
        })) : [{ node: h('p', { class: 'muted small', style: { padding: '4px 10px' } }, 'No saved filters yet.') }]),
        'sep',
        {
          label: 'Save current filters…', icon: 'plus',
          onClick: () => formDialog({
            title: 'Save filter', fields: [{ name: 'name', label: 'Name', required: true, full: true, placeholder: 'e.g. My critical drafts' }],
            onSubmit: ({ name }) => {
              if (!name.trim()) throw Object.assign(new Error('Name required'), { errors: { name: 'Give the filter a name.' } });
              const list = prefs.get('savedFilters', []);
              list.push({ name: name.trim(), query: queryFromState() });
              prefs.set('savedFilters', list);
              toast('Filter saved');
            },
          }),
        },
      ];
    }, { label: 'Saved filters' });
  }

  const chipsBar = h('div', { class: 'filter-chips', hidden: true });
  const bulkbar = h('div', { class: 'bulkbar', hidden: true, role: 'region', 'aria-label': 'Bulk actions' });
  const tableWrap = h('div', { class: 'table-wrap' });
  const pager = h('div', { class: 'pager' });
  const live = h('div', { class: 'sr-only', 'aria-live': 'polite' });
  root.append(h('section', { class: 'card' }, toolbar, chipsBar, bulkbar, tableWrap, pager), live);

  function queryFromState() {
    const q = { ...state.f };
    if (state.sort !== 'caseKey') q.sort = state.sort;
    if (state.dir !== 'asc') q.dir = state.dir;
    if (state.page > 1) q.page = state.page;
    return Object.fromEntries(Object.entries(q).filter(([, v]) => v));
  }

  function sync(full = false) {
    if (full) router.go('/cases', queryFromState(), { replace: true });
    else router.setQuery(queryFromState());
  }

  function sortCases(list) {
    const col = COLUMNS.find((c) => c.key === state.sort && c.sort) || COLUMNS[0];
    const dir = state.dir === 'desc' ? -1 : 1;
    return [...list].sort((a, b) => {
      const x = col.sort(a); const y = col.sort(b);
      if (state.sort === 'caseKey') return dir * String(x).localeCompare(String(y), undefined, { numeric: true });
      return dir * (x < y ? -1 : x > y ? 1 : 0) || a.caseKey.localeCompare(b.caseKey, undefined, { numeric: true });
    });
  }

  function renderChips() {
    const labels = {
      q: (v) => `“${v}”`, module: (v) => look.moduleName(v), feature: (v) => look.featureName(v), status: (v) => v, priority: (v) => v,
      level: (v) => v, suite: (v) => look.suiteName(v), automation: (v) => v, assignee: (v) => (v === 'none' ? 'Unassigned' : look.memberName(v)),
      account: (v) => look.accountName(v), tag: (v) => `#${v}`,
    };
    const active = FILTER_KEYS.filter((k) => state.f[k]);
    chipsBar.hidden = !active.length;
    chipsBar.replaceChildren(
      h('span', { class: 'muted small' }, 'Filters:'),
      ...active.map((k) => h('button', {
        type: 'button', class: 'chip chip-outline plain', 'aria-label': `Remove filter ${labels[k](state.f[k])}`,
        onClick: () => { state.f[k] = ''; if (k === 'module') state.f.feature = ''; state.page = 1; sync(true); },
      }, labels[k](state.f[k]), icon('x', 12))),
      h('button', { type: 'button', class: 'btn-link small', onClick: () => router.go('/cases', {}) }, 'Clear all'),
    );
  }

  function renderBulk(visibleIds) {
    bulkbar.hidden = !selected.size;
    if (!selected.size) return bulkbar.replaceChildren();
    const ids = [...selected];
    bulkbar.replaceChildren(...[
      h('span', null, `${plural(ids.length, 'case')} selected`),
      h('button', { type: 'button', class: 'btn-link small', onClick: () => { visibleIds.forEach((id) => selected.add(id)); update(); } }, 'Select page'),
      h('button', { type: 'button', class: 'btn-link small', onClick: () => { filterCases(store, state.f).forEach((c) => selected.add(c.id)); update(); } }, 'Select all matching'),
      h('span', { class: 'spacer' }),
      canBulk && h('button', { type: 'button', class: 'btn btn-sm', onClick: () => bulkEdit(ids) }, icon('edit', 15), 'Bulk edit'),
      h('button', {
        type: 'button', class: 'btn btn-sm', onClick: () => {
          const rows = sortCases(store.activeCases().filter((c) => selected.has(c.id)));
          downloadFile(`qa-hub-selected-${new Date().toISOString().slice(0, 10)}.csv`, casesToCsv(rows, look), 'text/csv');
        },
      }, 'CSV'),
      canBulk && h('button', { type: 'button', class: 'btn btn-sm', onClick: () => bulkDelete(ids) }, icon('trash', 15), 'Move to trash'),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => { selected.clear(); update(); } }, 'Clear'),
    ].filter(Boolean));
  }

  async function bulkEdit(ids) {
    const keep = { value: '', label: '— no change —' };
    const suites = store.data.testSuites.map((s) => ({ value: s.id, label: s.name }));
    const statusOpts = CASE_STATUSES.filter((s) => s !== 'Approved' || store.can('case.review'));
    await formDialog({
      title: `Bulk edit ${plural(ids.length, 'case')}`,
      description: `Changes apply to exactly ${plural(ids.length, 'selected case')}. Each change is recorded in that case's history.`,
      wide: true,
      fields: [
        { name: 'status', label: 'Status', type: 'select', options: [keep, ...statusOpts.map((s) => ({ value: s, label: s }))] },
        { name: 'priority', label: 'Priority', type: 'select', options: [keep, ...PRIORITIES.map((s) => ({ value: s, label: s }))] },
        { name: 'testLevel', label: 'Test level', type: 'select', options: [keep, ...TEST_LEVELS.map((s) => ({ value: s, label: s }))] },
        { name: 'automationStatus', label: 'Automation', type: 'select', options: [keep, ...AUTOMATION_STATUSES.map((s) => ({ value: s, label: s }))] },
        store.can('case.assign') && { name: 'assignedTo', label: 'Assignee', type: 'select', options: [keep, { value: '__none', label: 'Unassigned' }, ...store.data.members.filter((m) => m.active !== false).map((m) => ({ value: m.id, label: m.displayName }))] },
        { name: 'addSuite', label: 'Add to suite', type: 'select', options: [keep, ...suites] },
        { name: 'removeSuite', label: 'Remove from suite', type: 'select', options: [keep, ...suites] },
        { name: 'addTags', label: 'Add tags', placeholder: 'comma separated' },
        { name: 'removeTags', label: 'Remove tags', placeholder: 'comma separated' },
      ].filter(Boolean),
      submitLabel: `Apply to ${ids.length}`,
      onSubmit: async (v) => {
        const tags = (s) => s.split(',').map((t) => t.trim()).filter(Boolean);
        const patch = {};
        for (const k of ['status', 'priority', 'testLevel', 'automationStatus']) if (v[k]) patch[k] = v[k];
        if (v.assignedTo) patch.assignedTo = v.assignedTo === '__none' ? '' : v.assignedTo;
        if (v.addSuite) patch.addSuites = [v.addSuite];
        if (v.removeSuite) patch.removeSuites = [v.removeSuite];
        if (tags(v.addTags).length) patch.addTags = tags(v.addTags);
        if (tags(v.removeTags).length) patch.removeTags = tags(v.removeTags);
        if (!Object.keys(patch).length) throw Object.assign(new Error('Nothing to change'), { errors: { _form: 'Choose at least one change.' } });
        try {
          const n = await store.bulkUpdateCases(ids, patch);
          selected.clear();
          toast(n ? `Updated ${plural(n, 'case')}` : 'No cases needed changes');
        } catch (e) {
          if (e.errors) throw Object.assign(e, { errors: { _form: e.message, ...e.errors } });
          toastError(e);
        }
      },
    });
  }

  async function bulkDelete(ids) {
    const ok = await confirmDialog({
      title: `Move ${plural(ids.length, 'case')} to trash?`,
      message: 'They will be hidden from the library and dashboard. You can restore them from Trash.',
      confirmLabel: `Move ${ids.length} to trash`, danger: true,
      reason: { label: 'Reason', placeholder: 'e.g. Superseded by new login flow', required: true },
    });
    if (!ok) return;
    try {
      const n = await store.softDeleteCases(ids, ok.reason);
      selected.clear();
      toast(`Moved ${plural(n, 'case')} to trash`, { action: { label: 'Undo', onClick: () => Promise.all(ids.map((id) => store.restoreCase(id))).catch(toastError) } });
    } catch (e) { toastError(e); }
  }

  function rowMenu(c) {
    return menu(null, [
      { label: 'Open', icon: 'file', onClick: () => router.go(`/cases/${c.id}`) },
      canEdit && { label: 'Edit', icon: 'edit', onClick: () => router.go(`/cases/${c.id}/edit`) },
      canEdit && { label: 'Duplicate', icon: 'copy', onClick: () => router.go('/cases/new', { from: c.id }) },
      canEdit && 'sep',
      canEdit && {
        label: 'Move to trash', icon: 'trash', danger: true, onClick: async () => {
          const ok = await confirmDialog({ title: `Move ${c.caseKey} to trash?`, message: c.title, confirmLabel: 'Move to trash', danger: true, reason: { label: 'Reason (optional)' } });
          if (!ok) return;
          try {
            await store.softDeleteCases([c.id], ok.reason);
            toast(`${c.caseKey} moved to trash`, { action: { label: 'Undo', onClick: () => store.restoreCase(c.id).catch(toastError) } });
          } catch (e) { toastError(e); }
        },
      },
    ], { label: `Actions for ${c.caseKey}` });
  }

  function update() {
    const all = sortCases(filterCases(store, state.f));
    const pages = Math.max(1, Math.ceil(all.length / state.size));
    state.page = Math.min(state.page, pages);
    const pageRows = all.slice((state.page - 1) * state.size, state.page * state.size);
    renderChips();
    renderBulk(pageRows.map((c) => c.id));
    sync();
    live.textContent = `${plural(all.length, 'case')} found`;

    if (!all.length) {
      const anyFilter = FILTER_KEYS.some((k) => state.f[k]);
      tableWrap.replaceChildren(emptyState(anyFilter
        ? { iconName: 'search', title: 'No cases match these filters', text: 'Try removing a filter or searching for something else.', action: h('button', { type: 'button', class: 'btn', onClick: () => router.go('/cases', {}) }, 'Clear filters') }
        : { iconName: 'cases', title: 'No test cases yet', text: 'Document your first case — it takes about a minute.', action: canEdit && h('a', { class: 'btn btn-primary', href: '#/cases/new' }, icon('plus', 16), 'New case') }));
      pager.replaceChildren();
      return;
    }

    const cols = COLUMNS.filter((c) => c.always || !hidden.has(c.key));
    const allOnPage = pageRows.every((c) => selected.has(c.id));
    const headCheck = h('input', { type: 'checkbox', 'aria-label': 'Select all cases on this page', checked: allOnPage && pageRows.length > 0 });
    headCheck.indeterminate = !allOnPage && pageRows.some((c) => selected.has(c.id));
    headCheck.addEventListener('change', () => { pageRows.forEach((c) => (headCheck.checked ? selected.add(c.id) : selected.delete(c.id))); update(); });

    const thead = h('thead', null, h('tr', null,
      h('th', { class: 'col-check', scope: 'col' }, headCheck),
      cols.map((c) => h('th', { scope: 'col', 'aria-sort': state.sort === c.key ? (state.dir === 'asc' ? 'ascending' : 'descending') : undefined },
        c.sort ? h('button', {
          type: 'button', class: 'sort', onClick: () => {
            if (state.sort === c.key) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
            else { state.sort = c.key; state.dir = c.key === 'updatedAt' ? 'desc' : 'asc'; }
            update();
          },
        }, c.label) : c.label)),
      h('th', { class: 'col-actions', scope: 'col' }, h('span', { class: 'sr-only' }, 'Actions'))));

    const cell = (c, key) => {
      switch (key) {
        case 'caseKey': return h('td', { 'data-label': 'Key' }, h('span', { class: 'key' }, c.caseKey));
        case 'title': return h('td', { class: 'title-cell' },
          h('a', { href: `#/cases/${c.id}` }, c.title),
          c.demo ? h('span', { class: 'chip chip-demo plain', style: { marginLeft: '6px' } }, 'Demo') : null,
          h('div', { class: 'sub' }, [look.moduleName(c.moduleId), look.featureName(c.featureId)].filter(Boolean).join(' / ')));
        case 'priority': return h('td', { 'data-label': 'Priority' }, priorityChip(c.priority));
        case 'status': return h('td', { 'data-label': 'Status' }, statusChip(c.status));
        case 'testLevel': return h('td', { 'data-label': 'Level' }, c.testLevel || '—');
        case 'suites': return h('td', { 'data-label': 'Suites' }, c.suites.length ? h('div', { class: 'chips' }, c.suites.map((s) => suiteChip(look.suiteName(s)))) : h('span', { class: 'muted' }, '—'));
        case 'automationStatus': return h('td', { 'data-label': 'Automation' }, automationChip(c.automationStatus));
        case 'assignedTo': return h('td', { 'data-label': 'Assignee' }, person(store.get('members', c.assignedTo)));
        case 'updatedAt': return h('td', { 'data-label': 'Updated', class: 'nowrap muted small', title: fmtDate(c.updatedAt) }, fmtRelative(c.updatedAt));
        default: return h('td');
      }
    };

    const tbody = h('tbody', null, pageRows.map((c) => {
      const check = h('input', { type: 'checkbox', 'aria-label': `Select ${c.caseKey}`, checked: selected.has(c.id) });
      check.addEventListener('change', () => { if (check.checked) selected.add(c.id); else selected.delete(c.id); update(); });
      return h('tr', { class: selected.has(c.id) ? 'selected' : '' },
        h('td', { class: 'col-check' }, check),
        cols.map((col) => cell(c, col.key)),
        h('td', { class: 'col-actions' }, h('div', { class: 'row-actions' },
          canEdit && h('a', { class: 'btn btn-ghost btn-icon btn-sm', href: `#/cases/${c.id}/edit`, 'aria-label': `Edit ${c.caseKey}`, title: 'Edit' }, icon('edit', 15)),
          rowMenu(c))));
    }));
    tableWrap.replaceChildren(h('table', { class: 'table cards' }, h('caption', { class: 'sr-only' }, 'Test cases'), thead, tbody));

    const sizeSel = select(['25', '50', '100', '200'], String(state.size), { 'aria-label': 'Rows per page' });
    sizeSel.addEventListener('change', () => { state.size = Number(sizeSel.value); prefs.set('pageSize', state.size); state.page = 1; update(); });
    const start = (state.page - 1) * state.size + 1;
    pager.replaceChildren(
      h('span', null, `${start}–${start + pageRows.length - 1} of ${plural(all.length, 'case')}`),
      h('div', { class: 'row' },
        h('label', { class: 'row small' }, 'Rows', sizeSel),
        h('button', { type: 'button', class: 'btn btn-sm btn-icon', disabled: state.page <= 1, 'aria-label': 'Previous page', onClick: () => { state.page -= 1; update(); tableWrap.scrollTop = 0; } }, icon('chevronLeft', 16)),
        h('span', null, `Page ${state.page} / ${pages}`),
        h('button', { type: 'button', class: 'btn btn-sm btn-icon', disabled: state.page >= pages, 'aria-label': 'Next page', onClick: () => { state.page += 1; update(); tableWrap.scrollTop = 0; } }, icon('chevronRight', 16))),
    );
  }

  update();
  if (ctx.query.q) search.focus();
}
