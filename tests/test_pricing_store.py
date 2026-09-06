"""Tests for pricing history persistence helpers."""
from __future__ import annotations

import importlib.util
import sys
import types
from datetime import date, datetime, timezone
from pathlib import Path


def _load_pricing_modules():
    root = Path(__file__).resolve().parents[1]
    package = types.ModuleType("custom_components.heros")
    package.__path__ = [str(root / "custom_components" / "heros")]
    sys.modules.setdefault("custom_components.heros", package)

    homeassistant = types.ModuleType("homeassistant")
    homeassistant_core = types.ModuleType("homeassistant.core")
    homeassistant_core.HomeAssistant = object
    homeassistant_util = types.ModuleType("homeassistant.util")
    homeassistant_dt = types.ModuleType("homeassistant.util.dt")
    homeassistant_dt.utcnow = lambda: datetime(2026, 7, 19, 0, 0, tzinfo=timezone.utc)
    homeassistant_util.dt = homeassistant_dt
    sys.modules.setdefault("homeassistant", homeassistant)
    sys.modules.setdefault("homeassistant.core", homeassistant_core)
    sys.modules.setdefault("homeassistant.util", homeassistant_util)
    sys.modules.setdefault("homeassistant.util.dt", homeassistant_dt)

    pricing_path = root / "custom_components" / "heros" / "pricing.py"
    pricing_spec = importlib.util.spec_from_file_location(
        "custom_components.heros.pricing",
        pricing_path,
    )
    pricing = importlib.util.module_from_spec(pricing_spec)
    sys.modules[pricing_spec.name] = pricing
    pricing_spec.loader.exec_module(pricing)

    store_path = root / "custom_components" / "heros" / "pricing_store.py"
    store_spec = importlib.util.spec_from_file_location(
        "custom_components.heros.pricing_store",
        store_path,
    )
    pricing_store = importlib.util.module_from_spec(store_spec)
    sys.modules[store_spec.name] = pricing_store
    store_spec.loader.exec_module(pricing_store)
    return pricing, pricing_store


pricing, pricing_store = _load_pricing_modules()
PriceRecord = pricing.PriceRecord
PricingRateGroup = pricing.PricingRateGroup
PricingRateRecord = pricing.PricingRateRecord
PricingRule = pricing.PricingRule
PriceHistoryStore = pricing_store.PriceHistoryStore
PricingScheduleStore = pricing_store.PricingScheduleStore
load_pricing_history_file = pricing_store.load_pricing_history_file
write_pricing_history_file = pricing_store.write_pricing_history_file


class _FakeConfig:
    def __init__(self, base_dir: Path) -> None:
        self._base_dir = base_dir

    def path(self, *parts: str) -> str:
        return str(self._base_dir.joinpath(*parts))


class _FakeHass:
    def __init__(self, base_dir: Path) -> None:
        self.config = _FakeConfig(base_dir)

    async def async_add_executor_job(self, func, *args):
        return func(*args)


def test_pricing_store_persists_and_loads_records(tmp_path):
    store = PriceHistoryStore(_FakeHass(tmp_path), "entry-1")
    record = PriceRecord(
        flow="export",
        mode="dynamic",
        value=31.5,
        starts_at=datetime(2026, 7, 14, 14, 0, tzinfo=timezone.utc),
        ends_at=datetime(2026, 7, 14, 14, 30, tzinfo=timezone.utc),
        label="Spike export",
        source="AEMO",
        region="NSW",
        priority=100,
    )

    # Persist to JSON and load back through the same store.
    import asyncio

    asyncio.run(store.async_store_record(scope_key="nsw", label="NSW", record=record))
    history = asyncio.run(store.async_history("nsw"))

    assert len(history.entries) == 1
    assert history.entries[0] == record

    payload = (tmp_path / "www" / "heros" / "entry-1" / "pricing.json").read_text(encoding="utf-8")
    assert '"scope_key"' not in payload
    assert '"NSW"' in payload


def test_pricing_store_uses_safe_scope_names(tmp_path):
    store = PriceHistoryStore(_FakeHass(tmp_path), "entry-1")
    record = PriceRecord(flow="import", mode="fixed", value=25.0)

    import asyncio

    asyncio.run(store.async_store_record(scope_key="../evil scope", label="All systems", record=record))

    assert (tmp_path / "www" / "heros" / "entry-1" / "pricing.json").exists()


def test_pricing_history_file_helpers_round_trip(tmp_path):
    path = tmp_path / "pricing.json"
    payload = {
        "version": 1,
        "updated": "2026-07-14T00:00:00+00:00",
        "scopes": {
            "all": {
                "label": "All systems",
                "updated": "2026-07-14T00:00:00+00:00",
                "records": [
                    PriceRecord(flow="export", mode="fixed", value=7.5).to_dict(),
                ],
            }
        },
    }

    write_pricing_history_file(path, payload)
    loaded = load_pricing_history_file(path)

    assert loaded == payload


def test_pricing_history_file_helpers_handle_missing_file(tmp_path):
    path = tmp_path / "missing.json"

    assert load_pricing_history_file(path) == {}


def test_pricing_schedule_store_persists_rules_and_holidays(tmp_path):
    store = PricingScheduleStore(_FakeHass(tmp_path), "entry-1")
    rule = PricingRule(
        rule_id="rule-1",
        effective_date=date(2026, 7, 1),
        pricing_type="dynamic",
        start_time="00:00",
        provider="Amber",
        label="Dynamic plan",
        import_rate=24.5,
    )

    import asyncio

    asyncio.run(store.async_upsert_rule(rule))
    asyncio.run(
        store.async_set_holidays(
            holiday_dates=["2026-07-16", "2026-12-25"],
            holiday_source="workday",
            region="NSW",
        )
    )

    schedule = asyncio.run(store.async_schedule())

    assert len(schedule.rules) == 1
    assert schedule.rules[0] == rule
    assert schedule.holiday_source == "workday"
    assert schedule.region == "NSW"
    assert [item.isoformat() for item in schedule.holiday_dates] == ["2026-07-16", "2026-12-25"]

    asyncio.run(store.async_remove_rule("rule-1"))
    schedule_after_remove = asyncio.run(store.async_schedule())
    assert schedule_after_remove.rules == []


def test_pricing_schedule_store_persists_groups_and_records(tmp_path):
    store = PricingScheduleStore(_FakeHass(tmp_path), "entry-1")
    group = PricingRateGroup(
        group_id="group-1",
        label="Rates from Jan 1",
        effective_start_date=date(2026, 1, 1),
        pricing_type="fixed",
        daily_connection_charge=1.23,
    )
    record = PricingRateRecord(
        record_id="record-1",
        label="Peak",
        day_types=("mon", "tue", "wed", "thu", "fri"),
        start_time="14:00",
        end_time="20:00",
        import_rate=0.42,
    )

    import asyncio

    asyncio.run(store.async_upsert_group(group))
    asyncio.run(store.async_upsert_record(group_id="group-1", record=record))
    schedule = asyncio.run(store.async_schedule())

    assert len(schedule.groups) == 1
    assert schedule.groups[0].group_id == "group-1"
    assert schedule.groups[0].daily_connection_charge == 1.23
    assert len(schedule.groups[0].records) == 1
    assert schedule.groups[0].records[0] == record

    payload = load_pricing_history_file(
        tmp_path / "www" / "heros" / "entry-1" / "pricing_schedule.json"
    )
    assert payload["version"] == 2
    assert payload["groups"][0]["records"][0]["import_rate"] == 0.42

    asyncio.run(store.async_remove_record(group_id="group-1", record_id="record-1"))
    schedule_after_record_remove = asyncio.run(store.async_schedule())
    assert schedule_after_record_remove.groups[0].records == ()

    asyncio.run(store.async_remove_group("group-1"))
    schedule_after_group_remove = asyncio.run(store.async_schedule())
    assert schedule_after_group_remove.groups == []


def test_pricing_schedule_store_reads_legacy_path_when_new_path_is_empty(tmp_path):
    legacy_path = tmp_path / "www" / "heros-pricing" / "entry-1" / "pricing_schedule.json"
    legacy_payload = {
        "version": 1,
        "updated": "2026-07-14T00:00:00+00:00",
        "groups": [
            {
                "group_id": "legacy-group",
                "label": "Legacy group",
                "effective_start_date": "2026-01-01",
                "pricing_type": "fixed",
                "provider": "Test Provider",
                "plan_name": "",
                "daily_connection_charge": 0.149,
                "other_charges": "",
                "notes": "",
                "records": [],
            }
        ],
    }

    write_pricing_history_file(legacy_path, legacy_payload)
    store = PricingScheduleStore(_FakeHass(tmp_path), "entry-1")

    import asyncio

    schedule = asyncio.run(store.async_schedule())
    assert len(schedule.groups) == 1
    assert schedule.groups[0].group_id == "legacy-group"
