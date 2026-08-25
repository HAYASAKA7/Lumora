# Localization standard

Lumora ships one user interface across every supported language. Localization
is part of feature completion, not a follow-up translation task.

## Bundled language rule

Every change that adds, removes, or changes user-visible text must update all
bundled language packs in the same change:

- English (`en`)
- Simplified Chinese (`zh-Hans`)
- Traditional Chinese (`zh-Hant`)
- Japanese (`ja`)
- Korean (`ko`)

All bundled catalogs must expose the same semantic message keys and valid ICU
parameters. Translations must use natural product language for the target
locale while keeping international names such as Lumora, AI, CLI, npm, Mods,
provider names, and command names unchanged where that is clearer.

User-facing code must call the localization layer with semantic keys. It must
not embed English fallback text in components or build sentences by joining
translated fragments. Locale selectors display each language in its own name.

## Verification

Run the locale validation script and bundled-locales renderer tests whenever
catalogs or localized UI change. Missing keys, unexpected keys, invalid ICU
syntax, and untranslated placeholder values block completion.

## Canonical references

- `resources/locales/`
- `src/main/localization/`
- `src/renderer/src/localization/`
- `scripts/localization/validate-locales.cjs`

## Review checklist

- Did every new or changed message reach all five bundled languages?
- Are semantic keys and ICU variables identical across catalogs?
- Are translations natural and product-accurate in each language?
- Does locale validation pass without fallback-dependent gaps?
