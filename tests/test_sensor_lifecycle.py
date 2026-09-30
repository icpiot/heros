"""Lifecycle coverage for dispatcher-triggered HEROS sensor refreshes."""

from __future__ import annotations

import asyncio
import logging
from types import SimpleNamespace

from pytest_homeassistant_custom_component.common import MockConfigEntry

from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from custom_components.heros.sensor import PricingScheduleSensor


class _BlockingStore:
    def __init__(self) -> None:
        self.calls = 0
        self.started = asyncio.Event()

    async def async_schedule(self):
        self.calls += 1
        if self.calls == 1:
            return SimpleNamespace()
        self.started.set()
        await asyncio.Future()


async def test_pricing_refresh_task_is_cancelled_on_entity_removal(hass):
    entry = MockConfigEntry(domain="heros", entry_id="lifecycle-entry", title="probe")
    coordinator = DataUpdateCoordinator(
        hass,
        logging.getLogger("heros.sensor.lifecycle"),
        config_entry=entry,
        name="sensor-lifecycle",
        update_method=None,
    )
    sensor = PricingScheduleSensor(coordinator, entry)
    sensor.hass = hass
    sensor._store = _BlockingStore()
    writes: list[str] = []
    sensor.async_write_ha_state = lambda: writes.append("write")

    await sensor.async_added_to_hass()
    sensor._handle_refresh_signal()
    await asyncio.wait_for(sensor._store.started.wait(), timeout=2)

    refresh_task = sensor._refresh_task
    assert refresh_task is not None
    assert not refresh_task.done()

    sensor._call_on_remove_callbacks()
    await asyncio.gather(refresh_task, return_exceptions=True)

    assert sensor._refresh_task is None
    assert refresh_task.cancelled()
    assert writes == ["write"]
