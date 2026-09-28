"""SQLite archive for HEROS daily provider reports.

The database lives under Home Assistant's persistent /config directory.  The
legacy JSON files are read for migration only and are never changed here.
"""
from __future__ import annotations

import hashlib
import csv
import json
import logging
import os
import sqlite3
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterator

_LOGGER = logging.getLogger(__name__)
SCHEMA_VERSION = 1
DB_FILE_NAME = "archive.sqlite3"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _date(value: str) -> str:
    parsed = date.fromisoformat(str(value))
    if parsed.isoformat() != value:
        raise ValueError(f"Invalid ISO date: {value!r}")
    return value


class _JSONStream:
    """Parse one JSON value at a time without holding the source file in RAM."""

    def __init__(self, path: Path) -> None:
        self.handle = path.open("r", encoding="utf-8")
        self.buffer = ""
        self.pos = 0
        self.eof = False

    def close(self) -> None:
        self.handle.close()

    def _fill(self) -> None:
        if self.pos < len(self.buffer) or self.eof:
            return
        self.buffer = self.handle.read(65536)
        self.pos = 0
        self.eof = not self.buffer

    def peek(self) -> str:
        self._fill()
        return self.buffer[self.pos] if not self.eof else ""

    def take(self) -> str:
        value = self.peek()
        if not value:
            raise ValueError("Unexpected end of legacy JSON")
        self.pos += 1
        return value

    def space(self) -> None:
        while self.peek() in " \t\r\n" and self.peek():
            self.pos += 1

    def expect(self, value: str) -> None:
        self.space()
        found = self.take()
        if found != value:
            raise ValueError(f"Expected {value!r}, found {found!r}")

    def value(self) -> Any:
        self.space()
        first = self.take()
        chunks = [first]
        if first in "{[":
            stack = ["}" if first == "{" else "]"]
            quoted = False
            escaped = False
            while stack:
                char = self.take()
                chunks.append(char)
                if quoted:
                    if escaped:
                        escaped = False
                    elif char == "\\":
                        escaped = True
                    elif char == '"':
                        quoted = False
                elif char == '"':
                    quoted = True
                elif char in "{[":
                    stack.append("}" if char == "{" else "]")
                elif char in "}]":
                    if char != stack.pop():
                        raise ValueError("Mismatched legacy JSON delimiter")
        elif first == '"':
            escaped = False
            while True:
                char = self.take()
                chunks.append(char)
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == '"':
                    break
        else:
            while self.peek() and self.peek() not in ",}] \t\r\n":
                chunks.append(self.take())
        return json.loads("".join(chunks))

    def pairs(self, callback: Callable[[str], None]) -> None:
        """Walk an object; callback consumes each value from this stream."""
        self.expect("{")
        self.space()
        if self.peek() == "}":
            self.take()
            return
        while True:
            key = self.value()
            if not isinstance(key, str):
                raise ValueError("Legacy JSON object key is not a string")
            self.expect(":")
            callback(key)
            self.space()
            char = self.take()
            if char == "}":
                return
            if char != ",":
                raise ValueError("Expected comma in legacy JSON object")


class ArchiveStore:
    """Entry-scoped daily archive and independent persisted job state."""

    def __init__(self, db_path: Path, provider: str = "bytewatt") -> None:
        self.path = Path(db_path)
        self.provider = str(provider or "unknown")

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.path, timeout=5)
        try:
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA busy_timeout=5000")
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=FULL")
            conn.execute("PRAGMA wal_autocheckpoint=256")
            self._schema(conn)
            yield conn
        finally:
            conn.close()

    def _schema(self, conn: sqlite3.Connection) -> None:
        version = conn.execute("PRAGMA user_version").fetchone()[0]
        if version > SCHEMA_VERSION:
            raise RuntimeError(f"Archive schema {version} is newer than HEROS supports")
        if version == 0:
            with conn:
                conn.executescript("""
                    CREATE TABLE IF NOT EXISTS reports (
                        provider TEXT NOT NULL,
                        scope_key TEXT NOT NULL,
                        report_date TEXT NOT NULL,
                        label TEXT NOT NULL,
                        solar_kwh REAL,
                        load_kwh REAL,
                        feed_in_kwh REAL,
                        grid_import_kwh REAL,
                        battery_charge_kwh REAL,
                        battery_discharge_kwh REAL,
                        soc_percent REAL,
                        payload_json TEXT NOT NULL,
                        payload_sha256 TEXT NOT NULL,
                        saved_at TEXT NOT NULL,
                        PRIMARY KEY (provider, scope_key, report_date)
                    );
                    CREATE INDEX IF NOT EXISTS reports_by_date
                      ON reports (provider, report_date, scope_key);
                    CREATE TABLE IF NOT EXISTS missing_dates (
                        provider TEXT NOT NULL,
                        scope_key TEXT NOT NULL,
                        report_date TEXT NOT NULL,
                        reason TEXT NOT NULL,
                        saved_at TEXT NOT NULL,
                        PRIMARY KEY (provider, scope_key, report_date)
                    );
                    CREATE TABLE IF NOT EXISTS job_state (
                        id INTEGER PRIMARY KEY CHECK (id = 1),
                        state_json TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS migration_sources (
                        source_sha256 TEXT PRIMARY KEY,
                        source_path TEXT NOT NULL,
                        status TEXT NOT NULL,
                        source_records INTEGER NOT NULL DEFAULT 0,
                        imported_records INTEGER NOT NULL DEFAULT 0,
                        identical_duplicates INTEGER NOT NULL DEFAULT 0,
                        invalid_records INTEGER NOT NULL DEFAULT 0,
                        detail TEXT NOT NULL DEFAULT '',
                        updated_at TEXT NOT NULL
                    );
                """)
                conn.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
            _LOGGER.info("Created HEROS archive schema %s at %s", SCHEMA_VERSION, self.path)

    def integrity_check(self) -> str:
        with self.connect() as conn:
            return str(conn.execute("PRAGMA integrity_check").fetchone()[0])

    def backup(self, destination: Path) -> None:
        """Make a consistent SQLite backup, including uncheckpointed WAL data."""
        destination = Path(destination)
        destination.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as source, sqlite3.connect(destination) as target:
            source.backup(target)
        with sqlite3.connect(destination) as check:
            if check.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise RuntimeError("SQLite backup integrity check failed")

    def export_csv(self, destination: Path, scope: str | None = None) -> int:
        """Stream compact, typed report totals for migration or inspection."""
        destination = Path(destination)
        destination.parent.mkdir(parents=True, exist_ok=True)
        count = 0
        with self.connect() as conn, destination.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.writer(handle)
            writer.writerow(("provider", "scope_key", "report_date", "label", "solar_kwh",
                             "load_kwh", "feed_in_kwh", "grid_import_kwh", "battery_charge_kwh",
                             "battery_discharge_kwh", "soc_percent"))
            sql = """SELECT provider,scope_key,report_date,label,solar_kwh,load_kwh,
                feed_in_kwh,grid_import_kwh,battery_charge_kwh,battery_discharge_kwh,soc_percent
                FROM reports WHERE provider=?"""
            parameters: tuple[str, ...] = (self.provider,)
            if scope is not None:
                sql += " AND scope_key=?"
                parameters += (scope,)
            sql += " ORDER BY scope_key,report_date"
            for row in conn.execute(sql, parameters):
                writer.writerow(tuple(row))
                count += 1
        return count

    def export_legacy_json(self, destination: Path) -> int:
        """Write a new legacy-compatible JSON file for rollback reconciliation."""
        destination = Path(destination)
        if destination.resolve() == self.path.resolve():
            raise ValueError("Export destination cannot be the database")
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(destination.name + ".tmp")
        count = 0
        with self.connect() as conn, temporary.open("w", encoding="utf-8") as handle:
            handle.write('{"version":1,"updated":')
            handle.write(json.dumps(_now()))
            handle.write(',"scopes":{')
            first_scope = True
            for scope in self.scopes():
                if not first_scope:
                    handle.write(",")
                first_scope = False
                handle.write(json.dumps(scope) + ':{"label":' + json.dumps(scope) + ',"records":{')
                first_record = True
                for row in conn.execute(
                    "SELECT report_date,payload_json FROM reports WHERE provider=? AND scope_key=? ORDER BY report_date",
                    (self.provider, scope),
                ):
                    if not first_record:
                        handle.write(",")
                    first_record = False
                    handle.write(json.dumps(row[0]) + ":" + row[1])
                    count += 1
                handle.write('},"missing_dates":{')
                first_missing = True
                for row in conn.execute(
                    "SELECT report_date,reason,saved_at FROM missing_dates WHERE provider=? AND scope_key=? ORDER BY report_date",
                    (self.provider, scope),
                ):
                    if not first_missing:
                        handle.write(",")
                    first_missing = False
                    handle.write(json.dumps(row[0]) + ":" + json.dumps({"reason": row[1], "saved_at": row[2]}))
                handle.write("}}")
            handle.write('},"archive_state":')
            handle.write(json.dumps(self.job(), ensure_ascii=False))
            handle.write("}")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, destination)
        return count

    def put_report(self, scope: str, report_date: str, label: str,
                   payload: dict[str, Any], *, replace: bool = True) -> str:
        _date(report_date)
        if not isinstance(payload, dict):
            raise ValueError("Report payload must be an object")
        diagram = payload.get("power_diagram") or {}
        series = diagram.get("series") or {} if isinstance(diagram, dict) else {}
        if not isinstance(diagram, dict) or not (
            isinstance(diagram.get("time"), list) and diagram["time"]
            or isinstance(series, dict) and any(isinstance(v, list) and v for v in series.values())
        ):
            raise ValueError(f"Report {scope}/{report_date} has no power diagram data")
        serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), default=str)
        digest = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
        today = payload.get("today") or {}
        today = today if isinstance(today, dict) else {}
        summary = diagram.get("summary") or {}
        summary = summary if isinstance(summary, dict) else {}
        def numeric(value: Any) -> float | None:
            try:
                result = float(value)
                return result if result == result and abs(result) != float("inf") else None
            except (TypeError, ValueError):
                return None
        metrics = (
            numeric(today.get("solar_generation")),
            numeric(today.get("load_consumption")),
            numeric(today.get("feed_in")),
            numeric(today.get("grid_consumption")),
            numeric(today.get("battery_charge")),
            numeric(today.get("battery_discharge")),
            numeric(summary.get("soc")),
        )
        with self.connect() as conn, conn:
            previous = conn.execute(
                "SELECT payload_sha256 FROM reports WHERE provider=? AND scope_key=? AND report_date=?",
                (self.provider, scope, report_date),
            ).fetchone()
            if previous is not None:
                if previous[0] == digest:
                    return "unchanged"
                if not replace:
                    raise ValueError(f"Conflicting duplicate report: {scope}/{report_date}")
            conn.execute("""
                INSERT INTO reports(provider,scope_key,report_date,label,solar_kwh,load_kwh,
                  feed_in_kwh,grid_import_kwh,battery_charge_kwh,battery_discharge_kwh,
                  soc_percent,payload_json,payload_sha256,saved_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(provider,scope_key,report_date) DO UPDATE SET
                  label=excluded.label,solar_kwh=excluded.solar_kwh,load_kwh=excluded.load_kwh,
                  feed_in_kwh=excluded.feed_in_kwh,grid_import_kwh=excluded.grid_import_kwh,
                  battery_charge_kwh=excluded.battery_charge_kwh,
                  battery_discharge_kwh=excluded.battery_discharge_kwh,
                  soc_percent=excluded.soc_percent,payload_json=excluded.payload_json,
                  payload_sha256=excluded.payload_sha256,saved_at=excluded.saved_at
            """, (self.provider, scope, report_date, label, *metrics, serialized, digest, _now()))
            conn.execute("DELETE FROM missing_dates WHERE provider=? AND scope_key=? AND report_date=?",
                         (self.provider, scope, report_date))
        return "replaced" if previous else "stored"

    def mark_missing(self, scope: str, report_date: str, reason: str) -> None:
        _date(report_date)
        with self.connect() as conn, conn:
            if conn.execute("SELECT 1 FROM reports WHERE provider=? AND scope_key=? AND report_date=?",
                            (self.provider, scope, report_date)).fetchone():
                return
            conn.execute("""
                INSERT INTO missing_dates(provider,scope_key,report_date,reason,saved_at)
                VALUES(?,?,?,?,?) ON CONFLICT(provider,scope_key,report_date) DO UPDATE SET
                  reason=excluded.reason,saved_at=excluded.saved_at
            """, (self.provider, scope, report_date, reason, _now()))

    def dates(self, scope: str) -> set[str]:
        with self.connect() as conn:
            return {row[0] for row in conn.execute(
                "SELECT report_date FROM reports WHERE provider=? AND scope_key=?",
                (self.provider, scope))}

    def missing(self, scope: str) -> dict[str, dict[str, str]]:
        with self.connect() as conn:
            return {row[0]: {"reason": row[1], "saved_at": row[2]} for row in conn.execute(
                "SELECT report_date,reason,saved_at FROM missing_dates WHERE provider=? AND scope_key=?",
                (self.provider, scope))}

    def report(self, scope: str, report_date: str) -> dict[str, Any] | None:
        with self.connect() as conn:
            row = conn.execute("SELECT payload_json FROM reports WHERE provider=? AND scope_key=? AND report_date=?",
                               (self.provider, scope, report_date)).fetchone()
            return json.loads(row[0]) if row else None

    def range_reports(self, scope: str, start: str, end: str, *,
                      limit: int = 735, detail_date: str = "") -> dict[str, dict[str, Any]]:
        _date(start)
        _date(end)
        if (date.fromisoformat(end) - date.fromisoformat(start)).days > limit:
            raise ValueError(f"Archive request exceeds {limit} days")
        records = {}
        with self.connect() as conn:
            for row in conn.execute(
                "SELECT report_date,payload_json FROM reports WHERE provider=? AND scope_key=? AND report_date BETWEEN ? AND ? ORDER BY report_date",
                (self.provider, scope, start, end),
            ):
                payload = json.loads(row[1])
                if row[0] != detail_date:
                    diagram = payload.get("power_diagram") or {}
                    compact_diagram = {key: diagram[key] for key in
                                       ("date", "time", "series", "summary", "meta") if key in diagram}
                    payload = {key: payload[key] for key in
                               ("aggregate", "label", "reporting_date", "meta", "live", "today", "totals", "forecast")
                               if key in payload}
                    payload["power_diagram"] = compact_diagram
                records[row[0]] = payload
        return records

    def summary(self, scope: str) -> dict[str, Any]:
        with self.connect() as conn:
            row = conn.execute("""SELECT COUNT(*),MIN(report_date),MAX(report_date),MAX(saved_at)
                FROM reports WHERE provider=? AND scope_key=?""", (self.provider, scope)).fetchone()
            missing = conn.execute("""SELECT COUNT(*),MIN(report_date),MAX(report_date)
                FROM missing_dates WHERE provider=? AND scope_key=?""", (self.provider, scope)).fetchone()
            firsts = [d for d in (row[1], missing[1]) if d]
            lasts = [d for d in (row[2], missing[2]) if d]
            start, end = (min(firsts), max(lasts)) if firsts else ("", "")
            days = (date.fromisoformat(end) - date.fromisoformat(start)).days + 1 if start else 0
            stored = int(row[0])
            explicit_missing = int(missing[0])
            return {
                "scope_key": scope, "record_count": stored,
                "first_record_date": row[1] or "", "last_record_date": row[2] or "",
                "missing_count": explicit_missing,
                "explicit_missing_count": explicit_missing,
                "calendar_start_date": start, "calendar_end_date": end,
                "calendar_day_count": days,
                "unrecorded_gap_count": max(0, days - stored - explicit_missing),
                "stored_coverage_percent": round(stored / days * 100, 1) if days else None,
                "last_updated": row[3] or "",
            }

    def scopes(self) -> list[str]:
        with self.connect() as conn:
            return [row[0] for row in conn.execute(
                "SELECT scope_key FROM reports WHERE provider=? UNION SELECT scope_key FROM missing_dates WHERE provider=? ORDER BY scope_key",
                (self.provider, self.provider))]

    def job(self) -> dict[str, Any]:
        with self.connect() as conn:
            row = conn.execute("SELECT state_json FROM job_state WHERE id=1").fetchone()
            return json.loads(row[0]) if row else {}

    def update_job(self, updates: dict[str, Any]) -> dict[str, Any]:
        with self.connect() as conn, conn:
            row = conn.execute("SELECT state_json FROM job_state WHERE id=1").fetchone()
            state = json.loads(row[0]) if row else {}
            state.update(updates)
            conn.execute("INSERT INTO job_state(id,state_json,updated_at) VALUES(1,?,?) "
                         "ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at",
                         (json.dumps(state, ensure_ascii=False, default=str), _now()))
            return state

    def migration(self, source_sha256: str) -> dict[str, Any] | None:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM migration_sources WHERE source_sha256=?", (source_sha256,)).fetchone()
            return dict(row) if row else None

    def ensure_migrated(self, source: Path) -> dict[str, Any]:
        """Switch to SQLite only after a complete legacy import is recorded."""
        source = Path(source)
        if not source.exists():
            with self.connect():
                pass
            return {"status": "complete", "source_records": 0, "imported_records": 0}
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM migration_sources WHERE source_path=? AND status IN ('complete','complete_with_issues') "
                               "ORDER BY updated_at DESC LIMIT 1", (str(source),)).fetchone()
            if row:
                return dict(row)
        result = self.migrate_json(source)
        if result["status"] not in {"complete", "complete_with_issues"}:
            raise RuntimeError(f"Legacy archive migration incomplete: {result['detail']}")
        return result

    def migrate_json(self, source: Path) -> dict[str, Any]:
        """Idempotently import validated records from legacy JSON in bounded RAM."""
        source = Path(source)
        sha = hashlib.sha256()
        with source.open("rb") as handle:
            while chunk := handle.read(1024 * 1024):
                sha.update(chunk)
        source_sha = sha.hexdigest()
        previous = self.migration(source_sha)
        if previous and previous["status"] in {"complete", "complete_with_issues"}:
            return previous
        counts = {"source_records": 0, "imported_records": 0,
                  "identical_duplicates": 0, "invalid_records": 0}
        issues: list[str] = []
        fatal = False
        reader = _JSONStream(source)
        try:
            def scope_value(scope_key: str) -> None:
                scope_label = scope_key
                def field(name: str) -> None:
                    nonlocal scope_label
                    if name == "label":
                        scope_label = str(reader.value() or scope_key)
                    elif name == "records":
                        def record_value(day: str) -> None:
                            counts["source_records"] += 1
                            payload = reader.value()
                            try:
                                result = self.put_report(scope_key, day, scope_label, payload, replace=False)
                                counts["imported_records" if result == "stored" else "identical_duplicates"] += 1
                            except (ValueError, TypeError) as err:
                                counts["invalid_records"] += 1
                                if len(issues) < 20:
                                    issues.append(f"{scope_key}/{day}: {err}")
                                if "Conflicting duplicate" not in str(err):
                                    try:
                                        self.mark_missing(scope_key, day, "invalid_legacy_record")
                                    except ValueError:
                                        # A malformed date cannot be represented as a missing day.
                                        pass
                        reader.pairs(record_value)
                    elif name == "missing_dates":
                        # The legacy form is usually an object. A list is also supported.
                        reader.space()
                        if reader.peek() == "{":
                            reader.pairs(lambda day: self.mark_missing(scope_key, day,
                                str((reader.value() or {}).get("reason") or "legacy_missing")))
                        else:
                            for day in reader.value() or []:
                                self.mark_missing(scope_key, str(day), "legacy_missing")
                    else:
                        reader.value()
                reader.pairs(field)
            def root_value(key: str) -> None:
                if key == "scopes":
                    reader.pairs(scope_value)
                elif key == "archive_state":
                    legacy_job = reader.value()
                    if isinstance(legacy_job, dict) and not self.job():
                        self.update_job(legacy_job)
                else:
                    reader.value()
            reader.pairs(root_value)
            reader.space()
            if reader.peek():
                raise ValueError("Trailing content in legacy JSON")
        except Exception as err:
            fatal = True
            issues.append(f"JSON parse error: {err}")
        finally:
            reader.close()
        status = "failed" if fatal or any("Conflicting duplicate" in issue for issue in issues) else "complete_with_issues" if issues else "complete"
        result = {"source_sha256": source_sha, "source_path": str(source), "status": status,
                  **counts, "detail": "; ".join(issues), "updated_at": _now()}
        with self.connect() as conn, conn:
            conn.execute("""INSERT INTO migration_sources(source_sha256,source_path,status,source_records,
                imported_records,identical_duplicates,invalid_records,detail,updated_at)
                VALUES(:source_sha256,:source_path,:status,:source_records,:imported_records,
                :identical_duplicates,:invalid_records,:detail,:updated_at)
                ON CONFLICT(source_sha256) DO UPDATE SET status=excluded.status,
                source_records=excluded.source_records,imported_records=excluded.imported_records,
                identical_duplicates=excluded.identical_duplicates,invalid_records=excluded.invalid_records,
                detail=excluded.detail,updated_at=excluded.updated_at""", result)
        _LOGGER.info("HEROS archive migration %s: %s", status, counts)
        return result
