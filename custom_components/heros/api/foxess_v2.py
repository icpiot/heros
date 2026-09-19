"""Read-only FoxESS Cloud V2 session and plant client, independent of HA entities."""
from __future__ import annotations

import asyncio
from datetime import date as calendar_date, datetime
import hashlib
import json as json_module
import logging
from pathlib import Path
import time
from typing import Any, Protocol
from urllib.parse import parse_qsl, urlsplit
from zoneinfo import ZoneInfo

from .foxess_v2_signer import FoxESSV2Signer, signing_path

_LOGGER = logging.getLogger(__name__)

BASE_URL = "https://www.foxesscloud.com"
LOGIN_PATH = "/foxess/biz/auth/login"
DEFAULT_POLL_INTERVAL = 60
# This only paces the fixed read sequence inside one one-minute refresh.
# FoxESS V2's coordinator uses the fixed one-minute polling interval.
DEFAULT_REQUEST_INTERVAL = 0.5
WASM_REQUIREMENT = "wasmtime==48.0.0"
FOXESS_V2_DEBUG_COMMANDS = frozenset({
    "refresh_telemetry",
    "connection_status",
    "plant_list",
    "plant_extra_info",
    "plant_work_mode",
    "plant_last_energy",
    "plant_alarms",
    "plant_flow_preinfo",
    "plant_detail",
    "plant_green_energy",
    "device_discovery",
    "inverter_realtime",
    "mppt",
    "battery_from_inverter",
    "battery_realtime",
    "battery_health",
    "battery_expected_life",
})
READ_ENDPOINTS = {
    "/dew/w/v0/plant/list": "POST",
    "/dew/w/v0/plant/extra/info": "GET",
    "/dew/w/plant/work/mode": "GET",
    "/dew/w/plant/last/energy": "GET",
    "/dew/w/v0/plant/alarm": "POST",
    "/dew/w/plant/flow/preInfo": "GET",
    "/dew/v0/plant/detail": "GET",
    "/dew/v0/plant/green/energy": "GET",
    "/dew/w/plant/analysis/raw": "POST",
    "/dew/v0/battery/history/raw": "POST",
    "/dew/v0/battery/history/report": "POST",
    "/dew/v0/device/history/raw": "POST",
    "/dew/v0/device/history/report": "POST",
    "/dew/w/plant/device/overview": "POST",
    "/dew/v0/device/associateDevices": "GET",
    "/dew/v1/device/data/realtime": "GET",
    "/dew/w/battery/data/realtime": "GET",
    "/dew/w/battery/health": "GET",
    "/dew/v0/battery/expected/life": "GET",
}


class Signer(Protocol):
    def sign(self, path: str, token: str, language: str, timestamp_ms: int) -> str: ...


class FoxESSV2Error(Exception):
    """Safe error: never carries request/response payloads or credentials."""


class FoxESSV2AuthError(FoxESSV2Error):
    """Authentication failed or the bounded session retry was exhausted."""


class FoxESSV2Session:
    """Serialized async requests with an in-memory token and controlled renewal.

    The caller owns the HTTP session (normally HA's shared aiohttp session).
    No logging is performed: responses contain identifiers and personal data.
    """

    def __init__(self, http: Any, signer: Signer, username: str, password: str,
                 *, timezone: str, minimum_request_interval: float = DEFAULT_REQUEST_INTERVAL,
                 clock_ms=None) -> None:
        self._http, self._signer = http, signer
        self._username = username
        self._password_md5 = hashlib.md5(password.encode("utf-8"), usedforsecurity=False).hexdigest()
        self._zone = ZoneInfo(timezone)
        self._timezone = timezone
        self._token = ""
        self._lock = asyncio.Lock()
        self._clock_ms = clock_ms or (lambda: time.time_ns() // 1_000_000)
        if minimum_request_interval < 0:
            raise ValueError("Request interval must be nonnegative")
        self._interval = minimum_request_interval
        self._next_request_at = 0.0

    def clear_credentials(self) -> None:
        """Release session credentials when the owning integration unloads."""
        self._token = self._username = self._password_md5 = ""

    async def _send(self, method, path, *, params=None, json=None, token=""):
        delay = self._next_request_at - time.monotonic()
        if delay > 0:
            await asyncio.sleep(delay)
        timestamp_ms = int(self._clock_ms())
        local_time = datetime.fromtimestamp(timestamp_ms / 1000, self._zone)
        try:
            signature = await asyncio.to_thread(self._signer.sign, path, token, "en", timestamp_ms)
        except Exception:
            raise FoxESSV2Error("FoxESS request signing failed") from None
        headers = {
            "Content-Type": "application/json", "contentType": "application/json",
            "lang": "en", "token": token, "timezone": self._timezone,
            "platform": "web", "X-Auth-Platform": "FOX_CLOUD_WEB_2_0",
            "dt": f"{self._timezone}@{timestamp_ms}@{local_time:%Y-%m-%d %H:%M:%S}",
            "timestamp": str(timestamp_ms), "signature": signature,
        }
        self._next_request_at = time.monotonic() + self._interval
        try:
            # Never follow redirects with a token or password-bearing body.
            async with self._http.request(method, BASE_URL + path, params=params, json=json,
                                          headers=headers, timeout=30, allow_redirects=False) as response:
                refreshed = response.headers.get("refreshed-token")
                if isinstance(refreshed, str) and refreshed:
                    self._token = refreshed
                status = response.status
                raw = bytearray()
                while chunk := await response.content.read(65536):
                    raw.extend(chunk)
                    if len(raw) > 4 * 1024 * 1024:
                        raise FoxESSV2Error("FoxESS response exceeded the size limit")
                payload = json_module.loads(raw)
        except FoxESSV2Error:
            raise
        except asyncio.TimeoutError:
            raise FoxESSV2Error("FoxESS request timed out; the provider did not respond") from None
        except json_module.JSONDecodeError:
            raise FoxESSV2Error("FoxESS returned a non-JSON response") from None
        except OSError:
            raise FoxESSV2Error("FoxESS network connection failed") from None
        except Exception as error:
            # Keep provider and credential details out of HA logs while making
            # unexpected HTTP-client failures distinguishable from bad JSON.
            if error.__class__.__module__.startswith("aiohttp"):
                raise FoxESSV2Error("FoxESS network connection failed") from None
            raise FoxESSV2Error("FoxESS request failed unexpectedly") from None
        if not isinstance(payload, dict) or type(payload.get("errno")) is not int:
            raise FoxESSV2Error("FoxESS returned an invalid response envelope")
        if payload["errno"] == 41819:
            raise FoxESSV2AuthError("FoxESS session expired")
        if not 200 <= status < 300:
            raise FoxESSV2Error(f"FoxESS HTTP request failed ({status})")
        if payload["errno"] != 0:
            # Do not include provider msg or an unvalidated value in exceptions.
            raise FoxESSV2Error(f"FoxESS API request failed (errno {payload['errno']})")
        if "result" not in payload:
            raise FoxESSV2Error("FoxESS response is missing its result")
        return payload["result"], refreshed

    async def _login_once(self):
        self._token = ""
        if not self._username or not self._password_md5:
            raise FoxESSV2AuthError("FoxESS credentials are unavailable")
        result, refreshed = await self._send("POST", LOGIN_PATH, json={
            "account": self._username, "password": self._password_md5,
        }, token="")
        if not isinstance(result, dict) or not isinstance(result.get("token"), str) or not result["token"]:
            self._token = ""
            raise FoxESSV2AuthError("FoxESS login returned no session token")
        self._token = refreshed or result["token"]

    async def login(self):
        """One login attempt; login expiry errors must never recursively retry."""
        async with self._lock:
            await self._login_once()

    async def request(self, method, path, *, params=None, json=None):
        clean_path = signing_path(path)
        method = method.upper()
        if READ_ENDPOINTS.get(clean_path) != method:
            raise FoxESSV2Error("Unsupported FoxESS V2 read endpoint")
        query = dict(parse_qsl(urlsplit(path).query, keep_blank_values=True))
        if params:
            if query.keys() & params.keys():
                raise FoxESSV2Error("Duplicate FoxESS query parameter")
            query.update(params)
        async with self._lock:
            if not self._token:
                await self._login_once()
            for attempt in range(2):
                try:
                    result, _ = await self._send(method, clean_path, params=query or None,
                                                 json=json, token=self._token)
                    return result
                except FoxESSV2AuthError:
                    self._token = ""
                    if attempt:
                        raise
                    await self._login_once()


class FoxESSV2Client:
    """Discovered plants and the captured read methods; no inferred telemetry."""

    is_foxess_v2 = True

    def __init__(self, session: FoxESSV2Session):
        self.session = session
        self._plant_ids = None
        self._device_ids: set[str] = set()
        self._battery_ids: set[str] = set()

    async def discover_plants(self, *, force=False):
        """Return discovered plants using the provider-neutral setup contract."""
        if force:
            self._plant_ids = None
        return await self.list_plants()

    async def list_plants(self):
        plants = []
        seen = set()
        for page in range(1, 101):
            result = await self.session.request("POST", "/dew/w/v0/plant/list", json={
                "page": page, "size": 20, "fuzzyCondition": "", "status": 0, "exportFlag": False,
            })
            if not isinstance(result, dict) or not isinstance(result.get("data"), list):
                raise FoxESSV2Error("FoxESS returned an invalid plant list")
            total = result.get("total")
            if type(total) is not int or total < 0:
                raise FoxESSV2Error("FoxESS returned an invalid plant count")
            for plant in result["data"]:
                if not isinstance(plant, dict) or not isinstance(plant.get("plantID"), str) or not plant["plantID"]:
                    raise FoxESSV2Error("FoxESS returned an invalid plant entry")
                if plant["plantID"] in seen:
                    raise FoxESSV2Error("FoxESS plant pagination repeated an entry")
                seen.add(plant["plantID"])
                plants.append(plant)
            if len(plants) >= total:
                self._plant_ids = seen
                return plants
            if not result["data"]:
                raise FoxESSV2Error("FoxESS plant pagination ended early")
        raise FoxESSV2Error("FoxESS plant pagination exceeded its limit")

    async def _read(self, method, path, plant_id, *, body=None):
        if self._plant_ids is None:
            await self.list_plants()
        if plant_id not in self._plant_ids:
            raise FoxESSV2Error("Choose a plant returned by FoxESS discovery")
        if method == "GET":
            return await self.session.request(method, path, params={"plantID": plant_id})
        return await self.session.request(method, path, json=body or {"plantID": plant_id})

    async def list_devices(self, plant_id):
        """Discover inverter devices for a discovered plant; never use saved IDs."""
        if self._plant_ids is None:
            await self.list_plants()
        if plant_id not in self._plant_ids:
            raise FoxESSV2Error("Choose a plant returned by FoxESS discovery")
        devices = []
        seen_ids = set()
        records_seen = 0
        for page in range(1, 101):
            result = await self.session.request("POST", "/dew/w/plant/device/overview", json={
                "plantID": plant_id, "categories": [], "communications": [], "gridFlag": None,
                "states": [], "sn": "", "pageFlag": 1, "page": page, "size": 20,
            })
            if not isinstance(result, dict) or not isinstance(result.get("data"), list):
                raise FoxESSV2Error("FoxESS returned an invalid device list")
            total = result.get("total")
            if type(total) is not int or total < 0:
                raise FoxESSV2Error("FoxESS returned an invalid device count")
            records = result["data"]
            records_seen += len(records)
            for device in records:
                # FoxESS inventory also contains descriptive records which
                # cannot be queried through the device realtime endpoint.
                if not isinstance(device, dict):
                    continue
                device_id = device.get("id")
                if not isinstance(device_id, str) or not device_id or device_id in seen_ids:
                    continue
                seen_ids.add(device_id)
                devices.append(device)
            if records_seen >= total:
                self._device_ids.update(seen_ids)
                return devices
            if not records:
                raise FoxESSV2Error("FoxESS device pagination ended early")
        raise FoxESSV2Error("FoxESS device pagination exceeded its limit")

    async def _read_device(self, path, device_id):
        if device_id not in self._device_ids:
            raise FoxESSV2Error("Choose a device returned by FoxESS discovery")
        return await self.session.request("GET", path, params={"deviceID": device_id})

    async def _associated_devices(self, device: dict[str, Any]) -> list[dict[str, Any]]:
        """Return captured FoxESS associations for an inventory device."""
        device_id = device.get("id")
        category = device.get("category")
        if not isinstance(device_id, str) or not device_id or not isinstance(category, str) or not category:
            return []
        result = await self.session.request(
            "GET", "/dew/v0/device/associateDevices",
            params={"id": device_id, "category": category},
        )
        records = result.get("devices") if isinstance(result, dict) else None
        if not isinstance(records, list):
            raise FoxESSV2Error("FoxESS returned invalid associated devices")
        associated = [record for record in records if isinstance(record, dict)]
        self._device_ids.update(
            record["id"] for record in associated
            if isinstance(record.get("id"), str) and record["id"]
        )
        return associated

    async def _discover_inverter_device(
        self, plant_id: str, devices: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any] | None:
        """Find the inverter, including the captured meter-association route."""
        if devices is None:
            devices = await self.list_devices(plant_id)
        inverter = next((device for device in devices if _is_inverter_device(device)), None)
        if inverter is not None:
            return inverter
        for device in devices:
            if str(device.get("category") or "").strip().casefold() != "meter":
                continue
            for associated in await self._associated_devices(device):
                if _is_inverter_device(associated):
                    return associated
        return None

    async def _read_battery(self, path, battery_id):
        if battery_id not in self._battery_ids:
            raise FoxESSV2Error("Choose a battery returned by FoxESS discovery")
        return await self.session.request("GET", path, params={"batteryID": battery_id})

    async def get_device_realtime(self, device_id):
        return await self._read_device("/dew/v1/device/data/realtime", device_id)

    async def get_battery_realtime(self, battery_id):
        return await self._read_battery("/dew/w/battery/data/realtime", battery_id)

    async def get_battery_health(self, battery_id):
        return await self._read_battery("/dew/w/battery/health", battery_id)

    async def get_battery_expected_life(self, battery_id):
        return await self._read_battery("/dew/v0/battery/expected/life", battery_id)

    async def get_plant_extra_info(self, plant_id):
        return await self._read("GET", "/dew/w/v0/plant/extra/info", plant_id)

    async def get_work_mode(self, plant_id):
        return await self._read("GET", "/dew/w/plant/work/mode", plant_id)

    async def get_last_energy(self, plant_id):
        return await self._read("GET", "/dew/w/plant/last/energy", plant_id)

    async def get_alarms(self, plant_id):
        return await self._read("POST", "/dew/w/v0/plant/alarm", plant_id)

    async def get_flow_preinfo(self, plant_id):
        return await self._read("GET", "/dew/w/plant/flow/preInfo", plant_id)

    async def get_plant_detail(self, plant_id):
        return await self._read("GET", "/dew/v0/plant/detail", plant_id)

    async def get_green_energy(self, plant_id):
        return await self._read("GET", "/dew/v0/plant/green/energy", plant_id)

    async def get_raw_analysis(self, plant_id, dimension, date):
        if dimension != "DAY":
            raise FoxESSV2Error("Only captured DAY analysis is supported")
        try:
            day = calendar_date(int(date["year"]), int(date["month"]), int(date["day"]))
        except (ValueError, TypeError, KeyError):
            raise FoxESSV2Error("Invalid FoxESS analysis date") from None
        return await self._read("POST", "/dew/w/plant/analysis/raw", plant_id, body={
            "plantId": plant_id, "dimension": "DAY",
            "date": {"year": f"{day.year:04}", "month": f"{day.month:02}", "day": f"{day.day:02}"},
            "downloadFlag": False,
        })

    async def get_battery_history_raw(self, battery_id: str, report_date: str | dict[str, Any]):
        """Return five-minute battery history for one calendar day."""
        day = _history_day(report_date)
        if battery_id not in self._battery_ids:
            raise FoxESSV2Error("Choose a battery returned by FoxESS discovery")
        return await self.session.request("POST", "/dew/v0/battery/history/raw", json={
            "batteryID": battery_id,
            "custom": False,
            "date": {"year": f"{day.year:04}", "month": f"{day.month:02}", "day": f"{day.day:02}"},
            "exportFlag": False,
        })

    async def get_battery_history_report(self, battery_id: str, report_date: str | dict[str, Any]):
        """Return the provider's weekly battery charge/discharge report."""
        day = _history_day(report_date)
        if battery_id not in self._battery_ids:
            raise FoxESSV2Error("Choose a battery returned by FoxESS discovery")
        iso = day.isocalendar()
        return await self.session.request("POST", "/dew/v0/battery/history/report", json={
            "batteryID": battery_id,
            "custom": False,
            "dimension": "week",
            "date": {"year": f"{day.year:04}", "month": f"{day.month:02}", "day": f"{day.day:02}", "week": iso.week},
            "exportFlag": False,
        })

    async def get_device_history_raw(self, device_id: str, report_date: str | dict[str, Any]):
        """Return five-minute inverter history for one calendar day."""
        day = _history_day(report_date)
        if device_id not in self._device_ids:
            raise FoxESSV2Error("Choose a device returned by FoxESS discovery")
        return await self.session.request("POST", "/dew/v0/device/history/raw", json={
            "deviceID": device_id,
            "custom": False,
            "variables": [],
            "date": {"year": f"{day.year:04}", "month": f"{day.month:02}", "day": f"{day.day:02}"},
            "exportFlag": False,
        })

    async def get_device_history_report(self, device_id: str, report_date: str | dict[str, Any]):
        """Return the provider's weekly inverter energy report."""
        day = _history_day(report_date)
        if device_id not in self._device_ids:
            raise FoxESSV2Error("Choose a device returned by FoxESS discovery")
        iso = day.isocalendar()
        return await self.session.request("POST", "/dew/v0/device/history/report", json={
            "deviceID": device_id,
            "custom": False,
            "dimension": "week",
            "date": {"year": f"{day.year:04}", "month": f"{day.month:02}", "day": f"{day.day:02}", "week": iso.week},
            "exportFlag": False,
        })
    async def debug_query(self, command: str) -> dict[str, Any]:
        """Run one fixed read-only FoxESS V2 query for diagnostics."""
        command = str(command or "").strip()
        if command not in FOXESS_V2_DEBUG_COMMANDS:
            raise FoxESSV2Error("Unsupported FoxESS V2 debug query")
        plants = await self.list_plants()
        if command == "plant_list":
            return {"command": command, "plants": plants}
        if not plants:
            raise FoxESSV2Error("FoxESS returned no plants")
        plant = plants[0]
        plant_id = plant["plantID"]
        plant_queries = {
            "plant_extra_info": ("extra_info", self.get_plant_extra_info),
            "plant_work_mode": ("work_mode", self.get_work_mode),
            "plant_last_energy": ("last_energy", self.get_last_energy),
            "plant_alarms": ("alarms", self.get_alarms),
            "plant_flow_preinfo": ("flow_preinfo", self.get_flow_preinfo),
            "plant_detail": ("plant_detail", self.get_plant_detail),
            "plant_green_energy": ("green_energy", self.get_green_energy),
        }
        if command in plant_queries:
            result_key, query = plant_queries[command]
            return {
                "command": command,
                "plant": plant,
                result_key: await query(plant_id),
            }
        devices = await self.list_devices(plant_id)
        if command == "device_discovery":
            return {"command": command, "plant": plant, "devices": devices}
        inverter = await self._discover_inverter_device(plant_id, devices)
        if not isinstance(inverter, dict) or not isinstance(inverter.get("id"), str):
            raise FoxESSV2Error("FoxESS returned no inverter device")
        realtime = await self.get_device_realtime(inverter["id"])
        if command == "inverter_realtime":
            return {"command": command, "plant": plant, "device": inverter, "realtime": realtime}
        if command == "mppt":
            return {
                "command": command,
                "plant": plant,
                "device": inverter,
                "pvInfo": _nested(realtime, "pvInfo", "data") or [],
                "realtime": realtime,
            }
        batteries = realtime.get("battery") if isinstance(realtime, dict) else None
        battery = batteries[0] if isinstance(batteries, list) and batteries and isinstance(batteries[0], dict) else {}
        battery_id = battery.get("batteryId") if isinstance(battery, dict) else None
        if command == "battery_from_inverter":
            return {"command": command, "plant": plant, "device": inverter, "battery": battery, "realtime": realtime}
        if not isinstance(battery_id, str) or not battery_id:
            raise FoxESSV2Error("FoxESS inverter realtime returned no battery ID")
        self._battery_ids.add(battery_id)
        if command == "battery_realtime":
            return {"command": command, "plant": plant, "battery": battery, "realtime": await self.get_battery_realtime(battery_id)}
        if command == "battery_health":
            return {"command": command, "plant": plant, "battery": battery, "health": await self.get_battery_health(battery_id)}
        if command == "battery_expected_life":
            return {"command": command, "plant": plant, "battery": battery, "expected_life": await self.get_battery_expected_life(battery_id)}
        raise FoxESSV2Error("Unsupported FoxESS V2 debug query")


    async def get_historical_battery_data(self, report_date: str | dict[str, Any], **_kwargs):
        """Build a dated report snapshot from FoxESS five-minute history."""
        day = _history_day(report_date)
        plants = await self.list_plants()
        if not plants:
            raise FoxESSV2Error("FoxESS returned no plants")
        plant = plants[0]
        plant_id = plant["plantID"]
        devices = await self.list_devices(plant_id)
        inverter = await self._discover_inverter_device(plant_id, devices)
        if not isinstance(inverter, dict) or not isinstance(inverter.get("id"), str):
            raise FoxESSV2Error("FoxESS returned no inverter device")
        device_id = inverter["id"]
        realtime = await self.get_device_realtime(device_id)
        batteries = realtime.get("battery") if isinstance(realtime, dict) else []
        battery = batteries[0] if isinstance(batteries, list) and batteries and isinstance(batteries[0], dict) else {}
        battery_id = battery.get("batteryId") if isinstance(battery, dict) else None
        if not isinstance(battery_id, str) or not battery_id:
            raise FoxESSV2Error("FoxESS inverter realtime returned no battery ID")
        self._battery_ids.add(battery_id)
        device_history = await self.get_device_history_raw(device_id, day.isoformat())
        battery_history = await self.get_battery_history_raw(battery_id, day.isoformat())
        soc_history = await self.get_raw_analysis(plant_id, "DAY", {"year": day.year, "month": day.month, "day": day.day})
        device_report = await self.get_device_history_report(device_id, day.isoformat())

        def rows(payload):
            value = payload.get("data") if isinstance(payload, dict) else []
            return value if isinstance(value, list) else []

        def points(payload, variable):
            for row in rows(payload):
                if isinstance(row, dict) and row.get("variables") == variable:
                    return [item for item in (row.get("points") or []) if isinstance(item, dict)]
            return []

        def numeric(point):
            try:
                return float(point.get("value"))
            except (AttributeError, TypeError, ValueError):
                return None

        pv_points = points(device_history, "pvPower")
        bat_points = points(device_history, "invBatPower") or points(battery_history, "invBatPower")
        time_points = [str(item.get("index") or "") for item in pv_points]
        solar = [value * 1000 for item in pv_points if (value := numeric(item)) is not None]
        battery_curve = [value * 1000 for item in bat_points if (value := numeric(item)) is not None]
        report_rows = rows(device_report)
        wanted_day = day.strftime("%a")
        summary = {}
        report_keys = {
            "generation": "solar_generation", "loads": "load_consumption",
            "feedin": "feed_in", "gridConsumption": "grid_consumption",
            "chargeEnergyToTal": "battery_charge", "dischargeEnergyToTal": "battery_discharge",
        }
        for row in report_rows:
            if not isinstance(row, dict) or row.get("variables") not in report_keys:
                continue
            for item in row.get("points") or []:
                if isinstance(item, dict) and item.get("index") == wanted_day:
                    value = numeric(item)
                    if value is not None:
                        summary[report_keys[row["variables"]]] = abs(value)
                    break
        def analysis_points(section: str, variable: str) -> list[dict[str, Any]]:
            """Return one aligned FoxESS analysis series by its provider label."""
            if not isinstance(soc_history, dict):
                return []
            for group in soc_history.get(section) or []:
                if not isinstance(group, dict):
                    continue
                name = str(group.get("variable") or group.get("name") or "")
                if name.casefold() == variable.casefold():
                    return [item for item in group.get("points") or [] if isinstance(item, dict)]
            return []

        def analysis_curve(section: str, variable: str, *, watts: bool = False) -> tuple[list[str], list[float | None]]:
            points_for_series = analysis_points(section, variable)
            labels = [str(point.get("index") or "") for point in points_for_series]
            values: list[float | None] = []
            for point in points_for_series:
                value = numeric(point)
                values.append(None if value is None else value * 1000 if watts else value)
            return labels, values

        time_points, soc_curve = analysis_curve("socData", "SoC")
        if not time_points:
            time_points = [str(item.get("index") or "") for item in pv_points]
        _, solar_curve = analysis_curve("supplyData", "pvPower", watts=True)
        _, battery_discharge_curve = analysis_curve("supplyData", "batDischargePower", watts=True)
        _, grid_import_curve = analysis_curve("supplyData", "gridConsumptionPower", watts=True)
        _, feed_in_curve = analysis_curve("usageData", "feedinPower", watts=True)
        _, battery_charge_curve = analysis_curve("usageData", "batChargePower", watts=True)
        _, load_curve = analysis_curve("usageData", "loadsPower", watts=True)
        # Fall back to the legacy device series only when the richer plant analysis is absent.
        solar = solar_curve or [value * 1000 for item in pv_points if (value := numeric(item)) is not None]
        if not solar_curve:
            time_points = time_points or [str(item.get("index") or "") for item in pv_points]
        soc_curve = soc_curve or []
        soc = soc_curve[-1] if soc_curve else None
        last_solar = solar[-1] if solar else None
        last_battery = battery_curve[-1] if battery_curve else None
        return {
            "provider": "foxess_v2",
            "reporting_date": day.isoformat(),
            "soc": soc,
            "ppv": last_solar,
            "pv_input_total_power": last_solar,
            "pbat": last_battery,
            "PV_Generated_Today": summary.get("solar_generation"),
            "Consumed_Today": summary.get("load_consumption"),
            "Feed_In_Today": summary.get("feed_in"),
            "Grid_Import_Today": summary.get("grid_consumption"),
            "Battery_Charged_Today": summary.get("battery_charge"),
            "Battery_Discharged_Today": summary.get("battery_discharge"),
            "Power_Diagram": {
                "date": day.isoformat(),
                "meta": {"source": "foxess_v2_history", "device_id": device_id, "battery_id": battery_id},
                "summary": {"soc": soc, **summary},
                "time": time_points,
                "series": {
                    "solar": solar,
                    "bat": soc_curve,
                    "battery_charge": battery_charge_curve,
                    "bat_discharge": battery_discharge_curve,
                    "grid_import": grid_import_curve,
                    "load": load_curve,
                    "feed_in": feed_in_curve,
                    # Kept for report consumers that still use the older name.
                    "consumed": load_curve,
                },
                "provider_payload": {"device_history": device_history, "battery_history": battery_history, "soc_history": soc_history},
            },
        }

    async def get_battery_data(self, **_kwargs):
        """Return live FoxESS fields, or a dated historical snapshot when requested."""
        report_date = _kwargs.get("report_date")
        if report_date and not _kwargs.get("include_realtime", True):
            return await self.get_historical_battery_data(report_date)

        plants = await self.list_plants()
        if not plants:
            raise FoxESSV2Error("FoxESS returned no plants")
        plant = plants[0]
        plant_id = plant["plantID"]
        work_mode = await self.get_work_mode(plant_id)
        last_energy = await self.get_last_energy(plant_id)
        alarms = await self.get_alarms(plant_id)
        try:
            green_energy = await self.get_green_energy(plant_id)
        except Exception:
            green_energy = {}
        realtime = {}
        battery = {}
        battery_realtime = battery_health = battery_life = {}
        pv_strings = []
        pv_units: dict[str, Any] = {}
        telemetry_errors: dict[str, str] = {}
        try:
            inverter = await self._discover_inverter_device(plant_id)
            if not isinstance(inverter, dict) or not isinstance(inverter.get("id"), str):
                raise FoxESSV2Error("FoxESS returned no inverter device")
            realtime = await self.get_device_realtime(inverter["id"])
            pv_info = realtime.get("pvInfo") if isinstance(realtime, dict) else None
            pv_strings = _nested(pv_info, "data") if isinstance(_nested(pv_info, "data"), list) else []
            pv_units = _nested(pv_info, "unit") if isinstance(_nested(pv_info, "unit"), dict) else {}
            batteries = realtime.get("battery") if isinstance(realtime, dict) else None
            battery_units = [item for item in batteries if isinstance(item, dict)] if isinstance(batteries, list) else []
            battery = battery_units[0] if battery_units else {}
            for battery_index, battery_unit in enumerate(battery_units[:1], start=1):
                battery_id = battery_unit.get("batteryId")
                if not isinstance(battery_id, str) or not battery_id:
                    continue
                self._battery_ids.add(battery_id)
                for label, request, target in (
                    ("realtime", self.get_battery_realtime, "battery_realtime"),
                    ("health", self.get_battery_health, "battery_health"),
                    ("expected-life", self.get_battery_expected_life, "battery_life"),
                ):
                    try:
                        value = await request(battery_id)
                    except asyncio.CancelledError:
                        raise
                    except Exception as err:
                        telemetry_errors[f"battery_{battery_index}_{label}"] = (
                            str(err) if isinstance(err, FoxESSV2Error) else type(err).__name__
                        )
                        _LOGGER.warning(
                            "FoxESS battery %s %s unavailable (%s): %s",
                            battery_index, label, type(err).__name__, err,
                        )
                        continue
                    if isinstance(value, dict):
                        battery_unit[f"{label}_data"] = value
                        if battery_index == 1:
                            if target == "battery_realtime":
                                battery_realtime = value
                            elif target == "battery_health":
                                battery_health = value
                            else:
                                battery_life = value
                realtime_data = battery_unit.get("realtime_data") or {}
                health_data = battery_unit.get("health_data") or {}
                life_data = battery_unit.get("expected-life_data") or {}
                battery_unit["soc"] = realtime_data.get("soc", battery_unit.get("soc"))
                battery_unit["volt"] = realtime_data.get("volt", battery_unit.get("volt"))
                battery_unit["current"] = realtime_data.get("current", battery_unit.get("current"))
                battery_unit["temperature"] = battery_unit.get("temperature")
                battery_unit["capacity"] = health_data.get("energy", battery_unit.get("capacity"))
                battery_unit["soh"] = health_data.get("soh", battery_unit.get("soh"))
                battery_unit["cyclesNum"] = life_data.get("cyclesNum", battery_unit.get("cyclesNum"))
        except asyncio.CancelledError:
            raise
        except Exception as err:
            telemetry_errors["inverter"] = (
                str(err) if isinstance(err, FoxESSV2Error) else type(err).__name__
            )
            _LOGGER.warning("FoxESS optional telemetry unavailable (%s): %s", type(err).__name__, err)
            # Extra device telemetry is optional; retain the proven plant data.

        current_power_w = _foxess_amount(plant.get("currentPower"), target_unit="W")
        today_yield_kwh = _foxess_amount(plant.get("todayYield"), target_unit="kWh")
        total_yield_kwh = _foxess_amount(plant.get("totalYield"), target_unit="kWh")
        system_size_kw = _foxess_amount(plant.get("systemSize"), target_unit="kW")
        today_production_kwh = _foxess_amount(
            _nested(last_energy, "production", "todayProduction"), target_unit="kWh"
        )
        today_consumption_kwh = _foxess_amount(
            _nested(last_energy, "consumption", "todayConsumption"), target_unit="kWh"
        )
        online = work_mode.get("online") if isinstance(work_mode, dict) else None
        alarm_count = alarms.get("alarmCount") if isinstance(alarms, dict) else None
        work_mode_value = work_mode.get("workMode") if isinstance(work_mode, dict) else None
        charging_power_w = _foxess_amount(battery.get("chargingPower"), target_unit="W")
        discharging_power_w = _foxess_amount(battery.get("dischargingPower"), target_unit="W")
        battery_power_w = None
        if charging_power_w is not None or discharging_power_w is not None:
            battery_power_w = (discharging_power_w or 0.0) - (charging_power_w or 0.0)
        grid_info = realtime.get("gridInfo") if isinstance(realtime, dict) else {}
        grid_info = grid_info if isinstance(grid_info, dict) else {}
        grid_operating = _nested(realtime, "gridOperatingData", "operatingData")
        grid_phase = (
            grid_operating[0]
            if isinstance(grid_operating, list) and grid_operating and isinstance(grid_operating[0], dict)
            else {}
        )
        grid_units = _nested(realtime, "gridOperatingData", "unit")
        grid_units = grid_units if isinstance(grid_units, dict) else {}
        data = {
            "provider": "foxess_v2",
            # Successful polling proves the cloud provider connection is healthy.
            # The work-mode flag is inverter telemetry and can be stale or absent.
            "communication_status": "online",
            "inverter_communication_status": "online" if online is True else "offline" if online is False else "unknown",
            "operating_mode": work_mode_value,
            "alarm_state": alarm_count,
            "plant_status": plant.get("status"),
            "ppv": current_power_w,
            "pv_input_total_power": current_power_w,
            "Total_Solar_Generation": total_yield_kwh,
            "PV_Generated_Today": today_production_kwh if today_production_kwh is not None else today_yield_kwh,
            "Consumed_Today": today_consumption_kwh,
            "total_house_consumption": today_consumption_kwh,
            "system_size_kw": system_size_kw,
            "CO2_Reduction_Tons": _foxess_amount(_nested(green_energy, "co2"), target_unit="tons"),
            "Trees_Planted": _foxess_amount(_nested(green_energy, "tree"), target_unit="trees"),
            "soc": _foxess_amount(battery_realtime.get("soc"), target_unit="%"),
            "battery_voltage": _foxess_amount(battery_realtime.get("volt"), target_unit="V"),
            "battery_current": _foxess_amount(battery_realtime.get("current"), target_unit="A"),
            "battery_temperature": _foxess_amount(battery.get("temperature"), target_unit="°C"),
            "battery_cycles": _foxess_number(battery_life.get("cyclesNum")),
            "battery_state_of_health": _foxess_amount(battery_health.get("soh"), target_unit="%"),
            "battery_usable_capacity": _foxess_energy_amount(battery_health.get("energy")),
            "battery_remaining_capacity": _foxess_energy_amount(battery_health.get("remainCapacity")),
            "battery_capacity": _foxess_energy_amount(battery.get("capacity")),
            "battery_charging_power": _foxess_amount(battery.get("chargingPower"), target_unit="W"),
            "battery_discharging_power": _foxess_amount(battery.get("dischargingPower"), target_unit="W"),
            "battery_max_charge_current": _foxess_amount(battery.get("maxChargeCurrent"), target_unit="A"),
            "battery_max_discharge_current": _foxess_amount(battery.get("maxDischargeCurrent"), target_unit="A"),
            "battery_capacity_ah": _foxess_amount(battery_health.get("capacity"), target_unit="Ah"),
            "battery_self_discharge_rate": _foxess_amount(battery_health.get("rate"), target_unit="%"),
            "battery_round_trip_efficiency": _foxess_amount(battery_health.get("efficiency"), target_unit="%"),
            "battery_ohmic_resistance": _foxess_amount(battery_health.get("resistance"), target_unit="mΩ"),
            "battery_charge_energy_throughput": _foxess_amount(battery_life.get("chargeEnergyThroughput"), target_unit="kWh"),
            "battery_discharge_energy_throughput": _foxess_amount(battery_life.get("dischargeEnergyThroughput"), target_unit="kWh"),
            "battery_charge_capacity_throughput": _foxess_amount(battery_life.get("chargeCapacityThroughput"), target_unit="Ah"),
            "battery_discharge_capacity_throughput": _foxess_amount(battery_life.get("dischargeCapacityThroughput"), target_unit="Ah"),
            "battery_extreme_time": _foxess_amount(battery_life.get("extremeTime"), target_unit="h"),
            "battery_extreme_charging_time": _foxess_amount(battery_life.get("extremeChargingTime"), target_unit="h"),
            "battery_event_count": _foxess_number(battery_life.get("eventNum")),
            "pbat": battery_power_w,
            "Total_Battery_Charge": _foxess_amount(battery_realtime.get("chargingEnergyTotal"), target_unit="kWh"),
            "Total_Battery_Discharge": _foxess_amount(battery_realtime.get("dischargingEnergyTotal"), target_unit="kWh"),
            "Battery_Charged_Today": _foxess_amount(battery_realtime.get("chargingEnergyDaily"), target_unit="kWh"),
            "Battery_Discharged_Today": _foxess_amount(battery_realtime.get("dischargingEnergyDaily"), target_unit="kWh"),
            "house_consumption": _foxess_amount(_nested(realtime, "load", "loadsPower"), target_unit="W"),
            "pload": _foxess_amount(_nested(realtime, "load", "loadsPower"), target_unit="W"),
            "pgrid": _foxess_amount(grid_info.get("gridConsumptionPower"), target_unit="W"),
            "grid_status": grid_info.get("status"),
            "feedin_power": _foxess_amount(grid_info.get("feedinPower"), target_unit="W"),
            "grid_consumption_power": _foxess_amount(grid_info.get("gridConsumptionPower"), target_unit="W"),
            "ac_power": _foxess_display_amount(grid_phase.get("power"), grid_units.get("power"), target_unit="W"),
            "Total_Feed_In": _foxess_amount(grid_info.get("feedinTotal"), target_unit="kWh"),
            "Feed_In_Today": _foxess_amount(grid_info.get("feedinDaily"), target_unit="kWh"),
            "Grid_Power_Consumption": _foxess_amount(grid_info.get("gridConsumptionTotal"), target_unit="kWh"),
            "Grid_Import_Today": _foxess_amount(grid_info.get("gridConsumptionDaily"), target_unit="kWh"),
            "grid_voltage": _foxess_display_amount(grid_phase.get("volt"), grid_units.get("volt"), target_unit="V"),
            "grid_current": _foxess_display_amount(grid_phase.get("current"), grid_units.get("current"), target_unit="A"),
            "grid_frequency": _foxess_display_amount(grid_phase.get("freq"), grid_units.get("freq"), target_unit="Hz"),
            "Total_House_Consumption": _foxess_amount(_nested(realtime, "load", "loadsTotal"), target_unit="kWh"),
            "eps_output_power": _foxess_amount(_nested(realtime, "load", "epsPower"), target_unit="W"),
            "raw_provider": {
                "plant": plant,
                "work_mode": work_mode,
                "last_energy": last_energy,
                "alarms": alarms,
                "green_energy": green_energy,
                "inverter_realtime": realtime,
                "battery_realtime": battery_realtime,
                "battery_units": battery_units,
                "battery_serials": [str(item.get("batteryId", "")).split("@")[-1] for item in battery_units if item.get("batteryId")],
                "battery_health": battery_health,
                "battery_expected_life": battery_life,
                "optional_telemetry_errors": telemetry_errors,
            },
        }
        # V2 realtime places its aggregate PV reading before MPPT 1-4. Older
        # captures with only four values already contain the MPPT rows.
        mppt_strings = pv_strings[1:7] if len(pv_strings) >= 7 else pv_strings[:6]
        for index, pv_string in enumerate(mppt_strings, start=1):
            if isinstance(pv_string, dict):
                data[f"pv_string_{index}_voltage"] = _foxess_display_amount(
                    pv_string.get("volt"), pv_units.get("volt"), target_unit="V"
                )
                data[f"pv_string_{index}_current"] = _foxess_display_amount(
                    pv_string.get("current"), pv_units.get("current"), target_unit="A"
                )
                data[f"pv_string_{index}_power"] = _foxess_display_amount(
                    pv_string.get("power"), pv_units.get("power"), target_unit="W"
                )
        if battery_units:
            def _unit_number(item, key):
                return _foxess_amount(item.get(key), target_unit="W")
            capacity_values = [_foxess_energy_amount(item.get("capacity")) for item in battery_units]
            soc_values = [_foxess_amount(item.get("soc"), target_unit="%") for item in battery_units]
            valid_capacity = [(cap, soc) for cap, soc in zip(capacity_values, soc_values) if cap is not None and soc is not None]
            total_capacity = sum(cap for cap, _ in valid_capacity)
            if total_capacity:
                data["battery_aggregate_soc"] = sum(cap * soc for cap, soc in valid_capacity) / total_capacity
            data["battery_count"] = len(battery_units)
            data["battery_total_capacity"] = sum(value for value in capacity_values if value is not None)
            data["battery_total_charging_power"] = sum(_unit_number(item, "chargingPower") or 0 for item in battery_units)
            data["battery_total_discharging_power"] = sum(_unit_number(item, "dischargingPower") or 0 for item in battery_units)
            data["battery_max_temperature"] = max((_foxess_amount(item.get("temperature"), target_unit="°C") for item in battery_units), default=None)
            data["battery_serials"] = [str(item.get("batteryId", "")).split("@")[-1] for item in battery_units if item.get("batteryId")]
            for battery_index, unit in enumerate(battery_units[:4], start=1):
                serial = str(unit.get("batteryId", "")).split("@")[-1]
                data[f"battery_{battery_index}_serial"] = serial or None
                data[f"battery_{battery_index}_soc"] = _foxess_amount(unit.get("soc"), target_unit="%")
                data[f"battery_{battery_index}_voltage"] = _foxess_amount(unit.get("volt"), target_unit="V")
                data[f"battery_{battery_index}_current"] = _foxess_amount(unit.get("current"), target_unit="A")
                data[f"battery_{battery_index}_temperature"] = _foxess_amount(unit.get("temperature"), target_unit="°C")
                data[f"battery_{battery_index}_charging_power"] = _foxess_amount(unit.get("chargingPower"), target_unit="W")
                data[f"battery_{battery_index}_discharging_power"] = _foxess_amount(unit.get("dischargingPower"), target_unit="W")
                data[f"battery_{battery_index}_capacity"] = _foxess_energy_amount(unit.get("capacity"))
        return {key: value for key, value in data.items() if value is not None}


def _is_inverter_device(device: Any) -> bool:
    """Accept FoxESS' category and display-category variants for an inverter."""
    if not isinstance(device, dict) or not isinstance(device.get("id"), str):
        return False
    labels = (device.get("category"), device.get("categoryStr"))
    return any(
        str(label).strip().casefold() in {"device", "inverter"}
        for label in labels
        if label is not None
    )


def _history_day(value: str | dict[str, Any]) -> calendar_date:
    """Normalize a FoxESS history date from ISO text or provider date parts."""
    try:
        if isinstance(value, str):
            return calendar_date.fromisoformat(value[:10])
        if isinstance(value, dict):
            return calendar_date(int(value["year"]), int(value["month"]), int(value["day"]))
    except (TypeError, ValueError, KeyError):
        pass
    raise FoxESSV2Error("Invalid FoxESS history date")

def _nested(value: Any, *keys: str) -> Any:
    for key in keys:
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value


def _foxess_amount(value: Any, *, target_unit: str) -> float | None:
    if not isinstance(value, dict):
        return None
    try:
        amount = float(value.get("value"))
    except (TypeError, ValueError):
        return None
    unit = str(value.get("unit") or "").strip().lower()
    target = target_unit.lower()
    if target == "w" and unit == "kw":
        return amount * 1000
    if target == "kw" and unit == "w":
        return amount / 1000
    if target == "kwh" and unit == "wh":
        return amount / 1000
    if target == "wh" and unit == "kwh":
        return amount * 1000
    if target == "tons" and unit == "kg":
        return amount / 1000
    return amount


def _foxess_energy_amount(value: Any) -> float | None:
    """Return an energy value only when FoxESS supplies an energy unit."""
    if not isinstance(value, dict):
        return None
    unit = str(value.get("unit") or "").strip().lower()
    if unit not in {"wh", "kwh"}:
        return None
    return _foxess_amount(value, target_unit="kWh")

def _foxess_display_amount(value: Any, unit: Any, *, target_unit: str) -> float | None:
    """Normalize either captured value objects or V2 display strings."""
    if isinstance(value, dict):
        return _foxess_amount(value, target_unit=target_unit)
    return _foxess_amount({"value": value, "unit": unit}, target_unit=target_unit)


def _foxess_number(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


async def async_create_foxess_v2_client(hass, username, password, wasm_path=None):
    """HA bridge: shared HTTP, configured timezone, and executor-only WASM setup.

    Raises a sanitized FoxESSV2Error on setup failure. The integration's owning
    config flow/coordinator must handle it as a connection/setup failure.
    Creating the client itself makes no cloud requests.
    """
    try:
        wasm_asset = Path(wasm_path or hass.config.path("heros", "foxess", "signature.wasm"))
        wasm_asset.parent.mkdir(parents=True, exist_ok=True)
        if not wasm_asset.is_file():
            raise FoxESSV2Error("FoxESS V2 signer file is missing")
        # Install only for this opt-in transport, so ByteWatt setup does not
        # acquire a native WASM dependency on unsupported host architectures.
        from homeassistant.requirements import async_process_requirements
        await async_process_requirements(hass, "heros", [WASM_REQUIREMENT])
        signer = await hass.async_add_executor_job(FoxESSV2Signer, str(wasm_asset))
        from homeassistant.helpers.aiohttp_client import async_get_clientsession
        return FoxESSV2Client(FoxESSV2Session(async_get_clientsession(hass), signer,
            username, password, timezone=hass.config.time_zone))
    except FoxESSV2Error:
        raise
    except Exception:
        raise FoxESSV2Error("FoxESS V2 client setup failed") from None
