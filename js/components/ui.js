// Small reusable view helpers. All text goes through textContent via h().

import { h, icon } from '../utils.js';

export function fieldError(name) {
  return h('div', { class: 'error', dataset: { error: name }, hidden: true, role: 'alert' });
}

/** Show `{field: message}` errors inside a container; focuses the first invalid control. */
export function showErrors(container, errors = {}) {
  container.querySelectorAll('[data-error]').forEach((el) => { el.hidden = true; el.textContent = ''; });
  container.querySelectorAll('[aria-invalid="true"]').forEach((el) => el.removeAttribute('aria-invalid'));
  let first = null;
  for (const [field, msg] of Object.entries(errors)) {
    const slot = container.querySelector(`[data-error="${CSS.escape(field)}"]`);
    if (slot) { slot.hidden = false; slot.textContent = msg; }
    const input = container.querySelector(`[name="${CSS.escape(field)}"]`);
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      if (slot) {
        slot.id ||= `err-${field}-${Math.random().toString(36).slice(2, 6)}`;
        input.setAttribute('aria-describedby', slot.id);
      }
      first ||= input;
    } else first ||= slot;
  }
  if (first) {
    first.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    if (first.focus) first.focus({ preventScroll: true });
  }
}

const PRIORITY_CLASS = { Critical: 'chip-critical', High: 'chip-high', Medium: 'chip-medium', Low: 'chip-low' };
const STATUS_CLASS = { Draft: 'chip-draft', 'Ready for Review': 'chip-review', Approved: 'chip-approved', Deprecated: 'chip-deprecated' };

export const priorityChip = (p) => h('span', { class: ['chip', PRIORITY_CLASS[p]], title: `Priority: ${p}` }, p);
export const statusChip = (s) => h('span', { class: ['chip', STATUS_CLASS[s]], title: `Status: ${s}` }, s);
export const automationChip = (a) => h('span', { class: ['chip', a === 'Automated' ? 'chip-auto' : 'chip-outline'], title: `Automation: ${a}` }, a);
export const suiteChip = (name) => h('span', { class: 'chip chip-suite plain', title: `Suite: ${name}` }, name);
export const plainChip = (text, extra = '') => h('span', { class: `chip plain ${extra}` }, text);

const AVATAR_COLORS = ['#4f46e5', '#0e7490', '#b45309', '#be123c', '#047857', '#7c3aed', '#1d4ed8', '#a21caf', '#475569'];
function hashColor(s) {
  let x = 0;
  for (const ch of String(s)) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[x % AVATAR_COLORS.length];
}
export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts.at(-1)[0] : parts[0]?.[1] || '')).toUpperCase();
}
export function avatar(member, small = false) {
  return h('span', { class: ['avatar', small && 'avatar-sm'], style: { background: hashColor(member?.memberId || member?.id || '?') }, 'aria-hidden': 'true' }, initials(member?.displayName || '?'));
}
export function person(member, { small = true, fallback = 'Unassigned' } = {}) {
  if (!member) return h('span', { class: 'muted' }, fallback);
  return h('span', { class: 'person', title: `${member.displayName} (${member.memberId})` }, avatar(member, small), h('span', { class: 'person-name' }, member.displayName));
}

export function emptyState({ iconName = 'info', title, text = '', action = null }) {
  return h('div', { class: 'empty' }, icon(iconName, 36), h('h3', null, title), text && h('p', null, text), action);
}

export function pageHead({ title, subtitle = '', actions = [] }) {
  return h('div', { class: 'page-head' },
    h('div', null, h('h1', null, title), subtitle && h('p', null, subtitle)),
    actions.length ? h('div', { class: 'page-actions' }, actions) : null);
}

export function banner(kind, content, iconName = kind === 'danger' ? 'alert' : kind === 'warn' ? 'alert' : 'info') {
  return h('div', { class: `banner banner-${kind}`, role: kind === 'danger' ? 'alert' : undefined }, icon(iconName, 18), h('div', { class: 'banner-body' }, content));
}

export function field({ label, input, hint = '', name = '', required = false, full = false, id = null }) {
  const inputId = id || input.id || `in-${name || Math.random().toString(36).slice(2, 8)}`;
  if (input.tagName && !input.id) input.id = inputId;
  return h('div', { class: ['field', full && 'full'] },
    h('label', { for: inputId }, label, required ? h('span', { class: 'req', 'aria-hidden': 'true' }, '*') : null),
    input,
    hint && h('div', { class: 'hint' }, hint),
    name && fieldError(name));
}

export function select(options, value, attrs = {}) {
  return h('select', attrs, options.map((o) => {
    const opt = typeof o === 'string' ? { value: o, label: o } : o;
    return h('option', { value: opt.value, selected: String(opt.value) === String(value ?? '') }, opt.label);
  }));
}

/** Button + popover menu. items: [{label, icon, onClick, danger, disabled}] | 'sep' | {heading}. */
export function menu(trigger, items, { label = 'More actions', align = 'right' } = {}) {
  const panel = h('div', { class: 'popover-panel', role: 'menu', hidden: true, style: align === 'left' ? { left: 0, right: 'auto' } : null });
  const btn = trigger instanceof Node ? trigger : h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm' }, icon('more', 18));
  btn.setAttribute('aria-haspopup', 'menu');
  btn.setAttribute('aria-expanded', 'false');
  if (!btn.getAttribute('aria-label') && !btn.textContent.trim()) btn.setAttribute('aria-label', label);
  const wrap = h('div', { class: 'popover' }, btn, panel);
  const close = () => {
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', onKey, true);
  };
  const outside = (e) => { if (!wrap.contains(e.target)) close(); };
  const onKey = (e) => {
    const els = [...panel.querySelectorAll('.menu-item:not([disabled])')];
    const i = els.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); btn.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
  };
  const render = () => {
    panel.replaceChildren(...(typeof items === 'function' ? items() : items).filter(Boolean).map((it) => {
      if (it === 'sep') return h('div', { class: 'menu-sep', role: 'separator' });
      if (it.heading) return h('div', { class: 'menu-label' }, it.heading);
      if (it.node) return it.node;
      return h('button', {
        type: 'button', role: 'menuitem', class: ['menu-item', it.danger && 'danger'], disabled: it.disabled,
        onClick: () => { close(); it.onClick?.(); },
      }, it.icon && icon(it.icon, 16), it.label);
    }));
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!panel.hidden) return close();
    render();
    panel.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', onKey, true);
    panel.querySelector('.menu-item, input')?.focus();
  });
  return wrap;
}

export function card({ title = null, actions = null, body, flush = false, foot = null, cls = '' }) {
  return h('section', { class: `card ${cls}` },
    title !== null && h('div', { class: 'card-head' }, typeof title === 'string' ? h('h2', null, title) : title, actions),
    h('div', { class: ['card-body', flush && 'flush'] }, body),
    foot && h('div', { class: 'card-foot' }, foot));
}

export function barList(rows, { max = null, color = null, empty = 'No data yet.' } = {}) {
  if (!rows.length) return h('p', { class: 'muted small' }, empty);
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return h('div', { class: 'bars' }, rows.map((r) => {
    const inner = [
      h('span', { class: 'bar-label', title: r.label }, r.label),
      h('span', { class: 'bar-track', role: 'img', 'aria-label': `${r.label}: ${r.value}` },
        h('span', { class: 'bar-fill', style: { width: `${(r.value / top) * 100}%`, background: r.color || color || undefined } })),
      h('span', { class: 'bar-value' }, r.display ?? String(r.value)),
    ];
    return r.href ? h('a', { class: 'bar-row', href: r.href }, inner) : h('div', { class: 'bar-row' }, inner);
  }));
}

export function lookups(store) {
  const name = (c, f = 'name') => (id) => store.get(c, id)?.[f] || (id ? 'Unknown' : '');
  return {
    moduleName: name('modules'),
    featureName: name('features'),
    suiteName: name('testSuites'),
    accountName: name('accounts'),
    memberName: name('members', 'displayName'),
  };
}
