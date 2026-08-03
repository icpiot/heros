"""Local persistence helpers for vendor-neutral pricing history."""
from __future__ import annotations

import json
import logging
from copy import deepcopy
from pathlib import Path
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

from .pricing import (
    PriceHistory,
    PriceRecord,
    PricingRateGroup,
    PricingRateRecord,
    PricingRule,
    PricingSchedule,
)

_LOGGER = logging.getLogger(__name__)

PRICING_DIR_NAME = "home-energy-manager"
LEGACY_PRICING_DIR_NAME = "home-energy-manager-pricing"
PRICING_FILE_NAME = "pricing.json"
PRICING_SCHEDULE_FILE_NAME = "pricing_schedule.json"


def _safe_filename(value: str) -> str:
    value = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in str(value or ""))
    value = value.strip("._-")
    return value or "all"


def load_pricing_history_file(path: Path) -> dict[str, Any]:
    """Load a raw pricing history JSON file."""
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as err:  # noqa: BLE001
        _LOGGER.warning("Unable to read pricing history file %s: %s", path, err)
        return {}


def write_pricing_history_file(path: Path, payload: dict[str, Any]) -> None:
    """Write a raw pricing history JSON file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


class PriceHistoryStore:
    """Persist pricing records per scope.

    The store is intentionally lightweight:

    - JSON only
    - one file per Home Assistant entry
    - grouped by scope so future cards can render system-specific or
      region-specific pricing views
    """

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self.hass = hass
        self.entry_id = entry_id
        self.base_dir = Path(hass.config.path("www", PRICING_DIR_NAME, entry_id))
        self.legacy_base_dir = Path(hass.config.path("www", LEGACY_PRICING_DIR_NAME, entry_id))
        self.history_file = self.base_dir / PRICING_FILE_NAME
        self.legacy_history_file = self.legacy_base_dir / PRICING_FILE_NAME

    async def async_store_record(
        self,
        *,
        scope_key: str,
        label: str,
        record: PriceRecord,
    ) -> None:
        """Append a pricing record and persist the JSON file."""
        scope_key = _safe_filename(scope_key)
        try:
            await self.hass.async_add_executor_job(
                self._store_record_sync,
                scope_key,
                label or scope_key,
                record,
            )
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning(
                "Failed to persist pricing record for %s: %s",
                scope_key,
                err,
            )

    async def async_history(self, scope_key: str) -> PriceHistory:
        """Return the stored history for a scope."""
        scope_key = _safe_filename(scope_key)
        try:
            return await self.hass.async_add_executor_job(self._history_sync, scope_key)
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Failed to read pricing history for %s: %s", scope_key, err)
            return PriceHistory()

    def _store_record_sync(self, scope_key: str, label: str, record: PriceRecord) -> None:
        self.base_dir.mkdir(parents=True, exist_ok=True)
        history = self._load_sync()
        scopes = history.setdefault("scopes", {})
        scope = scopes.setdefault(
            scope_key,
            {
                "label": label,
                "records": [],
            },
        )
        scope["label"] = label
        scope["updated"] = dt_util.utcnow().isoformat()
        records = scope.setdefault("records", [])
        if not isinstance(records, list):
            records = []
            scope["records"] = records
        records.append(record.to_dict())
        history["version"] = 1
        history["updated"] = dt_util.utcnow().isoformat()
        self._save_sync(history)

    def _load_sync(self) -> dict[str, Any]:
        payload = load_pricing_history_file(self.history_file)
        if payload:
            return payload
        return load_pricing_history_file(self.legacy_history_file)

    def _save_sync(self, history: dict[str, Any]) -> None:
        write_pricing_history_file(self.history_file, history)

    def _history_sync(self, scope_key: str) -> PriceHistory:
        history = self._load_sync()
        scopes = history.get("scopes") or {}
        scope = scopes.get(scope_key) or {}
        records = scope.get("records") or []
        if not isinstance(records, list):
            return PriceHistory()
        return PriceHistory.from_dict(
            {
                "entries": [
                    deepcopy(record)
                    for record in records
                    if isinstance(record, dict)
                ],
            }
        )


class PricingScheduleStore:
    """Persist date-based pricing rules and holiday dates."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self.hass = hass
        self.entry_id = entry_id
        self.base_dir = Path(hass.config.path("www", PRICING_DIR_NAME, entry_id))
        self.legacy_base_dir = Path(hass.config.path("www", LEGACY_PRICING_DIR_NAME, entry_id))
        self.schedule_file = self.base_dir / PRICING_SCHEDULE_FILE_NAME
        self.legacy_schedule_file = self.legacy_base_dir / PRICING_SCHEDULE_FILE_NAME

    async def async_schedule(self) -> PricingSchedule:
        """Return the stored pricing schedule."""
        try:
            return await self.hass.async_add_executor_job(self._schedule_sync)
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Failed to read pricing schedule for %s: %s", self.entry_id, err)
            return PricingSchedule()

    async def async_upsert_rule(self, rule: PricingRule) -> PricingSchedule:
        """Insert or replace a pricing rule and persist the schedule."""
        try:
            return await self.hass.async_add_executor_job(self._upsert_rule_sync, rule)
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Failed to store pricing rule for %s: %s", self.entry_id, err)
            return PricingSchedule()

    async def async_remove_rule(self, rule_id: str) -> PricingSchedule:
        """Remove a pricing rule and persist the schedule."""
        try:
            return await self.hass.async_add_executor_job(self._remove_rule_sync, rule_id)
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Failed to remove pricing rule for %s: %s", self.entry_id, err)
            return PricingSchedule()

    async def async_upsert_group(self, group: PricingRateGroup) -> PricingSchedule:
        """Insert or replace a pricing rate group and persist the schedule."""
        try:
            return await self.hass.async_add_executor_job(self._upsert_group_sync, group)
        except ValueError:
            raise
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Failed to store pricing group for %s: %s", self.entry_id, err)
            return PricingSchedule()

    async def async_remove_group(self, group_id: str) -> PricingSchedule:
        """Remove a pricing rate group and persist the schedule."""
        try:
            return await self.hass.async_add_executor_job(self._remove_group_sync, group_id)
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Failed to remove pricing group for %s: %s", self.entry_id, err)
            return PricingSchedule()

    async def async_upsert_record(
        self,
        *,
        group_id: str,
        record: PricingRateRecord,
    ) -> PricingSchedule:
        """Insert or replace a pricing record inside a group."""
        try:
            return await self.hass.async_add_executor_job(self._upsert_record_sync, group_id, record)
        except ValueError:
            raise
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Failed to store pricing record for %s: %s", self.entry_id, err)
            return PricingSchedule()

    async def async_remove_record(
        self,
        *,
        group_id: str,
        record_id: str,
    ) -> PricingSchedule:
        """Remove one pricing record from a group."""
        try:
            return await self.hass.async_add_executor_job(self._remove_record_sync, group_id, record_id)
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Failed to remove pricing record for %s: %s", self.entry_id, err)
            return PricingSchedule()

    async def async_set_holidays(
        self,
        *,
        holiday_dates: list[str],
        holiday_source: str = "",
        region: str = "",
    ) -> PricingSchedule:
        """Replace the holiday calendar and persist the schedule."""
        try:
            return await self.hass.async_add_executor_job(
                self._set_holidays_sync,
                holiday_dates,
                holiday_source,
                region,
            )
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Failed to update holiday dates for %s: %s", self.entry_id, err)
            return PricingSchedule()

    def _schedule_sync(self) -> PricingSchedule:
        payload = load_pricing_history_file(self.schedule_file)
        if not payload:
            payload = load_pricing_history_file(self.legacy_schedule_file)
        return PricingSchedule.from_dict(payload)

    def _save_schedule_sync(self, schedule: PricingSchedule) -> None:
        self.base_dir.mkdir(parents=True, exist_ok=True)
        payload = schedule.to_dict()
        payload["version"] = int(payload.get("version") or 1)
        payload["updated"] = dt_util.utcnow().isoformat()
        write_pricing_history_file(self.schedule_file, payload)

    def _upsert_rule_sync(self, rule: PricingRule) -> PricingSchedule:
        schedule = self._schedule_sync()
        schedule.add_rule(rule)
        schedule.updated_at = dt_util.utcnow()
        self._save_schedule_sync(schedule)
        return schedule

    def _remove_rule_sync(self, rule_id: str) -> PricingSchedule:
        schedule = self._schedule_sync()
        schedule.remove_rule(rule_id)
        schedule.updated_at = dt_util.utcnow()
        self._save_schedule_sync(schedule)
        return schedule

    def _upsert_group_sync(self, group: PricingRateGroup) -> PricingSchedule:
        schedule = self._schedule_sync()
        schedule.add_group(group)
        schedule.updated_at = dt_util.utcnow()
        self._save_schedule_sync(schedule)
        return schedule

    def _remove_group_sync(self, group_id: str) -> PricingSchedule:
        schedule = self._schedule_sync()
        schedule.remove_group(group_id)
        schedule.updated_at = dt_util.utcnow()
        self._save_schedule_sync(schedule)
        return schedule

    def _upsert_record_sync(self, group_id: str, record: PricingRateRecord) -> PricingSchedule:
        schedule = self._schedule_sync()
        group_key = str(group_id or "").strip()
        groups = []
        found = False
        for group in schedule.groups:
            if group.group_id != group_key:
                groups.append(group)
                continue
            found = True
            records = [existing for existing in group.records if existing.record_id != record.record_id]
            records.append(record)
            groups.append(PricingRateGroup.from_dict({
                **group.to_dict(),
                "records": [item.to_dict() for item in records],
            }))
        if not found:
            raise ValueError(f"Unknown pricing group: {group_id!r}")
        schedule.groups = groups
        schedule._raise_for_duplicate_group_dates()
        schedule.updated_at = dt_util.utcnow()
        self._save_schedule_sync(schedule)
        return schedule

    def _remove_record_sync(self, group_id: str, record_id: str) -> PricingSchedule:
        schedule = self._schedule_sync()
        group_key = str(group_id or "").strip()
        record_key = str(record_id or "").strip()
        groups = []
        for group in schedule.groups:
            if group.group_id != group_key:
                groups.append(group)
                continue
            records = [record for record in group.records if record.record_id != record_key]
            groups.append(PricingRateGroup.from_dict({
                **group.to_dict(),
                "records": [record.to_dict() for record in records],
            }))
        schedule.groups = groups
        schedule.updated_at = dt_util.utcnow()
        self._save_schedule_sync(schedule)
        return schedule

    def _set_holidays_sync(
        self,
        holiday_dates: list[str],
        holiday_source: str,
        region: str,
    ) -> PricingSchedule:
        schedule = self._schedule_sync()
        from .pricing import _parse_date

        parsed_dates = [
            parsed
            for parsed in (_parse_date(value) for value in holiday_dates)
            if parsed is not None
        ]
        schedule.holiday_dates = parsed_dates
        schedule.holiday_source = str(holiday_source or "").strip()
        schedule.region = str(region or "").strip()
        schedule.updated_at = dt_util.utcnow()
        self._save_schedule_sync(schedule)
        return schedule
