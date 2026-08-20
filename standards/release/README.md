# Release standard

Every user-visible change after Lumora 0.1.0 must be recorded in
`CHANGELOG.md`. Version changes must keep `package.json`, the lockfile, release
documentation, artifact names, and tags consistent.

## Release gate

Before tagging:

1. run `npm ci` from the committed lockfile;
2. run `npm run verify`;
3. review the changelog and user documentation;
4. run the release-tag verification script;
5. build each native target through GitHub Actions on its host OS;
6. run package-layout verification against every artifact;
7. manually smoke-test installation, startup, provider discovery, terminal
   launch/exit, settings persistence, and uninstall behavior.

Unsigned MVP packages must state that they are unsigned. Signing credentials,
notarization secrets, and personal certificate instructions must never enter
the repository.

Electron Builder must receive explicit publish behavior. Ordinary package jobs
build artifacts without implicit publishing; release jobs attach artifacts only
to the intended GitHub release. Failed verification must prevent publication.

Transfer support requires separate native verification records for each
provider/version/platform route. An implementation or development test is not
release evidence.

## Application release checks

Release metadata checks must run in the main process, never the renderer. Only
stable releases from the exact `HAYASAKA7/Lumora` GitHub repository are valid.
Responses and displayed summaries must be bounded, validated, and free of HTML.
Checks use one global cache for at least 12 hours, coalesce concurrent windows,
and must never delay application startup. Renderer APIs may request the fixed
project page or the last validated release page; they must not supply URLs.

Do not add automatic downloading or installation until Windows signing and
macOS signing/notarization are operational and every release publishes verified
updater metadata for its supported platform and architecture.

## Canonical references

- `docs/RELEASING.md`
- `CHANGELOG.md`
- `electron-builder.yml`
- `.github/workflows/`
- `scripts/release/verify-release-tag.cjs`
- `scripts/release/verify-package.cjs`

## Review checklist

- Is the version and changelog accurate?
- Do Windows, macOS x64/arm64, and Linux jobs use explicit targets?
- Are artifacts verified before upload?
- Are publishing, signing, and prerelease status deliberate?
- Can a developer reproduce the build from the lockfile?
