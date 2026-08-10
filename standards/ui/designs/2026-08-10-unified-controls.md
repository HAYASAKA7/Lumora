# Unified popup controls design

## Outcome

Lumora must not expose browser- or operating-system-owned popup UI inside its
renderer. Local and remote windows use the same theme-aware dropdown and
confirmation surfaces, with no behavior or data-model changes.

## Inventory and scope

The current renderer contains two inconsistent patterns:

- native `select` elements in catalog filters, new/resume/recovery workflows,
  terminal profiles, General, Appearance, Launch, and Transfer;
- one `window.confirm` prompt before opening a terminal hyperlink.

Checkboxes, radios, buttons, tooltips, and existing workflow dialogs already
use Lumora-owned styles and stay unchanged.

## Components

`SelectMenu` remains the only dropdown primitive. It continues to portal its
option list outside scrolling dialogs, clamps the popup to the viewport, uses
semantic appearance variables, supports disabled and empty states, and exposes
listbox keyboard semantics. It gains only the optional accessibility and class
hooks required by existing fields.

`ConfirmDialog` is a small shared dialog built from Lumora's established
`dialog-backdrop`, `new-session-dialog`, `dialog-body`, and `modal-actions`
structure. Managed terminals use it for external-link confirmation instead of
blocking the renderer with `window.confirm`.

## Migration contract

Every native select is converted without changing option order, labels, values,
disabled conditions, state transitions, or persistence. Shared session dialogs
therefore fix both local Lumora and remote Lumora automatically. A source-level
contract test rejects future native `select`, `window.confirm`, `window.alert`,
`window.prompt`, and browser-native `title` usage in renderer TSX files.

## Verification

Focused component tests cover selection, keyboard navigation, portal behavior,
disabled controls, accessibility descriptions, and terminal-link confirmation.
Existing page tests verify state behavior. The completion gate is the full
renderer suite, TypeScript typecheck, production build, and the native-popup
contract scan.
