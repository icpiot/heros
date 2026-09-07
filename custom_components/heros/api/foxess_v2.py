"""Read-only FoxESS Cloud V2 session and plant client, independent of HA entities."""
from __future__ import annotations

import asyncio
from datetime import date as calendar_date, datetime
import hashlib
import json as json_module
from pathlib import Path
import time
from typing import Any, Protocol
from urllib.parse import parse_qsl, urlsplit
from zoneinfo import ZoneInfo

from .foxess_v2_signer import FoxESSV2Signer, signing_path

BASE_URL = "https://www.foxesscloud.com"
LOGIN_PATH = "/foxess/biz/auth/login"
DEFAULT_POLL_INTERVAL = 300
WASM_REQUIREMENT = "wasmtime==48.0.0"
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
                 *, timezone: str, minimum_request_interval: float = 5.0,
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
        except Exception:
            raise FoxESSV2Error("FoxESS connection failed or returned invalid JSON") from None
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

    def __init__(self, session: FoxESSV2Session):
        self.session = session
        self._plant_ids = None

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


async def async_create_foxess_v2_client(hass, username, password, wasm_path):
    """HA bridge: shared HTTP, configured timezone, and executor-only WASM setup.

    Raises a sanitized FoxESSV2Error on setup failure. The integration's owning
    config flow/coordinator must handle it as a connection/setup failure.
    Creating the client itself makes no cloud requests.
    """
    try:
        wasm_asset = Path(wasm_path)
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
