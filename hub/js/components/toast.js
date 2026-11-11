import { h, icon } from '../utils.js';

let host;

function ensureHost() {
  if (!host) {
    host = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'false' });
    document.body.append(host);
  }
  return host;
}

/**
 * toast('Saved') / toast('Failed', { type: 'error' }) / toast('Deleted', { action: { label: 'Undo', onClick } })
 */
export function toast(message, { type = 'success', action = null, timeout } = {}) {
  const el = h('div', { class: ['toast', type === 'error' && 'error'], role: type === 'error' ? 'alert' : undefined },
    icon(type === 'error' ? 'alert' : 'check', 18),
    h('div', { class: 'toast-msg' }, message),
    action && h('button', { type: 'button', onClick: () => { action.onClick(); dismiss(); } }, action.label),
    h('button', { type: 'button', 'aria-label': 'Dismiss notification', onClick: () => dismiss() }, icon('x', 16)),
  );
  ensureHost().append(el);
  const ms = timeout ?? (type === 'error' ? 9000 : action ? 7000 : 3500);
  const timer = setTimeout(dismiss, ms);
  function dismiss() {
    clearTimeout(timer);
    el.remove();
  }
  return dismiss;
}

/** Show an error from the store (ValidationError, PermissionError, StorageError, ...). */
export function toastError(err) {
  console.error(err);
  toast(err?.message || String(err), { type: 'error' });
}
