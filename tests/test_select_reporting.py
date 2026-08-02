from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _load_select_module():
    class _SelectEntity:
        pass

    class _CoordinatorEntity:
        pass

    class _ConfigEntry:
        pass

    class _HomeAssistant:
        pass

    class _HomeAssistantError(Exception):
        pass

    class _AddEntitiesCallback:
        pass

    package = types.ModuleType("custom_components.home_energy_manager")
    package.__path__ = [str(ROOT / "custom_components" / "home_energy_manager")]
    sys.modules.setdefault("custom_components.home_energy_manager", package)

    homeassistant = types.ModuleType("homeassistant")
    homeassistant_components = types.ModuleType("homeassistant.components")
    homeassistant_select = types.ModuleType("homeassistant.components.select")
    homeassistant_select.SelectEntity = _SelectEntity
    homeassistant_config_entries = types.ModuleType("homeassistant.config_entries")
    homeassistant_config_entries.ConfigEntry = _ConfigEntry
    homeassistant_core = types.ModuleType("homeassistant.core")
    homeassistant_core.HomeAssistant = _HomeAssistant
    homeassistant_exceptions = types.ModuleType("homeassistant.exceptions")
    homeassistant_exceptions.HomeAssistantError = _HomeAssistantError
    homeassistant_helpers = types.ModuleType("homeassistant.helpers")
    homeassistant_entity = types.ModuleType("homeassistant.helpers.entity")
    homeassistant_entity.EntityCategory = types.SimpleNamespace(CONFIG="config")
    homeassistant_entity_platform = types.ModuleType("homeassistant.helpers.entity_platform")
    homeassistant_entity_platform.AddEntitiesCallback = _AddEntitiesCallback
    homeassistant_update_coordinator = types.ModuleType("homeassistant.helpers.update_coordinator")
    homeassistant_update_coordinator.CoordinatorEntity = _CoordinatorEntity
    homeassistant_helpers_dispatcher = types.ModuleType("homeassistant.helpers.dispatcher")
    homeassistant_helpers_dispatcher.async_dispatcher_connect = lambda *args, **kwargs: None
    homeassistant_helpers_dispatcher.async_dispatcher_send = lambda *args, **kwargs: None

    coordinator_module = types.ModuleType("custom_components.home_energy_manager.coordinator")
    coordinator_module.ByteWattDataUpdateCoordinator = object

    settings_module = types.ModuleType("custom_components.home_energy_manager.settings_manager")
    settings_module.SettingsManager = object

    topology_module = types.ModuleType("custom_components.home_energy_manager.topology")
    topology_module.ByteWattScope = object
    topology_module.DiscoveredInverter = object

    reporting_module = types.ModuleType("custom_components.home_energy_manager.reporting")
    reporting_module.build_reporting_payload = lambda battery_data, aggregate, label: {
        "aggregate": aggregate,
        "label": label,
        "reporting_date": "2026-07-10",
        "power_diagram": battery_data.get("Power_Diagram", {}),
        "meta": {},
    }

    sys.modules.setdefault("homeassistant", homeassistant)
    sys.modules.setdefault("homeassistant.components", homeassistant_components)
    sys.modules.setdefault("homeassistant.components.select", homeassistant_select)
    sys.modules.setdefault("homeassistant.config_entries", homeassistant_config_entries)
    sys.modules.setdefault("homeassistant.core", homeassistant_core)
    sys.modules.setdefault("homeassistant.exceptions", homeassistant_exceptions)
    sys.modules.setdefault("homeassistant.helpers", homeassistant_helpers)
    sys.modules.setdefault("homeassistant.helpers.entity", homeassistant_entity)
    sys.modules.setdefault("homeassistant.helpers.entity_platform", homeassistant_entity_platform)
    sys.modules.setdefault("homeassistant.helpers.dispatcher", homeassistant_helpers_dispatcher)
    sys.modules.setdefault("homeassistant.helpers.update_coordinator", homeassistant_update_coordinator)
    sys.modules.setdefault("custom_components.home_energy_manager.coordinator", coordinator_module)
    sys.modules.setdefault("custom_components.home_energy_manager.settings_manager", settings_module)
    sys.modules.setdefault("custom_components.home_energy_manager.topology", topology_module)
    sys.modules.setdefault("custom_components.home_energy_manager.reporting", reporting_module)

    select_path = ROOT / "custom_components" / "home_energy_manager" / "select.py"
    spec = importlib.util.spec_from_file_location(
        "custom_components.home_energy_manager.select",
        select_path,
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_settings_target_timezone_reads_entity_coordinator():
    """Guard against using an undefined local coordinator during entity setup."""
    source = Path(__file__).resolve().parents[1].joinpath(
        "custom_components", "home_energy_manager", "select.py"
    ).read_text(encoding="utf-8")
    assert "getattr(coordinator.client" not in source
    assert "getattr(self.coordinator.client" in source


def test_reporting_payload_keeps_daily_chart_series():
    select_module = _load_select_module()

    payload = select_module._reporting_payload(
        {
            "soc": 48.5,
            "pbat": 120,
            "pload": 340,
            "pgrid": -80,
            "ppv": 260,
            "powerSource": "Solar",
            "Power_Diagram": {
                "date": "2026-07-10",
                "time": ["00:00", "00:15"],
                "series": {
                    "bat": [10, 11],
                    "load": [3, 4],
                    "solar": [2, 5],
                    "feed_in": [0, 1],
                    "consumed": [1, 2],
                },
                "summary": {"soc": 48.5},
                "meta": {"power_source": "Solar"},
            },
        },
        aggregate=False,
        label="All systems",
    )

    power_diagram = payload["power_diagram"]
    assert power_diagram["date"] == "2026-07-10"
    assert power_diagram["time"] == ["00:00", "00:15"]
    assert power_diagram["series"]["bat"] == [10, 11]
    assert power_diagram["series"]["solar"] == [2, 5]
    assert power_diagram["summary"]["soc"] == 48.5
