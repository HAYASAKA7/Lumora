# Lumora engineering standards

This directory is Lumora's normative engineering rulebook. It records the
patterns that new code and reviews must follow. Public explanations remain in
`docs/`; these standards define how the product is changed.

The words **must**, **must not**, **should**, and **may** are intentional:

- **must / must not**: required for acceptance;
- **should**: expected unless a review records a concrete reason;
- **may**: optional and compatible with the architecture.

## Standards index

| Area | Standard |
| --- | --- |
| Process and ownership boundaries | [Architecture](architecture/README.md) |
| Components, dialogs, accessibility, and themes | [UI](ui/README.md) |
| Renderer-to-main contracts and IPC | [API and IPC](api/README.md) |
| TypeScript and implementation practices | [Coding](coding/README.md) |
| Privileged operations and untrusted input | [Security](security/README.md) |
| Automated verification and regression coverage | [Testing](testing/README.md) |
| SQLite, settings, paths, and retention | [Data and storage](data-storage/README.md) |
| Agent discovery, launch, sessions, and transfer | [Providers](providers/README.md) |
| Windows, macOS, Linux, and remote targets | [Cross-platform](cross-platform/README.md) |
| Scanning, terminal output, and renderer responsiveness | [Performance](performance/README.md) |
| Versions, packages, and GitHub Actions | [Release](release/README.md) |
| User, developer, and product documentation | [Documentation](documentation/README.md) |
| Bundled languages and translatable UI | [Localization](localization/README.md) |

## Using these standards

Before implementation, identify the standards affected by the change. During
review, use the checklist at the end of each relevant standard. A change that
introduces a new durable pattern must update the appropriate standard in the
same commit.

Code and tests remain executable evidence. If they conflict with a standard,
the change must either restore compliance or deliberately update the standard
and its canonical examples. Do not silently allow documentation to drift.

Standards must stay public, product-specific, concise, and free of private
design notes, credentials, machine paths, patents, or generated artifacts.
