# Unified Popup Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every browser-owned dropdown and confirmation prompt with shared Lumora UI in local and remote windows.

**Architecture:** Extend the existing `SelectMenu` primitive only where current fields need accessibility or layout hooks, then migrate native selects without changing state behavior. Add one shared `ConfirmDialog` for the only browser confirmation and enforce the boundary with a renderer source contract.

**Tech Stack:** React 19, TypeScript 6, Testing Library, Vitest, semantic CSS variables.

---

### Task 1: Lock the renderer popup boundary

**Files:**
- Create: `src/renderer/src/ui/native-popup-contract.test.ts`

- [ ] Write a failing source scan that enumerates renderer TSX files and rejects `<select`, `window.confirm`, `window.alert`, `window.prompt`, and `title=`.
- [ ] Run `npx vitest run src/renderer/src/ui/native-popup-contract.test.ts` and confirm it reports the existing selects and terminal confirmation.

### Task 2: Complete the shared dropdown API

**Files:**
- Modify: `src/renderer/src/ui/SelectMenu.tsx`
- Modify: `src/renderer/src/ui/SelectMenu.test.tsx`
- Modify: `src/renderer/src/styles.css`

- [ ] Add failing tests for `aria-describedby`, optional wrapper class, disabled state, Escape focus restoration, and Home/End selection.
- [ ] Extend `SelectMenu` with optional `ariaDescribedBy` and `className` props while preserving its portaled fixed overlay.
- [ ] Keep all trigger and popup styles on Lumora semantic variables and verify the focused tests pass.

### Task 3: Migrate catalog and session workflow dropdowns

**Files:**
- Modify: `src/renderer/src/catalog/CatalogViews.tsx`
- Modify: `src/renderer/src/terminal/NewSessionDialog.tsx`
- Modify: `src/renderer/src/terminal/ResumeSessionDialog.tsx`
- Modify: `src/renderer/src/terminal/RuntimeRecoveryDialog.tsx`
- Modify: corresponding existing tests

- [ ] Add or adjust failing assertions that expect listbox triggers instead of native comboboxes.
- [ ] Convert provider, workspace, destination-provider, and terminal-profile fields to `SelectMenu` with unchanged option values and disabled conditions.
- [ ] Run the catalog and session-dialog suites and confirm local/remote shared behavior remains green.

### Task 4: Migrate settings and profile dropdowns

**Files:**
- Modify: `src/renderer/src/settings/GeneralSettingsPanel.tsx`
- Modify: `src/renderer/src/settings/AppearanceSettingsPanel.tsx`
- Modify: `src/renderer/src/settings/LaunchSettingsPanel.tsx`
- Modify: `src/renderer/src/terminal/TerminalProfiles.tsx`
- Modify: corresponding existing tests

- [ ] Update tests to operate through named Lumora menu triggers.
- [ ] Convert retention, image layout, launch scope/target/profile/command mode, and shell-family controls; convert numeric retention values at the state boundary.
- [ ] Run settings, profiles, App, and remote-window tests to verify persistence and target isolation.

### Task 5: Migrate Transfer dropdowns

**Files:**
- Modify: `src/renderer/src/transfer/SessionTransferExportSelection.tsx`
- Modify: `src/renderer/src/transfer/SessionTransferDialog.tsx`
- Modify: corresponding existing tests

- [ ] Update tests for Lumora provider filtering and workspace mapping menus.
- [ ] Preserve all-provider, skip-workspace, busy, mapping, and long-path labels while replacing native selects.
- [ ] Run both transfer workflow suites.

### Task 6: Replace the browser link confirmation

**Files:**
- Create: `src/renderer/src/ui/ConfirmDialog.tsx`
- Create: `src/renderer/src/ui/ConfirmDialog.test.tsx`
- Modify: `src/renderer/src/terminal/ManagedTerminal.tsx`
- Modify: `src/renderer/src/terminal/ManagedTerminal.test.tsx`

- [ ] Write failing tests for confirm, cancel, Escape, and focus restoration in the Lumora dialog.
- [ ] Queue a validated terminal hyperlink in component state, open `ConfirmDialog`, and invoke `api.openExternal` only after confirmation while the terminal remains mounted.
- [ ] Run the terminal tests and native-popup contract until both pass.

### Task 7: Verify and record

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `standards/ui/STANDARD.md`

- [ ] Record the unified renderer-popup rule and user-visible fix.
- [ ] Run `npx vitest run --maxWorkers=1`, `npm run typecheck`, and `npm run build`.
- [ ] Run `rg -n '<select|window\\.(confirm|alert|prompt)|title=' src/renderer/src -g '*.tsx'` and confirm no native popup UI remains.
- [ ] Commit the verified implementation on `feat/remote-session-runtime` without merging main before manual review.
