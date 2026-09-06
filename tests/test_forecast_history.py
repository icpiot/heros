from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _load_forecast_history_module():
    package = types.ModuleType("custom_components.home_energy_manager")
    package.__path__ = [str(ROOT / "custom_components" / "home_energy_manager")]
    sys.modules.setdefault("custom_components.home_energy_manager", package)

    aiohttp = types.ModuleType("aiohttp")
    aiohttp.ClientTimeout = lambda **kwargs: kwargs
    homeassistant = types.ModuleType("homeassistant")
    homeassistant_core = types.ModuleType("homeassistant.core")
    homeassistant_core.HomeAssistant = object
    homeassistant_helpers = types.ModuleType("homeassistant.helpers")
    homeassistant_aiohttp = types.ModuleType("homeassistant.helpers.aiohttp_client")
    homeassistant_aiohttp.async_get_clientsession = lambda hass: None

    sys.modules.setdefault("aiohttp", aiohttp)
    sys.modules.setdefault("homeassistant", homeassistant)
    sys.modules.setdefault("homeassistant.core", homeassistant_core)
    sys.modules.setdefault("homeassistant.helpers", homeassistant_helpers)
    sys.modules.setdefault("homeassistant.helpers.aiohttp_client", homeassistant_aiohttp)

    spec = importlib.util.spec_from_file_location(
        "custom_components.home_energy_manager.forecast_history",
        ROOT / "custom_components" / "home_energy_manager" / "forecast_history.py",
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


forecast_history = _load_forecast_history_module()
forecast_history_source_from_config = forecast_history.forecast_history_source_from_config
forecast_solar_history_url = forecast_history.forecast_solar_history_url


def test_forecast_history_source_builds_secret_url_without_logging_it():
    source = forecast_history_source_from_config({
        "forecast_history_provider": "forecast_solar",
        "forecast_history_api_key": "secret key",
        "forecast_history_latitude": -33.96899,
        "forecast_history_longitude": 151.00795,
        "forecast_history_declination": 30,
        "forecast_history_azimuth": 0,
        "forecast_history_kwp": 6.6,
        "forecast_history_damping": 0.5,
        "forecast_history_horizon": "10,20",
    })

    url = forecast_solar_history_url(source)

    assert source.provider == "forecast_solar"
    assert source.kwp == 6.6
    assert url.startswith("https://api.forecast.solar/secret%20key/history/watts/")
    assert "damping=0.5" in url
    assert "horizon=10%2C20" in url


def test_forecast_history_source_rejects_empty_kwp():
    try:
        forecast_history_source_from_config({
            "forecast_history_provider": "forecast_solar",
            "forecast_history_latitude": -33.96899,
            "forecast_history_longitude": 151.00795,
            "forecast_history_declination": 30,
            "forecast_history_azimuth": 0,
            "forecast_history_kwp": 0,
        })
    except ValueError as err:
        assert "kwp" in str(err)
    else:
        raise AssertionError("expected invalid kWp to fail")
