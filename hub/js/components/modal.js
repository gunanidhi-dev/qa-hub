// Accessible dialogs built on native <dialog> (focus containment, Esc to close, aria-modal).

import { h, icon } from '../utils.js';
import { fieldError, showErrors } from './ui.js';

let openCount = 0;
export const isModalOpen = () => openCount > 0;

/**
 * openModal({ title, body, actions:[{label, variant, onClick}], wide, dismissible })
 * onClick(close) may return false (or a promise of false) to keep the dialog open.
 * Returns a promise that resolves with the value passed to close().
 */
export function openModal({ title, description = '', body, actions = [], wide = false, dismissible = true, initialFocus = null, onReady = null }) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const titleId = `dlg-${Math.random().toString(36).slice(2)}`;
    const dialog = h('dialog', { class: ['modal', wide && 'wide'], 'aria-labelledby': titleId, 'aria-modal': 'true' });
    let closed = false;
    const close = (value = null) => {
      if (closed) return;
      closed = true;
      openCount -= 1;
      dialog.close();
      dialog.remove();
      if (prevFocus && document.contains(prevFocus)) prevFocus.focus();
      resolve(value);
    };

    const footButtons = actions.map((a) => {
      const btn = h('button', { type: a.submit ? 'submit' : 'button', class: ['btn', a.variant && `btn-${a.variant}`], form: a.submit ? `${titleId}-form` : undefined }, a.label);
      if (!a.submit) {
        btn.addEventListener('click', async () => {
          if (!a.onClick) return close(a.value ?? null);
          btn.disabled = true;
          try {
            const r = await a.onClick(close);
            if (r !== false && !closed) close(r === undefined ? a.value ?? true : r);
          } finally { btn.disabled = false; }
        });
      }
      return btn;
    });

    dialog.append(
      h('div', { class: 'modal-head' },
        h('div', null, h('h2', { id: titleId }, title), description && h('p', { class: 'muted small', style: { marginTop: '4px' } }, description)),
        dismissible && h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': 'Close dialog', onClick: () => close(null) }, icon('x', 16)),
      ),
      h('div', { class: 'modal-body' }, body),
      footButtons.length ? h('div', { class: 'modal-foot' }, footButtons) : null,
    );
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      if (dismissible) close(null);
    });
    document.body.append(dialog);
    openCount += 1;
    dialog.showModal();
    const focusTarget = initialFocus ? dialog.querySelector(initialFocus) : dialog.querySelector('input:not([type=hidden]), select, textarea');
    (focusTarget || footButtons.at(-1) || dialog).focus();
    onReady?.(close);
  });
}

/**
 * confirmDialog({ title, message, confirmLabel, danger, typed, reason })
 * Resolves to null when cancelled, otherwise { reason }.
 */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false, typed = null, reason = null, details = null }) {
  const typedInput = typed ? h('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'typed-hint' }) : null;
  const reasonInput = reason ? h('textarea', { rows: 2, placeholder: reason.placeholder || '' }) : null;
  const typedErr = h('div', { class: 'error', hidden: true, role: 'alert' });
  const body = h('div', { class: 'stack', style: { gap: '12px' } },
    typeof message === 'string' ? h('p', null, message) : message,
    details,
    reasonInput && h('div', { class: 'field' }, h('label', null, reason.label || 'Reason', reason.required ? h('span', { class: 'req' }, '*') : null), reasonInput),
    typedInput && h('div', { class: 'field' },
      h('label', { id: 'typed-hint' }, 'Type ', h('code', null, typed), ' to confirm'),
      typedInput, typedErr),
  );
  return openModal({
    title,
    body,
    initialFocus: typedInput ? 'input' : reasonInput ? 'textarea' : null,
    actions: [
      { label: 'Cancel', value: null },
      {
        label: confirmLabel,
        variant: danger ? 'danger' : 'primary',
        onClick: () => {
          if (typed && typedInput.value.trim() !== typed) {
            typedErr.hidden = false;
            typedErr.textContent = `Type ${typed} exactly.`;
            typedInput.setAttribute('aria-invalid', 'true');
            typedInput.focus();
            return false;
          }
          if (reason?.required && !reasonInput.value.trim()) {
            reasonInput.setAttribute('aria-invalid', 'true');
            reasonInput.focus();
            return false;
          }
          return { reason: reasonInput ? reasonInput.value.trim() : '' };
        },
      },
    ],
  });
}

/**
 * formDialog({ title, fields: [{name, label, type, options, value, required, hint, full}], submitLabel, onSubmit })
 * onSubmit(values) may throw a ValidationError ({errors}) to show inline field errors.
 */
export function formDialog({ title, description, fields, submitLabel = 'Save', onSubmit, wide = false, extra = null }) {
  const form = h('form', { class: 'form-grid', novalidate: true });
  const inputs = {};
  for (const f of fields) {
    const id = `f-${f.name}-${Math.random().toString(36).slice(2, 7)}`;
    let input;
    if (f.type === 'select') {
      input = h('select', { id, name: f.name }, f.options.map((o) => h('option', { value: o.value, selected: String(o.value) === String(f.value ?? '') }, o.label)));
    } else if (f.type === 'textarea') {
      input = h('textarea', { id, name: f.name, rows: f.rows || 3, value: f.value ?? '' });
    } else if (f.type === 'checkbox') {
      input = h('input', { id, name: f.name, type: 'checkbox', checked: Boolean(f.value) });
    } else {
      input = h('input', { id, name: f.name, type: f.type || 'text', value: f.value ?? '', placeholder: f.placeholder || '', autocomplete: 'off', min: f.min, maxlength: f.maxlength });
    }
    if (f.disabled) input.disabled = true;
    inputs[f.name] = input;
    form.append(f.type === 'checkbox'
      ? h('div', { class: ['field', f.full !== false && 'full'] }, h('label', { class: 'check', for: id }, input, f.label), f.hint && h('div', { class: 'hint' }, f.hint))
      : h('div', { class: ['field', f.full && 'full'], dataset: { field: f.name } },
        h('label', { for: id }, f.label, f.required ? h('span', { class: 'req', 'aria-hidden': 'true' }, '*') : null),
        input,
        f.hint && h('div', { class: 'hint' }, f.hint),
        fieldError(f.name)));
  }
  form.append(h('button', { type: 'submit', hidden: true, tabindex: '-1', 'aria-hidden': 'true' }, 'Submit'));
  const formId = `frm-${Math.random().toString(36).slice(2)}`;
  form.id = formId;
  const values = () => Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.type === 'checkbox' ? el.checked : el.value]));
  return new Promise((resolve) => {
    let closeFn;
    const submit = async () => {
      try {
        const result = await onSubmit(values());
        closeFn(result ?? true);
      } catch (e) {
        if (e?.errors) showErrors(form, e.errors);
        else throw e;
      }
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); submit().catch((err) => showErrors(form, { _form: err.message })); });
    const formError = h('div', { class: 'banner banner-danger full', hidden: true, dataset: { error: '_form' }, role: 'alert' });
    form.prepend(formError);
    openModal({
      title, description, wide,
      body: h('div', null, form, extra),
      onReady: (c) => { closeFn = c; },
      actions: [
        { label: 'Cancel', value: null },
        { label: submitLabel, variant: 'primary', onClick: () => { form.requestSubmit(); return false; } },
      ],
    }).then(resolve);
  });
}
