import { h, icon, fmtRelative } from '../utils.js';
import { PRIORITIES, CASE_STATUSES, TEST_LEVELS } from '../schema.js';
import { ACTIONS } from '../activity.js';
import { pageHead, card, barList, emptyState, person, statusChip, priorityChip, banner } from '../components/ui.js';
import { buildHash } from '../router.js';

const STATUS_COLORS = { Draft: 'var(--chart-5)', 'Ready for Review': 'var(--chart-3)', Approved: 'var(--ok)', Deprecated: 'var(--border-strong)' };
const PRIORITY_COLORS = { Critical: 'var(--p-critical)', High: 'var(--p-high)', Medium: 'var(--p-medium)', Low: 'var(--p-low)' };

const libLink = (query) => buildHash('/cases', query);

function countBy(items, keyFn) {
  const m = new Map();
  for (const it of items) {
    const keys = [].concat(keyFn(it));
    for (const k of keys) m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

function stat(label, value, href, sub = '') {
  return h('a', { class: 'card stat', href }, h('div', { class: 'stat-label' }, label), h('div', { class: 'stat-value' }, String(value)), sub && h('div', { class: 'stat-sub' }, sub));
}

function trendChart(activity) {
  const days = 14;
  const buckets = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    buckets.push({ date: d, key: d.toISOString().slice(0, 10), created: 0, updated: 0 });
  }
  const byKey = new Map(buckets.map((b) => [b.key, b]));
  for (const e of activity) {
    if (e.entityType !== 'testCase') continue;
    const d = new Date(e.timestamp);
    d.setHours(0, 0, 0, 0);
    const b = byKey.get(d.toISOString().slice(0, 10));
    if (!b) continue;
    if (e.action === 'create' || e.action === 'duplicate') b.created += 1;
    else if (['update', 'bulk_update', 'approve', 'reject', 'review_submit', 'import'].includes(e.action)) b.updated += 1;
  }
  const total = buckets.reduce((s, b) => s + b.created + b.updated, 0);
  if (!total) return h('p', { class: 'muted small' }, 'No case additions or edits in the last 14 days of local/imported history.');
  const max = Math.max(1, ...buckets.map((b) => b.created + b.updated));
  const W = 560; const H = 120; const pad = 18; const bw = (W - 8) / days;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'trend');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Case activity over the last ${days} days: ${buckets.map((b) => `${b.key} ${b.created} created, ${b.updated} updated`).join('; ')}`);
  const mk = (tag, attrs) => { const el = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
  svg.append(mk('line', { x1: 0, x2: W, y1: H - pad, y2: H - pad }));
  buckets.forEach((b, i) => {
    const x = 4 + i * bw + bw * 0.18;
    const w = bw * 0.64;
    const hc = ((H - pad - 6) * b.created) / max;
    const hu = ((H - pad - 6) * b.updated) / max;
    const r1 = mk('rect', { class: 'bar', x, y: H - pad - hc, width: w, height: hc, rx: 2 });
    const r2 = mk('rect', { class: 'bar upd', x, y: H - pad - hc - hu, width: w, height: hu, rx: 2 });
    const t = mk('title', {});
    t.textContent = `${b.key}: ${b.created} created, ${b.updated} updated`;
    r1.append(t.cloneNode(true));
    r2.append(t);
    svg.append(r1, r2);
    if (i % 2 === 0 || i === days - 1) {
      const label = mk('text', { x: x + w / 2, y: H - 4, 'text-anchor': 'middle' });
      label.textContent = b.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      svg.append(label);
    }
  });
  return h('div', null, svg, h('div', { class: 'legend' },
    h('span', null, h('i', { style: { background: 'var(--chart-1)' } }), 'Created'),
    h('span', null, h('i', { style: { background: 'var(--chart-2)' } }), 'Updated / reviewed')));
}

export function render({ store, root, setCrumbs }) {
  setCrumbs([{ label: 'Dashboard' }]);
  const me = store.actor();
  const all = store.data.testCases;
  const active = all.filter((c) => !c.deletedAt);
  const live = active.filter((c) => c.status !== 'Deprecated');
  const byStatus = countBy(active, (c) => c.status);
  const trashCount = all.length - active.length;

  root.append(pageHead({
    title: store.meta.project.name,
    subtitle: `Documented test cases across ${store.data.modules.filter((m) => !m.archived).length} modules. Figures come only from data in this browser.`,
  }));

  if (active.some((c) => c.demo)) {
    root.append(h('div', { style: { marginBottom: '16px' } }, banner('warn', [
      h('strong', null, 'Demo data present.'),
      h('span', null, 'AUTH-001 and PAT-001 are demonstration cases, not real coverage. Clear them in ', h('a', { href: '#/settings' }, 'Settings'), ' when you start documenting.'),
    ])));
  }

  root.append(h('div', { class: 'stats' },
    stat('Active cases', active.length, libLink({}), `${live.length} not deprecated`),
    stat('Draft', byStatus.get('Draft') || 0, libLink({ status: 'Draft' })),
    stat('Ready for review', byStatus.get('Ready for Review') || 0, libLink({ status: 'Ready for Review' })),
    stat('Approved', byStatus.get('Approved') || 0, libLink({ status: 'Approved' })),
    stat('Automated', active.filter((c) => c.automationStatus === 'Automated').length, libLink({ automation: 'Automated' })),
    stat('Deprecated', byStatus.get('Deprecated') || 0, libLink({ status: 'Deprecated' })),
    stat('In trash', trashCount, '#/trash', 'soft deleted'),
  ));

  // Module coverage (documented vs target)
  const mods = store.data.modules.filter((m) => !m.archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const perModule = countBy(live, (c) => c.moduleId);
  const coverage = h('div', { class: 'bars' }, mods.map((m) => {
    const n = perModule.get(m.id) || 0;
    const target = m.targetCases;
    const pct = target ? Math.min(100, Math.round((n / target) * 100)) : null;
    return h('a', { class: 'bar-row', href: libLink({ module: m.id }), style: { gridTemplateColumns: 'minmax(90px,150px) 1fr 92px' } },
      h('span', { class: 'bar-label', title: m.name }, m.name),
      target
        ? h('span', { class: 'bar-track', role: 'img', 'aria-label': `${m.name}: ${n} of ${target} target cases` }, h('span', { class: 'bar-fill', style: { width: `${pct}%`, background: pct >= 100 ? 'var(--ok)' : undefined } }))
        : h('span', { class: 'muted small' }, 'No target set'),
      h('span', { class: 'bar-value' }, target ? `${n} / ${target}` : String(n)));
  }));

  const statusStack = active.length
    ? h('div', null,
      h('div', { class: 'stacked', role: 'img', 'aria-label': CASE_STATUSES.map((s) => `${s}: ${byStatus.get(s) || 0}`).join(', ') },
        CASE_STATUSES.map((s) => h('span', { style: { width: `${((byStatus.get(s) || 0) / active.length) * 100}%`, background: STATUS_COLORS[s] } }))),
      h('div', { class: 'legend' }, CASE_STATUSES.map((s) => h('span', null, h('i', { style: { background: STATUS_COLORS[s] } }), `${s} ${byStatus.get(s) || 0}`))))
    : h('p', { class: 'muted small' }, 'No cases yet.');

  const byPriority = countBy(active, (c) => c.priority);
  const byLevel = countBy(active, (c) => c.testLevel || 'Other');
  const bySuite = countBy(active, (c) => c.suites);
  const byAssignee = countBy(active, (c) => c.assignedTo || '');
  const byAccount = countBy(active, (c) => c.accountIds);

  const mine = me ? active.filter((c) => c.assignedTo === me.id && c.status !== 'Deprecated').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : [];
  const review = active.filter((c) => c.status === 'Ready for Review').sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  const recent = store.data.activity.filter((e) => e.entityType === 'testCase').sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 8);

  const caseList = (list, emptyText) => (list.length
    ? h('div', { class: 'list' }, list.slice(0, 6).map((c) => h('a', { class: 'list-item', href: `#/cases/${c.id}` },
      h('span', { class: 'key' }, c.caseKey),
      h('span', { class: 'grow' }, h('span', { class: 'title' }, c.title), h('span', { class: 'muted small' }, store.get('modules', c.moduleId)?.name || '')),
      priorityChip(c.priority))))
    : h('div', { class: 'card-body' }, h('p', { class: 'muted small' }, emptyText)));

  const completed = active.filter((c) => c.completionStatus === 'Completed');
  const pending = active.filter((c) => c.completionStatus !== 'Completed');
  const percent = active.length ? Math.round(completed.length / active.length * 100) : 0;
  root.append(h('section', { class: 'completion-overview' },
    h('div', { class: 'completion-summary' },
      h('div', null, h('span', { class: 'completion-eyebrow' }, 'EXECUTION PROGRESS'),
        h('h2', null, 'Every test accounted for.'),
        h('p', { class: 'muted small' }, 'Track execution separately from review. Completed does not mean passed. Includes all non-deleted cases.')),
      h('div', { class: 'completion-ring', role: 'img', 'aria-label': `${percent}% completed: ${completed.length} completed, ${pending.length} pending`, style: { background: `conic-gradient(var(--ok) ${percent}%, var(--border) 0)` } },
        h('div', null, h('strong', null, `${percent}%`), h('span', null, 'completed')))),
    h('div', { class: 'completion-metrics' },
      stat('Pending execution', pending.length, libLink({ completion: 'Pending' }), 'Ready for your next testing session'),
      stat('Completed', completed.length, libLink({ completion: 'Completed' }), `${completed.length} of ${active.length} cases executed`)),
    h('div', { class: 'grid grid-2' },
      card({ title: 'Pending execution', flush: true, body: caseList(pending, 'All cases completed. Nothing pending.'), actions: h('a', { class: 'small', href: libLink({ completion: 'Pending' }) }, `View all (${pending.length})`) }),
      card({ title: 'Completed cases', flush: true, body: caseList([...completed].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), 'Mark your first case completed to see it here.'), actions: h('a', { class: 'small', href: libLink({ completion: 'Completed' }) }, `View all (${completed.length})`) })),
    card({ title: 'Completion by module', body: h('div', { class: 'bars' }, mods.map((m) => {
      const cases = active.filter((c) => c.moduleId === m.id);
      const done = cases.filter((c) => c.completionStatus === 'Completed').length;
      const pct = cases.length ? Math.round(done / cases.length * 100) : 0;
      return h('a', { class: 'bar-row', href: libLink({ module: m.id, completion: 'Pending' }) },
        h('span', { class: 'bar-label', title: m.name }, m.name),
        h('span', { class: 'bar-track', role: 'img', 'aria-label': `${m.name}: ${done} of ${cases.length} completed` }, h('span', { class: 'bar-fill', style: { width: `${pct}%`, background: 'var(--ok)' } })),
        h('span', { class: 'bar-value' }, `${done} / ${cases.length}`));
    })) })));

  root.append(
    h('div', { class: 'grid grid-2', style: { marginBottom: '16px' } },
      card({ title: 'Module coverage', actions: h('span', { class: 'muted small' }, 'documented vs. target'), body: h('div', { class: 'stack', style: { gap: '12px' } }, coverage, h('p', { class: 'muted small' }, 'Counts documented, non-deprecated cases against the target your team entered per module. This is not code coverage.')) }),
      h('div', { class: 'stack' },
        card({ title: 'Case status', body: statusStack }),
        card({ title: 'Additions & updates', actions: h('span', { class: 'muted small' }, 'last 14 days'), body: trendChart(store.data.activity) }))),
    h('div', { class: 'grid grid-3', style: { marginBottom: '16px' } },
      card({ title: 'Assigned to me', flush: true, body: caseList(mine, me ? 'Nothing assigned to you.' : 'Choose a profile to see your assignments.'), actions: me && h('a', { class: 'small', href: libLink({ assignee: me.id }) }, 'View all') }),
      card({ title: 'Awaiting review', flush: true, body: caseList(review, 'No cases are waiting for review.'), actions: h('a', { class: 'small', href: libLink({ status: 'Ready for Review' }) }, 'View all') }),
      card({
        title: 'Recent edits',
        flush: true,
        body: recent.length
          ? h('div', { class: 'list' }, recent.map((e) => h(store.get('testCases', e.entityId) ? 'a' : 'div', { class: 'list-item', href: store.get('testCases', e.entityId) ? `#/cases/${e.entityId}` : undefined },
            person(store.get('members', e.actorId), { fallback: 'Unknown' }),
            h('span', { class: 'grow small' }, h('span', { class: 'title' }, `${ACTIONS[e.action] || e.action} ${e.entityLabel}`)),
            h('span', { class: 'muted small nowrap' }, fmtRelative(e.timestamp)))))
          : h('div', { class: 'card-body' }, h('p', { class: 'muted small' }, 'No activity yet.')),
        actions: h('a', { class: 'small', href: '#/activity' }, 'Activity log'),
      })),
    h('div', { class: 'grid grid-3' },
      card({ title: 'By priority', body: barList(PRIORITIES.map((p) => ({ label: p, value: byPriority.get(p) || 0, color: PRIORITY_COLORS[p], href: libLink({ priority: p }) }))) }),
      card({ title: 'By test level', body: barList(TEST_LEVELS.filter((l) => byLevel.get(l)).map((l) => ({ label: l, value: byLevel.get(l), href: libLink({ level: l }) })), { empty: 'No cases yet.' }) }),
      card({ title: 'By suite', body: barList(store.data.testSuites.map((s) => ({ label: s.name, value: bySuite.get(s.id) || 0, color: 'var(--chart-2)', href: libLink({ suite: s.id }) }))) }),
      card({ title: 'By assignee', body: barList([...byAssignee.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, n]) => ({ label: id ? store.get('members', id)?.displayName || 'Unknown' : 'Unassigned', value: n, color: 'var(--chart-5)', href: libLink({ assignee: id || 'none' }) })), { empty: 'No cases yet.' }) }),
      card({ title: 'By account', body: barList(store.data.accounts.map((a) => ({ label: a.name, value: byAccount.get(a.id) || 0, color: 'var(--chart-3)', href: libLink({ account: a.id }) })), { empty: 'No account labels configured.' }) }),
      card({
        title: 'Automation',
        body: barList(['Automated', 'In Progress', 'Planned', 'Not Planned', 'Not Applicable'].map((a) => ({ label: a, value: active.filter((c) => c.automationStatus === a).length, color: 'var(--info)', href: libLink({ automation: a }) }))),
      })),
  );

  if (!active.length) {
    root.append(card({ body: emptyState({ iconName: 'cases', title: 'No test cases yet', text: 'Create your first case or import a team JSON file.', action: h('div', { class: 'row' }, h('a', { class: 'btn btn-primary', href: '#/cases/new' }, icon('plus', 16), 'New case'), h('a', { class: 'btn', href: '#/data' }, 'Import JSON')) }) }));
  }
}
