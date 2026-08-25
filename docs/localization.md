# Lumora localization

Lumora ships with English, Simplified Chinese, Traditional Chinese, Japanese,
and Korean. On first use, Lumora follows the operating-system language when it
is supported and otherwise falls back to English. **Settings > General >
Language** lists the explicit language choices using their native names. The
choice is global across the local window, Remote Lumora windows, tray or
menu-bar menus, notifications, dialogs, dates, times, and counts.

Lumora translates only application-owned interface text. Provider TUI output,
commands, prompts, session and workspace names, paths, host data, diagnostic
logs, and stable error codes stay unchanged.

## Mods and user language packs

Open **Settings > Mods** to manage Lumora's data-only customization directory.
The default location is inside Lumora's per-user application data, but users
can select another writable directory on any local drive, including a writable
folder beside a portable installation. Language packs live under its `locales`
folder, data-only font presets live under `fonts`, and data-only theme packs
live under `themes`. Do not modify bundled
packs inside the Lumora installation. A user pack can add a locale or override
part of an existing locale without changing application code.

Changing the Mods directory does not move or delete files. Lumora continues to
load packs from the former managed per-user `locales` directory for backward
compatibility. When the same locale exists in more than one place, the active
Mods pack overrides the legacy user pack, which overrides bundled messages.

Each pack uses a canonical locale tag as its folder name:

```text
locales/
  fr/
    manifest.json
    common.json
    shell.json
    catalog.json
    terminal.json
    settings.json
    providers.json
    remote.json
    transfer.json
    errors.json
```

`manifest.json` uses this schema:

```json
{
  "schemaVersion": 1,
  "catalogVersion": 1,
  "locale": "fr",
  "displayName": "Français",
  "direction": "ltr"
}
```

The folder and `locale` value must be the same canonical BCP 47 tag. Direction
is `ltr` or `rtl`. A user pack may omit namespace files and message keys; Lumora
fills missing messages from the matching bundled pack and then immutable
bundled English. Copy keys and ICU arguments exactly from
`resources/locales/en`. Translate message values only. Product and provider
names, commands, paths, shortcut notation, and placeholders such as `{count}`
must remain intact.

Use **Reload languages** in **Settings > Mods** after saving changes. Reload is
atomic: Lumora keeps the last valid catalog if the new files cannot be
accepted. Compatibility warnings appear when a pack targets another catalog
version or contains unknown keys. Invalid packs are rejected individually and
never replace bundled English.

## Safety limits

Language packs are local JSON data, not executable extensions. Lumora rejects
symbolic links, files outside the managed root, unexpected files, unsafe keys,
invalid ICU messages, excessive nesting, oversized messages, and oversized or
excessive packs. Current limits are 64 packs, 512 KiB per file, 4 MiB per pack,
32 MiB for the user locale root, 10,000 messages per pack, eight nesting levels,
and 16,384 code points per message.

If a pack is rejected, review the warning in Mods settings, compare its
manifest and placeholders with the current English catalog, and reload. Rename
or remove the invalid folder to return immediately to bundled translations.

## Font presets

Font presets are optional JSON files in the active Mods root's `fonts` folder.
They select fonts already installed on the local computer; they do not contain,
download, or install font files. Open **Settings > Appearance**, reload the
preset list, and choose a preset to apply its available interface or terminal
font fields.

The filename must match the preset `id`. For example, `coding-fonts.json`:

```json
{
  "schemaVersion": 1,
  "id": "coding-fonts",
  "displayName": "Coding fonts",
  "interfaceFontFamily": "Inter",
  "terminalFontFamily": "JetBrains Mono"
}
```

At least one font-family field is required. A preset may omit the other field,
in which case applying it leaves that existing choice unchanged. Font names are
treated as data and are combined with Lumora's safe platform fallback stacks.
Remote Lumora renders with fonts available on the local computer, because its
window is local even when its provider processes run over SSH.

Lumora reads at most 64 preset files, limits each file to 64 KiB, validates the
schema and filename, and rejects symbolic links or other non-regular files.
Invalid presets are isolated and reported without blocking healthy presets.
Use **Open font presets** in **Settings > Mods** to open the exact active folder.
Font-file import is intentionally deferred to a later customization phase.

## Theme packs

Theme packs are optional JSON files in the active Mods root's `themes` folder.
They customize Lumora through a fixed semantic palette rather than exposing
individual component selectors. Open **Settings > Appearance**, choose a pack,
review its color preview, and apply it. Use **Open theme packs** in **Settings >
Mods** to open the exact active folder.

The filename must match the pack `id`. For example, `midnight-cyan.json`:

```json
{
  "schemaVersion": 1,
  "id": "midnight-cyan",
  "displayName": "Midnight cyan",
  "baseTheme": "dark",
  "palette": {
    "accent": "#24c7d9",
    "onAccent": "#041014",
    "background": "#07111d",
    "sidebar": "#07131f",
    "sidebarText": "#d9f8ff",
    "surface": "#102033",
    "surfaceRaised": "#172b42",
    "control": "#1b3048",
    "text": "#eaf8ff",
    "textMuted": "#a7c0cf",
    "border": "#35506a",
    "success": "#55d6a8",
    "warning": "#f4c96b",
    "danger": "#ff7d91"
  }
}
```

`baseTheme` selects Lumora's compatible light or dark terminal palette while
the semantic colors style application chrome, pages, cards, controls, dialogs,
and the terminal container. Provider-owned TUI colors remain provider output.
Lumora validates required colors and readable text contrast before exposing a
pack. It reads at most 64 files, limits each file to 64 KiB, rejects symbolic
links, malformed data, unsafe IDs, filename mismatches, and invalid contrast,
and falls back to the selected built-in theme if an active pack disappears.
Theme packs never execute code.

## Maintainer checks

Run these checks before submitting a built-in language change:

```powershell
npm run locales:validate
npm run locales:check-strings
npm test -- --run src/main/localization src/renderer/src/localization
```

`locales:validate` enforces complete bundled catalogs and ICU placeholder
parity. `locales:check-strings` prevents new Lumora-owned interface literals
from bypassing the catalog. Packaged builds place immutable bundled catalogs in
the application's `resources/locales` directory on Windows, macOS, and Linux.
