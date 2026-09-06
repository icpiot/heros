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
        def __init__(self, coordinator):
            self.coordinator = coordinator

    class _ConfigEntry:
        pass

    class _HomeAssistant:
        pass

    class _HomeAssistantError(Exception):
        pass

    class _AddEntitiesCallback:
        pass

    package = types.ModuleType("custom_components.heros")
    package.__path__ = [str(ROOT / "custom_components" / "heros")]
    sys.modules.setdefault("custom_components.heros", package)

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

    coordinator_module = types.ModuleType("custom_components.heros.coordinator")
    coordinator_module.ByteWattDataUpdateCoordinator = object

    settings_module = types.ModuleType("custom_components.heros.settings_manager")
    settings_module.SettingsManager = object

    topology_path = ROOT / "custom_components" / "heros" / "topology.py"
    topology_spec = importlib.util.spec_from_file_location(
        "custom_components.heros.topology",
        topology_path,
    )
    topology_module = importlib.util.module_from_spec(topology_spec)
    sys.modules[topology_spec.name] = topology_module
    topology_spec.loader.exec_module(topology_module)

    reporting_module = types.ModuleType("custom_components.heros.reporting")
    reporting_module.build_forecast_snapshot = lambda hass, config: {
        "provider": config.get("forecast_provider", "none"),
        "values": {},
    }
    reporting_module.build_reporting_payload = lambda battery_data, aggregate, label, forecast=None: {
        "aggregate": aggregate,
        "label": label,
        "reporting_date": "2026-07-10",
        "power_diagram": battery_data.get("Power_Diagram", {}),
        "meta": {},
        "forecast": forecast or {},
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
    sys.modules.setdefault("custom_components.heros.coordinator", coordinator_module)
    sys.modules.setdefault("custom_components.heros.settings_manager", settings_module)
    sys.modules.setdefault("custom_components.heros.topology", topology_module)
    sys.modules.setdefault("custom_components.heros.reporting", reporting_module)

    select_path = ROOT / "custom_components" / "heros" / "select.py"
    spec = importlib.util.spec_from_file_location(
        "custom_components.heros.select",
        select_path,
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_settings_target_timezone_reads_entity_coordinator():
    """Guard against using an undefined local coordinator during entity setup."""
    source = Path(__file__).resolve().parents[1].joinpath(
        "custom_components", "heros", "select.py"
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


def test_reporting_payload_keeps_forecast_snapshot_for_panel_attributes():
    select_module = _load_select_module()

    payload = select_module._reporting_payload(
        {"Power_Diagram": {"date": "2026-07-10", "time": ["00:00"], "series": {}}},
        aggregate=True,
        label="All systems",
        forecast={"provider": "forecast_solar", "values": {"generation_today": {"state": "18.4"}}},
    )

    assert payload["forecast"]["provider"] == "forecast_solar"
    assert payload["forecast"]["values"]["generation_today"]["state"] == "18.4"


def test_forecast_history_source_summary_masks_api_key():
    select_module = _load_select_module()

    class _Entry:
        data = {
            "forecast_history_provider": "forecast_solar",
            "forecast_history_api_key": "secret",
            "forecast_history_latitude": -33.96899,
            "forecast_history_longitude": 151.00795,
            "forecast_history_declination": 30,
            "forecast_history_azimuth": 0,
            "forecast_history_kwp": 6.6,
        }
        options = {}

    summary = select_module._forecast_history_source_summary(_Entry())

    assert summary["provider"] == "forecast_solar"
    assert summary["api_key_configured"] is True
    assert summary["kwp"] == 6.6
    assert "secret" not in str(summary)


def test_direct_api_summary_keeps_mppt_and_power_source_fields():
    select_module = _load_select_module()

    summary = select_module._direct_api_summary(
        {
            "soc": 60.36,
            "pbat": 531,
            "pload": 531,
            "pgrid": 0,
            "ppv": 0,
            "ppv1": 120,
            "ppv2": 140,
            "ppv3": None,
            "ppv4": 0,
            "powerSource": "Solar",
        }
    )

    assert summary == {
        "soc": 60.36,
        "pbat": 531,
        "pload": 531,
        "pgrid": 0,
        "ppv": 0,
        "ppv1": 120,
        "ppv2": 140,
        "ppv3": None,
        "ppv4": 0,
        "powerSource": "Solar",
    }


def test_direct_api_live_battery_shape_keeps_per_battery_mppt_fields():
    source = Path(__file__).resolve().parents[1].joinpath(
        "custom_components", "heros", "select.py"
    ).read_text(encoding="utf-8")

    for field in (
        '"ppv1": battery.get("ppv1")',
        '"ppv2": battery.get("ppv2")',
        '"ppv3": battery.get("ppv3")',
        '"ppv4": battery.get("ppv4")',
        '"powerSource": battery.get("power_source")',
    ):
        assert field in source


def test_history_hint_exposes_inventory_and_scope_summaries():
    source = Path(__file__).resolve().parents[1].joinpath(
        "custom_components", "heros", "select.py"
    ).read_text(encoding="utf-8")

    assert '"inventory_scopes"' in source
    assert '"scope_summaries"' in source
    assert '"scope_key": "all"' in source
    assert 'if selected_scope is not None and selected_scope.aggregate:' in source
    assert 'history_scope_key = "all"' in source
    assert 'current_scope_label = "All Batteries"' in source


def test_coordinator_retries_inverter_inventory_when_only_one_system_is_cached():
    source = Path(__file__).resolve().parents[1].joinpath(
        "custom_components", "heros", "coordinator.py"
    ).read_text(encoding="utf-8")

    assert "async def _refresh_inverter_inventory_if_needed" in source
    assert "await self.client.fetch_inverter_list()" in source
    assert "Expanded inverter inventory" in source


def test_history_backfill_forwards_scope_to_provider_fetch():
    source = Path(__file__).resolve().parents[1].joinpath(
        "custom_components", "heros", "__init__.py"
    ).read_text(encoding="utf-8")

    assert 'history_sys_sn = None if scope_key == "all" else scope_key' in source
    assert "sys_sn=history_sys_sn" in source


def test_history_backfill_only_includes_realtime_for_the_actual_current_day():
    source = Path(__file__).resolve().parents[1].joinpath(
        "custom_components", "heros", "__init__.py"
    ).read_text(encoding="utf-8")

    assert 'today_date = dt_util.now().date().isoformat()' in source
    assert 'include_realtime=day == today_date and not force' in source


def test_live_battery_summary_keeps_per_battery_mppt_source_fields():
    source = Path(__file__).resolve().parents[1].joinpath(
        "custom_components", "heros", "coordinator.py"
    ).read_text(encoding="utf-8")

    for field in (
        '"ppv1": _float_or_none(live_data.get("ppv1"))',
        '"ppv2": _float_or_none(live_data.get("ppv2"))',
        '"ppv3": _float_or_none(live_data.get("ppv3"))',
        '"ppv4": _float_or_none(live_data.get("ppv4"))',
        '"power_source": live_data.get("powerSource")',
    ):
        assert field in source


def test_settings_target_options_merge_live_batteries_when_discovery_is_incomplete():
    select_module = _load_select_module()
    discovered = select_module.DiscoveredInverter(
        system_id="sys-1",
        sys_sn="25000SB244W00011",
    )
    hass = types.SimpleNamespace(data={
        "heros": {
            "entry-1": {
                "inverters": [discovered],
            }
        }
    })
    coordinator = types.SimpleNamespace(data={
        "live_battery_power": {
            "batteries": [
                {
                    "label": "25000SB244W00011",
                    "system_id": "sys-1",
                    "sys_sn": "25000SB244W00011",
                },
                {
                    "label": "25000SB285W00047",
                    "system_id": "sys-2",
                    "sys_sn": "25000SB285W00047",
                },
            ]
        }
    })
    manager = types.SimpleNamespace(
        current_settings_target_id="",
        current_settings_target_sys_sn="All",
    )
    config_entry = types.SimpleNamespace(entry_id="entry-1")

    entity = select_module.ByteWattSettingsTargetSelect(hass, coordinator, config_entry, manager)

    assert entity.options == [
        "All systems",
        "25000SB244W00011",
        "25000SB285W00047",
    ]
