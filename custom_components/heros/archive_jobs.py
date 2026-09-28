"""Bounded, resumable HEROS historical-download jobs."""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import date, timedelta
from typing import Any, Awaitable, Callable

_LOGGER = logging.getLogger(__name__)
REQUEST_ATTEMPTS = 3
BATCH_DAYS = 7


def inclusive_dates(start: str, end: str):
    current = date.fromisoformat(start)
    final = date.fromisoformat(end)
    if final < current:
        current, final = final, current
    while current <= final:
        yield current.isoformat()
        current += timedelta(days=1)


class ArchiveJobController:
    """Allow one active job per integration entry and persist its checkpoint."""

    def __init__(self, history: Any,
                 fetch: Callable[[str, str], Awaitable[dict[str, Any] | None]],
                 build: Callable[[dict[str, Any], str, str], dict[str, Any]],
                 changed: Callable[[dict[str, Any]], None] | None = None) -> None:
        self.history = history
        self.fetch = fetch
        self.build = build
        self.changed = changed or (lambda _: None)
        self.task: asyncio.Task | None = None
        self.cancel_event = asyncio.Event()
        self.stop_reason = "cancelled"
        self._starting = asyncio.Lock()

    async def start(self, scope: str, start: str, end: str, *,
                    force: bool = False, action: str = "download_missing",
                    resume: bool = False, job_id: str | None = None) -> str:
        async with self._starting:
            if self.task is not None and not self.task.done():
                raise RuntimeError("A HEROS archive download is already running")
            dates = list(inclusive_dates(start, end))
            if not dates or len(dates) > 3653:
                raise ValueError("Archive date range must be 1 to 3653 days")
            job_id = job_id or uuid.uuid4().hex
            self.cancel_event = asyncio.Event()
            self.stop_reason = "cancelled"
            state = await self.history.async_update_archive_state({
                "job_id": job_id, "action": action, "status": "running",
                "current_scope": scope, "current_start_date": dates[0],
                "current_end_date": dates[-1], "requested_start_date": dates[0],
                "requested_end_date": dates[-1], "requested_days": len(dates),
                "processed_days": 0, "stored_days": 0, "skipped_days": 0,
                "missing_days": 0, "failed_days": 0, "failed_dates": [],
                "progress": f"0/{len(dates)}", "completed": False,
                "force": bool(force), "resumed": bool(resume),
                "stop_reason": "", "last_attempt_error": "",
            })
            self.changed(state)
            self.task = asyncio.create_task(
                self._run(job_id, scope, dates, force=force and not resume),
                name=f"heros-archive-{job_id[:8]}",
            )
            return job_id

    async def recover(self) -> str | None:
        """Resume an uncleanly stopped job using committed records as truth."""
        state = await self.history.async_archive_state()
        if state.get("status") not in {"running", "interrupted"}:
            return None
        scope = str(state.get("current_scope") or "all")
        start = str(state.get("requested_start_date") or state.get("current_start_date") or "")
        end = str(state.get("requested_end_date") or state.get("current_end_date") or "")
        if not start or not end:
            await self.history.async_update_archive_state({
                "status": "failed", "stop_reason": "missing_recovery_range",
                "last_attempt_error": "Interrupted job has no valid requested range",
            })
            return None
        await self.history.async_update_archive_state({
            "status": "interrupted", "stop_reason": "home_assistant_restart",
        })
        _LOGGER.warning("Resuming interrupted HEROS archive job %s for %s %s..%s",
                        state.get("job_id", "legacy"), scope, start, end)
        return await self.start(scope, start, end, force=False,
                                action=str(state.get("action") or "download_missing"),
                                resume=True, job_id=str(state.get("job_id") or uuid.uuid4().hex))

    async def cancel(self, job_id: str | None = None) -> bool:
        if self.task is None or self.task.done():
            return False
        state = await self.history.async_archive_state()
        if job_id and state.get("job_id") != job_id:
            return False
        self.stop_reason = "cancelled"
        self.cancel_event.set()
        await self.history.async_update_archive_state({"status": "cancelling"})
        return True

    async def interrupt_for_unload(self) -> None:
        if self.task is None or self.task.done():
            return
        self.stop_reason = "interrupted"
        self.cancel_event.set()
        await self.task

    async def _run(self, job_id: str, scope: str, dates: list[str], *, force: bool) -> None:
        stored = skipped = missing = failed = processed = 0
        failed_dates: list[str] = []
        try:
            existing = await self.history.async_record_dates(scope)
            for index, day in enumerate(dates, 1):
                if self.cancel_event.is_set():
                    break
                if day in existing and not force:
                    skipped += 1
                    processed += 1
                    status = "kept"
                    error = ""
                else:
                    status = "failed"
                    error = ""
                    data = None
                    for attempt in range(1, REQUEST_ATTEMPTS + 1):
                        if self.cancel_event.is_set():
                            break
                        try:
                            data = await self.fetch(scope, day)
                            if data:
                                break
                            error = "Provider returned no report"
                        except Exception as err:  # noqa: BLE001
                            error = f"{type(err).__name__}: {err}"[:300]
                        if attempt < REQUEST_ATTEMPTS and not self.cancel_event.is_set():
                            await asyncio.sleep(min(2 ** attempt, 8))
                    if self.cancel_event.is_set() and not data:
                        break
                    if data:
                        try:
                            payload = self.build(data, scope, day)
                            result = await self.history.async_store_snapshot(
                                scope_key=scope,
                                label=str(payload.get("label") or scope), reporting=payload,
                                record_date=day)
                            if result not in {"stored", "replaced", "unchanged"}:
                                raise RuntimeError("Report was not committed")
                            stored += 1
                            existing.add(day)
                            status = "stored"
                            error = ""
                        except Exception as err:  # noqa: BLE001
                            error = f"Storage error: {type(err).__name__}: {err}"[:300]
                    if status != "stored" and not self.cancel_event.is_set():
                        missing += 1
                        failed += 1
                        failed_dates.append(day)
                        await self.history.async_mark_missing_date(
                            scope_key=scope, label=scope, record_date=day,
                            reason="storage_error" if data else "provider_error" if error != "Provider returned no report" else "provider_empty",
                        )
                    processed += 1
                state = await self.history.async_update_archive_state({
                    "status": "running" if not self.cancel_event.is_set() else "cancelling",
                    "progress": f"{index}/{len(dates)}", "processed_days": processed,
                    "stored_days": stored, "skipped_days": skipped,
                    "missing_days": missing, "failed_days": failed,
                    "failed_dates": failed_dates[-100:],
                    "last_attempt_date": day, "last_attempt_status": status,
                    "last_attempt_error": error,
                })
                self.changed(state)
                if index % BATCH_DAYS == 0:
                    await asyncio.sleep(0)
            if self.cancel_event.is_set():
                final = self.stop_reason
            elif failed:
                final = "failed"
            else:
                final = "completed"
            state = await self.history.async_update_archive_state({
                "status": final, "completed": final == "completed",
                "stop_reason": final, "progress": f"{processed}/{len(dates)}",
                "processed_days": processed, "stored_days": stored,
                "skipped_days": skipped, "missing_days": missing,
                "failed_days": failed, "failed_dates": failed_dates[-100:],
            })
            self.changed(state)
        except asyncio.CancelledError:
            await self.history.async_update_archive_state({
                "status": "interrupted", "completed": False,
                "stop_reason": "task_cancelled",
            })
            raise
        except Exception as err:  # noqa: BLE001
            _LOGGER.exception("HEROS archive job %s failed", job_id)
            state = await self.history.async_update_archive_state({
                "status": "failed", "completed": False,
                "stop_reason": "unexpected_error",
                "last_attempt_error": f"{type(err).__name__}: {err}"[:300],
            })
            self.changed(state)
