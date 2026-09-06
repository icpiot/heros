"""Forecast.Solar historic-average support for Home Energy Manager."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import quote, urlencode

import aiohttp

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import (
    CONF_FORECAST_HISTORY_API_KEY,
    CONF_FORECAST_HISTORY_AZIMUTH,
    CONF_FORECAST_HISTORY_DAMPING,
    CONF_FORECAST_HISTORY_DECLINATION,
    CONF_FORECAST_HISTORY_HORIZON,
    CONF_FORECAST_HISTORY_KWP,
    CONF_FORECAST_HISTORY_LATITUDE,
    CONF_FORECAST_HISTORY_LONGITUDE,
    CONF_FORECAST_HISTORY_PROVIDER,
    FORECAST_PROVIDER_FORECAST_SOLAR,
)

FORECAST_SOLAR_BASE_URL = "https://api.forecast.solar"
FORECAST_HISTORY_TIMEOUT = 30


@dataclass(frozen=True)
class ForecastHistorySource:
    """Validated Forecast.Solar historic-average source settings."""

    provider: str
    latitude: float
    longitude: float
    declination: float
    azimuth: float
    kwp: float
    api_key: str = ""
    damping: float | None = None
    horizon: str = ""


def _optional_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    return float(value)


def forecast_history_source_from_config(config: dict[str, Any]) -> ForecastHistorySource:
    """Build a validated historic-average source from config/service data."""
    provider = str(config.get(CONF_FORECAST_HISTORY_PROVIDER) or FORECAST_PROVIDER_FORECAST_SOLAR).strip()
    if provider != FORECAST_PROVIDER_FORECAST_SOLAR:
        raise ValueError("Only Forecast.Solar historic averages are supported right now")
    source = ForecastHistorySource(
        provider=provider,
        api_key=str(config.get(CONF_FORECAST_HISTORY_API_KEY) or "").strip(),
        latitude=float(config[CONF_FORECAST_HISTORY_LATITUDE]),
        longitude=float(config[CONF_FORECAST_HISTORY_LONGITUDE]),
        declination=float(config[CONF_FORECAST_HISTORY_DECLINATION]),
        azimuth=float(config[CONF_FORECAST_HISTORY_AZIMUTH]),
        kwp=float(config[CONF_FORECAST_HISTORY_KWP]),
        damping=_optional_float(config.get(CONF_FORECAST_HISTORY_DAMPING)),
        horizon=str(config.get(CONF_FORECAST_HISTORY_HORIZON) or "").strip(),
    )
    if source.kwp <= 0:
        raise ValueError("forecast_history_kwp must be greater than 0")
    return source


def forecast_solar_history_url(source: ForecastHistorySource, data: str = "watts") -> str:
    """Return the Forecast.Solar historic-average URL without logging secrets."""
    auth = f"/{quote(source.api_key)}" if source.api_key else ""
    path = (
        f"{FORECAST_SOLAR_BASE_URL}{auth}/history/{quote(data)}/"
        f"{source.latitude:g}/{source.longitude:g}/{source.declination:g}/"
        f"{source.azimuth:g}/{source.kwp:g}"
    )
    query: dict[str, str] = {}
    if source.damping is not None:
        query["damping"] = f"{source.damping:g}"
    if source.horizon:
        query["horizon"] = source.horizon
    return f"{path}?{urlencode(query)}" if query else path


async def async_test_forecast_history_source(
    hass: HomeAssistant,
    source: ForecastHistorySource,
) -> dict[str, Any]:
    """Call Forecast.Solar history once and return non-secret test metadata."""
    session = async_get_clientsession(hass)
    url = forecast_solar_history_url(source)
    async with session.get(url, timeout=aiohttp.ClientTimeout(total=FORECAST_HISTORY_TIMEOUT)) as response:
        payload = await response.json(content_type=None)
    result = payload.get("result") if isinstance(payload, dict) else None
    message = payload.get("message") if isinstance(payload, dict) else {}
    watts = result.get("watts") if isinstance(result, dict) else {}
    watt_hours = result.get("watt_hours") if isinstance(result, dict) else {}
    watt_hours_day = result.get("watt_hours_day") if isinstance(result, dict) else {}
    return {
        "ok": response.status < 400 and isinstance(result, dict),
        "status": response.status,
        "message_code": message.get("code") if isinstance(message, dict) else None,
        "message_type": message.get("type") if isinstance(message, dict) else None,
        "message_text": message.get("text") if isinstance(message, dict) else "",
        "sample_counts": {
            "watts": len(watts) if isinstance(watts, dict) else 0,
            "watt_hours": len(watt_hours) if isinstance(watt_hours, dict) else 0,
            "watt_hours_day": len(watt_hours_day) if isinstance(watt_hours_day, dict) else 0,
        },
    }
