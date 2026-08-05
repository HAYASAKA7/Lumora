# Data and storage standard

SQLite repositories and filesystem stores must preserve user data across
upgrades, isolate execution targets, and keep sensitive or provider-owned
content out of Lumora's catalog.

## SQLite

- Schema changes must append a numbered migration; never edit the meaning of an
  already released migration.
- Migrations must run in order, use transactions where supported, tolerate a
  clean database and every supported legacy shape, and leave foreign-key checks
  clean.
- New target-owned rows must include and query by `execution_target_id`.
- Repositories own SQL and parse serialized JSON before returning domain data.
- Use STRICT tables, constraints, indexes, and foreign keys for invariants.
- Timestamps use ISO-8601 UTC strings; IDs are stable opaque identities.

Do not infer that a table exists because another migration completed. Startup
must migrate before repositories or reset operations query new tables.

## Filesystem state

Development and packaged builds must use separate application-data paths.
Window state, appearance assets, handoff copies, and transfer staging must live
under their documented managed directories. Temporary files must use private
names, bounded retention, startup cleanup, and idempotent deletion.

The catalog stores session metadata only. Original provider session files are
read-only inputs. Transfer and handoff copies are explicit, scoped exceptions
with user intent and cleanup rules.

## Canonical references

- `src/main/storage/migrations.ts`
- `src/main/storage/catalog-repository.ts`
- `src/main/storage/execution-target-repository.ts`
- `src/main/development-data-paths.ts`
- `src/main/appearance/appearance-background-store.ts`

## Review checklist

- Does the migration work from clean and legacy databases?
- Are foreign keys, indexes, uniqueness, and target scope correct?
- Can failure leave a partial durable state?
- Is provider-owned or sensitive content being stored unnecessarily?
- Is retention and cleanup bounded and idempotent?
