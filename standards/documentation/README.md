# Documentation standard

Documentation must describe the current product truth and have one clear
audience.

## Ownership

- `README.md` is the user guide: purpose, supported platforms, installation,
  first run, core workflows, screenshots, and links to help.
- `docs/DEVELOPMENT.md` covers local development and verification.
- `docs/ARCHITECTURE.md` explains system design and durable boundaries.
- `docs/RELEASING.md` covers packaging and release operations.
- `docs/TROUBLESHOOTING.md` owns recoverable user and developer failures.
- `docs/PROVIDER_SUPPORT.md` owns provider capability truth.
- `docs/SESSION_TRANSFER.md` owns transfer use and limitations.
- `standards/` contains normative engineering rules.
- `CHANGELOG.md` records released and upcoming user-visible changes.

Do not duplicate long instructions across documents. Keep a canonical section
and link to it with relative Markdown links. Use Lumora as the product name and
HAYASAKA7 as the author where metadata requires an author.

## Quality

Write concise, actionable text. Commands must be copyable, paths and filenames
must be accurate, and platform-specific steps must be labeled. Distinguish
implemented, experimental, verified, known issue, and future scope. Never
present planned capability as available.

Update or remove outdated statements in the same change that makes them false.
Screenshots and recordings must have descriptive placement and should avoid
private paths, accounts, provider credentials, or session content.

Private design specifications, patents, signing notes, personal logs,
`docs/superpowers`, `.gax`, generated output, and machine-specific artifacts
must remain ignored and outside public documentation.

## Review checklist

- Is this information in the correct canonical document?
- Does it match current behavior, version, and support evidence?
- Are links, commands, headings, and platform labels correct?
- Does it avoid private or sensitive information?
- Can obsolete text be removed instead of accumulating another caveat?
