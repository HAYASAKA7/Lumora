# UI standard

## Reuse before invention

New UI must reuse an established Lumora component, structure, and semantic CSS
token before adding another pattern. Search nearby components and
`src/renderer/src/styles.css` first. A new primitive requires a reusable
component, focused tests, theme coverage, and a documented reason that existing
patterns do not fit.

Do not use hard-coded light/dark colors inside components. Surfaces, text,
borders, focus, status, shadows, and opacity must use semantic variables so
Lumora Mixed, Light, Dark, custom backgrounds, mosaic, and popup opacity remain
consistent.

## Dialogs and overlays

Workflow dialogs must use the established shell:

- `dialog-backdrop` for the viewport layer;
- `new-session-dialog` plus a feature class for the dialog;
- the standard header with `card-label`, title, and close action;
- `dialog-body` as the only scrolling region;
- a footer action row using existing button classes.

Dialog size must be stable after opening. Conditional workflows should reserve
space or replace content inside the body instead of repeatedly resizing the
shell.

Dropdowns, tooltips, and other transient option surfaces must overlay content.
They must be portaled outside the dialog's scrolling body, positioned against
their trigger, clamped to the viewport, and must not add dialog height or
scroll range. Use `SelectMenu` for every dropdown and a Lumora dialog for every
confirmation; browser-native `select`, `confirm`, `alert`, `prompt`, and
`title` tooltip UI are forbidden.

## Interaction and accessibility

- Use semantic roles, accessible names, `aria-modal`, and listbox/option state.
- Every pointer operation must have a keyboard path.
- Focus rings must remain visible and inside rounded component boundaries.
- Escape closes transient UI; closing restores focus when appropriate.
- App shortcuts must work while xterm is focused unless a documented native
  provider shortcut has priority.
- Interactive cards must expose hover and focus behavior without duplicating a
  redundant action button.

The terminal viewport must remain mounted across route changes and fit inside
its fixed workspace. UI changes must not recreate or interrupt a PTY.

## Canonical references

- Dialogs: `src/renderer/src/terminal/NewSessionDialog.tsx`
- Tooltips: `src/renderer/src/ui/Tooltip.tsx`
- Overlay selector: `src/renderer/src/ui/SelectMenu.tsx`
- Themes and surfaces: `src/renderer/src/appearance/`
- Dialog contract tests: `src/renderer/src/terminal/dialog-style-contract.test.tsx`
- Native-popup contract: `src/renderer/src/ui/native-popup-contract.test.tsx`

## Review checklist

- Does this match an existing Lumora pattern?
- Does opening transient UI leave surrounding layout unchanged?
- Are all themes, backgrounds, opacity tiers, and narrow windows readable?
- Are keyboard, focus, screen-reader, loading, empty, and error states covered?
- Is user-visible text concise and actionable?
