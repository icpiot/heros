"""API client for HEROS provider connections."""
import base64
import json
import logging
import asyncio
import aiohttp
import re
from typing import Dict, Any, Optional
from datetime import datetime, timedelta

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.util import dt as dt_util

from .neovolt_auth import EncryptionError, encrypt_password

_LOGGER = logging.getLogger(__name__)

DEFAULT_TIMEOUT = 30
DEFAULT_BASE_URL = "https://monitor.byte-watt.com"

# Max number of times async_get_battery_data / async_get_device_list will
# re-login and retry after a session-expiry / 401 response. One retry is
# normally sufficient — the new session is fresh, so a second 6069 means
# the server is misbehaving and we should fail loudly instead of recursing
# forever and exhausting the stack.
MAX_RELOGIN_RETRIES = 1


class ByteWattAPIError(Exception):
    """Raised by async_get_battery_data when the API call cannot complete.

    Returning None on failure prevented the coordinator's _timed_operation
    circuit-breaker accounting from registering the failure — every API
    error looked like a success. Raising lets exceptions propagate through
    _timed_operation, where the circuit breaker can record them and
    eventually trip to OPEN.

    The coordinator catches this exception and falls back to cached data
    where appropriate (preserving the previous "tolerate transient errors"
    behaviour for the user-facing sensors).
    """


async def _decode_json_object(response, context: str) -> Optional[Dict[str, Any]]:
    """Decode an aiohttp response body to a JSON object (dict), or return None.

    Guards against three failure modes that would otherwise propagate as
    crashes into the .get() lines that follow:

      1. ContentTypeError — body's Content-Type isn't JSON
      2. ValueError / JSONDecodeError — body is JSON-shaped but malformed
      3. Valid JSON but not an object — e.g. ``[]``, ``"error"``, ``null``
         (an error page returned as a JSON string would crash
         ``result.get(...)`` because str has no .get method)

    Logs at error level and returns None so callers can fail gracefully.
    """
    try:
        decoded = await response.json()
    except (ValueError, aiohttp.ContentTypeError) as err:
        _LOGGER.error("%s: response was not valid JSON (%s)", context, err)
        return None
    if not isinstance(decoded, dict):
        _LOGGER.error(
            "%s: response decoded to %s, expected object: %r",
            context, type(decoded).__name__, decoded,
        )
        return None
    return decoded


def _stat_value(stats_data, key):
    """Read a numeric field from a stats response, coercing missing / None /
    empty / non-numeric values to 0 so derived arithmetic never raises.

    The provider API has dropped fields without warning historically and
    returns null for sensors with no data yet (e.g. before midnight on day
    one of install). Defensive coercion to a float lets the arithmetic
    complete; the integration's sensor entities surface the underlying
    field directly so a 0 here only affects the derived total, not the
    raw reading.
    """
    value = stats_data.get(key)
    if value is None or value == "":
        return 0
    try:
        return float(value)
    except (TypeError, ValueError):
        _LOGGER.debug("Non-numeric value for %s in stats response: %r", key, value)
        return 0


def _float_or_none(value: Any) -> float | None:
    """Coerce provider values to float when possible."""
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _jwt_claims(token: str | None) -> dict[str, Any]:
    """Decode JWT claims without verifying the signature."""
    parts = str(token or "").split(".")
    if len(parts) < 2:
        return {}
    payload = parts[1]
    payload += "=" * (-len(payload) % 4)
    try:
        decoded = base64.urlsafe_b64decode(payload.encode("ascii")).decode("utf-8")
        claims = json.loads(decoded)
    except (ValueError, UnicodeDecodeError):
        return {}
    return claims if isinstance(claims, dict) else {}


def _detail_curve_value(rows: Any) -> list[float]:
    """Extract a power-like curve from provider detail rows.

    The web payload exposes interval objects with ``value`` plus optional
    ``value1``/``value2`` fields. The screenshoted web chart behaves like a
    power series rather than a per-interval energy bar, so prefer the larger
    detailed point when present and fall back to ``value``.
    """
    curve: list[float] = []
    if not isinstance(rows, list):
        return curve
    for row in rows:
        if not isinstance(row, dict):
            curve.append(0.0)
            continue
        candidates = [
            _float_or_none(row.get("value1")),
            _float_or_none(row.get("value2")),
            _float_or_none(row.get("value")),
        ]
        numeric = [abs(item) for item in candidates if item is not None]
        curve.append(max(numeric) if numeric else 0.0)
    return curve


def _provider_power_diagram(
    stats_data: dict[str, Any],
    *,
    report_date: str,
    summary: dict[str, Any],
    scope_label: str,
) -> dict[str, Any]:
    """Normalize the provider's dated chart payload to the HEROS report shape."""
    provider_snapshot = dict(stats_data) if isinstance(stats_data, dict) else {}
    time_points = stats_data.get("time") if isinstance(stats_data.get("time"), list) else []
    solar_curve = stats_data.get("ppvinverterPv") if isinstance(stats_data.get("ppvinverterPv"), list) else stats_data.get("ppv")
    load_curve = stats_data.get("homePower") if isinstance(stats_data.get("homePower"), list) else stats_data.get("usePower")
    battery_curve = stats_data.get("cbat") if isinstance(stats_data.get("cbat"), list) else stats_data.get("soc")
    feed_in_curve = stats_data.get("feedIn") if isinstance(stats_data.get("feedIn"), list) else []
    consumed_curve = _detail_curve_value(stats_data.get("gridDetailList"))
    if not any(consumed_curve):
        consumed_curve = stats_data.get("homePower") if isinstance(stats_data.get("homePower"), list) else []
    normalized = {
        "date": report_date,
        "meta": {
            "source": "provider",
            "label": scope_label,
            "date": report_date,
            "maximum_power": _float_or_none(stats_data.get("maximumPower")),
            "raw_keys": sorted(stats_data.keys()),
        },
        "summary": summary,
        "time": list(time_points),
        "series": {
            "bat": list(battery_curve) if isinstance(battery_curve, list) else [],
            "load": list(load_curve) if isinstance(load_curve, list) else [],
            "solar": list(solar_curve) if isinstance(solar_curve, list) else [],
            "feed_in": _detail_curve_value(stats_data.get("feedInDetailList")) if isinstance(stats_data.get("feedInDetailList"), list) else list(feed_in_curve),
            "consumed": list(consumed_curve) if isinstance(consumed_curve, list) else [],
        },
        "raw_provider": {
            "soc": _float_or_none(stats_data.get("soc")),
            "powerSource": stats_data.get("powerSource"),
            "maximumPower": _float_or_none(stats_data.get("maximumPower")),
            "maxPpv": _float_or_none(stats_data.get("maxPpv")),
            "maxUsePower": _float_or_none(stats_data.get("maxUsePower")),
            "maxFeedIn": _float_or_none(stats_data.get("maxFeedIn")),
            "maxGridCharge": _float_or_none(stats_data.get("maxGridCharge")),
            "inverterMode": stats_data.get("inverterMode"),
        },
        "provider_payload": provider_snapshot,
    }
    return normalized


def _is_success_code(code: Any) -> bool:
    """Return True when an endpoint reports a success code.

    The web app mixes multiple success conventions across endpoint
    families. Older/home endpoints often report ``"000000"`` while newer
    iterate/settings endpoints return integer ``200``. Treating only ``200``
    as success causes account inventory discovery to silently drop valid
    payloads.
    """
    return str(code).strip() in {"0", "200", "000000"}


def _safe_candidate_text(value: Any) -> str:
    """Normalize candidate identifier text."""
    candidate = str(value or "").strip()
    if not candidate:
        return ""
    if candidate.lower() in {"all", "null", "none", "unknown", "unavailable"}:
        return ""
    return candidate

class NeovoltClient:
    """API Client for provider connections."""
    
    def __init__(
        self, 
        hass: HomeAssistant, 
        username: str, 
        password: str, 
        base_url: str = DEFAULT_BASE_URL,
        host_system_id: str = "",
        host_sys_sn: str = "",
    ) -> None:
        """Initialize the API client."""
        self.hass = hass
        self.username = username
        self.password = password
        self.base_url = base_url
        self.session = async_get_clientsession(hass)
        self.token: Optional[str] = None
        self.host_system_id = host_system_id   # systemId of the Host inverter
        self.host_sys_sn = host_sys_sn         # sysSn of the Host inverter
        self.user_id: str = ""
        self.user_id_candidates: list[str] = []
    
    async def async_login(self) -> bool:
        """Login to the provider API using encrypted password."""
        _LOGGER.debug("Logging in to provider API as %s", self.username)

        login_url = f"{self.base_url}/api/usercenter/cloud/user/login"

        # Encrypt OR fail loudly — never fall through to plaintext.
        try:
            encrypted_password = encrypt_password(self.password, self.username)
        except EncryptionError as exc:
            _LOGGER.error(
                "Cannot log in: password encryption failed (%s). "
                "Refusing to fall back to the plaintext form-data path.",
                exc,
            )
            return False

        payload = {
            "username": self.username,
            "password": encrypted_password,
        }
        
        try:
            async with asyncio.timeout(DEFAULT_TIMEOUT):
                async with self.session.post(
                    url=login_url,
                    json=payload,
                    headers={"Content-Type": "application/json"},
                ) as response:
                    if response.status != 200:
                        _LOGGER.error(
                            "Login failed with status %s: %s",
                            response.status,
                            await response.text(),
                        )
                        return False

                    result = await _decode_json_object(response, "login")
                    if result is None:
                        return False

                    if not _is_success_code(result.get("code")):
                        _LOGGER.error(
                            "Login rejected with code %s: %s",
                            result.get("code"), result.get("msg"),
                        )
                        # NO plaintext fallback. The legacy _async_login_fallback
                        # path sent the password as form-data unencrypted — fine
                        # for early development against the old API, but a
                        # security smell now. If the encrypted path is rejected
                        # the credentials are wrong (or the encryption scheme
                        # rotated server-side), neither of which is fixed by
                        # leaking the plaintext.
                        return False

                    if "token" in result:
                        self.token = result["token"]
                    elif "data" in result and result["data"] and "token" in result["data"]:
                        self.token = result["data"]["token"]
                    else:
                        _LOGGER.error("No token found in login response")
                        return False

                    login_data = result.get("data", {}) if isinstance(result.get("data"), dict) else {}
                    claims = _jwt_claims(self.token)
                    direct_user_id = _safe_candidate_text(
                        login_data.get("userId")
                        or login_data.get("user_id")
                        or claims.get("user_id")
                        or claims.get("userId")
                        or claims.get("uid")
                    )
                    if not direct_user_id:
                        subject = _safe_candidate_text(claims.get("sub"))
                        if subject and "@" not in subject and "." not in subject:
                            direct_user_id = subject
                    self.user_id = direct_user_id
                    self.user_id_candidates = [direct_user_id] if direct_user_id else []
                    self._remember_user_id_candidates(result, login_data, claims)

                    _LOGGER.debug("Successfully logged in to provider API")
                    return True

        except (asyncio.TimeoutError, aiohttp.ClientError, ValueError) as error:
            _LOGGER.error("Error connecting to provider API: %s", error)
            return False
    
    async def async_get_device_list(self, _retry_count: int = 0) -> Optional[Dict[str, Any]]:
        """Get the list of devices.

        ``_retry_count`` is an internal recursion guard — never pass it from
        the outside. See MAX_RELOGIN_RETRIES for the rationale.
        """
        if not self.token:
            if not await self.async_login():
                return None

        url = f"{self.base_url}/api/devices/list"

        try:
            async with asyncio.timeout(DEFAULT_TIMEOUT):
                async with self.session.get(
                    url=url, headers=self._get_auth_headers(),
                ) as response:
                    if response.status != 200:
                        _LOGGER.error(
                            "Failed to get device list with status %s: %s",
                            response.status,
                            await response.text(),
                        )
                        if response.status == 401 and _retry_count < MAX_RELOGIN_RETRIES:
                            if await self.async_login():
                                return await self.async_get_device_list(_retry_count + 1)
                        return None

                    result = await _decode_json_object(response, "getDeviceList")
                    if result is None:
                        return None

                    if not _is_success_code(result.get("code")):
                        if result.get("code") == 6069 and _retry_count < MAX_RELOGIN_RETRIES:
                            _LOGGER.warning("Session expired (code 6069), attempting to re-login")
                            if await self.async_login():
                                return await self.async_get_device_list(_retry_count + 1)

                        _LOGGER.error(
                            "Failed to get device list with code %s: %s",
                            result.get("code"),
                            result.get("msg"),
                        )
                        return None

                    payload = result.get("data")
                    self._remember_user_id_candidates(result, payload)
                    return payload

        except (asyncio.TimeoutError, aiohttp.ClientError, ValueError) as error:
            _LOGGER.error("Error fetching device list: %s", error)
            return None
    
    async def async_get_battery_data(
        self,
        station_id: str = None,
        _retry_count: int = 0,
        report_date: str | None = None,
        include_realtime: bool = True,
        sys_sn: str | None = None,
        include_statistics: bool = True,
    ) -> Dict[str, Any]:
        """Get data for a specific battery using the new API endpoint.

        Raises ``ByteWattAPIError`` if the critical real-time power data
        endpoint fails (login failure, network error, HTTP non-200,
        unrecoverable session expiry, or unexpected server code). The
        exception propagates through the coordinator's _timed_operation
        wrapper so the circuit breaker records the failure — previously
        a None return looked like a success to the CB and the breaker
        could never trip.

        Subsequent statistics endpoints (energy stats, today's stats,
        today's detailed stats) are still tolerated as partial failures
        — they return what was already fetched rather than raising — so
        a flaky statistics endpoint doesn't kill the real-time sensors.

        ``_retry_count`` is an internal recursion guard — never pass it
        from outside. Capped at MAX_RELOGIN_RETRIES.
        """
        if not self.token:
            if not await self.async_login():
                raise ByteWattAPIError("Login failed; cannot fetch battery data")

        report_date_str = report_date or dt_util.now().date().isoformat()
        # First get the real-time power data — failures of THIS call raise.
        url = f"{self.base_url}/api/report/energyStorage/getLastPowerData"

        selected_sys_sn = (sys_sn or "All").strip() or "All"
        scope_label = selected_sys_sn if selected_sys_sn != "All" else "All systems"
        effective_station_id = (
            ""
            if selected_sys_sn == "All"
            else str(station_id or "").strip()
        )
        params = {"sysSn": selected_sys_sn, "stationId": effective_station_id}

        current_date = dt_util.now().strftime("%Y-%m-%d %H:%M:%S")
        headers = self._get_auth_headers()
        headers.update({
            "Accept": "application/json, text/plain, */*",
            "language": "en-US",
            "operationDate": current_date,
            "platform": "AK9D8H",
            "System": "alphacloud",
        })

        try:
            battery_data: Dict[str, Any] = {}

            if include_realtime:
                async with asyncio.timeout(DEFAULT_TIMEOUT):
                    async with self.session.get(
                        url=url, params=params, headers=headers,
                    ) as response:
                        if response.status != 200:
                            body = await response.text()
                            if response.status == 401 and _retry_count < MAX_RELOGIN_RETRIES:
                                if await self.async_login():
                                    return await self.async_get_battery_data(
                                        station_id,
                                        _retry_count + 1,
                                        report_date=report_date,
                                        include_realtime=include_realtime,
                                        sys_sn=selected_sys_sn,
                                        include_statistics=include_statistics,
                                    )
                            raise ByteWattAPIError(
                                f"getLastPowerData HTTP {response.status}: {body[:200]}"
                            )

                        result = await _decode_json_object(response, "getLastPowerData")
                        if result is None:
                            raise ByteWattAPIError(
                                "getLastPowerData returned a non-JSON or non-object body"
                            )

                        if not _is_success_code(result.get("code")):
                            if result.get("code") == 6069:
                                _LOGGER.warning("Session expired (code 6069), attempting to re-login")
                                if _retry_count < MAX_RELOGIN_RETRIES and await self.async_login():
                                    return await self.async_get_battery_data(
                                        station_id,
                                        _retry_count + 1,
                                        report_date=report_date,
                                        include_realtime=include_realtime,
                                        sys_sn=selected_sys_sn,
                                        include_statistics=include_statistics,
                                    )
                            raise ByteWattAPIError(
                                f"getLastPowerData code={result.get('code')}: {result.get('msg')}"
                            )

                        power_data = result.get("data", {}) or {}
                        self._remember_user_id_candidates(result, power_data)
                        _LOGGER.debug("Received battery power data: %s", power_data)
                        battery_data.update(power_data)

            if not include_statistics:
                return battery_data
            
            # Now get the energy statistics
            stats_url = f"{self.base_url}/api/report/energy/getEnergyStatistics"
            
            # Get date range from 2020-01-01 to tomorrow
            # TIMEZONE FIX: Using tomorrow's date as endDate prevents the midnight reset issue
            # where cumulative totals temporarily show yesterday's values for ~30 minutes
            # after midnight in timezones ahead of the API server (e.g., UTC+9:30)
            # This ensures the API always returns complete data for "today"
            now = dt_util.parse_datetime(report_date_str + "T12:00:00Z") or dt_util.now()
            end_date = (now + timedelta(days=1)).strftime("%Y-%m-%d")
            begin_date = "2020-01-01"
            
            _LOGGER.debug("Fetching statistics for date range: %s to %s (tomorrow used for timezone fix, current time: %s)", 
                         begin_date, end_date, now.strftime("%Y-%m-%d %H:%M:%S %Z"))
            
            stats_params = {
                "sysSn": "All", 
                "stationId": effective_station_id,
                "beginDate": begin_date,
                "endDate": end_date
            }
            
            _LOGGER.debug("Fetching energy statistics from: %s with params: %s", stats_url, stats_params)
            try:
                async with asyncio.timeout(DEFAULT_TIMEOUT):
                    async with self.session.get(
                        url=stats_url, params=stats_params, headers=headers,
                    ) as stats_response:
                        if stats_response.status == 200:
                            stats_result = await _decode_json_object(stats_response, "getEnergyStatistics")
                            if stats_result is None:
                                # Non-object response — skip stats, keep partial data.
                                return battery_data
                            _LOGGER.debug("Energy statistics response: %s", stats_result)

                            if _is_success_code(stats_result.get("code")):
                                stats_data = stats_result.get("data", {}) or {}
                                self._remember_user_id_candidates(stats_result, stats_data)
                                if stats_data:
                                    battery_data["Total_Solar_Generation"]   = stats_data.get("epvT")
                                    battery_data["Total_Feed_In"]            = stats_data.get("eout")
                                    battery_data["Total_Battery_Charge"]     = stats_data.get("echarge")
                                    battery_data["Total_Battery_Discharge"]  = stats_data.get("edischarge")
                                    battery_data["PV_Power_House"]           = stats_data.get("epv2load")
                                    battery_data["PV_Charging_Battery"]      = stats_data.get("epvcharge")
                                    battery_data["Total_House_Consumption"]  = stats_data.get("eload")
                                    battery_data["Grid_Based_Battery_Charge"] = stats_data.get("egridCharge")
                                    battery_data["Grid_Power_Consumption"]   = stats_data.get("einput")
                            elif stats_result.get("code") == 6069:
                                _LOGGER.warning("Session expired (code 6069) during statistics fetch")
                                if _retry_count < MAX_RELOGIN_RETRIES and await self.async_login():
                                    return await self.async_get_battery_data(
                                        station_id,
                                        _retry_count + 1,
                                        report_date=report_date,
                                        include_realtime=include_realtime,
                                        sys_sn=selected_sys_sn,
                                        include_statistics=include_statistics,
                                    )
                            else:
                                _LOGGER.error(
                                    "Failed to get energy statistics with code %s: %s",
                                    stats_result.get("code"), stats_result.get("msg"),
                                )
                        else:
                            _LOGGER.error(
                                "Failed to get energy statistics with status %s",
                                stats_response.status,
                            )
            except (asyncio.TimeoutError, aiohttp.ClientError, ValueError) as stats_error:
                _LOGGER.error("Error fetching energy statistics: %s", stats_error)
                # Return the power data we already have rather than failing completely.
                return battery_data
            
            # Now get today's stats
            today_url = f"{self.base_url}/api/stable/home/getSumDataForCustomer"
            today_date = report_date_str
            
            today_params = {
                "sn": "All",
                "stationId": effective_station_id,
                "tday": today_date
            }
            
            _LOGGER.debug("Fetching today's stats from: %s with params: %s", today_url, today_params)
            try:
                async with asyncio.timeout(DEFAULT_TIMEOUT):
                    async with self.session.get(
                        url=today_url, params=today_params, headers=headers,
                    ) as today_response:
                        if today_response.status == 200:
                            today_result = await _decode_json_object(today_response, "getSumDataForCustomer")
                            if today_result is None:
                                return battery_data
                            _LOGGER.debug("Today's stats response: %s", today_result)

                            if _is_success_code(today_result.get("code")):
                                today_data = today_result.get("data", {}) or {}
                                self._remember_user_id_candidates(today_result, today_data)
                                if today_data:
                                    battery_data["PV_Generated_Today"]    = today_data.get("epvtoday")
                                    battery_data["Total_PV_Generation"]   = today_data.get("epvtotal")
                                    battery_data["Consumed_Today"]        = today_data.get("eload")
                                    battery_data["Feed_In_Today"]         = today_data.get("eoutput")
                                    battery_data["Grid_Import_Today"]     = today_data.get("einput")
                                    battery_data["Battery_Charged_Today"] = today_data.get("echarge")
                                    battery_data["Battery_Discharged_Today"] = today_data.get("edischarge")

                                    self_consumption = today_data.get("eselfConsumption")
                                    if self_consumption is not None:
                                        battery_data["Self_Consumption"] = round(self_consumption * 100, 2)
                                    self_sufficiency = today_data.get("eselfSufficiency")
                                    if self_sufficiency is not None:
                                        battery_data["Self_Sufficiency"] = round(self_sufficiency * 100, 2)

                                    battery_data["Trees_Planted"] = today_data.get("treeNum")
                                    carbon_kg = today_data.get("carbonNum")
                                    if carbon_kg is not None:
                                        battery_data["CO2_Reduction_Tons"] = round(carbon_kg / 1000, 2)
                                    battery_data["Today_Income"] = today_data.get("todayIncome")
                                    battery_data["Total_Income"] = today_data.get("totalIncome")
                            elif today_result.get("code") == 6069:
                                _LOGGER.warning("Session expired (code 6069) during today's stats fetch")
                                if _retry_count < MAX_RELOGIN_RETRIES and await self.async_login():
                                    return await self.async_get_battery_data(
                                        station_id,
                                        _retry_count + 1,
                                        report_date=report_date,
                                        include_realtime=include_realtime,
                                        sys_sn=selected_sys_sn,
                                        include_statistics=include_statistics,
                                    )
                            else:
                                _LOGGER.error(
                                    "Failed to get today's stats with code %s: %s",
                                    today_result.get("code"), today_result.get("msg"),
                                )
                        else:
                            _LOGGER.error(
                                "Failed to get today's stats with status %s",
                                today_response.status,
                            )
            except (asyncio.TimeoutError, aiohttp.ClientError, ValueError) as today_error:
                _LOGGER.error("Error fetching today's stats: %s", today_error)
                return battery_data

            # Now get today's statistics
            today_stats_url = f"{self.base_url}/api/report/power/staticsByDay"
            today_stats_date = report_date_str
            if selected_sys_sn == "All" and not self.user_id_candidates and not self.user_id:
                await self._prime_aggregate_user_ids()

            today_stats_params_candidates = self._detailed_stats_param_candidates(
                selected_sys_sn,
                effective_station_id,
                today_stats_date,
            )

            chart_loaded = False
            last_chart_failure = ""
            for today_stats_params in today_stats_params_candidates:
                _LOGGER.debug("Fetching today's detailed stats from: %s with params: %s", today_stats_url, today_stats_params)
                try:
                    async with asyncio.timeout(DEFAULT_TIMEOUT):
                        async with self.session.get(
                            url=today_stats_url, params=today_stats_params, headers=headers,
                        ) as today_stats_response:
                            if today_stats_response.status != 200:
                                last_chart_failure = f"HTTP {today_stats_response.status}"
                                continue

                            today_stats_result = await _decode_json_object(today_stats_response, "staticsByDay")
                            if today_stats_result is None:
                                last_chart_failure = "non-object JSON body"
                                continue
                            _LOGGER.debug("Today's detailed stats response: %s", today_stats_result)
                            self._remember_user_id_candidates(today_stats_result, today_stats_result.get("data"))

                            if _is_success_code(today_stats_result.get("code")):
                                stats_data = today_stats_result.get("data", {}) or {}
                                # _stat_value coalesces missing / null fields to 0
                                # so the discharge arithmetic never raises TypeError.
                                if not stats_data:
                                    last_chart_failure = "empty stats payload"
                                    continue

                                pv_today    = _stat_value(stats_data, "epvtoday")
                                consumed    = _stat_value(stats_data, "ehomeload")
                                feed_in     = _stat_value(stats_data, "efeedIn")
                                grid_import = _stat_value(stats_data, "einput")
                                charged     = _stat_value(stats_data, "echarge")

                                battery_data["PV_Generated_Today"]    = pv_today
                                battery_data["Consumed_Today"]        = consumed
                                battery_data["Feed_In_Today"]         = feed_in
                                battery_data["Grid_Import_Today"]     = grid_import
                                battery_data["Battery_Charged_Today"] = charged

                                # Discharge = energy used minus energy gained.
                                total_gained = pv_today + grid_import
                                total_used   = consumed + feed_in + charged
                                battery_data["Battery_Discharged_Today"] = total_used - total_gained
                                battery_data["reporting_date"] = report_date_str
                                provider_soc = _float_or_none(stats_data.get("soc"))
                                battery_data["Power_Diagram"] = _provider_power_diagram(
                                    stats_data,
                                    report_date=report_date_str,
                                    scope_label=scope_label,
                                    summary={
                                        "soc": provider_soc if provider_soc is not None else battery_data.get("soc"),
                                        "solar_generation": pv_today,
                                        "load_consumption": consumed,
                                        "feed_in": feed_in,
                                        "grid_consumption": grid_import,
                                        "battery_charge": charged,
                                        "battery_discharge": battery_data["Battery_Discharged_Today"],
                                    },
                                )
                                if "userId" in today_stats_params:
                                    self.user_id = _safe_candidate_text(today_stats_params.get("userId"))
                                    self._remember_user_id_candidates({"userId": self.user_id})
                                chart_loaded = True
                                break

                            if today_stats_result.get("code") == 6069:
                                _LOGGER.warning("Session expired (code 6069) during today's detailed stats fetch")
                                if _retry_count < MAX_RELOGIN_RETRIES and await self.async_login():
                                    return await self.async_get_battery_data(
                                        station_id,
                                        _retry_count + 1,
                                        report_date=report_date,
                                        include_realtime=include_realtime,
                                        sys_sn=selected_sys_sn,
                                        include_statistics=include_statistics,
                                    )
                            last_chart_failure = (
                                f"code {today_stats_result.get('code')}: {today_stats_result.get('msg')}"
                            )
                except (asyncio.TimeoutError, aiohttp.ClientError, ValueError) as today_stats_error:
                    last_chart_failure = str(today_stats_error)
                    continue

            if not chart_loaded and last_chart_failure:
                _LOGGER.error(
                    "Failed to get today's detailed stats for %s after %d candidate request(s): %s",
                    scope_label,
                    len(today_stats_params_candidates),
                    last_chart_failure,
                )

            _LOGGER.debug("Combined battery data: %s", battery_data)
            return battery_data

        except ByteWattAPIError:
            # Already wrapped — propagate so the circuit breaker counts it.
            raise
        except (asyncio.TimeoutError, aiohttp.ClientError, ValueError) as error:
            # Wrap transport errors so the caller sees a uniform exception type.
            raise ByteWattAPIError(f"Transport error fetching battery data: {error}") from error
    
    def _get_auth_headers(self) -> Dict[str, str]:
        """Get the authentication headers."""
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.token}"
        }
    
    async def _async_get(self, endpoint: str) -> Optional[Dict[str, Any]]:
        """GET ``endpoint`` and return the decoded JSON object, or None.

        Returns None on any failure (timeout, ClientError, non-200 status,
        non-JSON body, or JSON that isn't an object). Callers can safely
        do ``response.get(...)`` without further type checks.
        """
        if not self.token:
            if not await self.async_login():
                _LOGGER.debug("GET %s aborted because login failed", endpoint)
                return None
        url = f"{self.base_url}/{endpoint}"
        headers = self._get_auth_headers()
        try:
            async with self.session.get(
                url, headers=headers,
                timeout=aiohttp.ClientTimeout(total=DEFAULT_TIMEOUT),
            ) as response:
                if response.status != 200:
                    _LOGGER.debug("GET %s failed with status %s", url, response.status)
                    return None
                return await _decode_json_object(response, f"GET {endpoint}")
        except (asyncio.TimeoutError, aiohttp.ClientError) as error:
            _LOGGER.debug("Error making GET request to %s: %s", url, error)
            return None

    async def _async_post(self, endpoint: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """POST ``data`` to ``endpoint`` and return the decoded JSON object, or None."""
        url = f"{self.base_url}/{endpoint}"
        headers = self._get_auth_headers()
        headers.update({
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json",
            "language": "en-US",
            "platform": "AK9D8H",
            "System": "alphacloud",
        })
        try:
            async with self.session.post(
                url, headers=headers, json=data,
                timeout=aiohttp.ClientTimeout(total=DEFAULT_TIMEOUT),
            ) as response:
                if response.status != 200:
                    response_text = await response.text()
                    _LOGGER.debug(
                        "POST %s failed (status %s): %s",
                        url, response.status, response_text,
                    )
                    return None
                return await _decode_json_object(response, f"POST {endpoint}")
        except (asyncio.TimeoutError, aiohttp.ClientError) as error:
            _LOGGER.debug("Error making POST request to %s: %s", url, error)
            return None

    async def _async_put(self, endpoint: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """PUT ``data`` to ``endpoint`` and return the decoded JSON object, or None."""
        url = f"{self.base_url}/{endpoint}"
        headers = self._get_auth_headers()
        headers.update({
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json",
            "language": "en-US",
            "platform": "AK9D8H",
            "System": "alphacloud",
        })
        try:
            async with self.session.put(
                url, headers=headers, json=data,
                timeout=aiohttp.ClientTimeout(total=DEFAULT_TIMEOUT),
            ) as response:
                if response.status != 200:
                    response_text = await response.text()
                    _LOGGER.debug(
                        "PUT %s failed (status %s): %s",
                        url, response.status, response_text,
                    )
                    return None
                return await _decode_json_object(response, f"PUT {endpoint}")
        except (asyncio.TimeoutError, aiohttp.ClientError) as error:
            _LOGGER.debug("Error making PUT request to %s: %s", url, error)
            return None

    @staticmethod
    def _extract_inverter_records(payload: Any) -> list[Dict[str, Any]]:
        """Recursively pull inverter-like records out of an arbitrary payload."""
        records: list[Dict[str, Any]] = []

        def _walk(node: Any) -> None:
            if isinstance(node, str):
                text = node.strip()
                if not text:
                    return
                if text[:1] in "[{":
                    try:
                        import json

                        _walk(json.loads(text))
                        return
                    except (TypeError, ValueError, json.JSONDecodeError):
                        pass
                return
            if isinstance(node, dict):
                system_id = str(node.get("systemId", "") or node.get("system_id", "")).strip()
                sys_sn = str(node.get("sysSn", "") or node.get("sys_sn", "")).strip()
                if system_id or sys_sn:
                    records.append(dict(node))
                for value in node.values():
                    if isinstance(value, (dict, list)):
                        _walk(value)
                    elif isinstance(value, str):
                        _walk(value)
            elif isinstance(node, list):
                for item in node:
                    _walk(item)

        _walk(payload)
        return records

    @staticmethod
    def _extract_account_ids(payload: Any) -> list[str]:
        """Recursively pull aggregate-account identifiers out of arbitrary payloads."""
        account_ids: list[str] = []
        seen: set[str] = set()
        field_names = {
            "userid",
            "user_id",
            "memberid",
            "member_id",
            "customerid",
            "customer_id",
            "accountid",
            "account_id",
            "uid",
        }
        patterns = [
            re.compile(r"(?:userId|user_id|memberId|member_id|customerId|customer_id|accountId|account_id|uid)=([A-Za-z0-9_-]+)"),
        ]

        def _add(value: Any) -> None:
            candidate = _safe_candidate_text(value)
            if not candidate or candidate in seen:
                return
            if "@" in candidate or "/" in candidate or "\\" in candidate or "." in candidate or " " in candidate:
                return
            seen.add(candidate)
            account_ids.append(candidate)

        def _walk(node: Any) -> None:
            if isinstance(node, dict):
                for key, value in node.items():
                    if str(key or "").strip().lower() in field_names:
                        _add(value)
                    if isinstance(value, (dict, list)):
                        _walk(value)
                    elif isinstance(value, str):
                        _walk(value)
                return

            if isinstance(node, list):
                for item in node:
                    _walk(item)
                return

            if isinstance(node, str):
                text = node.strip()
                if not text:
                    return
                for pattern in patterns:
                    for match in pattern.finditer(text):
                        _add(match.group(1))
                if text[:1] in "[{":
                    try:
                        _walk(json.loads(text))
                    except (TypeError, ValueError, json.JSONDecodeError):
                        pass

        _walk(payload)
        return account_ids

    def _remember_user_id_candidates(self, *payloads: Any) -> None:
        """Persist any aggregate account identifiers discovered in provider payloads."""
        candidates = list(self.user_id_candidates or [])
        seen = set(candidates)
        current = _safe_candidate_text(self.user_id)
        if current and current not in seen:
            candidates.append(current)
            seen.add(current)
        for payload in payloads:
            for candidate in self._extract_account_ids(payload):
                if candidate in seen:
                    continue
                candidates.append(candidate)
                seen.add(candidate)
        self.user_id_candidates = candidates
        if not current and candidates:
            self.user_id = candidates[0]

    def _aggregate_station_id_candidates(self, station_id: str | None = None) -> list[str]:
        """Return candidate station IDs for aggregate scope requests."""
        candidates: list[str] = [""]
        for raw in (station_id, self.host_system_id):
            candidate = _safe_candidate_text(raw)
            if candidate and candidate not in candidates:
                candidates.append(candidate)
        return candidates

    def _detailed_stats_param_candidates(
        self,
        selected_sys_sn: str,
        effective_station_id: str,
        report_date: str,
    ) -> list[dict[str, Any]]:
        """Return ordered request candidates for detailed day-chart fetches."""
        if selected_sys_sn != "All":
            return [{
                "sysSn": selected_sys_sn,
                "stationId": effective_station_id,
                "date": report_date,
            }]

        seen: set[tuple[tuple[str, Any], ...]] = set()
        candidates: list[dict[str, Any]] = []
        for user_id in self.user_id_candidates or []:
            candidate = {
                "userId": user_id,
                "date": report_date,
            }
            key = tuple(sorted(candidate.items()))
            if key not in seen:
                seen.add(key)
                candidates.append(candidate)
        current = _safe_candidate_text(self.user_id)
        if current:
            candidate = {
                "userId": current,
                "date": report_date,
            }
            key = tuple(sorted(candidate.items()))
            if key not in seen:
                seen.add(key)
                candidates.append(candidate)
        for station_id in self._aggregate_station_id_candidates(effective_station_id):
            candidate = {
                "sysSn": selected_sys_sn,
                "stationId": station_id,
                "date": report_date,
            }
            key = tuple(sorted(candidate.items()))
            if key not in seen:
                seen.add(key)
                candidates.append(candidate)
        return candidates

    async def _prime_aggregate_user_ids(self) -> None:
        """Try to discover the aggregate chart userId before falling back."""
        if self.user_id_candidates or self.user_id:
            return

        device_list = await self.async_get_device_list()
        self._remember_user_id_candidates(device_list)
        if self.user_id_candidates or self.user_id:
            return

        endpoints = [
            "api/stable/home/getCustomMenuEssList?inverterMode=0",
            "api/stable/home/getCustomMenuEssList?inverterMode=1",
        ]
        for endpoint in endpoints:
            response = await self._async_get(endpoint)
            if response is None:
                continue
            if response.get("code") == 6069:
                if not await self.async_login():
                    continue
                response = await self._async_get(endpoint)
                if response is None:
                    continue
            if not _is_success_code(response.get("code")):
                continue
            self._remember_user_id_candidates(response, response.get("data"))
            if self.user_id_candidates or self.user_id:
                return

    @staticmethod
    def _dedupe_inverter_records(records: list[Dict[str, Any]]) -> list[Dict[str, Any]]:
        """Return unique inverter records, keeping the first seen per identity."""
        unique: list[Dict[str, Any]] = []
        seen: set[tuple[str, str]] = set()
        for record in records:
            system_id = str(record.get("systemId", "") or record.get("system_id", "")).strip()
            sys_sn = str(record.get("sysSn", "") or record.get("sys_sn", "")).strip()
            key = (system_id, sys_sn)
            if key in seen:
                continue
            seen.add(key)
            unique.append(record)
        return unique

    @staticmethod
    def _extract_system_ids(payload: Any) -> set[str]:
        """Recursively pull system IDs out of arbitrary payload fragments.

        Some Byte-Watt account/menu endpoints embed system IDs inside nested
        route strings rather than exposing a clean ``[{systemId, sysSn}]`` list.
        We collect both direct fields and ``systemId=...`` query fragments so a
        second detail pass can still recover the full per-system records.
        """
        system_ids: set[str] = set()
        pattern = re.compile(r"systemId=([A-Za-z0-9]+)")

        def _walk(node: Any) -> None:
            if isinstance(node, dict):
                system_id = str(node.get("systemId", "") or node.get("system_id", "")).strip()
                if system_id:
                    system_ids.add(system_id)
                for value in node.values():
                    _walk(value)
                return

            if isinstance(node, list):
                for item in node:
                    _walk(item)
                return

            if isinstance(node, str):
                text = node.strip()
                if not text:
                    return
                for match in pattern.finditer(text):
                    candidate = str(match.group(1) or "").strip()
                    if candidate:
                        system_ids.add(candidate)
                if text[:1] in "[{":
                    try:
                        import json

                        _walk(json.loads(text))
                    except (TypeError, ValueError, json.JSONDecodeError):
                        pass

        _walk(payload)
        return system_ids

    async def _fetch_system_detail(self, system_id: str) -> Optional[Dict[str, Any]]:
        """Fetch one system detail record by systemId."""
        system_id = str(system_id or "").strip()
        if not system_id:
            return None

        response = await self._async_get(
            f"api/stable/essSystemData/getSystemDetail?systemId={system_id}"
        )
        if response is None:
            return None
        if response.get("code") == 6069:
            if not await self.async_login():
                return None
            response = await self._async_get(
                f"api/stable/essSystemData/getSystemDetail?systemId={system_id}"
            )
            if response is None:
                return None
        if not _is_success_code(response.get("code")):
            _LOGGER.debug(
                "System detail endpoint for %s returned code %s",
                system_id,
                response.get("code"),
            )
            return None
        data = response.get("data")
        self._remember_user_id_candidates(response, data)
        return data if isinstance(data, dict) else None

    async def fetch_inverter_list(self) -> list:
        """Return the list of inverters on this account.

        Used by the config flow / migration to populate the Host inverter
        selection. Re-logs in once on session expiry (code 6069).
        """
        endpoints = [
            "api/stable/home/getCustomMenuEssList?inverterMode=0",
            "api/stable/home/getCustomMenuEssList?inverterMode=1",
        ]
        collected: list[Dict[str, Any]] = []
        discovered_system_ids: set[str] = set()

        async def _do(endpoint: str) -> Optional[Dict[str, Any]]:
            return await self._async_get(endpoint)

        for endpoint in endpoints:
            response = await _do(endpoint)
            if response and response.get("code") == 6069:
                if await self.async_login():
                    response = await _do(endpoint)
            if response and _is_success_code(response.get("code")):
                payload = response.get("data")
                self._remember_user_id_candidates(response, payload)
                collected.extend(self._extract_inverter_records(payload))
                discovered_system_ids.update(self._extract_system_ids(payload))
            else:
                _LOGGER.debug("Inverter list endpoint %s returned %s", endpoint, response)

        device_list = await self.async_get_device_list()
        if device_list:
            collected.extend(self._extract_inverter_records(device_list))
            discovered_system_ids.update(self._extract_system_ids(device_list))

        discovered_system_ids.update(
            str(record.get("systemId", "") or record.get("system_id", "")).strip()
            for record in collected
            if str(record.get("systemId", "") or record.get("system_id", "")).strip()
        )

        detail_records: list[Dict[str, Any]] = []
        for system_id in sorted(discovered_system_ids):
            detail = await self._fetch_system_detail(system_id)
            if detail:
                detail_records.append(detail)

        if detail_records:
            collected.extend(detail_records)

        deduped = self._dedupe_inverter_records(collected)
        if deduped:
            _LOGGER.info(
                "Discovered %d inverter record(s) from %d endpoint result(s)",
                len(deduped),
                len(collected),
            )
            if len(deduped) == 1:
                _LOGGER.warning(
                    "Only one inverter record was discovered. Parsed record keys: %s",
                    sorted(deduped[0].keys()),
                )
            return deduped

        _LOGGER.warning("Could not fetch inverter list from any endpoint")
        return []
