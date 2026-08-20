"""Stateless transport for battery + grid feed-in settings.

Endpoints, payload construction, retries, and 6069 re-login live here.
Caching, pending-diff bookkeeping, and validation live in SettingsManager.
"""
from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Optional

from ..models import CycleStrategy, GridFeedInSettings

if TYPE_CHECKING:
    from .neovolt_client import NeovoltClient

_LOGGER = logging.getLogger(__name__)

# Retry parameters — applied uniformly to GET/PUT/POST
DEFAULT_RETRIES = 3
DEFAULT_RETRY_DELAY = 1.0


async def _with_relogin(api_client: "NeovoltClient", op):
    """Run op (a no-arg async callable returning a response dict),
    re-login once and retry if the server returns session-expiry code 6069."""
    response = await op()
    if response and response.get("code") == 6069:
        _LOGGER.warning("Session expired (code 6069), re-logging in")
        if await api_client.async_login():
            response = await op()
    return response


class BatterySettingsAPI:
    """Stateless transport for getCycleStrategy / setCycleStrategy."""

    GET_ENDPOINT = "api/iterate/sysSet/getCycleStrategy?id="
    PUT_ENDPOINT = "api/iterate/sysSet/setCycleStrategy"
    FORCE_CHARGE_ENDPOINT = "api/iterate/sysSet/forceCharge"
    STOP_CHARGE_ENDPOINT = "api/iterate/sysSet/stopCharge"
    CHARGE_PROMPT_ENDPOINT = "api/iterate/sysSet/customerSetChargePrompt"
    FORCE_CHARGE_STATUS_ENDPOINT = "api/iterate/sysSet/getForceChargeStatus?id="
    FORCE_CHARGE_LIMIT_ENDPOINT = "api/iterate/sysSet/getForceChargeLimit?id="

    def __init__(self, api_client: "NeovoltClient") -> None:
        self._client = api_client

    def _host_id(self) -> str:
        """Return the configured host systemId, or empty for single-inverter installs.

        The provider API tolerates ``id=`` (empty) for accounts with one
        inverter — confirmed against HAR captures. For multi-inverter
        accounts the behaviour is undefined; we warn ONCE per process so
        operators see the signal in the log without spamming it on every
        poll. The repair-issue flow surfaces the same prompt in the UI.
        """
        host_id = getattr(self._client, "host_system_id", "") or ""
        if not host_id and not getattr(self._client, "_warned_empty_host_id", False):
            _LOGGER.warning(
                "Battery settings requests are using an empty host_system_id. "
                "This is safe for single-inverter accounts but ambiguous for "
                "multi-inverter accounts — open Settings → Devices & Services "
                "→ Home Energy Manager → Reconfigure to pick the Host inverter explicitly."
            )
            self._client._warned_empty_host_id = True
        return host_id

    async def fetch_current_settings(
        self,
        max_retries: int = DEFAULT_RETRIES,
        retry_delay: float = DEFAULT_RETRY_DELAY,
    ) -> Optional[CycleStrategy]:
        endpoint = f"{self.GET_ENDPOINT}{self._host_id()}"
        for attempt in range(max_retries):
            response = await _with_relogin(self._client, lambda: self._client._async_get(endpoint))
            if response and response.get("code") == 200 and "data" in response:
                settings = CycleStrategy.from_api_response(response["data"])
                settings.host_system_id = self._host_id()
                _LOGGER.debug(
                    "Fetched cycle strategy (id=%s): batUseCap=%.0f%%, "
                    "%d charge slot(s), %d discharge slot(s)",
                    self._host_id(),
                    settings.bat_use_cap,
                    len(settings.charge_slots),
                    len(settings.discharge_slots),
                )
                return settings
            _LOGGER.debug(
                "Cycle strategy fetch attempt %d/%d returned: %s",
                attempt + 1, max_retries, response,
            )
            if attempt < max_retries - 1:
                await asyncio.sleep(retry_delay)
        return None

    async def put(
        self,
        settings: CycleStrategy,
        max_retries: int = DEFAULT_RETRIES,
        retry_delay: float = DEFAULT_RETRY_DELAY,
    ) -> bool:
        payload = settings.to_dict()
        payload["id"] = self._host_id()
        for attempt in range(max_retries):
            response = await _with_relogin(
                self._client, lambda: self._client._async_put(self.PUT_ENDPOINT, payload)
            )
            if response and response.get("code") == 200 and response.get("msg") == "Success":
                return True
            # Code 9007 is a transient server-side network exception; retry with backoff
            if response and response.get("code") == 9007:
                _LOGGER.warning(
                    "setCycleStrategy transient error 9007 (attempt %d/%d), retrying",
                    attempt + 1, max_retries,
                )
            else:
                _LOGGER.debug(
                    "setCycleStrategy attempt %d/%d returned: %s",
                    attempt + 1, max_retries, response,
                )
            if attempt < max_retries - 1:
                await asyncio.sleep(retry_delay)
        return False

    async def get_force_charge_status(
        self,
        max_retries: int = DEFAULT_RETRIES,
        retry_delay: float = DEFAULT_RETRY_DELAY,
    ) -> Optional[bool]:
        endpoint = f"{self.FORCE_CHARGE_STATUS_ENDPOINT}{self._host_id()}"
        for attempt in range(max_retries):
            response = await _with_relogin(self._client, lambda: self._client._async_get(endpoint))
            if response and response.get("code") == 200 and "data" in response:
                return bool(response.get("data"))
            _LOGGER.debug(
                "Force charge status fetch attempt %d/%d returned: %s",
                attempt + 1, max_retries, response,
            )
            if attempt < max_retries - 1:
                await asyncio.sleep(retry_delay)
        return None

    async def get_force_charge_limit(
        self,
        max_retries: int = DEFAULT_RETRIES,
        retry_delay: float = DEFAULT_RETRY_DELAY,
    ) -> Optional[float]:
        endpoint = f"{self.FORCE_CHARGE_LIMIT_ENDPOINT}{self._host_id()}"
        for attempt in range(max_retries):
            response = await _with_relogin(self._client, lambda: self._client._async_get(endpoint))
            if response and response.get("code") == 200 and "data" in response:
                try:
                    return float(response.get("data"))
                except (TypeError, ValueError):
                    _LOGGER.debug("Force charge limit was not numeric: %s", response)
                    return None
            _LOGGER.debug(
                "Force charge limit fetch attempt %d/%d returned: %s",
                attempt + 1, max_retries, response,
            )
            if attempt < max_retries - 1:
                await asyncio.sleep(retry_delay)
        return None

    async def force_charge_result(
        self,
        battery_limit: int = 100,
        max_retries: int = DEFAULT_RETRIES,
        retry_delay: float = DEFAULT_RETRY_DELAY,
    ) -> dict[str, object]:
        host_id = self._host_id()
        payload = {
            "id": host_id,
            "batUseCap": int(battery_limit),
        }
        prompt_response = None
        if not host_id:
            prompt_endpoint = f"{self.CHARGE_PROMPT_ENDPOINT}?type=0&batUseCap={int(battery_limit)}"
            prompt_response = await _with_relogin(
                self._client, lambda: self._client._async_get(prompt_endpoint)
            )
        for attempt in range(max_retries):
            response = await _with_relogin(
                self._client, lambda: self._client._async_put(self.FORCE_CHARGE_ENDPOINT, payload)
            )
            if response and response.get("code") == 200:
                return {
                    "ok": True,
                    "message": self._force_charge_message(payload, response),
                    "data": response.get("data"),
                    "payload": payload,
                    "prompt_response": prompt_response,
                    "response": response,
                }
            _LOGGER.debug(
                "forceCharge attempt %d/%d returned: %s",
                attempt + 1, max_retries, response,
            )
            if attempt < max_retries - 1:
                await asyncio.sleep(retry_delay)
        return {
            "ok": False,
            "message": self._force_charge_message(payload, response),
            "data": (response or {}).get("data"),
            "payload": payload,
            "prompt_response": prompt_response,
            "response": response,
        }

    def _force_charge_message(self, payload: dict[str, object], response: dict[str, object] | None) -> str:
        target = str(payload.get("id") or "")
        target_label = 'all batteries (id="")' if not target else f"battery id {target}"
        cap = payload.get("batUseCap")
        code = (response or {}).get("code")
        msg = str((response or {}).get("msg") or (response or {}).get("expMsg") or "Force charge request failed")
        data = (response or {}).get("data")
        data_text = f", data={data}" if data is not None else ""
        return f"Sent forceCharge to {target_label} with batUseCap={cap}. Response code={code}, msg={msg}{data_text}."

    async def force_charge(
        self,
        battery_limit: int = 100,
        max_retries: int = DEFAULT_RETRIES,
        retry_delay: float = DEFAULT_RETRY_DELAY,
    ) -> bool:
        result = await self.force_charge_result(
            battery_limit=battery_limit,
            max_retries=max_retries,
            retry_delay=retry_delay,
        )
        return bool(result.get("ok"))

    async def stop_charge_result(
        self,
        max_retries: int = DEFAULT_RETRIES,
        retry_delay: float = DEFAULT_RETRY_DELAY,
    ) -> dict[str, object]:
        host_id = self._host_id()
        payload = {"id": host_id}
        prompt_response = None
        if not host_id:
            prompt_response = await _with_relogin(
                self._client, lambda: self._client._async_get(f"{self.CHARGE_PROMPT_ENDPOINT}?type=2")
            )
        for attempt in range(max_retries):
            response = await _with_relogin(
                self._client, lambda: self._client._async_put(self.STOP_CHARGE_ENDPOINT, payload)
            )
            if response and response.get("code") == 200:
                return {
                    "ok": True,
                    "message": self._stop_charge_message(payload, response),
                    "data": response.get("data"),
                    "payload": payload,
                    "prompt_response": prompt_response,
                    "response": response,
                }
            _LOGGER.debug(
                "stopCharge attempt %d/%d returned: %s",
                attempt + 1, max_retries, response,
            )
            if attempt < max_retries - 1:
                await asyncio.sleep(retry_delay)
        return {
            "ok": False,
            "message": self._stop_charge_message(payload, response),
            "data": (response or {}).get("data"),
            "payload": payload,
            "prompt_response": prompt_response,
            "response": response,
        }

    def _stop_charge_message(self, payload: dict[str, object], response: dict[str, object] | None) -> str:
        target = str(payload.get("id") or "")
        target_label = 'all batteries (id="")' if not target else f"battery id {target}"
        code = (response or {}).get("code")
        msg = str((response or {}).get("msg") or (response or {}).get("expMsg") or "Stop charge request failed")
        data = (response or {}).get("data")
        data_text = f", data={data}" if data is not None else ""
        return f"Sent stopCharge to {target_label}. Response code={code}, msg={msg}{data_text}."

    async def stop_charge(
        self,
        max_retries: int = DEFAULT_RETRIES,
        retry_delay: float = DEFAULT_RETRY_DELAY,
    ) -> bool:
        result = await self.stop_charge_result(
            max_retries=max_retries,
            retry_delay=retry_delay,
        )
        return bool(result.get("ok"))


class GridFeedInSettingsAPI:
    """Stateless transport for getFeedStrategyList / saveFeedStrategy."""

    GET_ENDPOINT = "api/iterate/sysSet/getFeedStrategyList?id="
    POST_ENDPOINT = "api/iterate/sysSet/saveFeedStrategy"

    def __init__(self, api_client: "NeovoltClient") -> None:
        self._client = api_client

    def _host_id(self) -> str:
        return getattr(self._client, "host_system_id", "") or ""

    async def fetch_current_settings(
        self,
        max_retries: int = DEFAULT_RETRIES,
        retry_delay: float = DEFAULT_RETRY_DELAY,
    ) -> Optional[GridFeedInSettings]:
        host_id = self._host_id()
        if not host_id:
            _LOGGER.debug(
                "Skipping grid feed-in fetch — no host_system_id configured. "
                "Reconfigure the integration to select the Host inverter."
            )
            return None
        endpoint = f"{self.GET_ENDPOINT}{host_id}"
        for attempt in range(max_retries):
            response = await _with_relogin(self._client, lambda: self._client._async_get(endpoint))
            if response and response.get("code") == 200 and "data" in response:
                settings = GridFeedInSettings.from_api_response(response["data"], host_id)
                _LOGGER.debug(
                    "Fetched grid feed-in (id=%s): enabled=%s, %d slot(s)",
                    host_id, bool(settings.battery_en), len(settings.slots),
                )
                return settings
            _LOGGER.debug(
                "Grid feed-in fetch attempt %d/%d returned: %s",
                attempt + 1, max_retries, response,
            )
            if attempt < max_retries - 1:
                await asyncio.sleep(retry_delay)
        return None

    async def post(
        self,
        settings: GridFeedInSettings,
        max_retries: int = DEFAULT_RETRIES,
        retry_delay: float = DEFAULT_RETRY_DELAY,
    ) -> bool:
        payload = settings.to_dict()
        payload["id"] = self._host_id()
        for attempt in range(max_retries):
            response = await _with_relogin(
                self._client, lambda: self._client._async_post(self.POST_ENDPOINT, payload)
            )
            if response and response.get("code") == 200:
                return True
            if response and response.get("code") == 9007:
                _LOGGER.warning(
                    "saveFeedStrategy transient error 9007 (attempt %d/%d), retrying",
                    attempt + 1, max_retries,
                )
            else:
                _LOGGER.debug(
                    "saveFeedStrategy attempt %d/%d returned: %s",
                    attempt + 1, max_retries, response,
                )
            if attempt < max_retries - 1:
                await asyncio.sleep(retry_delay)
        return False
