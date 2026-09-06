"""Shared reporting helpers and local history persistence for Byte-Watt."""
from __future__ import annotations

import csv
import json
import logging
import re
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable

from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

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
)

_LOGGER = logging.getLogger(__name__)

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


def _json_default(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _csv_cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list, tuple)):
        value = json.dumps(value, default=_json_default, ensure_ascii=False, separators=(",", ":"))
    else:
        value = str(value)
    return value


def _summary_row(
    *,
    scope_key: str,
    label: str,
    record_date: str,
    reporting: dict[str, Any],
) -> dict[str, Any]:
    live = reporting.get("live") or {}
    today = reporting.get("today") or {}
    totals = reporting.get("totals") or {}
    forecast = reporting.get("forecast") or {}
    forecast_values = forecast.get("values") if isinstance(forecast, dict) else {}
    power_diagram = _power_diagram_from_reporting(reporting)
    series = power_diagram.get("series") or {}

    return {
        "record_date": record_date,
        "scope_key": scope_key,
        "label": label,
        "aggregate": reporting.get("aggregate", False),
        "reporting_date": power_diagram.get("date") or "",
        "saved_at": reporting.get("meta", {}).get("saved_at") or "",
        "live_soc": live.get("soc"),
        "live_battery_power": live.get("battery_power"),
        "live_load_power": live.get("house_consumption"),
        "live_grid_power": live.get("grid_power"),
        "live_pv_power": live.get("pv_power"),
        "power_source": live.get("power_source"),
        "solar_generation_today": today.get("solar_generation"),
        "load_consumption_today": today.get("load_consumption"),
        "feed_in_today": today.get("feed_in"),
        "grid_consumption_today": today.get("grid_consumption"),
        "battery_charged_today": today.get("battery_charge"),
        "battery_discharged_today": today.get("battery_discharge"),
        "self_consumption": today.get("self_consumption"),
        "self_sufficiency": today.get("self_sufficiency"),
        "trees_planted": today.get("trees_planted"),
        "co2_reduction_tons": today.get("co2_reduction_tons"),
        "total_solar_generation": totals.get("solar_generation"),
        "total_feed_in": totals.get("feed_in"),
        "total_battery_charge": totals.get("battery_charge"),
        "total_battery_discharge": totals.get("battery_discharge"),
        "total_house_consumption": totals.get("house_consumption"),
        "total_grid_consumption": totals.get("grid_consumption"),
        "pv_power_house": totals.get("pv_power_house"),
        "pv_charging_battery": totals.get("pv_charging_battery"),
        "grid_battery_charge": totals.get("grid_battery_charge"),
        "forecast_provider": forecast.get("provider") if isinstance(forecast, dict) else "",
        "forecast_saved_at": forecast.get("saved_at") if isinstance(forecast, dict) else "",
        "forecast_values": json.dumps(forecast_values or {}, default=_json_default, ensure_ascii=False, separators=(",", ":")),
        "chart_time": json.dumps(power_diagram.get("time") or [], default=_json_default, ensure_ascii=False, separators=(",", ":")),
        "chart_bat": json.dumps(series.get("bat") or [], default=_json_default, ensure_ascii=False, separators=(",", ":")),
        "chart_load": json.dumps(series.get("load") or [], default=_json_default, ensure_ascii=False, separators=(",", ":")),
        "chart_solar": json.dumps(series.get("solar") or [], default=_json_default, ensure_ascii=False, separators=(",", ":")),
        "chart_feed_in": json.dumps(series.get("feed_in") or [], default=_json_default, ensure_ascii=False, separators=(",", ":")),
        "chart_consumed": json.dumps(series.get("consumed") or [], default=_json_default, ensure_ascii=False, separators=(",", ":")),
    }


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


def _reporting_has_power_diagram_data(reporting: dict[str, Any]) -> bool:
    """Return True when a stored row has chart data worth treating as archived."""
    power_diagram = _power_diagram_from_reporting(reporting)
    if not isinstance(power_diagram, dict) or not power_diagram:
        return False
    time_points = power_diagram.get("time") or []
    if isinstance(time_points, list) and len(time_points) > 0:
        return True
    series = power_diagram.get("series") or {}
    if isinstance(series, dict):
        for value in series.values():
            if isinstance(value, list) and len(value) > 0:
                return True
    return False


class ByteWattReportHistory:
    """Persist one local snapshot per date and scope."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self.hass = hass
        self.entry_id = entry_id
        self.base_dir = Path(hass.config.path("www", HISTORY_DIR_NAME, entry_id))
        self.history_file = self.base_dir / HISTORY_FILE_NAME

    async def async_store_snapshot(
        self,
        *,
        scope_key: str,
        label: str,
        reporting: dict[str, Any],
        record_date: str | None = None,
    ) -> None:
        """Store a daily snapshot and regenerate the CSV summary."""
        payload = deepcopy(reporting)
        scope_key = _safe_filename(scope_key)
        label = label or payload.get("label") or scope_key
        record_date = record_date or str(
            payload.get("power_diagram", {}).get("date")
            or _local_date_iso()
        )
        payload["reporting_date"] = record_date
        meta = payload.setdefault("meta", {})
        if isinstance(meta, dict):
            meta["reporting_date"] = record_date
        power_diagram = payload.setdefault("power_diagram", {})
        if isinstance(power_diagram, dict):
            power_diagram["date"] = record_date

        try:
            await self.hass.async_add_executor_job(
                self._store_snapshot_sync,
                scope_key,
                label,
                record_date,
                payload,
            )
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning(
                "Failed to persist ByteWatt history for %s (%s): %s",
                scope_key,
                record_date,
                err,
            )

    async def async_mark_missing_date(
        self,
        *,
        scope_key: str,
        label: str,
        record_date: str,
        reason: str = "no_reporting_data",
    ) -> None:
        """Persist a known-missing date so it is not re-requested forever."""
        scope_key = _safe_filename(scope_key)
        try:
            await self.hass.async_add_executor_job(
                self._mark_missing_date_sync,
                scope_key,
                label or scope_key,
                record_date,
                reason,
            )
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning(
                "Failed to persist missing ByteWatt history date for %s (%s): %s",
                scope_key,
                record_date,
                err,
            )

    async def async_record_dates(self, scope_key: str) -> set[str]:
        """Return the known record dates for a scope."""
        scope_key = _safe_filename(scope_key)
        try:
            return await self.hass.async_add_executor_job(self._record_dates_sync, scope_key)
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Failed to read ByteWatt history dates for %s: %s", scope_key, err)
            return set()

    async def async_missing_dates(self, scope_key: str) -> dict[str, dict[str, Any]]:
        """Return the known missing-date markers for a scope."""
        scope_key = _safe_filename(scope_key)
        try:
            return await self.hass.async_add_executor_job(self._missing_dates_sync, scope_key)
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Failed to read ByteWatt missing dates for %s: %s", scope_key, err)
            return {}

    async def async_scope_summary(self, scope_key: str) -> dict[str, Any]:
        """Return compact archive summary details for one scope."""
        scope_key = _safe_filename(scope_key)
        try:
            return await self.hass.async_add_executor_job(self.scope_summary_sync, scope_key)
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Failed to read ByteWatt scope summary for %s: %s", scope_key, err)
            return {}

    def _store_snapshot_sync(
        self,
        scope_key: str,
        label: str,
        record_date: str,
        reporting: dict[str, Any],
    ) -> None:
        if not _reporting_has_power_diagram_data(reporting):
            _LOGGER.debug(
                "Skipping ByteWatt history snapshot for %s (%s): no chart data",
                scope_key,
                record_date,
            )
            return
        self.base_dir.mkdir(parents=True, exist_ok=True)

        if self.history_file.exists():
            try:
                history = json.loads(self.history_file.read_text(encoding="utf-8"))
            except Exception as err:  # noqa: BLE001
                _LOGGER.warning("Unable to read existing ByteWatt history file: %s", err)
                history = {}
        else:
            history = {}

        scopes = history.setdefault("scopes", {})
        scope = scopes.setdefault(
            scope_key,
            {
                "label": label,
                "records": {},
            },
        )
        scope["label"] = label
        scope["updated"] = dt_util.utcnow().isoformat()
        records = scope.setdefault("records", {})
        records[record_date] = reporting
        missing_dates = scope.get("missing_dates")
        if isinstance(missing_dates, dict) and record_date in missing_dates:
            missing_dates.pop(record_date, None)
        history["version"] = 1
        history["updated"] = dt_util.utcnow().isoformat()

        self.history_file.write_text(
            json.dumps(history, indent=2, ensure_ascii=False, default=_json_default),
            encoding="utf-8",
        )
        self._write_scope_csv(scope_key, label, scope.get("records", {}))

    def _mark_missing_date_sync(
        self,
        scope_key: str,
        label: str,
        record_date: str,
        reason: str,
    ) -> None:
        self.base_dir.mkdir(parents=True, exist_ok=True)

        if self.history_file.exists():
            try:
                history = json.loads(self.history_file.read_text(encoding="utf-8"))
            except Exception as err:  # noqa: BLE001
                _LOGGER.warning("Unable to read existing ByteWatt history file: %s", err)
                history = {}
        else:
            history = {}

        scopes = history.setdefault("scopes", {})
        scope = scopes.setdefault(
            scope_key,
            {
                "label": label,
                "records": {},
                "missing_dates": {},
            },
        )
        scope["label"] = label
        scope["updated"] = dt_util.utcnow().isoformat()
        records = scope.setdefault("records", {})
        existing_record = records.get(record_date)
        if _reporting_has_power_diagram_data(existing_record or {}):
            missing_dates = scope.setdefault("missing_dates", {})
            if isinstance(missing_dates, list):
                missing_dates = {str(item): {"reason": reason} for item in missing_dates if item}
                scope["missing_dates"] = missing_dates
            if isinstance(missing_dates, dict) and record_date in missing_dates:
                missing_dates.pop(record_date, None)
                history["version"] = 1
                history["updated"] = dt_util.utcnow().isoformat()
                self.history_file.write_text(
                    json.dumps(history, indent=2, ensure_ascii=False, default=_json_default),
                    encoding="utf-8",
                )
            return

        records.pop(record_date, None)
        missing_dates = scope.setdefault("missing_dates", {})
        if isinstance(missing_dates, list):
            missing_dates = {str(item): {"reason": reason} for item in missing_dates if item}
            scope["missing_dates"] = missing_dates
        missing_dates[record_date] = {
            "reason": reason,
            "saved_at": dt_util.utcnow().isoformat(),
        }
        history["version"] = 1
        history["updated"] = dt_util.utcnow().isoformat()

        self.history_file.write_text(
            json.dumps(history, indent=2, ensure_ascii=False, default=_json_default),
            encoding="utf-8",
        )

    def _record_dates_sync(self, scope_key: str) -> set[str]:
        if not self.history_file.exists():
            return set()
        try:
            history = json.loads(self.history_file.read_text(encoding="utf-8"))
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Unable to read existing ByteWatt history file: %s", err)
            return set()
        scopes = history.get("scopes") or {}
        scope = scopes.get(scope_key) or {}
        records = scope.get("records") or {}
        return {
            str(key)
            for key, reporting in records.items()
            if key and _reporting_has_power_diagram_data(reporting or {})
        }

    def _missing_dates_sync(self, scope_key: str) -> dict[str, dict[str, Any]]:
        if not self.history_file.exists():
            return {}
        try:
            history = json.loads(self.history_file.read_text(encoding="utf-8"))
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Unable to read existing ByteWatt history file: %s", err)
            return {}
        scopes = history.get("scopes") or {}
        scope = scopes.get(scope_key) or {}
        missing = scope.get("missing_dates") or {}
        if isinstance(missing, list):
            return {str(key): {} for key in missing if key}
        if not isinstance(missing, dict):
            return {}
        return {str(key): (value if isinstance(value, dict) else {}) for key, value in missing.items() if key}

    def scope_summary_sync(self, scope_key: str) -> dict[str, Any]:
        """Return compact archive summary details for one scope."""
        if not self.history_file.exists():
            return {}
        try:
            history = json.loads(self.history_file.read_text(encoding="utf-8"))
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Unable to read existing ByteWatt history file: %s", err)
            return {}

        scopes = history.get("scopes") or {}
        scope = scopes.get(scope_key) or {}
        records = scope.get("records") or {}
        valid_dates = sorted(
            str(key)
            for key, reporting in records.items()
            if key and _reporting_has_power_diagram_data(reporting or {})
        )
        missing = self._missing_dates_sync(scope_key)
        csv_path = self.base_dir / f"{scope_key}.csv"
        latest_record = records.get(valid_dates[-1]) if valid_dates else {}
        latest_power_diagram = _power_diagram_from_reporting(latest_record or {})
        latest_provider_payload = _provider_payload_from_reporting(latest_record or {})
        return {
            "scope_key": scope_key,
            "label": str(scope.get("label") or scope_key),
            "record_count": len(valid_dates),
            "first_record_date": valid_dates[0] if valid_dates else "",
            "last_record_date": valid_dates[-1] if valid_dates else "",
            "missing_count": len(missing),
            "last_updated": str(scope.get("updated") or history.get("updated") or ""),
            "csv_filename": csv_path.name if csv_path.exists() else "",
            "history_filename": self.history_file.name if self.history_file.exists() else "",
            "provider_payload_present": bool(latest_provider_payload),
            "provider_payload_key_count": len(latest_provider_payload),
            "provider_payload_keys": sorted(str(key) for key in latest_provider_payload.keys()),
            "raw_provider_present": isinstance(latest_power_diagram.get("raw_provider"), dict)
            and bool(latest_power_diagram.get("raw_provider")),
        }

    def _write_scope_csv(
        self,
        scope_key: str,
        label: str,
        records: dict[str, Any],
    ) -> None:
        csv_path = self.base_dir / f"{scope_key}.csv"
        fieldnames = [
            "record_date",
            "scope_key",
            "label",
            "aggregate",
            "reporting_date",
            "saved_at",
            "live_soc",
            "live_battery_power",
            "live_load_power",
            "live_grid_power",
            "live_pv_power",
            "power_source",
            "solar_generation_today",
            "load_consumption_today",
            "feed_in_today",
            "grid_consumption_today",
            "battery_charged_today",
            "battery_discharged_today",
            "self_consumption",
            "self_sufficiency",
            "trees_planted",
            "co2_reduction_tons",
            "total_solar_generation",
            "total_feed_in",
            "total_battery_charge",
            "total_battery_discharge",
            "total_house_consumption",
            "total_grid_consumption",
            "pv_power_house",
            "pv_charging_battery",
            "grid_battery_charge",
            "forecast_provider",
            "forecast_saved_at",
            "forecast_values",
            "chart_time",
            "chart_bat",
            "chart_load",
            "chart_solar",
            "chart_feed_in",
            "chart_consumed",
        ]

        rows: list[dict[str, Any]] = []
        for record_date in sorted(records):
            reporting = records.get(record_date) or {}
            rows.append(
                _summary_row(
                    scope_key=scope_key,
                    label=label,
                    record_date=record_date,
                    reporting=reporting,
                )
            )

        with csv_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            for row in rows:
                writer.writerow({key: _csv_cell(row.get(key)) for key in fieldnames})
