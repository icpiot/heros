"""Background daily report archiving does not depend on opening Reports."""
from __future__ import annotations

import asyncio
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

pytest.importorskip("homeassistant.config_entries")

import custom_components.heros as integration


class FakeHistory:
    def __init__(self, dates, state=None):
        self.dates = dates
        self.state = dict(state or {})

    async def async_record_dates(self, scope):
        return set(self.dates.get(scope, []))

    async def async_archive_state(self):
        return dict(self.state)

    async def async_update_archive_state(self, updates):
        self.state.update(updates)
        return dict(self.state)


def setup_archive(monkeypatch, dates, state=None):
    history = FakeHistory(dates, state)
    entry = {"provider": integration.PROVIDER_FOXESS_V2, "client": object()}
    hass = SimpleNamespace(data={integration.DOMAIN: {"entry": entry}})
    controller = SimpleNamespace(history=history, task=None)
    monkeypatch.setattr(integration, "_archive_controller", lambda *_: controller)
    monkeypatch.setattr(integration, "_history_scope_targets", lambda *_: [
        ("all", "All systems", ""), ("battery", "Battery", "station")])
    monkeypatch.setattr(integration.dt_util, "now", lambda: datetime(2026, 11, 22, 9))
    ensure = AsyncMock(return_value=True)
    monkeypatch.setattr(integration, "_ensure_report_history_range", ensure)
    return hass, history, ensure


def test_daily_archive_catches_up_all_scopes_without_opening_reports(monkeypatch):
    hass, history, ensure = setup_archive(monkeypatch, {
        "all": {"2026-11-18"}, "battery": {"2026-11-18"}})

    asyncio.run(integration._daily_archive_backfill(hass, "entry"))

    assert ensure.await_count == 2
    assert all(call.kwargs["start_date"] == "2026-11-19" for call in ensure.await_args_list)
    assert all(call.kwargs["end_date"] == "2026-11-21" for call in ensure.await_args_list)
    assert history.state["daily_archive_completed_through"] == "2026-11-21"


def test_today_snapshot_does_not_hide_missing_yesterday(monkeypatch):
    hass, history, ensure = setup_archive(monkeypatch, {
        "all": {"2026-11-20", "2026-11-22"},
        "battery": {"2026-11-20", "2026-11-22"}})

    asyncio.run(integration._daily_archive_backfill(hass, "entry"))

    assert ensure.await_count == 2
    assert ensure.await_args_list[0].kwargs["start_date"] == "2026-11-21"
    assert history.state["daily_archive_completed_through"] == "2026-11-21"


def test_failed_scope_retries_from_persisted_start(monkeypatch):
    hass, history, ensure = setup_archive(monkeypatch, {
        "all": {"2026-11-19"}, "battery": {"2026-11-19"}})
    ensure.side_effect = [True, False, True, True]

    asyncio.run(integration._daily_archive_backfill(hass, "entry"))
    assert "daily_archive_completed_through" not in history.state
    assert history.state["daily_archive_start_date"] == "2026-11-20"

    asyncio.run(integration._daily_archive_backfill(hass, "entry"))
    assert ensure.await_count == 4
    assert ensure.await_args_list[2].kwargs["start_date"] == "2026-11-20"
    assert history.state["daily_archive_completed_through"] == "2026-11-21"
