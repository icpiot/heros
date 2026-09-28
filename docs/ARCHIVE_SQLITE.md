# HEROS historical report archive

HEROS stores Web API daily reports in SQLite at `/config/heros-history/<entry_id>/archive.sqlite3`. Home Assistant's `/config` backup includes this path. The schema starts at version 1 (`PRAGMA user_version`). One row represents one provider, scope (aggregate or battery), and local report date; a SQLite primary key prevents duplicates. Typed daily totals and indexed dates support coverage and range queries. The dynamic provider report remains in `payload_json`. Modbus telemetry is outside this archive.

The old `/config/www/heros-history/<entry_id>/history.json` and any `.bak` files remain unchanged. At first setup, HEROS streams each JSON report into SQLite, validates it, and records migration completion in `migration_sources`. If setup is interrupted, the import can be rerun. Identical reports do not duplicate; conflicting reports and malformed records are reported instead of silently replacing them. The original JSON remains the rollback source. SQLite is authoritative after successful migration, including the Settings totals, missing days, and reports shown in the panel. A gap between two stored dates is an unrecorded calendar day; a provider-unavailable date is recorded separately. Neither is counted as stored history.

Downloads request one provider day at a time, commit each validated report, and checkpoint job progress separately from report rows. A new download skips dates already stored. Refresh explicitly refetches and may replace a row when provider data changed. Each date gets at most three attempts with bounded backoff. A failed day is recorded and the job reports failure rather than claiming a complete range. The current button becomes Cancel while its job runs; cancelling keeps committed reports and stops new requests after the in-flight request. A later missing-only download resumes the remaining dates. At startup, HEROS marks a persisted `running` job `interrupted` and resumes its requested range using committed SQLite rows as truth. A request that began but did not commit is safe to retry.

The report card requests bounded date ranges from the HEROS backend through `heros/archive_query`; it does not fetch the full legacy JSON archive. Only administrators may query this WebSocket command. Settings obtains coverage and status from the same database. The monthly maintenance refresh checks the previous two complete calendar months at the beginning of a month. Today's live provider polling remains separate from historical archive downloads.

## Backup and integrity

SQLite uses WAL mode with full synchronous durability. A consistent backup while HEROS is running must use the SQLite backup API, **not** copy only `archive.sqlite3`: uncheckpointed transactions may be in `archive.sqlite3-wal`. In Python with HEROS on its import path:

```python
from pathlib import Path
from custom_components.heros.archive_store import ArchiveStore
store = ArchiveStore(Path('/config/heros-history/ENTRY_ID/archive.sqlite3'), 'PROVIDER_KEY')
print(store.integrity_check())  # must print ok
store.backup(Path('/config/heros-history/ENTRY_ID/archive-backup.sqlite3'))
```

Back up the matching integration files, panel assets, JSON and `.bak` before any deployment. Verify `PRAGMA integrity_check` on both the active database and backup. If Home Assistant is fully stopped, a filesystem backup may copy the main database together with its `-wal` and `-shm` files, but the backup API is preferred. Do not delete the legacy JSON automatically. Avoid routine `VACUUM` or forced WAL checkpoints solely for housekeeping.

## Export and rollback

`ArchiveStore.export_csv(path, scope=None)` exports indexed typed totals. `ArchiveStore.export_legacy_json(path)` writes a new, legacy-compatible complete JSON file suitable for comparing with a pre-migration archive before reverting the runtime. Use a **new destination path** and compare row counts, per-scope dates, and representative records. If reports were committed after the SQLite switch, reconcile this export with the old JSON before rolling back so they are not silently lost. Preserve the failed database and its WAL for diagnosis. To restore SQLite, stop HEROS writes, restore a verified backup to the entry's archive path, and check integrity before reloading.

The database stores daily Web API reports only. When future Modbus logging is designed, its sampling frequency, schema, retention, and aggregation must be assessed separately; it is not added to the daily report table.
