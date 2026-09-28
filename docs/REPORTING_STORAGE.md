# Reporting storage

HEROS's current Web API daily report archive is SQLite at `/config/heros-history/<entry_id>/archive.sqlite3`. Each provider, scope, and local date has at most one validated report row. The database also records unavailable dates, a separate download job checkpoint, and explicit migration results. Settings coverage and report retrieval use this database as their source of truth. Live provider polling is separate.

The older `/config/www/heros-history/<entry_id>/history.json`, matching scope CSVs, and `.bak` files are retained as migration and rollback material. They are not rewritten when a new SQLite report is committed and are not the normal UI read path. The report and debug cards query bounded date ranges through `heros/archive_query` instead of downloading the full JSON archive.

Use [ARCHIVE_SQLITE.md](ARCHIVE_SQLITE.md) for schema, migration, retries, cancellation, restart recovery, backup, export, and rollback procedures. Use [REPORTING_PAYLOAD.md](REPORTING_PAYLOAD.md) for the normalized report format.

Future Modbus telemetry storage is a separate design decision. HEROS does not install or write to InfluxDB as part of the daily-report archive.
