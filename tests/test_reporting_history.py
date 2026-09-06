from __future__ import annotations

import importlib.util
import json
import sys
import types
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _load_reporting_module():
    package = types.ModuleType("custom_components.heros")
    package.__path__ = [str(ROOT / "custom_components" / "heros")]
    sys.modules.setdefault("custom_components.heros", package)

    homeassistant = types.ModuleType("homeassistant")
    homeassistant_core = types.ModuleType("homeassistant.core")
    homeassistant_core.HomeAssistant = object
    homeassistant_util = types.ModuleType("homeassistant.util")
    homeassistant_dt = types.ModuleType("homeassistant.util.dt")
    homeassistant_dt.now = lambda: datetime(2026, 8, 20, tzinfo=timezone.utc)
    homeassistant_dt.utcnow = lambda: datetime(2026, 8, 20, tzinfo=timezone.utc)
    homeassistant_util.dt = homeassistant_dt

    sys.modules.setdefault("homeassistant", homeassistant)
    sys.modules.setdefault("homeassistant.core", homeassistant_core)
    sys.modules.setdefault("homeassistant.util", homeassistant_util)
    sys.modules.setdefault("homeassistant.util.dt", homeassistant_dt)

    spec = importlib.util.spec_from_file_location(
        "custom_components.heros.reporting",
        ROOT / "custom_components" / "heros" / "reporting.py",
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


reporting_module = _load_reporting_module()
ByteWattReportHistory = reporting_module.ByteWattReportHistory
build_forecast_snapshot = reporting_module.build_forecast_snapshot
build_reporting_payload = reporting_module.build_reporting_payload


class _FakeConfig:
    def __init__(self, base_dir: Path) -> None:
        self._base_dir = base_dir

    def path(self, *parts: str) -> str:
        return str(self._base_dir.joinpath(*parts))


class _FakeHass:
    def __init__(self, base_dir: Path) -> None:
        self.config = _FakeConfig(base_dir)
        self.states = types.SimpleNamespace(get=lambda entity_id: None)


class _FakeState:
    def __init__(self, state: str, unit: str = "kWh") -> None:
        self.state = state
        self.attributes = {"unit_of_measurement": unit}
        self.last_updated = datetime(2026, 8, 20, 10, 15, tzinfo=timezone.utc)


def _valid_reporting_payload() -> dict[str, object]:
    return {
        "aggregate": True,
        "label": "All systems",
        "meta": {"saved_at": "2026-07-10T00:00:00+00:00"},
        "power_diagram": {
            "date": "2026-07-08",
            "time": ["00:00", "00:05"],
            "series": {
                "bat": [1, 2],
                "load": [3, 4],
                "solar": [5, 6],
                "feed_in": [7, 8],
                "consumed": [9, 10],
            },
            "summary": {"soc": 42},
            "meta": {},
            "raw_provider": {"soc": 42, "powerSource": "grid"},
            "provider_payload": {
                "soc": 42,
                "time": ["00:00", "00:05"],
                "ppvinverterPv": [5, 6],
                "gridDetailList": [{"value2": 9}, {"value2": 10}],
            },
        },
    }


def test_mark_missing_date_keeps_existing_valid_record(tmp_path):
    history = ByteWattReportHistory(_FakeHass(tmp_path), "entry-1")
    history._store_snapshot_sync(
        scope_key="all",
        label="All systems",
        record_date="2026-07-08",
        reporting=_valid_reporting_payload(),
    )

    history._mark_missing_date_sync(
        scope_key="all",
        label="All systems",
        record_date="2026-07-08",
        reason="no_reporting_data",
    )

    payload = json.loads((tmp_path / "www" / "heros-history" / "entry-1" / "history.json").read_text(encoding="utf-8"))
    scope = payload["scopes"]["all"]
    assert "2026-07-08" in scope["records"]
    assert "2026-07-08" not in scope.get("missing_dates", {})


def test_mark_missing_date_removes_blank_record(tmp_path):
    history_dir = tmp_path / "www" / "heros-history" / "entry-1"
    history_dir.mkdir(parents=True, exist_ok=True)
    history_file = history_dir / "history.json"
    history_file.write_text(
        json.dumps(
            {
                "version": 1,
                "scopes": {
                    "all": {
                        "label": "All systems",
                        "records": {
                            "2026-07-08": {
                                "aggregate": True,
                                "label": "All systems",
                                "reporting_date": "2026-07-08",
                                "meta": {},
                                "power_diagram": {
                                    "date": "2026-07-08",
                                    "meta": {},
                                    "summary": {},
                                    "time": [],
                                    "series": {},
                                },
                            }
                        },
                        "missing_dates": {},
                    }
                },
            }
        ),
        encoding="utf-8",
    )

    history = ByteWattReportHistory(_FakeHass(tmp_path), "entry-1")
    history._mark_missing_date_sync(
        scope_key="all",
        label="All systems",
        record_date="2026-07-08",
        reason="no_reporting_data",
    )

    payload = json.loads(history_file.read_text(encoding="utf-8"))
    scope = payload["scopes"]["all"]
    assert "2026-07-08" not in scope["records"]
    assert "2026-07-08" in scope["missing_dates"]


def test_scope_summary_reports_counts_dates_and_archive_filenames(tmp_path):
    history = ByteWattReportHistory(_FakeHass(tmp_path), "entry-1")
    history._store_snapshot_sync(
        scope_key="all",
        label="All systems",
        record_date="2026-07-08",
        reporting=_valid_reporting_payload(),
    )
    second = _valid_reporting_payload()
    second["power_diagram"] = {
        **second["power_diagram"],
        "date": "2026-07-09",
    }
    history._store_snapshot_sync(
        scope_key="all",
        label="All systems",
        record_date="2026-07-09",
        reporting=second,
    )
    history._mark_missing_date_sync(
        scope_key="all",
        label="All systems",
        record_date="2026-07-10",
        reason="no_reporting_data",
    )

    summary = history.scope_summary_sync("all")

    assert summary["scope_key"] == "all"
    assert summary["label"] == "All systems"
    assert summary["record_count"] == 2
    assert summary["first_record_date"] == "2026-07-08"
    assert summary["last_record_date"] == "2026-07-09"
    assert summary["missing_count"] == 1
    assert summary["csv_filename"] == "all.csv"
    assert summary["history_filename"] == "history.json"
    assert summary["provider_payload_present"] is True
    assert summary["provider_payload_key_count"] == 4
    assert summary["provider_payload_keys"] == ["gridDetailList", "ppvinverterPv", "soc", "time"]
    assert summary["raw_provider_present"] is True
    assert summary["last_updated"]


def test_build_reporting_payload_preserves_zero_total_values():
    payload = build_reporting_payload(
        {
            "PV_Generated_Today": 18.29,
            "Feed_In_Today": 0.09,
            "Battery_Charged_Today": 0.0,
            "Battery_Discharged_Today": 0.0,
            "Consumed_Today": 29.2,
            "Grid_Import_Today": 0.2,
            "Total_Solar_Generation": 0.0,
            "Total_Feed_In": 0.0,
            "Total_Battery_Charge": 0.0,
            "Total_Battery_Discharge": 0.0,
            "Total_House_Consumption": 0.0,
            "Grid_Power_Consumption": 0.0,
        },
        aggregate=True,
        label="All systems",
    )

    assert payload["totals"]["solar_generation"] == 0.0
    assert payload["totals"]["feed_in"] == 0.0
    assert payload["totals"]["battery_charge"] == 0.0
    assert payload["totals"]["battery_discharge"] == 0.0
    assert payload["totals"]["house_consumption"] == 0.0
    assert payload["totals"]["grid_consumption"] == 0.0


def test_forecast_snapshot_captures_mapped_entity_state(tmp_path):
    hass = _FakeHass(tmp_path)
    states = {
        "sensor.forecast_today": _FakeState("18.4", "kWh"),
        "sensor.forecast_power_now": _FakeState("1.2", "kW"),
    }
    hass.states = types.SimpleNamespace(get=lambda entity_id: states.get(entity_id))

    snapshot = build_forecast_snapshot(
        hass,
        {
            "forecast_provider": "forecast_solar",
            "forecast_generation_today_entity": "sensor.forecast_today",
            "forecast_power_now_entity": "sensor.forecast_power_now",
        },
    )

    assert snapshot["provider"] == "forecast_solar"
    assert snapshot["entities"]["generation_today"] == "sensor.forecast_today"
    assert snapshot["values"]["generation_today"]["state"] == "18.4"
    assert snapshot["values"]["generation_today"]["unit"] == "kWh"
    assert snapshot["values"]["power_now"]["state"] == "1.2"


def test_report_history_stores_forecast_snapshot_in_json_and_csv(tmp_path):
    history = ByteWattReportHistory(_FakeHass(tmp_path), "entry-1")
    reporting = _valid_reporting_payload()
    reporting["forecast"] = {
        "provider": "forecast_solar",
        "saved_at": "2026-08-20T10:15:00+00:00",
        "values": {
            "generation_today": {
                "entity_id": "sensor.forecast_today",
                "state": "18.4",
                "unit": "kWh",
            }
        },
    }

    history._store_snapshot_sync(
        scope_key="all",
        label="All systems",
        record_date="2026-08-20",
        reporting=reporting,
    )

    history_file = tmp_path / "www" / "heros-history" / "entry-1" / "history.json"
    payload = json.loads(history_file.read_text(encoding="utf-8"))
    row = payload["scopes"]["all"]["records"]["2026-08-20"]
    assert row["forecast"]["provider"] == "forecast_solar"

    csv_file = tmp_path / "www" / "heros-history" / "entry-1" / "all.csv"
    csv_text = csv_file.read_text(encoding="utf-8")
    assert "forecast_provider" in csv_text
    assert "forecast_solar" in csv_text
    assert "sensor.forecast_today" in csv_text
