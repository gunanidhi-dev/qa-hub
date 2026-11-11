import { h, icon, fmtDate, fmtRelative, downloadFile, plural, slug } from '../utils.js';
import { buildExport, casesToCsv, parseJson, planImport, KIND_LABEL } from '../import-export.js';
import { diffFields } from '../activity.js';
import { FIELD_LABELS } from '../schema.js';
import { pageHead, card, banner, select, lookups, emptyState } from '../components/ui.js';
import { confirmDialog } from '../components/modal.js';
import { toast, toastError } from '../components/toast.js';

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

export function downloadFullJson(store, { silent = false } = {}) {
  const doc = store.exportDocument();
  downloadFile(`qa-hub-${slug(store.meta.project.name)}-${stamp()}.json`, `${JSON.stringify(doc, null, 2)}\n`);
  store.markExported(true).catch(toastError);
  if (!silent) toast(`Exported ${plural(doc.testCases.length, 'case')} and ${plural(doc.activity.length, 'history event')}`);
}

export function render({ store, root, setCrumbs, query }) {
  setCrumbs([{ label: 'Import / Export' }]);
  const look = lookups(store);
  const canImport = store.can('data.import');

  root.append(pageHead({ title: 'Import / Export', subtitle: 'JSON is the portable format for backups and for sharing through Git. Nothing leaves this browser until you export it.' }));

  // ---- export ----
  const unexported = store.hasUnexportedChanges();
  const modSel = select(store.data.modules.map((m) => ({ value: m.id, label: `${m.name} (${store.data.testCases.filter((c) => c.moduleId === m.id).length})` })), query.module || store.data.modules[0]?.id, { 'aria-label': 'Module to export' });
  const exportCard = card({
    title: 'Export',
    body: h('div', { class: 'stack' },
      h('dl', { class: 'kv' },
        h('dt', null, 'Last full export'), h('dd', null, store.meta.lastExportAt ? `${fmtDate(store.meta.lastExportAt)} (${fmtRelative(store.meta.lastExportAt)})` : 'Never'),
        h('dt', null, 'Last local change'), h('dd', null, store.meta.lastChangeAt ? fmtDate(store.meta.lastChangeAt) : '—'),
        h('dt', null, 'Status'), h('dd', null, unexported ? h('span', { class: 'chip chip-review' }, 'Unexported changes') : h('span', { class: 'chip chip-approved' }, 'Up to date'))),
      banner('warn', 'Clearing browser data, using a private window, or switching browsers loses anything not exported.'),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn btn-primary', onClick: () => downloadFullJson(store) }, icon('data', 16), 'Download full JSON'),
        h('button', {
          type: 'button', class: 'btn', onClick: () => {
            const rows = store.activeCases().sort((a, b) => a.caseKey.localeCompare(b.caseKey, undefined, { numeric: true }));
            downloadFile(`qa-hub-cases-${stamp()}.csv`, casesToCsv(rows, look), 'text/csv');
            toast(`Exported ${plural(rows.length, 'case')} to CSV`);
          },
        }, 'Export CSV (all active cases)')),
      h('div', { class: 'field' },
        h('span', { class: 'field-label' }, 'Per-module JSON (recommended for Git)'),
        h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, modSel, h('button', {
          type: 'button', class: 'btn nowrap', onClick: () => {
            const m = store.get('modules', modSel.value);
            if (!m) return;
            const doc = buildExport(store.data, store.meta, { moduleId: m.id });
            downloadFile(`${slug(m.name)}.json`, `${JSON.stringify(doc, null, 2)}\n`);
            toast(`Exported ${m.name}: ${plural(doc.testCases.length, 'case')}`);
          },
        }, 'Download')),
        h('div', { class: 'hint' }, 'Save as data/modules/<module>.json in the qa-hub repo. Includes the module, its features, cases (incl. trash), history and shared team/suite lists.')),
    ),
  });

  // ---- import ----
  const preview = h('div', { class: 'stack' });
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', class: 'sr-only', id: 'import-file' });
  const drop = h('label', { class: 'dropzone', for: 'import-file', tabindex: '0', role: 'button', 'aria-describedby': 'drop-hint' },
    icon('upload', 28), h('div', { style: { fontWeight: 600, marginTop: '8px' } }, 'Choose a QA Hub JSON file or drop it here'),
    h('div', { id: 'drop-hint', class: 'small' }, 'Full backups and per-module files are supported. You will see a preview before anything changes.'));
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) readFile(fileInput.files[0]); fileInput.value = ''; });

  async function readFile(file) {
    if (file.size > 50 * 1024 * 1024) return toast('File is larger than 50 MB — split it per module.', { type: 'error' });
    const { doc, error } = parseJson(await file.text());
    if (error) {
      preview.replaceChildren(banner('danger', [h('strong', null, `Cannot import ${file.name}`), h('span', null, error)]));
      return;
    }
    showPlan(file.name, doc, planImport(store.data, doc));
  }

  function showPlan(name, doc, plan) {
    if (plan.errors.length) {
      preview.replaceChildren(banner('danger', [
        h('strong', null, `${name} was rejected — ${plural(plan.errors.length, 'problem')} found. Nothing was changed.`),
        h('ul', null, plan.errors.map((e) => h('li', null, e))),
      ]));
      return;
    }
    const changes = plan.items.filter((i) => i.kind !== 'same');
    const scope = plan.scope?.type === 'module' ? `module “${doc.modules?.[0]?.name || plan.scope.moduleId}”` : 'full project';
    let mode = 'merge';
    const counts = Object.entries(plan.counts).map(([k, n]) => h('span', { class: 'chip plain chip-outline' }, `${KIND_LABEL[k]}: ${n}`));
    const tbody = h('tbody');
    const renderRows = () => tbody.replaceChildren(...changes.map((it) => {
      const fixed = ['memberClash', 'skippedDeleted', 'localNewer'].includes(it.kind);
      const cb = h('input', { type: 'checkbox', checked: it.take, disabled: fixed && it.kind !== 'localNewer', 'aria-label': `Apply incoming change to ${it.label}` });
      cb.addEventListener('change', () => { it.take = cb.checked; });
      const diff = it.local && it.incoming ? diffFields(it.local, it.incoming).filter((d) => !['createdAt', 'createdBy'].includes(d.field)) : [];
      return h('tr', null,
        h('td', null, cb),
        h('td', null, it.entityType),
        h('td', { class: 'title-cell' }, it.label || it.id, it.kind === 'keyClash' ? h('div', { class: 'sub' }, 'Will be imported with the next free key.') : null),
        h('td', null, h('span', { class: ['chip plain', it.kind === 'conflict' || it.kind === 'remoteDeleted' ? 'chip-review' : it.kind === 'new' ? 'chip-approved' : ''] }, KIND_LABEL[it.kind])),
        h('td', { class: 'small' }, diff.length ? diff.slice(0, 6).map((d) => FIELD_LABELS[d.field] || d.field).join(', ') + (diff.length > 6 ? '…' : '') : it.kind === 'remoteDeleted' ? 'Removed in file' : '—'),
        h('td', { class: 'small nowrap' }, it.local ? `v${it.local.version ?? '?'}` : '—', ' → ', it.incoming ? `v${it.incoming.version ?? '?'}` : '∅'));
    }));
    renderRows();

    const backupCb = h('input', { type: 'checkbox', checked: true });
    const modeRadios = h('div', { class: 'stack', style: { gap: '8px' }, role: 'radiogroup', 'aria-label': 'Import mode' },
      h('label', { class: 'check' }, h('input', { type: 'radio', name: 'mode', value: 'merge', checked: true, onChange: () => { mode = 'merge'; tableCard.hidden = false; } }),
        h('span', null, h('strong', null, 'Merge (recommended)'), h('span', { class: 'muted' }, ' — add new records, update when the file is newer, keep local when local is newer. Conflicts are kept local unless you tick them.'))),
      store.can('data.reset') && h('label', { class: 'check' }, h('input', { type: 'radio', name: 'mode', value: 'replace', onChange: () => { mode = 'replace'; tableCard.hidden = true; } }),
        h('span', null, h('strong', null, 'Replace all local data'), h('span', { class: 'muted' }, ' — restore a backup or start from the team file. Local-only records are removed.'))));

    const tableCard = h('div', { class: 'table-wrap', style: { maxHeight: '420px', border: '1px solid var(--border)', borderRadius: 'var(--radius)' } },
      changes.length ? h('table', { class: 'table import-table' },
        h('thead', null, h('tr', null, ['Apply', 'Type', 'Record', 'Change', 'Fields', 'Version'].map((t) => h('th', { scope: 'col' }, t)))),
        tbody) : emptyState({ iconName: 'check', title: 'Everything in this file already matches local data', text: plan.newActivity.length ? `${plural(plan.newActivity.length, 'history event')} will still be added.` : '' }));

    const apply = async () => {
      if (!canImport) return toast('Your role cannot import. Ask a Maintainer or Admin.', { type: 'error' });
      const ok = await confirmDialog(mode === 'replace'
        ? { title: 'Replace all local data?', message: `Every local record will be replaced with the contents of ${name} (${plural(doc.testCases?.length || 0, 'case')}).`, confirmLabel: 'Replace local data', danger: true, typed: 'REPLACE' }
        : { title: 'Apply merge?', message: `${plural(changes.filter((c) => c.take).length, 'change')} will be applied from ${name}${plan.newActivity.length ? `, plus ${plural(plan.newActivity.length, 'history event')}` : ''}.`, confirmLabel: 'Apply merge' });
      if (!ok) return;
      try {
        if (backupCb.checked) downloadFullJson(store, { silent: true });
        const result = await store.applyImport(plan, { mode, sourceName: name, incoming: doc });
        // The page re-renders after the store changes, so report the outcome in a toast.
        toast(result.replaced
          ? `Replaced local data with ${name}: ${plural(result.cases, 'case')}.`
          : `Merged ${name}: ${result.added} added, ${result.updated} updated, ${result.deleted} removed, ${result.rekeyed} re-keyed, ${result.skipped} skipped, ${result.activity} history events.`, { timeout: 10000 });
      } catch (e) { toastError(e); }
    };

    preview.replaceChildren(...[
      h('div', { class: 'row' }, h('strong', null, name), h('span', { class: 'muted small' }, `· ${scope} · schema v${doc.schemaVersion}${doc.exportedAt ? ` · exported ${fmtDate(doc.exportedAt)}` : ''}`)),
      plan.warnings.length ? banner('warn', [h('strong', null, `${plural(plan.warnings.length, 'warning')}`), h('ul', null, plan.warnings.slice(0, 10).map((w) => h('li', null, w)))]) : null,
      h('div', { class: 'chips' }, counts, plan.newActivity.length ? h('span', { class: 'chip plain chip-outline' }, `New history events: ${plan.newActivity.length}`) : null),
      modeRadios,
      tableCard,
      h('label', { class: 'check small' }, backupCb, 'Download a backup of current local data first'),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn btn-primary', disabled: !canImport, onClick: apply }, 'Apply import'),
        h('button', { type: 'button', class: 'btn btn-ghost', onClick: () => preview.replaceChildren() }, 'Cancel')),
      !canImport ? banner('warn', 'Your role cannot apply imports. Ask a Maintainer or Admin, or switch profile.') : null,
    ].filter(Boolean));
    preview.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  const importCard = card({ title: 'Import', body: h('div', { class: 'stack' }, fileInput, drop, preview) });

  const gitCard = card({
    title: 'Team workflow with Git',
    body: h('div', { class: 'stack', style: { gap: '10px' } },
      h('p', { class: 'muted' }, 'QA Hub has no server. Sharing happens through reviewed JSON files in Git, never automatically.'),
      h('ol', { style: { margin: 0, paddingLeft: '20px', display: 'grid', gap: '6px' } },
        h('li', null, 'Pull the latest ', h('code', null, 'main'), ' of the qa-hub repository.'),
        h('li', null, 'Import the module files you will work on from ', h('code', null, 'data/modules/'), ' (Merge).'),
        h('li', null, 'Edit cases under your own profile.'),
        h('li', null, 'Export the changed modules (per-module JSON) and overwrite the files in ', h('code', null, 'data/modules/'), '.'),
        h('li', null, 'Commit on a feature branch and open a pull request. Review the JSON diff for duplicate IDs/keys and PHI.'),
        h('li', null, 'After merge, teammates pull and import the updated files.')),
      banner('info', 'Prefer one file per module to keep merge conflicts small. If two people edit the same case, the import preview flags it as a conflict instead of silently overwriting.'),
      banner('warn', 'Never commit real patient data, credentials, browser storage dumps or secrets.')),
  });

  root.append(h('div', { class: 'grid grid-2', style: { alignItems: 'start' } }, h('div', { class: 'stack' }, exportCard, gitCard), importCard));
}
