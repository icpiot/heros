"""Data update coordinator for Byte-Watt integration."""
import asyncio
import json
import logging
import socket
import statistics
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, List, Optional, Set

import voluptuous as vol
from homeassistant.components.persistent_notification import async_create, async_dismiss
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import (
    async_call_later,
    async_track_time_change,
    async_track_time_interval,
)
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from .api.settings import BatterySettingsAPI
from .bytewatt_client import ByteWattClient
from .const import (
    DOMAIN,
    CONF_HEARTBEAT_INTERVAL,
    CONF_MAX_DATA_AGE,
    CONF_STALE_CHECKS_THRESHOLD,
    CONF_NOTIFY_ON_RECOVERY,
    CONF_DIAGNOSTICS_MODE,
    CONF_AUTO_RECONNECT_TIME,
    DEFAULT_HEARTBEAT_INTERVAL,
    DEFAULT_MAX_DATA_AGE,
    DEFAULT_STALE_CHECKS_THRESHOLD,
    DEFAULT_NOTIFY_ON_RECOVERY,
    DEFAULT_DIAGNOSTICS_MODE,
    DEFAULT_AUTO_RECONNECT_TIME,
    MAX_DIAGNOSTIC_LOGS,
    RECENT_DATA_THRESHOLD,
    STALE_DATA_THRESHOLD,
    HTTPS_PORT,
    signal_policy_charge_changed,
)
from .policy_charge_store import PolicyChargeScheduleStore
from .pricing_store import PricingScheduleStore
from .topology import DiscoveredInverter
from .utilities.circuit_breaker import CircuitBreaker, CircuitBreakerState
from .utilities.connection_stats import ConnectionStatistics
from .utilities.diagnostic_service import DiagnosticService

_LOGGER = logging.getLogger(__name__)

# Notification IDs
NOTIFICATION_RECOVERY = "bytewatt_recovery"
NOTIFICATION_ERROR = "bytewatt_error"
NOTIFICATION_POLICY_CHARGE = "home_energy_manager_policy_charge"
INVERTER_REDISCOVERY_INTERVAL = timedelta(minutes=15)


def _float_or_none(value: Any) -> float | None:
    """Return a float for API numeric values, or None when unavailable."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


class ByteWattDataUpdateCoordinator(DataUpdateCoordinator):
    """Class to manage fetching Byte-Watt data with improved error handling and recovery."""

    def __init__(
        self,
        hass: HomeAssistant,
        client: ByteWattClient,
        scan_interval: int,
        entry_id: str,
        options: Dict[str, Any] = None,
    ):
        """Initialize."""
        self.client = client
        self.hass = hass
        self.entry_id = entry_id
        self._last_battery_data = None
        self._selected_battery_data: dict[str, Any] | None = None
        self._live_battery_power: list[dict[str, Any]] = []
        self._scan_interval = scan_interval
        self._last_successful_update: Optional[datetime] = None
        self._consecutive_stale_checks = 0
        self._recovery_in_progress = False
        self._heartbeat_unsub = None
        self._recovery_attempts = 0
        self._auto_reconnect_unsub = None
        # async_call_later unsubscribe for the post-failure recovery retry.
        # Tracked so we can cancel it on entry unload — otherwise the
        # callback would fire on a torn-down coordinator.
        self._recovery_retry_unsub = None
        self._last_inverter_rediscovery_attempt: Optional[datetime] = None


        # Connection health tracking
        self.circuit_breaker = CircuitBreaker()
        
        # Diagnostic service
        self.diagnostic_service = DiagnosticService()
        
        # Load options
        options = options or {}
        self._heartbeat_interval = options.get(CONF_HEARTBEAT_INTERVAL, DEFAULT_HEARTBEAT_INTERVAL)
        self._max_data_age = options.get(CONF_MAX_DATA_AGE, DEFAULT_MAX_DATA_AGE)
        self._stale_checks_threshold = options.get(CONF_STALE_CHECKS_THRESHOLD, DEFAULT_STALE_CHECKS_THRESHOLD)
        self._notify_on_recovery = options.get(CONF_NOTIFY_ON_RECOVERY, DEFAULT_NOTIFY_ON_RECOVERY)
        self._diagnostics_mode = options.get(CONF_DIAGNOSTICS_MODE, DEFAULT_DIAGNOSTICS_MODE)
        self._auto_reconnect_time = options.get(CONF_AUTO_RECONNECT_TIME, DEFAULT_AUTO_RECONNECT_TIME)
        
        if self._diagnostics_mode:
            self.diagnostic_service.enable_diagnostics()

        super().__init__(
            hass,
            _LOGGER,
            name="bytewatt",
            update_interval=timedelta(seconds=scan_interval),
        )

    
    @contextmanager
    def _timed_operation(self, operation_name: str):
        """Context manager for timing operations + recording to the circuit breaker.

        Circuit-breaker stats are recorded ALWAYS — previously they were gated
        behind diagnostics_mode, which meant default installs never tracked
        failure rates and the circuit never opened. With that gating in place
        the entire recovery path was effectively a no-op.
        """
        start_time = time.time()
        error = None

        try:
            yield
        except Exception as e:
            error = e
            raise
        finally:
            duration = time.time() - start_time

            # Always record to the circuit breaker so it can actually trip.
            if error:
                self.circuit_breaker.record_failure(
                    type(error).__name__, str(error)
                )
            else:
                self.circuit_breaker.record_success(duration)

            # Verbose per-operation diagnostics are still opt-in.
            if self.diagnostic_service.diagnostics_enabled:
                details = {
                    "operation": operation_name,
                    "duration": f"{duration:.3f}s",
                    "success": error is None,
                }
                if error:
                    details["error"] = str(error)
                    details["error_type"] = type(error).__name__
                self.diagnostic_service.log_diagnostic("operation", details)
    
    async def _async_update_data(self):
        """Update data via library with improved error handling."""
        try:
            # Store current time as timezone-aware datetime for reuse
            current_time = dt_util.utcnow()
            # Check if circuit breaker allows execution
            if not self.circuit_breaker.can_execute():
                _LOGGER.warning(
                    f"Circuit breaker is {self.circuit_breaker.state.value}, using cached data"
                )
                self.diagnostic_service.log_diagnostic("circuit_breaker_blocked", {
                    "state": self.circuit_breaker.state.value,
                    "stats": self.circuit_breaker.get_status_report()
                })
                
                # Use cached data if available
                if self._last_battery_data:
                    return {
                        "battery": self._last_battery_data,
                        "selected_battery": self._selected_battery_data or {},
                        "live_battery_power": self.live_battery_power_summary,
                        "connection_status": "limited",
                        "circuit_breaker": self.circuit_breaker.state.value
                    }
                else:
                    raise UpdateFailed(
                        f"Circuit breaker is {self.circuit_breaker.state.value} and no cached data available"
                    )
            
            # Get battery data
            with self._timed_operation("get_battery_data"):
                battery_data = await self.client.get_battery_data()
            await self._refresh_inverter_inventory_if_needed()
            await self._refresh_live_battery_power()
            selected_battery_data = await self._refresh_selected_battery_data()
            
            # Refresh battery + grid feed-in settings via the manager.
            # The manager owns its lock so concurrent submit() / refresh() are serialized,
            # and per-batch failures are swallowed there — don't fail the poll on them.
            manager = self.hass.data.get(DOMAIN, {}).get(self.entry_id, {}).get("manager")
            if manager is not None:
                await manager.refresh()
                await self._run_policy_charge_schedule(manager)
            
            # If we got battery data, update our cached version and last successful time
            if battery_data:
                self._last_battery_data = battery_data
                self._selected_battery_data = selected_battery_data
                self._last_successful_update = current_time
                self._consecutive_stale_checks = 0
                self._recovery_attempts = 0  # Reset recovery attempts on successful update
                
                self.diagnostic_service.log_diagnostic("data_update", {
                    "type": "battery_data",
                    "result": "success"
                })
            elif self._last_battery_data is None:
                # Only raise error if we never got data
                error_msg = "Failed to get battery data and no cached data available"
                self.diagnostic_service.log_diagnostic("data_update", {
                    "type": "battery_data",
                    "result": "failure",
                    "error": error_msg
                })
                raise UpdateFailed(error_msg)
            else:
                _LOGGER.warning("Using cached battery data due to API error")
                self.diagnostic_service.log_diagnostic("data_update", {
                    "type": "battery_data",
                    "result": "fallback_to_cache"
                })
            
            # If we got here successfully, ensure any error notifications are dismissed
            if self._notify_on_recovery:
                async_dismiss(self.hass, NOTIFICATION_ERROR)
            
            # Return the data along with connection status
            data = {
                "battery": self._last_battery_data or {},
                "selected_battery": self._selected_battery_data or {},
                "live_battery_power": self.live_battery_power_summary,
                "connection_status": "connected" if battery_data else "partial",
                "circuit_breaker": self.circuit_breaker.state.value,
                "last_updated": current_time.isoformat()
            }
            
            _LOGGER.debug(f"Coordinator data refreshed with keys: {list(data.keys())}")
            return data
        except Exception as err:
            # Record the error in diagnostics
            self.diagnostic_service.log_diagnostic("update_error", {
                "error_type": type(err).__name__,
                "error_message": str(err)
            })
            
            # If we have cached data, use it rather than failing
            if self._last_battery_data:
                _LOGGER.error(f"Error communicating with API: {err}")
                _LOGGER.warning("Using cached data due to communication error")
                
                # Update cache freshness status
                cache_age = "unknown"
                if self._last_successful_update:
                    age_seconds = (current_time - self._last_successful_update).total_seconds()
                    if age_seconds < RECENT_DATA_THRESHOLD:
                        cache_age = "fresh"
                    elif age_seconds < STALE_DATA_THRESHOLD:
                        cache_age = "recent"
                    else:
                        cache_age = "stale"
                
                return {
                    "battery": self._last_battery_data,
                    "selected_battery": self._selected_battery_data or {},
                    "live_battery_power": self.live_battery_power_summary,
                    "connection_status": "cached",
                    "cache_age": cache_age,
                    "circuit_breaker": self.circuit_breaker.state.value,
                    "last_updated": self._last_successful_update.isoformat() if self._last_successful_update else "unknown"
                }
            else:
                if self._notify_on_recovery:
                    async_create(
                        self.hass,
                        f"ByteWatt integration error: {err}",
                        title="ByteWatt Connection Error",
                        notification_id=NOTIFICATION_ERROR,
                    )

                raise UpdateFailed(f"Error communicating with API: {err}")

    async def _refresh_selected_battery_data(self) -> dict[str, Any]:
        """Fetch the direct API payload for the currently selected battery scope."""
        entry_data = self.hass.data.get(DOMAIN, {}).get(self.entry_id, {})
        manager = entry_data.get("manager")
        selected_sys_sn = str(getattr(manager, "current_settings_target_sys_sn", "") or "").strip()
        if not selected_sys_sn or selected_sys_sn.lower() == "all":
            return {}
        try:
            return await self.client.get_battery_data(sys_sn=selected_sys_sn)
        except Exception as err:  # noqa: BLE001
            _LOGGER.debug("Unable to fetch selected battery data for %s: %s", selected_sys_sn, err)
            return self._selected_battery_data or {}

    async def _refresh_inverter_inventory_if_needed(self) -> None:
        """Retry provider inventory discovery when the cached list looks incomplete.

        Some installs start with only one discovered inverter even though the
        account exposes more battery systems. That leaves the shared battery
        selector stuck on `All systems`, because live per-battery polling only
        iterates the discovered inventory. This helper periodically retries the
        account inventory endpoints and merges in any newly discovered systems.
        """
        entry_data = self.hass.data.get(DOMAIN, {}).get(self.entry_id, {})
        current_inventory = entry_data.get("inverters") or []
        if len(current_inventory) > 1:
            return

        now = dt_util.utcnow()
        last_attempt = self._last_inverter_rediscovery_attempt
        if last_attempt and (now - last_attempt) < INVERTER_REDISCOVERY_INTERVAL:
            return
        self._last_inverter_rediscovery_attempt = now

        try:
            raw_inverters = await self.client.fetch_inverter_list()
        except Exception as err:  # noqa: BLE001
            _LOGGER.debug("Unable to re-discover inverter inventory for %s: %s", self.entry_id, err)
            return

        if not raw_inverters:
            return

        merged: dict[tuple[str, str], DiscoveredInverter] = {}
        for inverter in current_inventory:
            if not isinstance(inverter, DiscoveredInverter):
                continue
            key = (
                str(inverter.system_id or "").strip(),
                str(inverter.sys_sn or "").strip(),
            )
            merged[key] = inverter

        for record in raw_inverters:
            inverter = DiscoveredInverter.from_api_response(record)
            key = (
                str(inverter.system_id or "").strip(),
                str(inverter.sys_sn or "").strip(),
            )
            merged[key] = inverter

        if len(merged) <= len(current_inventory):
            return

        entry_data["inverters"] = list(merged.values())
        _LOGGER.info(
            "Expanded inverter inventory for %s from %d to %d record(s)",
            self.entry_id,
            len(current_inventory),
            len(merged),
        )

    async def _refresh_live_battery_power(self) -> None:
        """Poll each discovered inverter for live pbat values.

        ByteWatt's aggregate view can hide per-battery flow, so this keeps a
        compact live summary for the policy page and control-state decisions.
        """
        entry_data = self.hass.data.get(DOMAIN, {}).get(self.entry_id, {})
        inverters = entry_data.get("inverters") or []
        readings: list[dict[str, Any]] = []
        seen_sys_sns: set[str] = set()
        for inverter in inverters:
            sys_sn = str(getattr(inverter, "sys_sn", "") or "").strip()
            if not sys_sn or sys_sn.lower() == "all" or sys_sn in seen_sys_sns:
                continue
            seen_sys_sns.add(sys_sn)
            try:
                live_data = await self.client.get_battery_data(
                    sys_sn=sys_sn,
                    include_statistics=False,
                )
            except Exception as err:  # noqa: BLE001
                _LOGGER.debug("Unable to fetch live battery power for %s: %s", sys_sn, err)
                continue
            pbat = _float_or_none(live_data.get("pbat"))
            charge_rate_w = abs(pbat) if pbat is not None and pbat < 0 else 0.0
            discharge_rate_w = pbat if pbat is not None and pbat > 0 else 0.0
            readings.append(
                {
                    "label": str(getattr(inverter, "display_name", "") or sys_sn),
                    "system_id": str(getattr(inverter, "system_id", "") or ""),
                    "sys_sn": sys_sn,
                    "soc": _float_or_none(live_data.get("soc")),
                    "pbat": pbat,
                    "charge_rate_w": charge_rate_w,
                    "discharge_rate_w": discharge_rate_w,
                    "load_w": _float_or_none(live_data.get("pload")),
                    "grid_w": _float_or_none(live_data.get("pgrid")),
                    "solar_w": _float_or_none(live_data.get("ppv")),
                    "ppv1": _float_or_none(live_data.get("ppv1")),
                    "ppv2": _float_or_none(live_data.get("ppv2")),
                    "ppv3": _float_or_none(live_data.get("ppv3")),
                    "ppv4": _float_or_none(live_data.get("ppv4")),
                    "power_source": live_data.get("powerSource"),
                    "force_charge_mode": live_data.get("forceChargeMode"),
                }
            )
        self._live_battery_power = readings

    @property
    def live_battery_power_summary(self) -> dict[str, Any]:
        batteries = list(self._live_battery_power)
        charging_count = sum(
            1
            for battery in batteries
            if (battery.get("charge_rate_w") or 0) > 0 or battery.get("force_charge_mode") is True
        )
        return {
            "batteries": batteries,
            "total_charge_rate_w": sum(float(battery.get("charge_rate_w") or 0) for battery in batteries),
            "total_discharge_rate_w": sum(float(battery.get("discharge_rate_w") or 0) for battery in batteries),
            "any_charging": charging_count > 0,
            "partial_charging": 0 < charging_count < len(batteries),
        }

    async def _run_policy_charge_schedule(self, manager) -> None:
        """Evaluate the shared charge policy for the currently selected target scope.

        The current monitoring client only exposes reliable live SOC for the active
        selected target/all-systems view, so this runner intentionally executes the
        schedule for that active scope rather than pretending to enforce every saved
        scope with missing data.
        """
        entry_data = self.hass.data.get(DOMAIN, {}).get(self.entry_id, {})
        policy_store = entry_data.get("policy_charge_store") or PolicyChargeScheduleStore(self.hass, self.entry_id)
        pricing_store = entry_data.get("pricing_store") or PricingScheduleStore(self.hass, self.entry_id)
        scope = entry_data.get("settings_scope")
        if scope is not None and getattr(scope, "aggregate", False):
            scope_key = "all"
        elif scope is not None:
            scope_key = str(getattr(scope, "effective_system_id", "") or getattr(scope, "system_id", "") or getattr(scope, "sys_sn", "") or "all").strip() or "all"
        else:
            scope_key = str(manager.current_settings_target_id or manager.current_settings_target_sys_sn or "all").strip() or "all"
        schedule_set = await policy_store.async_schedule_set()
        schedule = schedule_set.scope(scope_key)
        if schedule is None and len(schedule_set.schedules) == 1:
            schedule = schedule_set.schedules[0]
        if schedule is None or not schedule.policy_enabled:
            return

        holiday_set = set()
        try:
            pricing_schedule = await pricing_store.async_schedule()
            holiday_set = {item.isoformat() for item in pricing_schedule.holiday_dates}
        except Exception as err:  # noqa: BLE001
            _LOGGER.debug("Unable to load pricing holidays for policy charge: %s", err)

        battery_data = self._last_battery_data or {}
        soc_value = battery_data.get("soc")
        try:
            soc = float(soc_value) if soc_value is not None else None
        except (TypeError, ValueError):
            soc = None

        now_local = dt_util.now()
        active_row = schedule.active_row(now_local, soc=soc, holiday_dates=holiday_set)
        manual_stop_holds_window = self._policy_charge_manual_stop_holds_window(schedule, now_local, holiday_set)

        original_system_id = getattr(manager._client, "host_system_id", "") or ""  # noqa: SLF001
        original_sys_sn = getattr(manager._client, "host_sys_sn", "") or ""  # noqa: SLF001
        manager._client.host_system_id = schedule.system_id  # noqa: SLF001
        manager._client.host_sys_sn = "" if schedule.scope_key == "all" else schedule.sys_sn  # noqa: SLF001
        try:
            await self._ensure_bytewatt_schedule_disabled(schedule.system_id, manager)
            api = BatterySettingsAPI(manager._client)  # noqa: SLF001
            force_charge_active = await api.get_force_charge_status(max_retries=1, retry_delay=0)
            if force_charge_active is not None:
                manager._force_charge_active = force_charge_active  # noqa: SLF001
            if active_row is not None and not force_charge_active and not manual_stop_holds_window:
                result = await manager.start_force_charge_with_feedback(
                    active_row.cutoff_soc,
                    allow_aggregate_fallback=schedule.scope_key == "all",
                )
                started = bool(result.get("ok"))
                feedback_message = (
                    f"HEROS schedule started charging: {active_row.label} "
                    f"({active_row.start_time}-{active_row.end_time}, SOC {active_row.cutoff_soc}%)."
                    if started
                    else str(result.get("message") or "HEROS schedule charge start failed")
                )
                await policy_store.async_record_feedback(
                    scope_key=schedule.scope_key,
                    action="scheduler_start_force_charge",
                    ok=started,
                    message=feedback_message,
                    charging_now=started,
                )
                if started:
                    async_create(
                        self.hass,
                        feedback_message,
                        title="HEROS Charge Schedule",
                        notification_id=NOTIFICATION_POLICY_CHARGE,
                    )
                async_dispatcher_send(self.hass, signal_policy_charge_changed(self.entry_id))
            elif active_row is not None and not force_charge_active and manual_stop_holds_window:
                await policy_store.async_record_feedback(
                    scope_key=schedule.scope_key,
                    action="scheduler_manual_stop_hold",
                    ok=True,
                    message="HEROS schedule is active, but manual stop is holding charge off until the next schedule window.",
                    charging_now=False,
                )
                async_dispatcher_send(self.hass, signal_policy_charge_changed(self.entry_id))
            elif active_row is not None and force_charge_active:
                await policy_store.async_record_feedback(
                    scope_key=schedule.scope_key,
                    action="scheduler_force_charge_already_active",
                    ok=True,
                    message=(
                        f"HEROS schedule is active for {active_row.label}, and force charge is already active "
                        f"(SOC {soc if soc is not None else 'unknown'} / cutoff {active_row.cutoff_soc}%)."
                    ),
                    charging_now=True,
                )
                async_dispatcher_send(self.hass, signal_policy_charge_changed(self.entry_id))
            elif active_row is None and force_charge_active:
                result = await manager.stop_force_charge_with_feedback()
                await policy_store.async_record_feedback(
                    scope_key=schedule.scope_key,
                    action="scheduler_stop_force_charge",
                    ok=bool(result.get("ok")),
                    message=str(result.get("message") or "Scheduled charge stopped"),
                    charging_now=False if result.get("ok") else True,
                )
                async_dispatcher_send(self.hass, signal_policy_charge_changed(self.entry_id))
            elif active_row is None:
                await policy_store.async_record_feedback(
                    scope_key=schedule.scope_key,
                    action="scheduler_no_active_charge_row",
                    ok=True,
                    message=(
                        f"HEROS Charge Policy evaluated: no active row matched now "
                        f"(SOC {soc if soc is not None else 'unknown'})."
                    ),
                    charging_now=False,
                )
                async_dispatcher_send(self.hass, signal_policy_charge_changed(self.entry_id))
        finally:
            manager._client.host_system_id = original_system_id  # noqa: SLF001
            manager._client.host_sys_sn = original_sys_sn  # noqa: SLF001

    def _policy_charge_manual_stop_holds_window(self, schedule, now_local: datetime, holiday_set: set[str]) -> bool:
        """Avoid immediately restarting a HEROS scheduled charge after a manual stop."""
        if schedule.last_command_action != "stop_force_charge" or schedule.last_command_ok is not True:
            return False
        try:
            stopped_at = datetime.fromisoformat(str(schedule.last_command_at).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            return False
        if stopped_at.tzinfo is None:
            stopped_at = dt_util.as_local(stopped_at.replace(tzinfo=timezone.utc))
        else:
            stopped_at = dt_util.as_local(stopped_at)
        if stopped_at.date() != now_local.date():
            return False
        return any(
            row.matches(stopped_at, holiday_dates=holiday_set)
            and row.matches(now_local, holiday_dates=holiday_set)
            for row in schedule.rows
        )

    async def _ensure_bytewatt_schedule_disabled(self, system_id: str, manager) -> None:
        """Turn off provider-side charge/discharge cycles when HEROS owns the schedule."""
        api = BatterySettingsAPI(manager._client)  # noqa: SLF001
        current = await api.fetch_current_settings(max_retries=1, retry_delay=0)
        if current is None:
            return
        if int(current.grid_charge_cycle or 0) == 0 and int(current.ctr_dis_cycle or 0) == 0:
            return
        current.grid_charge_cycle = 0
        current.ctr_dis_cycle = 0
        await api.put(current, max_retries=1, retry_delay=0)
    
    async def start_heartbeat(self) -> None:
        """Start the heartbeat service to monitor and recover the integration."""
        if self._heartbeat_unsub is not None:
            self._heartbeat_unsub()
        
        self._heartbeat_unsub = async_track_time_interval(
            self.hass,
            self._async_heartbeat_check,
            timedelta(seconds=self._heartbeat_interval)
        )
        _LOGGER.debug("ByteWatt heartbeat monitoring started")
        
        # Also start auto-reconnect if configured
        await self.start_auto_reconnect()
        
        # Log this in diagnostics
        self.diagnostic_service.log_diagnostic("service_started", {
            "heartbeat_interval": self._heartbeat_interval,
            "auto_reconnect_time": self._auto_reconnect_time
        })
    
    async def start_auto_reconnect(self) -> None:
        """Schedule daily reconnection at the configured wall-clock time.

        Previously this fired every 24 h from startup regardless of the
        configured ``auto_reconnect_time``, so the setting was decorative.
        Uses ``async_track_time_change`` so the reconnect lands at a
        predictable hour (default 03:30 — outside peak monitoring hours
        and after the daily server-side stats rollover).
        """
        if self._auto_reconnect_unsub is not None:
            self._auto_reconnect_unsub()

        reconnect_time = dt_util.parse_time(self._auto_reconnect_time)
        if reconnect_time is None:
            _LOGGER.warning(
                "Invalid auto_reconnect_time %r, falling back to %s",
                self._auto_reconnect_time, DEFAULT_AUTO_RECONNECT_TIME,
            )
            reconnect_time = dt_util.parse_time(DEFAULT_AUTO_RECONNECT_TIME)

        self._auto_reconnect_unsub = async_track_time_change(
            self.hass,
            self._handle_auto_reconnect,
            hour=reconnect_time.hour,
            minute=reconnect_time.minute,
            second=reconnect_time.second,
        )
        _LOGGER.info(
            "Automatic reconnect scheduled daily at %02d:%02d:%02d local time",
            reconnect_time.hour, reconnect_time.minute, reconnect_time.second,
        )
    
    async def _handle_auto_reconnect(self, _now: Optional[datetime] = None) -> None:
        """Handle scheduled automatic reconnection."""
        current_time = dt_util.utcnow()
        _LOGGER.info(f"Executing scheduled auto reconnect at {current_time.strftime('%H:%M:%S')}")
        self.diagnostic_service.log_diagnostic("auto_reconnect", {
            "trigger": "scheduled",
            "time": current_time.isoformat()
        })
        
        await self._perform_recovery(is_scheduled=True)
    
    async def stop_heartbeat(self) -> None:
        """Cancel the heartbeat + auto-reconnect + retry timers."""
        if self._heartbeat_unsub is not None:
            self._heartbeat_unsub()
            self._heartbeat_unsub = None
            _LOGGER.debug("ByteWatt heartbeat monitoring stopped")
        if self._auto_reconnect_unsub is not None:
            self._auto_reconnect_unsub()
            self._auto_reconnect_unsub = None
        if self._recovery_retry_unsub is not None:
            self._recovery_retry_unsub()
            self._recovery_retry_unsub = None
    
    async def _async_heartbeat_check(self, _now: Optional[datetime] = None) -> None:
        """Check if the integration is still alive and recover if needed.

        Registered via async_track_time_interval, which awaits coroutine
        handlers — do NOT decorate with @callback (that marks it sync).
        """
        await self._check_and_recover(_now)
    
    async def _check_and_recover(self, _now: Optional[datetime] = None) -> None:
        """Internal method to check data freshness and recover if needed.

        The actual re-entrancy guard lives in _perform_recovery so all
        callers (heartbeat, auto-reconnect timer, force_reconnect service)
        are equally protected.
        """
        current_time = dt_util.utcnow()
        
        # Log heartbeat check in diagnostics
        self.diagnostic_service.log_diagnostic("heartbeat_check", {
            "timestamp": current_time.isoformat(),
            "last_update": self._last_successful_update.isoformat() if self._last_successful_update else "never"
        })
        
        # No successful update recorded yet
        if self._last_successful_update is None:
            _LOGGER.debug("No successful update recorded yet")
            # Try to trigger an update if we have no data yet
            if self._last_battery_data is None:
                await self._perform_recovery()
            return
        
        # Calculate age of data
        data_age = current_time - self._last_successful_update
        data_age_seconds = data_age.total_seconds()
        
        # Check if data is stale
        if data_age_seconds > self._max_data_age:
            self._consecutive_stale_checks += 1
            _LOGGER.warning(
                f"ByteWatt data is stale (age: {data_age_seconds:.1f}s). "
                f"Stale checks: {self._consecutive_stale_checks}/{self._stale_checks_threshold}"
            )
            
            self.diagnostic_service.log_diagnostic("stale_data", {
                "age_seconds": data_age_seconds,
                "consecutive_checks": self._consecutive_stale_checks,
                "threshold": self._stale_checks_threshold
            })
            
            # If we've reached the threshold, attempt recovery
            if self._consecutive_stale_checks >= self._stale_checks_threshold:
                await self._perform_recovery()
        else:
            # Data is fresh, reset counter
            if self._consecutive_stale_checks > 0:
                _LOGGER.debug("Data is fresh, resetting stale check counter")
                self.diagnostic_service.log_diagnostic("fresh_data", {
                    "age_seconds": data_age_seconds,
                    "reset_counter_from": self._consecutive_stale_checks
                })
                
            self._consecutive_stale_checks = 0
    
    async def _perform_recovery(self, is_scheduled: bool = False) -> None:
        """Perform recovery actions when data updates have stopped.

        Re-entrancy guard lives HERE (not just in _check_and_recover) because
        three call sites can invoke this directly: heartbeat-via-_check_and_
        recover, the 24 h auto-reconnect timer, and the force_reconnect service.
        Without an early return here, two concurrent recoveries could race
        client.initialize(), circuit_breaker.reset(), and async_refresh().

        Success is verified by checking that the refresh actually advanced
        _last_successful_update — without that, a refresh that fell back to
        cached data (UpdateFailed swallowed in _async_update_data) would
        spuriously report "successfully reconnected" to the user.
        """
        if self._recovery_in_progress:
            _LOGGER.debug("Recovery already in progress — skipping duplicate trigger")
            return
        self._recovery_in_progress = True
        self._recovery_attempts += 1

        recovery_type = "scheduled" if is_scheduled else "automatic"
        _LOGGER.warning(
            "Performing ByteWatt integration %s recovery (attempt %d)",
            recovery_type, self._recovery_attempts,
        )

        recovery_start_ts = dt_util.utcnow()
        last_update_before = self._last_successful_update
        self.diagnostic_service.log_diagnostic("recovery_attempt", {
            "attempt": self._recovery_attempts,
            "type": recovery_type,
            "timestamp": recovery_start_ts.isoformat(),
        })

        if self._notify_on_recovery:
            async_create(
                self.hass,
                f"ByteWatt integration is attempting to reconnect ({recovery_type} recovery)",
                title="ByteWatt Recovery",
                notification_id=NOTIFICATION_RECOVERY,
            )

        try:
            self.circuit_breaker.reset()

            if self.diagnostic_service.diagnostics_enabled:
                network_status = await self.hass.async_add_executor_job(self._check_network)
                self.diagnostic_service.log_diagnostic("network_check", network_status)

            with self._timed_operation("reset_client"):
                await self._reset_client()

            with self._timed_operation("refresh_data"):
                await self.async_refresh()

            # Did the refresh actually succeed, or did _async_update_data fall
            # back to cached data and swallow the failure?
            recovered = (
                self._last_successful_update is not None
                and (last_update_before is None
                     or self._last_successful_update > last_update_before)
            )
            if recovered:
                _LOGGER.info("ByteWatt integration recovery completed successfully")
                self.diagnostic_service.log_diagnostic("recovery_result", {
                    "success": True,
                    "timestamp": dt_util.utcnow().isoformat(),
                })
                if self._notify_on_recovery:
                    async_dismiss(self.hass, NOTIFICATION_RECOVERY)
                    async_create(
                        self.hass,
                        "ByteWatt integration successfully reconnected to the API",
                        title="ByteWatt Recovery Success",
                        notification_id=NOTIFICATION_RECOVERY,
                    )
            else:
                # Refresh "completed" without advancing last_successful_update
                # — the API is still broken. Surface as a failure.
                raise UpdateFailed(
                    "Recovery refresh did not advance last_successful_update "
                    "(API still returning errors or no data)"
                )
        except Exception as err:
            _LOGGER.error("ByteWatt recovery failed: %s", err)
            self.diagnostic_service.log_diagnostic("recovery_result", {
                "success": False,
                "error": str(err),
                "error_type": type(err).__name__,
                "timestamp": dt_util.utcnow().isoformat(),
            })

            backoff_factor = min(5, self._recovery_attempts)
            next_check_seconds = max(self._heartbeat_interval // backoff_factor, 30)
            _LOGGER.info("Will attempt recovery again in %ds", next_check_seconds)

            if self._notify_on_recovery:
                async_create(
                    self.hass,
                    f"ByteWatt recovery attempt failed: {err}. "
                    f"Will retry in {next_check_seconds} seconds.",
                    title="ByteWatt Recovery Failed",
                    notification_id=NOTIFICATION_RECOVERY,
                )

            # Schedule a sooner retry. Cancel any previous retry first so
            # back-to-back failures don't queue multiple callbacks, and
            # store the unsubscribe so unload can cancel it cleanly.
            if backoff_factor > 1:
                if self._recovery_retry_unsub is not None:
                    self._recovery_retry_unsub()
                self._recovery_retry_unsub = async_call_later(
                    self.hass,
                    next_check_seconds,
                    lambda _now: self.hass.async_create_task(
                        self._check_and_recover(None)
                    ),
                )
        finally:
            self._recovery_in_progress = False
    
    def _check_network(self) -> Dict[str, Any]:
        """Check network connectivity to ByteWatt API."""
        network_check_time = dt_util.utcnow()
        result = {
            "dns_check": {},
            "ping_check": {},
            "timestamp": network_check_time.isoformat()
        }
        
        # Extract domain from base_url
        domain = "monitor.byte-watt.com"
        if hasattr(self.client, 'api_client') and hasattr(self.client.api_client, 'base_url'):
            base_url = self.client.api_client.base_url
            domain = base_url.replace("https://", "").replace("http://", "").split("/")[0]
        
        # Check DNS resolution
        try:
            ip_address = socket.gethostbyname(domain)
            result["dns_check"] = {
                "success": True,
                "domain": domain,
                "ip_address": ip_address
            }
        except Exception as e:
            result["dns_check"] = {
                "success": False,
                "domain": domain,
                "error": str(e)
            }
        
        # Simple TCP connection test on HTTPS port
        try:
            start_time = time.time()
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(5)
            s.connect((domain, HTTPS_PORT))
            s.close()
            end_time = time.time()
            result["ping_check"] = {
                "success": True,
                "domain": domain,
                "port": HTTPS_PORT,
                "response_time": f"{(end_time - start_time) * 1000:.2f}ms"
            }
        except Exception as e:
            result["ping_check"] = {
                "success": False,
                "domain": domain,
                "port": HTTPS_PORT,
                "error": str(e)
            }
        
        return result
    
    async def _reset_client(self) -> None:
        """Reset client state to force reauthentication and session cleanup."""
        try:
            # Reinitialize client to get a new session and authentication
            if hasattr(self.client, 'initialize'):
                await self.client.initialize()
            
            _LOGGER.info("ByteWatt client state has been reset")
            
            # Record diagnostics
            self.diagnostic_service.log_diagnostic("client_reset", {
                "success": True,
                "timestamp": dt_util.utcnow().isoformat()
            })
        except Exception as err:
            _LOGGER.error(f"Error resetting ByteWatt client: {err}")
            
            # Record diagnostics
            self.diagnostic_service.log_diagnostic("client_reset", {
                "success": False,
                "error": str(err),
                "error_type": type(err).__name__,
                "timestamp": dt_util.utcnow().isoformat()
            })
            
            raise
    
    async def run_health_check(self) -> Dict[str, Any]:
        """Run a comprehensive health check on the ByteWatt integration."""
        health_timestamp = dt_util.utcnow()
        health_result = {
            "timestamp": health_timestamp.isoformat(),
            "integration_id": self.entry_id,
            "connection_status": "unknown",
            "network_checks": {},
            "authentication": {},
            "api_checks": {},
            "configuration": {},
            "metrics": {}
        }
        
        # Record in diagnostics
        self.diagnostic_service.log_diagnostic("health_check", {"timestamp": health_timestamp.isoformat()})
        
        # Check network connectivity
        try:
            health_result["network_checks"] = await self.hass.async_add_executor_job(self._check_network)
        except Exception as err:
            health_result["network_checks"] = {
                "success": False,
                "error": str(err)
            }
        
        # Check authentication
        try:
            auth_start = time.time()
            auth_result = await self.client.initialize()
            auth_duration = time.time() - auth_start
            
            health_result["authentication"] = {
                "success": auth_result,
                "duration": f"{auth_duration:.3f}s"
            }
        except Exception as err:
            health_result["authentication"] = {
                "success": False,
                "error": str(err)
            }
        
        # Check API endpoints
        api_checks = {}
        
        # Check battery data endpoint
        try:
            data_start = time.time()
            battery_data = await self.client.get_battery_data()
            data_duration = time.time() - data_start
            
            api_checks["battery_endpoint"] = {
                "success": battery_data is not None,
                "duration": f"{data_duration:.3f}s",
                "data_available": bool(battery_data)
            }
        except Exception as err:
            api_checks["battery_endpoint"] = {
                "success": False,
                "error": str(err)
            }
        
        # Add API checks to result
        health_result["api_checks"] = api_checks
        
        # Add configuration details
        health_result["configuration"] = {
            "heartbeat_interval": f"{self._heartbeat_interval}s",
            "max_data_age": f"{self._max_data_age}s",
            "stale_checks_threshold": self._stale_checks_threshold,
            "notifications_enabled": self._notify_on_recovery,
            "diagnostics_enabled": self.diagnostic_service.diagnostics_enabled,
            "auto_reconnect_time": self._auto_reconnect_time
        }
        
        # Add metrics
        health_result["metrics"] = {
            "recovery_attempts": self._recovery_attempts,
            "consecutive_stale_checks": self._consecutive_stale_checks,
            "circuit_breaker_state": self.circuit_breaker.state.value,
            "last_successful_update": self._last_successful_update.isoformat() if self._last_successful_update else "never"
        }
        
        # Add overall status
        if (health_result["network_checks"].get("ping_check", {}).get("success", False) and
            health_result["authentication"].get("success", False) and
            api_checks.get("battery_endpoint", {}).get("success", False)):
            health_result["connection_status"] = "healthy"
        elif health_result["authentication"].get("success", False):
            health_result["connection_status"] = "limited"
        else:
            health_result["connection_status"] = "disconnected"
        
        # Log result to diagnostics
        self.diagnostic_service.log_diagnostic("health_check_result", health_result)
        
        return health_result
    
    def toggle_diagnostics_mode(self, enable: Optional[bool] = None) -> Dict[str, Any]:
        """Toggle or set diagnostics mode."""
        return self.diagnostic_service.toggle_diagnostics_mode(enable)
    
    def get_diagnostic_logs(self) -> List[Dict[str, Any]]:
        """Get all diagnostic logs."""
        return self.diagnostic_service.get_diagnostic_logs()
