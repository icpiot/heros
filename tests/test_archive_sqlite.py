"""SQLite archive durability and job lifecycle regressions."""
from __future__ import annotations

import asyncio
import json
import sqlite3
import sys
import types
from pathlib import Path

import pytest

package = types.ModuleType("custom_components.heros")
package.__path__ = [str(Path(__file__).resolve().parents[1] / "custom_components" / "heros")]
sys.modules.setdefault("custom_components.heros", package)

from custom_components.heros.archive_store import ArchiveStore, SCHEMA_VERSION
from custom_components.heros.archive_jobs import ArchiveJobController


def report(day: str, value: int = 1):
    return {"label": "All systems", "reporting_date": day,
            "power_diagram": {"date": day, "time": ["00:00"],
                              "series": {"solar": [value]}, "summary": {}},
            "today": {"solar_generation": value}}


def test_schema_uniqueness_and_idempotence(tmp_path):
    store = ArchiveStore(tmp_path / "archive.sqlite3")
    assert store.put_report("all", "2026-09-01", "All systems", report("2026-09-01")) == "stored"
    assert store.put_report("all", "2026-09-01", "All systems", report("2026-09-01"), replace=False) == "unchanged"
    with pytest.raises(ValueError, match="Conflicting duplicate"):
        store.put_report("all", "2026-09-01", "All systems", report("2026-09-01", 2), replace=False)
    assert store.summary("all")["record_count"] == 1
    with store.connect() as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
        assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    assert store.integrity_check() == "ok"


def test_incremental_coverage_and_missing(tmp_path):
    store = ArchiveStore(tmp_path / "archive.sqlite3")
    store.put_report("all", "2026-09-01", "All systems", report("2026-09-01"))
    store.put_report("all", "2026-09-03", "All systems", report("2026-09-03"))
    assert store.summary("all")["unrecorded_gap_count"] == 1
    store.mark_missing("all", "2026-09-02", "provider_empty")
    assert store.summary("all")["explicit_missing_count"] == 1
    assert store.summary("all")["unrecorded_gap_count"] == 0
    store.put_report("all", "2026-09-02", "All systems", report("2026-09-02"))
    assert store.summary("all")["record_count"] == 3
    assert store.missing("all") == {}
    assert len(store.range_reports("all", "2026-09-01", "2026-09-07")) == 3


def test_failed_write_preserves_committed_row(tmp_path):
    store = ArchiveStore(tmp_path / "archive.sqlite3")
    store.put_report("all", "2026-09-01", "All systems", report("2026-09-01"))
    with store.connect() as conn:
        conn.execute("CREATE TRIGGER reject_new BEFORE INSERT ON reports WHEN NEW.report_date='2026-09-02' BEGIN SELECT RAISE(ABORT, 'forced failure'); END")
    with pytest.raises(sqlite3.IntegrityError, match="forced failure"):
        store.put_report("all", "2026-09-02", "All systems", report("2026-09-02"))
    assert store.dates("all") == {"2026-09-01"}
    assert store.integrity_check() == "ok"


def test_legacy_migration_preserves_source_and_repeats(tmp_path):
    source = tmp_path / "history.json"
    legacy = {"version": 1, "scopes": {"all": {"label": "All systems", "records": {
        "2026-09-01": report("2026-09-01"),
        "2026-09-02": report("2026-09-02")}, "missing_dates": {}}}}
    source.write_text(json.dumps(legacy), encoding="utf-8")
    source_bytes = source.read_bytes()
    store = ArchiveStore(tmp_path / "archive.sqlite3")
    first = store.migrate_json(source)
    second = store.migrate_json(source)
    assert first["status"] == second["status"] == "complete"
    assert first["imported_records"] == 2
    assert store.summary("all")["record_count"] == 2
    assert source.read_bytes() == source_bytes
    backup = tmp_path / "consistent-backup.sqlite3"
    store.backup(backup)
    assert ArchiveStore(backup).dates("all") == store.dates("all")


def test_newer_schema_refused_without_mutating_database(tmp_path):
    db = tmp_path / "archive.sqlite3"
    with sqlite3.connect(db) as conn:
        conn.execute("PRAGMA user_version=999")
    with pytest.raises(RuntimeError, match="newer than HEROS supports"):
        ArchiveStore(db).summary("all")
    with sqlite3.connect(db) as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 999


def test_bad_legacy_record_is_reported_and_source_remains_unchanged(tmp_path):
    source = tmp_path / "history.json"
    source.write_text(json.dumps({"scopes": {"all": {"records": {
        "2026-09-01": report("2026-09-01"),
        "2026-09-02": {"power_diagram": {"time": [], "series": {}}}}}}}), encoding="utf-8")
    original = source.read_bytes()
    store = ArchiveStore(tmp_path / "archive.sqlite3")
    result = store.migrate_json(source)
    assert result["status"] == "complete_with_issues"
    assert result["source_records"] == 2
    assert result["invalid_records"] == 1
    assert store.dates("all") == {"2026-09-01"}
    assert store.missing("all")["2026-09-02"]["reason"] == "invalid_legacy_record"
    assert source.read_bytes() == original


class AsyncHistory:
    def __init__(self, store):
        self.store = store
    async def async_update_archive_state(self, updates):
        return self.store.update_job(updates)
    async def async_archive_state(self):
        return self.store.job()
    async def async_record_dates(self, scope):
        return self.store.dates(scope)
    async def async_store_snapshot(self, *, scope_key, label, reporting, record_date):
        return self.store.put_report(scope_key, record_date, label, reporting)
    async def async_mark_missing_date(self, *, scope_key, label, record_date, reason):
        self.store.mark_missing(scope_key, record_date, reason)


def test_interrupted_job_recovers_without_duplicate(tmp_path):
    async def scenario():
        store = ArchiveStore(tmp_path / "archive.sqlite3")
        history = AsyncHistory(store)
        store.put_report("all", "2026-09-01", "All systems", report("2026-09-01"))
        store.update_job({"status": "running", "job_id": "job-one", "action": "download_missing",
                          "current_scope": "all", "requested_start_date": "2026-09-01",
                          "requested_end_date": "2026-09-03", "processed_days": 1})
        fetched = []
        async def fetch(scope, day):
            fetched.append(day)
            return {"date": day}
        controller = ArchiveJobController(history, fetch,
            lambda data, scope, day: report(day))
        assert await controller.recover() == "job-one"
        await controller.task
        assert fetched == ["2026-09-02", "2026-09-03"]
        assert store.summary("all")["record_count"] == 3
        assert store.job()["status"] == "completed"
        assert store.integrity_check() == "ok"
    asyncio.run(scenario())


def test_cancel_then_resume_keeps_committed_days(tmp_path):
    async def scenario():
        store = ArchiveStore(tmp_path / "archive.sqlite3")
        history = AsyncHistory(store)
        first_request = asyncio.Event()
        release = asyncio.Event()
        async def fetch(scope, day):
            first_request.set()
            await release.wait()
            return {"date": day}
        controller = ArchiveJobController(history, fetch, lambda data, scope, day: report(day))
        job_id = await controller.start("all", "2026-09-01", "2026-09-03")
        await first_request.wait()
        assert await controller.cancel(job_id)
        release.set()
        await controller.task
        assert store.job()["status"] == "cancelled"
        assert store.dates("all") == {"2026-09-01"}
        await controller.start("all", "2026-09-01", "2026-09-03", resume=True)
        await controller.task
        assert store.job()["status"] == "completed"
        assert store.summary("all")["record_count"] == 3
    asyncio.run(scenario())


def test_unload_interrupts_and_restart_resumes(tmp_path):
    async def scenario():
        store = ArchiveStore(tmp_path / "archive.sqlite3")
        history = AsyncHistory(store)
        entered = asyncio.Event()
        release = asyncio.Event()
        async def fetch(scope, day):
            entered.set()
            await release.wait()
            return {"date": day}
        controller = ArchiveJobController(history, fetch, lambda data, scope, day: report(day))
        await controller.start("all", "2026-09-01", "2026-09-03")
        await entered.wait()
        unloading = asyncio.create_task(controller.interrupt_for_unload())
        await asyncio.sleep(0)
        release.set()
        await unloading
        assert store.job()["status"] == "interrupted"
        assert store.dates("all") == {"2026-09-01"}
        resumed = ArchiveJobController(history, fetch, lambda data, scope, day: report(day))
        assert await resumed.recover()
        await resumed.task
        assert store.job()["status"] == "completed"
        assert store.summary("all")["record_count"] == 3
    asyncio.run(scenario())


def test_failed_date_does_not_claim_completed_range(tmp_path, monkeypatch):
    async def scenario():
        from custom_components.heros import archive_jobs
        async def no_wait(_):
            return None
        monkeypatch.setattr(archive_jobs.asyncio, "sleep", no_wait)
        store = ArchiveStore(tmp_path / "archive.sqlite3")
        history = AsyncHistory(store)
        async def fetch(scope, day):
            return None if day == "2026-09-02" else {"date": day}
        controller = ArchiveJobController(history, fetch, lambda data, scope, day: report(day))
        await controller.start("all", "2026-09-01", "2026-09-03")
        await controller.task
        assert store.job()["status"] == "failed"
        assert store.job()["completed"] is False
        assert store.job()["failed_dates"] == ["2026-09-02"]
        assert store.dates("all") == {"2026-09-01", "2026-09-03"}
        assert store.missing("all")["2026-09-02"]["reason"] == "provider_empty"
    asyncio.run(scenario())
