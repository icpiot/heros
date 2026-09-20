"""Home Assistant persistence for HEROS ROI settings."""
from __future__ import annotations

import json
import logging
from pathlib import Path

from homeassistant.core import HomeAssistant

from .roi import InstallationCostEntry, RepaymentScheduleEntry, RoiSettings, VppRateEntry

_LOGGER = logging.getLogger(__name__)
ROI_FILE_NAME = "roi_settings.json"


class RoiSettingsStore:
    """Persist finance settings per HEROS config entry."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self.hass = hass
        self.entry_id = entry_id
        self.file = Path(hass.config.path("www", "heros", entry_id, ROI_FILE_NAME))

    async def async_settings(self) -> RoiSettings:
        return await self.hass.async_add_executor_job(self._load_sync)

    async def async_save(self, settings: RoiSettings) -> RoiSettings:
        return await self.hass.async_add_executor_job(self._save_sync, settings)

    async def async_upsert_repayment(self, repayment: RepaymentScheduleEntry) -> RoiSettings:
        settings = await self.async_settings()
        entries = [item for item in settings.repayments if item.entry_id != repayment.entry_id and item.effective_start_date != repayment.effective_start_date]
        entries.append(repayment)
        return await self.async_save(RoiSettings(
            solar_installation_cost=settings.solar_installation_cost,
            battery_installation_cost=settings.battery_installation_cost,
            currency=settings.currency,
            repayments=tuple(entries),
            vpp_rates=settings.vpp_rates,
            installation_costs=settings.installation_costs,
        ))

    async def async_remove_repayment(self, entry_id: str) -> RoiSettings:
        settings = await self.async_settings()
        return await self.async_save(RoiSettings(
            solar_installation_cost=settings.solar_installation_cost,
            battery_installation_cost=settings.battery_installation_cost,
            currency=settings.currency,
            repayments=tuple(item for item in settings.repayments if item.entry_id != entry_id),
            vpp_rates=settings.vpp_rates,
            installation_costs=settings.installation_costs,
        ))


    async def async_upsert_vpp_rate(self, rate: VppRateEntry) -> RoiSettings:
        settings = await self.async_settings()
        entries = [item for item in settings.vpp_rates if item.entry_id != rate.entry_id and not (item.provider.casefold() == rate.provider.casefold() and item.effective_start_date == rate.effective_start_date)]
        entries.append(rate)
        return await self.async_save(RoiSettings(
            solar_installation_cost=settings.solar_installation_cost,
            battery_installation_cost=settings.battery_installation_cost,
            currency=settings.currency,
            repayments=settings.repayments,
            vpp_rates=tuple(entries),
        ))

    async def async_remove_vpp_rate(self, entry_id: str) -> RoiSettings:
        settings = await self.async_settings()
        return await self.async_save(RoiSettings(
            solar_installation_cost=settings.solar_installation_cost,
            battery_installation_cost=settings.battery_installation_cost,
            currency=settings.currency,
            repayments=settings.repayments,
            vpp_rates=tuple(item for item in settings.vpp_rates if item.entry_id != entry_id),
            installation_costs=settings.installation_costs,
        ))
    async def async_upsert_installation_cost(self, cost: InstallationCostEntry) -> RoiSettings:
        settings = await self.async_settings()
        entries = [item for item in settings.installation_costs if item.entry_id != cost.entry_id and not (item.effective_start_date == cost.effective_start_date and item.description.casefold() == cost.description.casefold())]
        entries.append(cost)
        return await self.async_save(RoiSettings(
            solar_installation_cost=settings.solar_installation_cost,
            battery_installation_cost=settings.battery_installation_cost,
            currency=settings.currency, repayments=settings.repayments, vpp_rates=settings.vpp_rates, installation_costs=tuple(entries),
        ))

    async def async_remove_installation_cost(self, entry_id: str) -> RoiSettings:
        settings = await self.async_settings()
        solar = 0 if entry_id == "legacy-solar" else settings.solar_installation_cost
        battery = 0 if entry_id == "legacy-battery" else settings.battery_installation_cost
        return await self.async_save(RoiSettings(
            solar_installation_cost=solar,
            battery_installation_cost=battery,
            currency=settings.currency, repayments=settings.repayments, vpp_rates=settings.vpp_rates,
            installation_costs=tuple(item for item in settings.installation_costs if item.entry_id != entry_id),
        ))

    def _load_sync(self) -> RoiSettings:
        if not self.file.exists():
            return RoiSettings()
        try:
            payload = json.loads(self.file.read_text(encoding="utf-8"))
            return RoiSettings.from_dict(payload if isinstance(payload, dict) else {})
        except (OSError, ValueError, json.JSONDecodeError) as err:
            _LOGGER.warning("Unable to read ROI settings for %s: %s", self.entry_id, err)
            return RoiSettings()

    def _save_sync(self, settings: RoiSettings) -> RoiSettings:
        self.file.parent.mkdir(parents=True, exist_ok=True)
        self.file.write_text(json.dumps(settings.to_dict(), indent=2), encoding="utf-8")
        return settings