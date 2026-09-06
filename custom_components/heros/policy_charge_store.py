"""Shared persistence for battery charge policy schedules."""
from __future__ import annotations

import logging
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

from .policy_charge import PolicyChargeSchedule, PolicyChargeScheduleSet
from .pricing_store import LEGACY_PRICING_DIR_NAME, PRICING_DIR_NAME, load_pricing_history_file, write_pricing_history_file

_LOGGER = logging.getLogger(__name__)

POLICY_CHARGE_SCHEDULE_FILE_NAME = "policy_charge_schedule.json"


def _safe_scope_key(value: str) -> str:
    text = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in str(value or ""))
    text = text.strip("._-")
    return text or "all"


class PolicyChargeScheduleStore:
    """Persist selected-target battery charge schedules."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self.hass = hass
        self.entry_id = entry_id
        self.base_dir = Path(hass.config.path("www", PRICING_DIR_NAME, entry_id))
        self.legacy_base_dir = Path(hass.config.path("www", LEGACY_PRICING_DIR_NAME, entry_id))
        self.schedule_file = self.base_dir / POLICY_CHARGE_SCHEDULE_FILE_NAME
        self.legacy_schedule_file = self.legacy_base_dir / POLICY_CHARGE_SCHEDULE_FILE_NAME

    async def async_schedule_set(self) -> PolicyChargeScheduleSet:
        try:
            return await self.hass.async_add_executor_job(self._schedule_set_sync)
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Failed to read policy charge schedules for %s: %s", self.entry_id, err)
            return PolicyChargeScheduleSet()

    async def async_scope_schedule(self, scope_key: str) -> PolicyChargeSchedule | None:
        schedule_set = await self.async_schedule_set()
        return schedule_set.scope(_safe_scope_key(scope_key))

    async def async_upsert_scope(self, schedule: PolicyChargeSchedule) -> PolicyChargeScheduleSet:
        try:
            return await self.hass.async_add_executor_job(self._upsert_scope_sync, schedule)
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Failed to store policy charge schedule for %s: %s", self.entry_id, err)
            return PolicyChargeScheduleSet()

    async def async_remove_scope(self, scope_key: str) -> PolicyChargeScheduleSet:
        try:
            return await self.hass.async_add_executor_job(self._remove_scope_sync, _safe_scope_key(scope_key))
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Failed to remove policy charge schedule for %s: %s", self.entry_id, err)
            return PolicyChargeScheduleSet()

    async def async_record_feedback(
        self,
        *,
        scope_key: str,
        action: str,
        ok: bool,
        message: str,
        charging_now: bool | None = None,
    ) -> PolicyChargeScheduleSet:
        try:
            return await self.hass.async_add_executor_job(
                self._record_feedback_sync,
                _safe_scope_key(scope_key),
                action,
                ok,
                message,
                charging_now,
            )
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Failed to update policy charge feedback for %s: %s", self.entry_id, err)
            return PolicyChargeScheduleSet()

    def _schedule_set_sync(self) -> PolicyChargeScheduleSet:
        payload = load_pricing_history_file(self.schedule_file)
        if not payload:
            payload = load_pricing_history_file(self.legacy_schedule_file)
        return PolicyChargeScheduleSet.from_dict(payload)

    def _save_schedule_set_sync(self, schedule_set: PolicyChargeScheduleSet) -> None:
        self.base_dir.mkdir(parents=True, exist_ok=True)
        write_pricing_history_file(self.schedule_file, schedule_set.to_dict())

    def _upsert_scope_sync(self, schedule: PolicyChargeSchedule) -> PolicyChargeScheduleSet:
        schedule_set = self._schedule_set_sync()
        now = dt_util.utcnow().isoformat()
        schedule.updated_at = now
        schedule.scope_key = _safe_scope_key(schedule.scope_key)
        schedule_set.upsert(schedule)
        schedule_set.updated_at = now
        self._save_schedule_set_sync(schedule_set)
        return schedule_set

    def _remove_scope_sync(self, scope_key: str) -> PolicyChargeScheduleSet:
        schedule_set = self._schedule_set_sync()
        remaining = [schedule for schedule in schedule_set.schedules if schedule.scope_key != scope_key]
        schedule_set = PolicyChargeScheduleSet(schedules=remaining, updated_at=dt_util.utcnow().isoformat())
        self._save_schedule_set_sync(schedule_set)
        return schedule_set

    def _record_feedback_sync(
        self,
        scope_key: str,
        action: str,
        ok: bool,
        message: str,
        charging_now: bool | None,
    ) -> PolicyChargeScheduleSet:
        schedule_set = self._schedule_set_sync()
        existing = deepcopy(schedule_set.scope(scope_key).to_dict()) if schedule_set.scope(scope_key) is not None else {
            "scope_key": scope_key,
            "scope_label": "All systems" if scope_key == "all" else scope_key,
        }
        schedule = PolicyChargeSchedule.from_dict(existing)
        schedule.last_command_ok = bool(ok)
        schedule.last_command_action = str(action or "").strip()
        schedule.last_command_message = str(message or "").strip()
        schedule.last_command_at = dt_util.utcnow().isoformat()
        if charging_now is not None:
            schedule.charging_now = bool(charging_now)
        return self._upsert_scope_sync(schedule)
