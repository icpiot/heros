"""Shared HEROS reporting helpers and SQLite-backed history."""
from __future__ import annotations

import re
import threading
from copy import deepcopy
from datetime import datetime
from functools import wraps
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, TypeVar

from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

from .archive_store import ArchiveStore, DB_FILE_NAME

from .const import (
    CONF_FORECAST_GENERATION_NEXT_HOUR_ENTITY,
    CONF_FORECAST_GENERATION_REMAINING_TODAY_ENTITY,
    CONF_FORECAST_GENERATION_THIS_HOUR_ENTITY,
    CONF_FORECAST_GENERATION_TODAY_ENTITY,
    CONF_FORECAST_GENERATION_TOMORROW_ENTITY,
    CONF_FORECAST_PEAK_TODAY_ENTITY,
    CONF_FORECAST_PEAK_TOMORROW_ENTITY,
    CONF_FORECAST_POWER_IN_1_HOUR_ENTITY,
    CONF_FORECAST_POWER_IN_12_HOURS_ENTITY,
    CONF_FORECAST_POWER_IN_24_HOURS_ENTITY,
    CONF_FORECAST_POWER_NOW_ENTITY,
    CONF_FORECAST_PROVIDER,
    CONF_SOLAR_FORECAST_ENTITY,
    FORECAST_PROVIDER_NONE,
    DOMAIN,
)

_HISTORY_FILE_LOCK = threading.RLock()
_HistoryCallable = TypeVar("_HistoryCallable", bound=Callable[..., Any])


def _synchronized_history_io(func: _HistoryCallable) -> _HistoryCallable:
    """Serialize archive access during migration and concurrent writes."""
    @wraps(func)
    def wrapped(*args: Any, **kwargs: Any) -> Any:
        with _HISTORY_FILE_LOCK:
            return func(*args, **kwargs)

    return wrapped  # type: ignore[return-value]


HISTORY_DIR_NAME = "heros-history"
HISTORY_FILE_NAME = "history.json"


def _local_date_iso() -> str:
    """Return today's local date without depending on HA's optional dt helper."""
    default_zone = getattr(dt_util, "DEFAULT_TIME_ZONE", None)
    return datetime.now(default_zone).date().isoformat()

FORECAST_SNAPSHOT_FIELDS: tuple[tuple[str, str], ...] = (
    ("generation_today", CONF_FORECAST_GENERATION_TODAY_ENTITY),
    ("generation_tomorrow", CONF_FORECAST_GENERATION_TOMORROW_ENTITY),
    ("generation_this_hour", CONF_FORECAST_GENERATION_THIS_HOUR_ENTITY),
    ("generation_next_hour", CONF_FORECAST_GENERATION_NEXT_HOUR_ENTITY),
    ("generation_remaining_today", CONF_FORECAST_GENERATION_REMAINING_TODAY_ENTITY),
    ("power_now", CONF_FORECAST_POWER_NOW_ENTITY),
    ("power_in_1_hour", CONF_FORECAST_POWER_IN_1_HOUR_ENTITY),
    ("power_in_12_hours", CONF_FORECAST_POWER_IN_12_HOURS_ENTITY),
    ("power_in_24_hours", CONF_FORECAST_POWER_IN_24_HOURS_ENTITY),
    ("peak_today", CONF_FORECAST_PEAK_TODAY_ENTITY),
    ("peak_tomorrow", CONF_FORECAST_PEAK_TOMORROW_ENTITY),
    ("solar_forecast", CONF_SOLAR_FORECAST_ENTITY),
)


def _first_present(*values: Any) -> Any:
    """Return the first value that is not None."""
    for value in values:
        if value is not None:
            return value
    return None


def build_forecast_snapshot(
    hass: HomeAssistant,
    config: dict[str, Any],
    *,
    saved_at: str | None = None,
) -> dict[str, Any]:
    """Capture mapped solar forecast entity states for report history."""
    provider = str(config.get(CONF_FORECAST_PROVIDER) or FORECAST_PROVIDER_NONE).strip() or FORECAST_PROVIDER_NONE
    values: dict[str, dict[str, Any]] = {}
    entities: dict[str, str] = {}
    for field, config_key in FORECAST_SNAPSHOT_FIELDS:
        entity_id = str(config.get(config_key) or "").strip()
        if not entity_id:
            continue
        entities[field] = entity_id
        state = hass.states.get(entity_id)
        attrs = dict(getattr(state, "attributes", {}) or {}) if state is not None else {}
        values[field] = {
            "entity_id": entity_id,
            "state": getattr(state, "state", None),
            "unit": attrs.get("unit_of_measurement"),
            "last_updated": getattr(getattr(state, "last_updated", None), "isoformat", lambda: "")(),
        }
    return {
        "provider": provider,
        "saved_at": saved_at or dt_util.utcnow().isoformat(),
        "entities": entities,
        "values": values,
    }


def _synthesized_power_diagram(
    battery_data: dict[str, Any],
    *,
    reporting_date: str,
) -> dict[str, Any]:
    """Build a minimal power diagram when the backend did not provide one."""
    live_battery = battery_data.get("pbat")
    live_load = battery_data.get("pload")
    live_grid = battery_data.get("pgrid")
    live_pv = battery_data.get("ppv")
    daily_solar = battery_data.get("PV_Generated_Today")
    daily_load = battery_data.get("Consumed_Today")
    daily_feed = battery_data.get("Feed_In_Today")
    daily_grid = battery_data.get("Grid_Import_Today")
    daily_charge = battery_data.get("Battery_Charged_Today")
    daily_discharge = battery_data.get("Battery_Discharged_Today")
    return {
        "date": reporting_date,
        "meta": {
            "source": "synthesized",
            "label": "HEROS",
            "date": reporting_date,
        },
        "summary": {
            "soc": battery_data.get("soc"),
            "solar_generation": daily_solar,
            "load_consumption": daily_load,
            "feed_in": daily_feed,
            "grid_consumption": daily_grid,
            "battery_charge": daily_charge,
            "battery_discharge": daily_discharge,
        },
        "time": ["00:00"],
        "series": {
            "bat": [live_battery],
            "load": [live_load],
            "solar": [live_pv or daily_solar],
            "feed_in": [daily_feed if daily_feed is not None else live_grid],
            "consumed": [daily_load if daily_load is not None else live_load],
        },
    }


def build_reporting_payload(
    battery_data: dict[str, Any],
    *,
    aggregate: bool,
    label: str,
    forecast: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build the compact reporting payload used by the custom Lovelace cards."""
    reporting_date = str(
        battery_data.get("reporting_date")
        or battery_data.get("Power_Diagram", {}).get("date")
        or _local_date_iso()
    )
    power_diagram = battery_data.get("Power_Diagram") or {}
    power_diagram_source = "provider_power_diagram"
    if not isinstance(power_diagram, dict) or not power_diagram:
        power_diagram = _synthesized_power_diagram(battery_data, reporting_date=reporting_date)
        power_diagram_source = "synthesized_from_backend_snapshot"
    saved_at = dt_util.utcnow().isoformat()
    return {
        "aggregate": aggregate,
        "label": label,
        "reporting_date": reporting_date,
        "meta": {
            "aggregate": aggregate,
            "label": label,
            "reporting_date": reporting_date,
            "saved_at": saved_at,
            "source": "backend_reporting",
            "storage": "local_archive",
            "power_diagram_source": power_diagram_source,
        },
        "live": {
            "soc": battery_data.get("soc"),
            "battery_power": battery_data.get("pbat"),
            "house_consumption": battery_data.get("pload"),
            "grid_power": battery_data.get("pgrid"),
            "pv_power": battery_data.get("ppv"),
            "power_source": battery_data.get("powerSource"),
        },
        "today": {
            "solar_generation": battery_data.get("PV_Generated_Today"),
            "load_consumption": battery_data.get("Consumed_Today"),
            "feed_in": battery_data.get("Feed_In_Today"),
            "grid_consumption": battery_data.get("Grid_Import_Today"),
            "battery_charge": battery_data.get("Battery_Charged_Today"),
            "battery_discharge": battery_data.get("Battery_Discharged_Today"),
            "self_consumption": battery_data.get("Self_Consumption"),
            "self_sufficiency": battery_data.get("Self_Sufficiency"),
            "trees_planted": battery_data.get("Trees_Planted"),
            "co2_reduction_tons": battery_data.get("CO2_Reduction_Tons"),
        },
        "totals": {
            "solar_generation": _first_present(
                battery_data.get("Total_Solar_Generation"),
                battery_data.get("PV_Generated_Today"),
            ),
            "feed_in": _first_present(
                battery_data.get("Total_Feed_In"),
                battery_data.get("Feed_In_Today"),
            ),
            "battery_charge": _first_present(
                battery_data.get("Total_Battery_Charge"),
                battery_data.get("Battery_Charged_Today"),
            ),
            "battery_discharge": _first_present(
                battery_data.get("Total_Battery_Discharge"),
                battery_data.get("Battery_Discharged_Today"),
            ),
            "house_consumption": _first_present(
                battery_data.get("Total_House_Consumption"),
                battery_data.get("Consumed_Today"),
            ),
            "grid_consumption": _first_present(
                battery_data.get("Grid_Power_Consumption"),
                battery_data.get("Grid_Import_Today"),
            ),
            "pv_power_house": _first_present(battery_data.get("PV_Power_House"), 0),
            "pv_charging_battery": _first_present(battery_data.get("PV_Charging_Battery"), 0),
            "grid_battery_charge": _first_present(battery_data.get("Grid_Based_Battery_Charge"), 0),
        },
        "power_diagram": power_diagram,
        "forecast": forecast or {},
    }


def _safe_filename(value: str) -> str:
    value = re.sub(r"[^A-Za-z0-9._-]+", "_", value or "").strip("._-")
    return value or "all"


def _power_diagram_from_reporting(reporting: dict[str, Any]) -> dict[str, Any]:
    """Return a nested or bare power diagram payload when one exists."""
    if not isinstance(reporting, dict):
        return {}
    power_diagram = reporting.get("power_diagram")
    if isinstance(power_diagram, dict) and power_diagram:
        return power_diagram
    bare_keys = ("time", "series", "summary", "date", "meta")
    if any(key in reporting for key in bare_keys):
        return reporting
    return {}


def _provider_payload_from_reporting(reporting: dict[str, Any]) -> dict[str, Any]:
    """Return the stored provider day payload when one exists."""
    power_diagram = _power_diagram_from_reporting(reporting)
    provider_payload = power_diagram.get("provider_payload") if isinstance(power_diagram, dict) else {}
    return provider_payload if isinstance(provider_payload, dict) else {}


class ByteWattReportHistory:
    """Persistent per-entry SQLite archive; legacy JSON is migration input only."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self.hass = hass
        self.entry_id = entry_id
        self.base_dir = Path(hass.config.path("www", HISTORY_DIR_NAME, entry_id))
        self.history_file = self.base_dir / HISTORY_FILE_NAME
        self.db_dir = Path(hass.config.path("heros-history", entry_id))
        self.archive_file = self.db_dir / DB_FILE_NAME
        entry_data = getattr(hass, "data", {}).get(DOMAIN, {}).get(entry_id, {})
        self.provider = str(entry_data.get("provider") or "bytewatt")
        self.store = ArchiveStore(self.archive_file, self.provider)

    def ensure_ready_sync(self) -> dict[str, Any]:
        """Run an idempotent migration before SQLite becomes authoritative."""
        return self.store.ensure_migrated(self.history_file)

    async def async_ensure_ready(self) -> dict[str, Any]:
        return await self.hass.async_add_executor_job(self.ensure_ready_sync)

    async def async_store_snapshot(
        self, *, scope_key: str, label: str, reporting: dict[str, Any],
        record_date: str | None = None,
    ) -> str:
        """Commit a validated day; surface errors to the job controller."""
        payload = deepcopy(reporting)
        scope_key = _safe_filename(scope_key)
        label = str(label or payload.get("label") or scope_key)
        record_date = record_date or str(payload.get("power_diagram", {}).get("date") or _local_date_iso())
        payload["reporting_date"] = record_date
        meta = payload.setdefault("meta", {})
        if isinstance(meta, dict):
            meta["reporting_date"] = record_date
        diagram = payload.setdefault("power_diagram", {})
        if isinstance(diagram, dict):
            diagram["date"] = record_date
        return await self.hass.async_add_executor_job(
            self._store_snapshot_sync, scope_key, label, record_date, payload,
        )

    @_synchronized_history_io
    def _store_snapshot_sync(self, scope_key: str, label: str,
                             record_date: str, reporting: dict[str, Any]) -> str:
        self.ensure_ready_sync()
        return self.store.put_report(scope_key, record_date, label, reporting)

    async def async_mark_missing_date(
        self, *, scope_key: str, label: str, record_date: str,
        reason: str = "no_reporting_data",
    ) -> None:
        await self.hass.async_add_executor_job(
            self._mark_missing_date_sync, _safe_filename(scope_key), label,
            record_date, reason,
        )

    @_synchronized_history_io
    def _mark_missing_date_sync(self, scope_key: str, label: str,
                                record_date: str, reason: str) -> None:
        self.ensure_ready_sync()
        self.store.mark_missing(scope_key, record_date, reason)

    async def async_record_dates(self, scope_key: str) -> set[str]:
        return await self.hass.async_add_executor_job(self._record_dates_sync, _safe_filename(scope_key))

    @_synchronized_history_io
    def _record_dates_sync(self, scope_key: str) -> set[str]:
        self.ensure_ready_sync()
        return self.store.dates(scope_key)

    async def async_missing_dates(self, scope_key: str) -> dict[str, dict[str, Any]]:
        return await self.hass.async_add_executor_job(self._missing_dates_sync, _safe_filename(scope_key))

    @_synchronized_history_io
    def _missing_dates_sync(self, scope_key: str) -> dict[str, dict[str, Any]]:
        self.ensure_ready_sync()
        return self.store.missing(scope_key)

    async def async_scope_summary(self, scope_key: str) -> dict[str, Any]:
        return await self.hass.async_add_executor_job(self.scope_summary_sync, _safe_filename(scope_key))

    @_synchronized_history_io
    def scope_summary_sync(self, scope_key: str) -> dict[str, Any]:
        self.ensure_ready_sync()
        summary = self.store.summary(scope_key)
        latest = self.store.report(scope_key, summary["last_record_date"]) if summary["last_record_date"] else {}
        latest = latest or {}
        diagram = _power_diagram_from_reporting(latest)
        provider_payload = _provider_payload_from_reporting(latest)
        summary.update({
            "label": str(latest.get("label") or scope_key),
            "csv_filename": "", "history_filename": "",
            "storage": "sqlite", "database_filename": self.archive_file.name,
            "provider_payload_present": bool(provider_payload),
            "provider_payload_key_count": len(provider_payload),
            "provider_payload_keys": sorted(str(key) for key in provider_payload),
            "raw_provider_present": bool(diagram.get("raw_provider"))
                if isinstance(diagram.get("raw_provider"), dict) else False,
        })
        return summary

    async def async_archive_state(self) -> dict[str, Any]:
        return await self.hass.async_add_executor_job(self.archive_state_sync)

    @_synchronized_history_io
    def archive_state_sync(self) -> dict[str, Any]:
        self.ensure_ready_sync()
        return self.store.job()

    async def async_update_archive_state(self, updates: dict[str, Any]) -> dict[str, Any]:
        state = await self.hass.async_add_executor_job(self._update_archive_state_sync, dict(updates or {}))
        from homeassistant.helpers.dispatcher import async_dispatcher_send
        async_dispatcher_send(self.hass, f"{DOMAIN}_{self.entry_id}_history_updated")
        return state

    @_synchronized_history_io
    def _update_archive_state_sync(self, updates: dict[str, Any]) -> dict[str, Any]:
        self.ensure_ready_sync()
        return self.store.update_job(updates)

    async def async_range_reports(self, scope_key: str, start: str,
                                  end: str) -> dict[str, dict[str, Any]]:
        return await self.hass.async_add_executor_job(
            self._range_reports_sync, _safe_filename(scope_key), start, end,
        )

    @_synchronized_history_io
    def _range_reports_sync(self, scope_key: str, start: str,
                            end: str) -> dict[str, dict[str, Any]]:
        self.ensure_ready_sync()
        return self.store.range_reports(scope_key, start, end)
