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
folder. Do not modify bundled packs inside the Lumora installation. A user pack
can add a locale or override part of an existing locale without changing
application code.

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
