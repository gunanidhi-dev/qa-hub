# QA Hub

QA Hub is a frontend-only app for documenting and managing manual and automated test cases for the healthcare web application. It is written in plain HTML, CSS and JavaScript (ES modules). There is no backend, no framework and no build step.

Data is stored in your browser's IndexedDB. The team shares data by exporting JSON files, committing them to Git and importing them in other browsers. Nothing syncs automatically.

## Run it

ES modules need to be served over HTTP. Opening `index.html` with `file://` does not work.

```bash
npm start            # node scripts/serve.js  →  http://127.0.0.1:5173/
```

The server has no dependencies, so `npm install` is not needed. It needs Node 20 or later (Node 22 or later for the UI smoke test).

### IP access restriction

The bundled server permits only `100.31.136.152` and `120.56.46.9`. Every other address, including localhost, receives HTTP 403 before any files are read. IPv4-mapped IPv6 connections are supported. The allowlist is in `scripts/ip-access.js`.

Use `npm start` to enforce this restriction; other static servers do not apply it. For direct network access, set `HOST` to the server's network interface (for example, `$env:HOST = '0.0.0.0'` in PowerShell) before starting. The default bind address remains `127.0.0.1`.

The server checks the TCP peer address and ignores forwarding headers. If hosted behind a reverse proxy or CDN, enforce these two allowed client IPs at that trusted entry point and prevent direct origin access; the bundled server will otherwise see and reject the proxy's address. Previously downloaded browser data is not removed by this restriction. The existing local UI smoke test is blocked by the allowlist as well.

On first launch the app seeds this browser from `data/library.json` (the Patient Manager library: 3,815 cases in 19 modules) and shows the sign-in screen.

## Sign-in setup (once per machine)

Passwords are never stored in the repository. Each machine that runs QA Hub needs a local, git-ignored `data/users.local.json` with salted PBKDF2-SHA256 hashes:

```bash
# users.txt (keep it OUTSIDE the repo, delete it afterwards) — one "username:password" per line:
#   gunanidhi:<password>
node scripts/create-users.js path/to/users.txt
```

To add or replace a few users without touching the others, use `node scripts/create-users.js --add new-users.txt`.

Usernames must match team members in the library (`dossmk`, `gunanidhi`, `selshiya`, `sujitha`, `santhiya`, `marivijayakumar`, `samnikesh`, `vignesh`). Re-running the script replaces the file. If `data/users.local.json` is missing or cannot be loaded, QA Hub stays on a disabled sign-in screen with a configuration error; it does not fall back to the profile picker.

Sessions last until the tab closes, or 12 hours with "Keep me signed in". After 5 wrong passwords the form waits 15 s, then longer. Sign out from the account button in the top bar.

> **This is not real security.** There is no server. Anyone with the app files or DevTools can skip the sign-in or edit IndexedDB, and a leaked `users.local.json` can be brute-forced offline. It only keeps honest teammates on their own name in the activity log. Use long, unique passwords and never commit `data/users.local.json`.

## Test library and categories

`data/library.json` is generated from the Markdown test cases (one file per module, `# Module` › `## Feature (N)` › `### N. Title — scenario`, `**Test data:**`, and a `| Step | Action | Expected result |` table):

```bash
node scripts/import-markdown.js ../patientmanager-testing-analysis/testing-analysis/testcases
```

The output is deterministic: fixed IDs (`case-<module>-0001`), keys (`LOGIN-001`, `PAT-001`, …) and timestamps, so re-running on unchanged Markdown gives an identical file. The script warns when a feature heading's declared count does not match the cases found. Imported cases start as **Ready for Review**.

Suites (categories) are assigned by [js/library-rules.js](js/library-rules.js) from the scenario text after the em dash and from the module. A case can be in several:

| Suite | Rule | When to run |
| --- | --- | --- |
| Smoke | "opens and loads its data", all login cases | Every deploy |
| Sanity | Happy paths: saves with valid details, shows correct data, deletes, toggles, full amount, valid upload | After a small change or hotfix |
| Regression | Every case | Before every release |
| Negative | Rejected, invalid, missing, wrong file type, already deleted, not allowed | With regression |
| Boundary | Maximum length, size limit, zero/over-limit, rounding, partial amount | With regression |
| Tenant Isolation | Cannot see/change another company's data; anything mentioning Company B | Before every release |
| Security | Login module, security module, tenant isolation | Before every release |
| Integration | External service declines, fails or times out; external-services module | With regression |
| End-to-End | end-to-end-flows module | Before every release |
| Data Integrity | data-checks module | Before every release |
| Admin Features | Users/companies/settings, practice setup and subscription billing modules, plus admin, role, permission and access-level cases | When admin screens change |
| Release Critical | Tenant isolation, security, E2E, key login cases, money happy paths and rounding | Must pass before production |

Priority follows the same rules: tenant isolation and security are **Critical**; happy paths, smoke and money cases are **High**; negative and boundary are **Medium**. Each case also gets a test level, risk, tags, an objective and its Markdown source (`requirementRef`, e.g. `login.md#12`). Every imported record is created by **DossMK**. Cases start **unassigned** and modules start without an owner.

Members and roles in the library: **DossMK** and **Gunanidhi** (Admin), **Selshiya** (Maintainer), and Sujitha, Santhiya, Marivijayakumar, Samnikesh and Vignesh (Contributor). An Admin can change roles on the Team page.

### Assigning work (Admin only)

Only an Admin can set or change a case's assignee (in the editor, in bulk edit, or on the **Assign work** page). The Assign work page filters by module, feature, suite, priority and status, and assigns all matching cases to a member in one step (optionally only the unassigned ones). It also shows each member's workload and lets the Admin set module owners and hand a module's unassigned cases to its owner. When a Contributor edits a case, the Admin's assignment is kept.

### Updating the library

Re-running the import writes `data/library.json` and `data/library.meta.json` with a new `libraryRevision`. A browser that seeded an older library loads the new one automatically if nothing was ever edited there. If it has local edits, a notice offers **Load library**, which asks for confirmation first: export your work before you accept, because loading replaces all data in that browser.

## Tests

```bash
npm test             # unit tests: store, validation, import/merge, CSV, fixtures (node:test)
npm run test:ui      # end-to-end smoke test in headless Chrome/Edge via DevTools protocol
node tests/ui/smoke.mjs --shots ./shots   # same, and save screenshots
```

The UI smoke test runs the Phase 1 acceptance flow against the real app. It signs in with a throwaway credential served by the test itself (the real `users.local.json` is never read), checks that a wrong password is rejected and that the 3,815-case library is seeded. It creates two cases (including an inline validation check), reloads the page, edits a case (checking the version bump and field-level history) and checks the unsaved-changes guard. It then moves a case to trash and restores it, and renders every page. Next it exports JSON, wipes browser storage, and imports the file into the clean browser with Replace, checking that IDs, keys, versions and all history events are intact. It signs out and back in, and finishes with the mobile layout (no horizontal scroll) and dark theme. It also fails if the browser reports any console error. Set `CHROME_PATH` if Chrome or Edge is not in a standard location.

## What's included

| Area | Status |
| --- | --- |
| Dashboard: totals, status/priority/level/suite/assignee/account/automation breakdowns, module coverage against an entered target, 14-day trend, assigned to me, awaiting review, recent edits | ✅ |
| Test case library: search, filters (module, feature, status, priority, suite, level, automation, assignee, account, tag), sort, pagination, column visibility, saved filters, multi-select, bulk edit, bulk trash, CSV export | ✅ |
| Case editor: create, edit and duplicate; inline validation; dynamic steps; unsaved-change guard; local draft recovery after refresh; `Ctrl/⌘+S` | ✅ |
| Case detail: steps, metadata, ownership, review actions, field-level history | ✅ |
| Review workflow: Draft → Ready for Review → Approved, or Send back with a required note | ✅ |
| Soft delete with reason, restore, Admin-only permanent delete with typed confirmation and a tombstone | ✅ |
| Modules & features: create, edit, archive/unarchive, owners, targets, counts | ✅ |
| Test suites (a case can be in several), account labels; a label in use cannot be deleted without explicitly removing it from those cases | ✅ |
| Activity log with filters by actor, action, module, record type and date | ✅ |
| Team: local profiles, roles, workload, deactivate | ✅ |
| Import/Export: full JSON, per-module JSON, CSV; import validation, preview, merge with conflict detection, or Replace | ✅ |
| Settings: project name, backup reminder, theme, accounts, storage status, Clear demo data, Erase local data | ✅ |
| Light/dark theme, responsive layout (table becomes cards on phones), keyboard shortcuts, ARIA dialogs, reduced motion | ✅ |
| Cross-tab refresh (BroadcastChannel) and stale-edit detection by record version | ✅ |
| **Test Runs** (manual execution tracking) | ❌ Not built yet (Phase 3). It is left out of the navigation rather than shown as a placeholder. |

Keyboard shortcuts: `/` search, `N` new case (when not typing), `Ctrl/⌘+S` save in the editor, `Esc` close dialog or menu, `?` help.

## Data model

There is one versioned JSON document (`schemaVersion: 1`) with these collections: `members`, `accounts`, `modules`, `features`, `testCases`, `testSuites`, `testRuns`, `activity` and `deletedItems`. See [js/schema.js](js/schema.js).

- Every record has a stable `id`, a `version` that goes up on every change, and ISO 8601 `createdAt`/`updatedAt` timestamps.
- `caseKey` values (e.g. `PAT-001`) come from the module prefix and are **never renumbered or reused**. When a case is permanently deleted, a tombstone stays in `deletedItems` so that its key and ID cannot come back on a later import.
- These fields are kept separate on purpose: **suite** (Smoke/Regression…), **test level** (UI/API/E2E…), **priority**, **case status** (Draft…Deprecated) and **automation status**. Run outcomes will be separate again when Test Runs exist.
- Seed records use fixed IDs and timestamps. This means two browsers that seed independently produce identical data and merge cleanly.

### Storage and backups

- IndexedDB holds all data. `localStorage` holds only UI preferences (theme, active profile, columns, page size, saved filters).
- **Clearing site data, using a private window or switching browsers loses anything you have not exported.** The top bar shows "Unexported changes", and a reminder appears on launch (configurable in Settings).
- Export: **Download full JSON** (backup), **per-module JSON** (for Git) and **CSV** (filtered list, selection or all).
- Import validates the schema version, required fields, enums, duplicate IDs and keys, and references (to the file or to local data). It then shows a preview before changing anything:
  - *New*: added.
  - *Identical*: skipped.
  - *Incoming is newer*: updated.
  - *Local is newer*: kept.
  - *Conflict* (same version, different content): local is kept unless you tick it.
  - *Case key clash*: imported with the next free key, and the change is logged.
  - *Deleted in incoming file*: the tombstone is applied.

  Imports never silently overwrite a newer local record. A backup download is offered before you apply.
- If the browser's storage quota is exceeded, saving fails with a message telling you to export immediately. Unsaved editor input is kept as a draft.

## Team workflow with Git (no backend)

Keep this app in a private `qa-hub` repository. Shared test definitions go in `data/modules/<module>.json`, one file per module, which keeps merge conflicts small. **The browser never writes to these files itself.**

1. `git pull` the latest `main`.
2. In QA Hub, go to **Import / Export** and import the module files you will work on (**Merge**).
3. Edit cases under your own profile.
4. Export each changed module (**per-module JSON**) and overwrite `data/modules/<module>.json`.
5. Commit on a feature branch and open a pull request.
6. The reviewer checks the JSON diff for duplicate IDs or keys, schema validity and any PHI or secrets. Running `npm test` validates the committed data files.
7. After merge, teammates pull and import the updated files.

If two people edit the same case at the same time, the import preview marks it as a conflict. Decide in review which version wins. If two people create cases in the same module at the same time, both may pick the same next key; the importer re-keys the incoming one and logs it. Agreeing on module ownership avoids most of this.

`data/sample-data.json` and `data/modules/{authentication,patients}.json` contain the starter content. Regenerate them with `node scripts/build-sample-data.js`.

**Never commit** real patient data, credentials, API tokens, browser storage dumps or environment secrets. Keep QA Hub data out of the healthcare app's staging and production deployment paths.

## Known limitations (by design)

- **Identity is checked only in the browser.** The sign-in compares a PBKDF2 hash in the page; it is not secure server-side authentication. Without `data/users.local.json`, sign-in is disabled. This UI gate does not protect files published by a static host.
- **Roles (Admin, Maintainer, Contributor, Viewer) are UI conveniences, not access control.** Anyone with the static files, DevTools or the JSON can bypass them.
- **This is an activity log, not a compliance-grade audit trail.** Actor IDs and timestamps come from the browser and can be edited. Git history adds reviewable provenance but does not authenticate in-app actors. Regulated auditability would need a backend with real authentication and append-only server-side logging.
- **There is no real-time collaboration.** Your edits are visible to others only after an export, a commit and their import. Concurrent edits are detected on import, not prevented.
- **Permanent delete only affects this browser.** Copies in exported files, Git history and other browsers stay until those are updated.
- Attachments and screenshots are not stored. Use safe relative links in text fields instead.
- Test Runs (manual execution tracking) are not implemented yet.
- Performance has been checked at the logic level with 3,000 synthetic cases (`npm test`) and in the UI smoke test with the 3,815-case library (list, dashboard, suites, export and Replace import).

## Project structure

```text
index.html                 app shell (loads js/app.js)
css/tokens.css             design tokens, light/dark themes
css/layout.css             shell, grid, responsive rules
css/components.css         buttons, forms, tables, chips, dialogs, toasts…
css/login.css              sign-in screen
js/app.js                  bootstrap, sign-in gate, shell, shortcuts, cross-tab sync
js/auth.js                 PBKDF2 verify, session, retry slow-down (browser + Node)
js/library-rules.js        suite/priority/level classification for imported cases
js/router.js               hash router with unsaved-change guard
js/store.js                state + all mutations (persist first, then notify); DOM-free
js/db.js                   IndexedDB adapter + in-memory adapter (tests/fallback)
js/schema.js               enums, record shapes, factories
js/validation.js           case/module/member/import validation
js/import-export.js        export builder, CSV, merge planner, key counters
js/activity.js             activity events + field diffs
js/seed.js                 fallback seed (unit tests / no library.json)
js/components/             modal, toast, timeline, small UI helpers
js/pages/                  login, assign (Admin), dashboard, cases, case-detail, case-editor, modules, suites,
                           activity, trash, team, data (import/export), settings
data/library.json          generated test library (seed for new browsers)
data/library.meta.json     library revision, used to offer updates
data/users.local.json      local password hashes — git-ignored, never commit
data/                      shared JSON for Git (sample + per-module)
scripts/serve.js           zero-dependency static server
scripts/import-markdown.js Markdown test cases → data/library.json
scripts/create-users.js    username:password list → data/users.local.json (hashes only)
scripts/build-sample-data.js
tests/*.test.js            unit tests (node:test)
tests/ui/smoke.mjs         headless browser end-to-end smoke test
```

All user-entered text is rendered with `textContent` through the `h()` helper in [js/utils.js](js/utils.js). No user content is ever passed to `innerHTML`. CSV export neutralises spreadsheet formula injection. Core features make no network calls.
