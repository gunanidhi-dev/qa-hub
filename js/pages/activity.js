import { h, plural } from '../utils.js';
import { ACTIONS } from '../activity.js';
import { pageHead, card, select, banner } from '../components/ui.js';
import { timeline } from '../components/timeline.js';

const PAGE = 50;

export function render({ store, root, setCrumbs, query, router }) {
  setCrumbs([{ label: 'Activity' }]);
  const f = { actor: query.actor || '', action: query.action || '', module: query.module || '', type: query.type || '', from: query.from || '', to: query.to || '' };
  let limit = PAGE;

  root.append(pageHead({ title: 'Activity log', subtitle: 'Local history of creates, edits, reviews, deletions, imports and profile switches.' }));
  root.append(h('div', { style: { marginBottom: '16px' } }, banner('info', [
    h('strong', null, 'This is an activity log, not a tamper-proof audit trail.'),
    h('span', null, 'Profiles are not authenticated and anyone with access to browser storage or the JSON files can alter entries. Git commit and pull-request history adds reviewable provenance for shared data.'),
  ])));

  const sel = (key, label, options) => {
    const s = select([{ value: '', label }, ...options], f[key], { 'aria-label': label });
    s.addEventListener('change', () => { f[key] = s.value; limit = PAGE; update(); });
    return s;
  };
  const date = (key, label) => {
    const d = h('input', { type: 'date', value: f[key], 'aria-label': label, style: { width: 'auto', height: '32px' } });
    d.addEventListener('change', () => { f[key] = d.value; limit = PAGE; update(); });
    return h('label', { class: 'row small muted' }, label, d);
  };
  const types = [...new Set(store.data.activity.map((e) => e.entityType))].sort();
  const toolbar = h('div', { class: 'toolbar' },
    sel('actor', 'Anyone', store.data.members.map((m) => ({ value: m.id, label: m.displayName }))),
    sel('action', 'Any action', Object.entries(ACTIONS).map(([value, label]) => ({ value, label }))),
    sel('module', 'Any module', store.data.modules.map((m) => ({ value: m.id, label: m.name }))),
    sel('type', 'Any record type', types.map((t) => ({ value: t, label: t }))),
    date('from', 'From'), date('to', 'To'));
  const count = h('span', { class: 'muted small' });
  const list = h('div');
  const more = h('div', { class: 'card-foot' });
  root.append(h('section', { class: 'card' }, toolbar, h('div', { class: 'card-head' }, h('h2', null, 'Events'), count), list, more));

  function update() {
    router.setQuery(Object.fromEntries(Object.entries(f).filter(([, v]) => v)));
    const from = f.from ? new Date(`${f.from}T00:00:00`).toISOString() : '';
    const to = f.to ? new Date(`${f.to}T23:59:59.999`).toISOString() : '';
    const caseModule = (e) => e.moduleId || store.get('testCases', e.entityId)?.moduleId;
    const events = store.data.activity.filter((e) => (!f.actor || e.actorId === f.actor)
      && (!f.action || e.action === f.action)
      && (!f.type || e.entityType === f.type)
      && (!f.module || caseModule(e) === f.module)
      && (!from || e.timestamp >= from)
      && (!to || e.timestamp <= to)).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    count.textContent = plural(events.length, 'event');
    list.replaceChildren(timeline(store, events.slice(0, limit), { empty: 'No events match these filters.' }));
    more.replaceChildren(...(events.length > limit ? [h('button', { type: 'button', class: 'btn btn-sm', onClick: () => { limit += PAGE * 2; update(); } }, `Show more (${events.length - limit} remaining)`)] : []));
    more.hidden = events.length <= limit;
  }
  update();
}
