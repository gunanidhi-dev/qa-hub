// Full-screen sign-in page. Rendered before the app shell exists.
// All text goes through h()/textContent; nothing user-entered reaches innerHTML.

import { h, icon, clear } from '../utils.js';
import { confirmDialog } from '../components/modal.js';

const fmt = (n) => n.toLocaleString('en-US');

function stats(store) {
  const active = store.activeCases();
  const crit = active.filter((c) => c.priority === 'Critical').length;
  return [
    [fmt(active.length), 'test cases'],
    [fmt(store.data.modules.filter((m) => !m.archived).length), 'modules'],
    [fmt(store.data.testSuites.length), 'suites'],
    [fmt(crit), 'critical'],
  ];
}

/**
 * @param {HTMLElement} root
 * @param {{store, submit:(v)=>Promise<{ok:boolean, reason?:string}>, lockoutRemaining:()=>number,
 *          staleData?:boolean, loadLibrary?:()=>Promise<void>}} opts
 */
export function renderLogin(root, { store, submit, lockoutRemaining, staleData = false, loadLibrary }) {
  clear(root);

  const userIn = h('input', { id: 'login-user', name: 'username', type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true, placeholder: 'username' });
  const passIn = h('input', { id: 'login-pass', name: 'password', type: 'password', autocomplete: 'current-password', required: true, placeholder: 'Your password' });
  const reveal = h('button', { type: 'button', class: 'login-reveal', 'aria-label': 'Show password', 'aria-pressed': 'false' }, icon('eye', 16));
  reveal.addEventListener('click', () => {
    const show = passIn.type === 'password';
    passIn.type = show ? 'text' : 'password';
    reveal.replaceChildren(icon(show ? 'eyeOff' : 'eye', 16));
    reveal.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    reveal.setAttribute('aria-pressed', String(show));
    passIn.focus();
  });
  const caps = h('div', { class: 'login-caps', hidden: true }, icon('alert', 13), 'Caps Lock is on');
  passIn.addEventListener('keyup', (e) => { caps.hidden = !e.getModifierState?.('CapsLock'); });
  const remember = h('input', { type: 'checkbox', id: 'login-remember', name: 'remember' });
  const error = h('div', { class: 'login-error', role: 'alert', 'aria-live': 'assertive', hidden: true });
  const submitBtn = h('button', { type: 'submit', class: 'btn btn-primary login-submit' }, h('span', null, 'Sign in'), icon('chevronRight', 16));

  const showError = (msg) => {
    error.hidden = !msg;
    error.replaceChildren(...(msg ? [icon('alert', 15), h('span', null, msg)] : []));
  };

  const form = h('form', { class: 'login-form', novalidate: true },
    h('div', { class: 'login-field' },
      h('label', { for: 'login-user' }, 'Username'),
      h('div', { class: 'login-input' }, icon('user', 16), userIn)),
    h('div', { class: 'login-field' },
      h('label', { for: 'login-pass' }, 'Password'),
      h('div', { class: 'login-input' }, icon('lock', 16), passIn, reveal),
      caps),
    h('label', { class: 'login-remember', for: 'login-remember' }, remember, h('span', null, 'Keep me signed in on this browser for 12 hours')),
    error,
    submitBtn);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!userIn.value.trim() || !passIn.value) { showError('Enter your username and password.'); (userIn.value.trim() ? passIn : userIn).focus(); return; }
    const wait = lockoutRemaining();
    if (wait) { showError(`Too many attempts. Try again in ${wait}s.`); return; }
    showError('');
    submitBtn.disabled = true;
    submitBtn.classList.add('is-loading');
    submitBtn.firstChild.textContent = 'Verifying…';
    try {
      const res = await submit({ username: userIn.value, password: passIn.value, remember: remember.checked });
      if (res.ok) { passIn.value = ''; return; }
      showError(res.reason);
      passIn.value = '';
      passIn.focus();
      form.classList.remove('shake');
      void form.offsetWidth; // restart animation
      form.classList.add('shake');
    } catch (err) {
      showError(err.message || String(err));
    } finally {
      submitBtn.disabled = false;
      submitBtn.classList.remove('is-loading');
      submitBtn.firstChild.textContent = 'Sign in';
    }
  });

  const stale = staleData && loadLibrary ? h('div', { class: 'login-stale' },
    icon('info', 16),
    h('div', null,
      h('strong', null, 'This browser holds older QA Hub data.'),
      h('p', null, 'None of the team accounts exist in it yet. Load the Patient Manager library to continue (export anything you need first).'),
      h('button', {
        type: 'button', class: 'btn btn-sm',
        onClick: async () => {
          const ok = await confirmDialog({ title: 'Replace local data with the library?', message: 'Everything in this browser\'s QA Hub storage is erased and replaced with data/library.json. This cannot be undone.', confirmLabel: 'Erase and load library', danger: true });
          if (!ok) return;
          await loadLibrary();
          location.reload();
        },
      }, 'Load library'))) : null;

  const year = new Date().getFullYear();
  const page = h('div', { class: 'login' },
    h('section', { class: 'login-hero', 'aria-hidden': 'true' },
      h('div', { class: 'login-hero-inner' },
        h('div', { class: 'login-brand' }, h('span', { class: 'brand-mark' }, icon('logo', 20)), h('span', null, 'QA Hub')),
        h('h2', { class: 'login-headline' }, 'Every case. Every module.', h('br'), h('span', null, 'One source of truth.')),
        h('p', { class: 'login-sub' }, store.meta.project.name, ' — test library, review workflow and activity history, all local-first.'),
        h('div', { class: 'login-stats' }, stats(store).map(([n, l]) => h('div', null, h('strong', null, n), h('span', null, l)))),
        h('pre', { class: 'login-code' },
          h('span', { class: 'c' }, '# shared through Git, no backend'), '\n',
          h('span', { class: 'p' }, '$ '), 'git pull && npm start', '\n',
          h('span', { class: 'p' }, '$ '), 'npm test', '  ', h('span', { class: 'ok' }, '✔ pass'), '\n',
          h('span', { class: 'p' }, '$ '), 'open ', h('span', { class: 's' }, 'http://127.0.0.1:5173/')),
        h('div', { class: 'login-foot' }, `© ${year} · Plain HTML, CSS & JS`))),
    h('section', { class: 'login-panel' },
      h('div', { class: 'login-card' },
        h('div', { class: 'login-card-head' },
          h('span', { class: 'login-badge' }, icon('lock', 14), 'Team sign-in'),
          h('h1', null, 'Welcome back'),
          h('p', null, 'Sign in with your QA Hub username.')),
        stale,
        form,
        h('p', { class: 'login-note' }, icon('info', 13),
          h('span', null, 'Local sign-in: it records who made each change. It is not a security boundary — anyone with the files can bypass it.')),
        h('div', { class: 'login-kbd' }, h('kbd', null, 'Enter'), ' to sign in · ', h('kbd', null, 'Tab'), ' to move'))));

  root.append(page);
  requestAnimationFrame(() => userIn.focus());
}
