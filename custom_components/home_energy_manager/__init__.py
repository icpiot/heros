"""Home Energy Manager integration."""
from __future__ import annotations

import asyncio
import logging
from datetime import timedelta
from typing import Any, Optional

import voluptuous as vol

from homeassistant.components.frontend import (
    async_register_built_in_panel,
    async_remove_panel,
)
from homeassistant.components.persistent_notification import (
    async_create as notify_create,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_SCAN_INTERVAL
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError
import homeassistant.helpers.config_validation as cv
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.util import dt as dt_util

from .bytewatt_client import ByteWattClient
from .coordinator import ByteWattDataUpdateCoordinator
from .pricing import PricingRateGroup, PricingRateRecord, PricingRule
from .pricing_store import PricingScheduleStore
from .reporting import ByteWattReportHistory, build_reporting_payload
from .settings_manager import SettingsManager, SettingsValidationError
from .topology import DiscoveredInverter
from .const import (
    DOMAIN,
    CONF_PROVIDER,
    PROVIDER_BYTEWATT,
    CONF_USERNAME,
    CONF_PASSWORD,
    CONF_FORECAST_PROVIDER,
    CONF_FORECAST_GENERATION_TODAY_ENTITY,
    CONF_FORECAST_GENERATION_TOMORROW_ENTITY,
    CONF_SOLAR_FORECAST_ENTITY,
    CONF_RECOVERY_ENABLED,
    CONF_HEARTBEAT_INTERVAL,
    CONF_MAX_DATA_AGE,
    CONF_STALE_CHECKS_THRESHOLD,
    CONF_NOTIFY_ON_RECOVERY,
    CONF_DIAGNOSTICS_MODE,
    CONF_AUTO_RECONNECT_TIME,
    DEFAULT_SCAN_INTERVAL,
    DEFAULT_RECOVERY_ENABLED,
    DEFAULT_HEARTBEAT_INTERVAL,
    DEFAULT_MAX_DATA_AGE,
    DEFAULT_STALE_CHECKS_THRESHOLD,
    DEFAULT_NOTIFY_ON_RECOVERY,
    DEFAULT_DIAGNOSTICS_MODE,
    DEFAULT_AUTO_RECONNECT_TIME,
    SERVICE_SET_DISCHARGE_TIME,
    SERVICE_SET_DISCHARGE_START_TIME,
    SERVICE_SET_CHARGE_START_TIME,
    SERVICE_SET_CHARGE_END_TIME,
    SERVICE_SET_MINIMUM_SOC,
    SERVICE_SET_CHARGE_CAP,
    SERVICE_UPDATE_BATTERY_SETTINGS,
    SERVICE_START_FORCE_CHARGE,
    SERVICE_STOP_FORCE_CHARGE,
    SERVICE_FORCE_RECONNECT,
    SERVICE_HEALTH_CHECK,
    SERVICE_TOGGLE_DIAGNOSTICS,
    ATTR_END_DISCHARGE,
    ATTR_START_DISCHARGE,
    ATTR_START_CHARGE,
    ATTR_END_CHARGE,
    ATTR_MINIMUM_SOC,
    ATTR_CHARGE_CAP,
    SERVICE_SET_GRID_FEEDIN_ENABLED,
    SERVICE_SET_GRID_FEEDIN_CUTOFF_SOC,
    SERVICE_UPDATE_GRID_FEEDIN_SLOT,
    SERVICE_PRICING_UPSERT_RULE,
    SERVICE_PRICING_REMOVE_RULE,
    SERVICE_PRICING_SET_HOLIDAYS,
    SERVICE_PRICING_UPSERT_GROUP,
    SERVICE_PRICING_REMOVE_GROUP,
    SERVICE_PRICING_UPSERT_RECORD,
    SERVICE_PRICING_REMOVE_RECORD,
    ATTR_FEEDIN_ENABLED,
    ATTR_FEEDIN_CUTOFF_SOC,
    ATTR_FEEDIN_SLOT,
    ATTR_FEEDIN_START,
    ATTR_FEEDIN_END,
    ATTR_FEEDIN_POWER,
    ATTR_ENTRY_ID,
    ATTR_RULE_ID,
    ATTR_GROUP_ID,
    ATTR_RECORD_ID,
    ATTR_RECORD_TYPE,
    ATTR_EFFECTIVE_DATE,
    ATTR_EFFECTIVE_START_DATE,
    ATTR_EFFECTIVE_TIME,
    ATTR_EFFECTIVE_END_DATE,
    ATTR_EFFECTIVE_END_TIME,
    ATTR_PRICING_TYPE,
    ATTR_PROVIDER,
    ATTR_PLAN_NAME,
    ATTR_LABEL,
    ATTR_IMPORT_RATE,
    ATTR_EXPORT_RATE,
    ATTR_EXPORT_TIER_1_LIMIT,
    ATTR_EXPORT_TIER_1_RATE,
    ATTR_EXPORT_TIER_2_RATE,
    ATTR_SUPPLY_CHARGE,
    ATTR_CONTROLLED_LOAD_1,
    ATTR_CONTROLLED_LOAD_2,
    ATTR_CONTROLLED_LOAD_RATE,
    ATTR_ADDITIONAL_CHARGE,
    ATTR_DAILY_CONNECTION_CHARGE,
    ATTR_OTHER_CHARGES,
    ATTR_HOLIDAY_ONLY,
    ATTR_DAYS_OF_WEEK,
    ATTR_DAY_TYPES,
    ATTR_NOTES,
    ATTR_HOLIDAY_DATES,
    ATTR_HOLIDAY_SOURCE,
    ATTR_REGION,
    signal_pricing_changed,
    CONF_HOST_SYSTEM_ID,
    CONF_HOST_SYS_SN,
    CONF_HISTORY_BACKFILL_YEARS,
    CURRENT_ENTRY_VERSION,
    FEEDIN_MAX_SLOTS,
    FEEDIN_MAX_POWER_W,
)

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

PLATFORMS = ["sensor", "number", "time", "switch", "button", "select"]

PANEL_COMPONENT_NAME = "home-energy-manager-panel"
PANEL_FRONTEND_URL_PATH = "home-energy-manager"
PANEL_MODULE_URL = "/local/community/home-energy-manager/home-energy-manager-panel.js?v=217"
PANEL_CONFIG = {
    "title": "Home Energy Manager (HEM)",
    "subtitle": "Live energy control, custom theming, and provider-aware dashboards.",
    "theme": "cyberpunk",
    "entity_prefix": "home_energy_manager",
    "settings_target": "select.house_home_energy_manager_settings_target",
    "theme_art_url": "",
    "theme_art_size": "cover",
    "theme_art_position": "center center",
    "theme_art_opacity": "0.18",
    "forecast_provider": "none",
    "forecast_generation_today_entity": "",
    "forecast_generation_tomorrow_entity": "",
    "solar_forecast_entity": "",
}
PANEL_CUSTOM_CONFIG = {
    "_panel_custom": {
        "name": PANEL_COMPONENT_NAME,
        "module_url": PANEL_MODULE_URL,
        "embed_iframe": False,
        "trust_external": False,
    }
}
PANEL_PROVIDER_LABELS = {
    PROVIDER_BYTEWATT: "Home Energy Manager",
}

# Services are domain-level; registered once via hass.services.has_service() guard.


# ---------------------------------------------------------------------------
# Setup / unload / migrate
# ---------------------------------------------------------------------------

async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    hass.data.setdefault(DOMAIN, {})
    return True


def _register_frontend_panel(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Register the built-in sidebar panel and load its module."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get("frontend_panel_registered"):
        return

    async_register_built_in_panel(
        hass,
        component_name="custom",
        sidebar_title="HEM",
        sidebar_icon="mdi:solar-power-variant",
        frontend_url_path=PANEL_FRONTEND_URL_PATH,
        config={
            **PANEL_CONFIG,
            "entry_id": entry.entry_id,
            "provider": PANEL_PROVIDER_LABELS.get(
                entry.data.get(CONF_PROVIDER),
                str(entry.data.get(CONF_PROVIDER, "Configured provider")).title(),
            ),
            CONF_FORECAST_PROVIDER: entry.data.get(CONF_FORECAST_PROVIDER, "none"),
            CONF_FORECAST_GENERATION_TODAY_ENTITY: entry.data.get(CONF_FORECAST_GENERATION_TODAY_ENTITY, ""),
            CONF_FORECAST_GENERATION_TOMORROW_ENTITY: entry.data.get(CONF_FORECAST_GENERATION_TOMORROW_ENTITY, ""),
            CONF_SOLAR_FORECAST_ENTITY: entry.data.get(CONF_SOLAR_FORECAST_ENTITY, ""),
            **PANEL_CUSTOM_CONFIG,
        },
        show_in_sidebar=True,
        update=True,
    )
    domain_data["frontend_panel_registered"] = True


def _unregister_frontend_panel(hass: HomeAssistant) -> None:
    """Remove the sidebar panel and module when no entries remain."""
    domain_data = hass.data.get(DOMAIN, {})
    if not domain_data.get("frontend_panel_registered"):
        return
    if any(isinstance(value, dict) and value.get("coordinator") for value in domain_data.values()):
        return

    async_remove_panel(hass, PANEL_FRONTEND_URL_PATH, warn_if_unknown=False)
    domain_data.pop("frontend_panel_registered", None)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Byte-Watt from a config entry."""
    username = entry.data[CONF_USERNAME]
    password = entry.data[CONF_PASSWORD]
    host_system_id = entry.data.get(CONF_HOST_SYSTEM_ID, "")
    host_sys_sn = entry.data.get(CONF_HOST_SYS_SN, "")

    options = entry.options or {}
    scan_interval = options.get(
        CONF_SCAN_INTERVAL,
        entry.data.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL),
    )

    recovery_options = {
        CONF_RECOVERY_ENABLED:        options.get(CONF_RECOVERY_ENABLED, DEFAULT_RECOVERY_ENABLED),
        CONF_HEARTBEAT_INTERVAL:      options.get(CONF_HEARTBEAT_INTERVAL, DEFAULT_HEARTBEAT_INTERVAL),
        CONF_MAX_DATA_AGE:            options.get(CONF_MAX_DATA_AGE, DEFAULT_MAX_DATA_AGE),
        CONF_STALE_CHECKS_THRESHOLD:  options.get(CONF_STALE_CHECKS_THRESHOLD, DEFAULT_STALE_CHECKS_THRESHOLD),
        CONF_NOTIFY_ON_RECOVERY:      options.get(CONF_NOTIFY_ON_RECOVERY, DEFAULT_NOTIFY_ON_RECOVERY),
        CONF_DIAGNOSTICS_MODE:        options.get(CONF_DIAGNOSTICS_MODE, DEFAULT_DIAGNOSTICS_MODE),
        CONF_AUTO_RECONNECT_TIME:     options.get(CONF_AUTO_RECONNECT_TIME, DEFAULT_AUTO_RECONNECT_TIME),
    }

    client = ByteWattClient(
        hass, username, password,
        host_system_id=host_system_id,
        host_sys_sn=host_sys_sn,
    )
    manager = SettingsManager(hass, client.api_client, entry.entry_id)
    pricing_store = PricingScheduleStore(hass, entry.entry_id)
    coordinator = ByteWattDataUpdateCoordinator(
        hass,
        client=client,
        scan_interval=scan_interval,
        entry_id=entry.entry_id,
        options=recovery_options,
    )

    hass.data[DOMAIN][entry.entry_id] = {
        "client": client,
        "coordinator": coordinator,
        "manager": manager,
        "pricing_store": pricing_store,
    }

    inverters: list[DiscoveredInverter] = []
    try:
        raw_inverters = await client.fetch_inverter_list()
    except Exception as ex:
        _LOGGER.debug("Could not fetch inverter inventory during setup: %s", ex)
        raw_inverters = []
    if raw_inverters:
        inverters = [DiscoveredInverter.from_api_response(inv) for inv in raw_inverters]
        hass.data[DOMAIN][entry.entry_id]["inverters"] = inverters
        if not host_system_id and len(inverters) == 1:
            host_system_id = inverters[0].system_id
            host_sys_sn = inverters[0].sys_sn
            client.api_client.host_system_id = host_system_id
            client.api_client.host_sys_sn = host_sys_sn
            hass.config_entries.async_update_entry(
                entry,
                data={
                    **entry.data,
                    CONF_HOST_SYSTEM_ID: host_system_id,
                    CONF_HOST_SYS_SN: host_sys_sn,
                },
            )

    # If host is now configured, clear any leftover repair issue from prior runs.
    # If it's still empty, _check_host_inverter_repair_issue may raise one.
    if host_system_id:
        ir.async_delete_issue(hass, DOMAIN, _host_inverter_issue_id(entry.entry_id))
    else:
        _check_host_inverter_repair_issue(hass, entry, client)

    await coordinator.async_config_entry_first_refresh()

    if recovery_options[CONF_RECOVERY_ENABLED]:
        await coordinator.start_heartbeat()
        # Ensure heartbeat is stopped even if a later setup step raises before
        # async_unload_entry would otherwise clean it up.
        entry.async_on_unload(_stop_heartbeat_factory(coordinator))
        _LOGGER.info(
            "ByteWatt heartbeat monitoring started (interval: %ss, stale threshold: %ss)",
            recovery_options[CONF_HEARTBEAT_INTERVAL],
            recovery_options[CONF_MAX_DATA_AGE],
        )

    if not hass.services.has_service(DOMAIN, SERVICE_FORCE_RECONNECT):
        _register_services(hass)

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Reload the entry whenever the user changes options (currently just
    # scan_interval). Without this, edits via the Configure dialog would
    # silently have no effect on the running coordinator.
    entry.async_on_unload(entry.add_update_listener(_async_options_updated))

    _register_frontend_panel(hass, entry)
    history = ByteWattReportHistory(hass, entry.entry_id)
    if not history.history_file.exists():
        backfill_days = _history_backfill_days(entry)
        end_date = dt_util.now().date()
        start_date = (end_date - timedelta(days=backfill_days)).isoformat()
        end_date_str = end_date.isoformat()
        scopes: list[tuple[str, str]] = [("all", "All systems")]
        scopes.extend(
            (
                inverter.sys_sn or inverter.system_id,
                inverter.display_name,
            )
            for inverter in inverters
            if inverter.sys_sn or inverter.system_id
        )
        seen_scopes: set[str] = set()
        for scope_key, scope_label in scopes:
            scope_key = str(scope_key or "").strip()
            if not scope_key or scope_key in seen_scopes:
                continue
            seen_scopes.add(scope_key)
            _LOGGER.info(
                "Scheduling initial Home Energy Manager history backfill for %s (%s): %s -> %s",
                entry.entry_id,
                scope_label,
                start_date,
                end_date_str,
            )
            hass.async_create_task(
                hass.services.async_call(
                    DOMAIN,
                    "ensure_report_history",
                    {
                        ATTR_ENTRY_ID: entry.entry_id,
                        "scope_key": scope_key,
                        "start_date": start_date,
                        "end_date": end_date_str,
                        "force": False,
                    },
                    blocking=False,
                )
            )

    return True


def _date_range(start_date: str, end_date: str) -> list[str]:
    """Return inclusive YYYY-MM-DD dates between two bounds."""
    from datetime import datetime, timedelta

    start = datetime.strptime(start_date, "%Y-%m-%d").date()
    end = datetime.strptime(end_date, "%Y-%m-%d").date()
    if end < start:
        start, end = end, start
    days = []
    current = start
    while current <= end:
        days.append(current.isoformat())
        current += timedelta(days=1)
    return days


def _history_scope_targets(entry_data: dict[str, Any]) -> list[tuple[str, str, str]]:
    """Return the scopes that should be archived for this entry."""
    targets: list[tuple[str, str, str]] = [("all", "All systems", "")]
    seen: set[str] = {"all"}

    for inverter in entry_data.get("inverters") or []:
        if not isinstance(inverter, DiscoveredInverter):
            continue
        scope_key = str(inverter.sys_sn or inverter.system_id or "").strip()
        if not scope_key or scope_key in seen:
            continue
        seen.add(scope_key)
        label = str(inverter.display_name or scope_key).strip() or scope_key
        station_id = str(inverter.system_id or "").strip()
        targets.append((scope_key, label, station_id))

    return targets


async def _ensure_report_history_range(
    hass: HomeAssistant,
    entry_id: str,
    *,
    scope_key: str,
    start_date: str,
    end_date: str,
    force: bool = False,
    label: str | None = None,
    station_id: str = "",
) -> None:
    """Download and persist report history snapshots for one scope."""
    entry_data = hass.data[DOMAIN].get(entry_id, {})
    client = entry_data.get("client")
    if client is None:
        raise HomeAssistantError("Home Energy Manager entry is not ready")

    if not station_id and scope_key != "all":
        for inverter in entry_data.get("inverters") or []:
            if not isinstance(inverter, DiscoveredInverter):
                continue
            candidates = {
                str(inverter.system_id or "").strip(),
                str(inverter.sys_sn or "").strip(),
                str(inverter.display_name or "").strip(),
            }
            if scope_key in candidates:
                station_id = str(inverter.system_id or "").strip()
                break

    history = ByteWattReportHistory(hass, entry_id)
    history_label = label or scope_key.replace("_", " ").title()
    dates = _date_range(start_date, end_date)
    status_text = f"Downloading {len(dates)} day(s) for {history_label}..."
    entry_data["history_status"] = status_text
    notify_create(
        hass,
        status_text,
        title="Home Energy Manager History",
        notification_id=f"home_energy_manager_history_{entry_id}",
    )

    for index, day in enumerate(dates, start=1):
        battery_data = await client.get_battery_data(
            station_id=station_id or None,
            report_date=day,
            include_realtime=day == dates[-1] and not force,
        )
        reporting = build_reporting_payload(
            battery_data or {},
            aggregate=(scope_key == "all"),
            label=history_label,
        )
        if battery_data:
            await history.async_store_snapshot(
                scope_key=scope_key,
                label=history_label,
                reporting=reporting,
                record_date=day,
            )
        else:
            await history.async_mark_missing_date(
                scope_key=scope_key,
                label=history_label,
                record_date=day,
                reason="no_reporting_data",
            )
        progress = f"Downloaded {index}/{len(dates)} days for {history_label}"
        entry_data["history_status"] = progress
        notify_create(
            hass,
            progress,
            title="Home Energy Manager History",
            notification_id=f"home_energy_manager_history_{entry_id}",
        )

    done_text = f"History ready for {history_label} ({len(dates)} day(s))"
    entry_data["history_status"] = done_text
    notify_create(
        hass,
        done_text,
        title="Home Energy Manager History",
        notification_id=f"home_energy_manager_history_{entry_id}",
    )


async def _bootstrap_report_history(hass: HomeAssistant, entry_id: str, backfill_days: int) -> None:
    """Seed history for a fresh install if no local archive exists yet."""
    entry_data = hass.data[DOMAIN].get(entry_id, {})
    history = ByteWattReportHistory(hass, entry_id)
    if history.history_file.exists():
        _LOGGER.debug("History archive already exists for %s; skipping bootstrap", entry_id)
        return

    from datetime import timedelta

    end_date = dt_util.now().date().isoformat()
    start_date = (dt_util.now().date() - timedelta(days=max(1, backfill_days) - 1)).isoformat()
    for scope_key, label, station_id in _history_scope_targets(entry_data):
        try:
            await _ensure_report_history_range(
                hass,
                entry_id,
                scope_key=scope_key,
                start_date=start_date,
                end_date=end_date,
                force=False,
                label=label,
                station_id=station_id,
            )
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning(
                "Failed to bootstrap report history for %s (%s): %s",
                entry_id,
                scope_key,
                err,
            )


def _stop_heartbeat_factory(coordinator):
    """Return a sync callback that schedules stop_heartbeat — for async_on_unload."""
    def _stop():
        coordinator.hass.async_create_task(coordinator.stop_heartbeat())
    return _stop


async def _async_options_updated(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload the entry so option changes (e.g. scan_interval) take effect."""
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    entry_data = hass.data[DOMAIN].get(entry.entry_id)

    # Warn the user if they have unsaved pending changes that will be lost
    if entry_data:
        manager: SettingsManager | None = entry_data.get("manager")
        if manager is not None and manager.has_pending():
            count = manager.pending_count()
            _LOGGER.warning(
                "Unloading with %d pending settings change(s) still staged — these will be lost",
                count,
            )
            try:
                notify_create(
                    hass,
                    f"ByteWatt integration is unloading with {count} unsaved setting "
                    f"change(s) staged. These have been discarded.",
                    title="ByteWatt: pending changes lost",
                    notification_id=f"bytewatt_pending_lost_{entry.entry_id}",
                )
            except (AttributeError, TypeError) as ex:
                _LOGGER.debug("Could not create pending-lost notification: %s", ex)

        coordinator = entry_data.get("coordinator")
        if coordinator:
            await coordinator.stop_heartbeat()
            _LOGGER.info("ByteWatt heartbeat monitoring stopped")

    unload_ok = all(
        await asyncio.gather(
            *[
                hass.config_entries.async_forward_entry_unload(entry, platform)
                for platform in PLATFORMS
            ]
        )
    )
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)
        _unregister_frontend_panel(hass)
    return unload_ok


async def async_migrate_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Migrate older config entries to the current schema.

    v1 → v2: introduces ``host_system_id`` / ``host_sys_sn`` (added when the
    Host inverter selection step was added). Try to populate them
    automatically when only one inverter exists; otherwise raise a repair
    issue prompting the user to reconfigure.
    """
    _LOGGER.info("Migrating ByteWatt entry from v%s to v%s", entry.version, CURRENT_ENTRY_VERSION)

    if entry.version < 2:
        new_data = dict(entry.data)
        new_data.setdefault(CONF_HOST_SYSTEM_ID, "")
        new_data.setdefault(CONF_HOST_SYS_SN, "")

        # Track inverter count explicitly so the post-migration decision
        # below doesn't depend on whether a variable got bound inside a
        # try-block (the previous walrus-via-locals() pattern was brittle).
        inverter_count: Optional[int] = None

        if not new_data[CONF_HOST_SYSTEM_ID]:
            client = ByteWattClient(
                hass,
                new_data[CONF_USERNAME],
                new_data[CONF_PASSWORD],
            )
            try:
                logged_in = await client.initialize()
                if logged_in:
                    inverters = await client.fetch_inverter_list()
                    inverter_count = len(inverters)
                    if inverter_count == 1:
                        new_data[CONF_HOST_SYSTEM_ID] = inverters[0].get("systemId", "")
                        new_data[CONF_HOST_SYS_SN] = inverters[0].get("sysSn", "")
                        _LOGGER.info(
                            "Auto-selected single inverter %s as Host",
                            new_data[CONF_HOST_SYS_SN],
                        )
                    elif inverter_count == 0:
                        _LOGGER.warning(
                            "Migration found no inverters on the account — "
                            "grid feed-in will be unavailable. Reconfigure if you add one."
                        )
                    else:
                        _LOGGER.info(
                            "Migration found %d inverters; user must pick the Host",
                            inverter_count,
                        )
                else:
                    _LOGGER.warning(
                        "Could not log in during migration; "
                        "host_system_id stays empty and a repair issue will be raised"
                    )
            except Exception as ex:  # noqa: BLE001 — migration must never crash
                _LOGGER.warning("Migration could not fetch inverter list: %s", ex)

        # Raise a repair issue only when we KNOW there are multiple inverters
        # and we still don't have a host. Login failures (inverter_count is
        # None) and 0-inverter accounts don't reach this — they get warning
        # logs above.
        if (
            not new_data[CONF_HOST_SYSTEM_ID]
            and inverter_count is not None
            and inverter_count > 1
        ):
            _create_host_inverter_repair_issue(hass, entry.entry_id)

        # Backfill unique_id from the username (matching what the config
        # flow now sets for new installs) so dedup checks recognise this
        # entry on subsequent re-add attempts.
        unique_id = (entry.unique_id or new_data[CONF_USERNAME].lower())
        hass.config_entries.async_update_entry(
            entry,
            data=new_data,
            unique_id=unique_id,
            version=CURRENT_ENTRY_VERSION,
        )

    return True


# ---------------------------------------------------------------------------
# Repair issues
# ---------------------------------------------------------------------------

def _host_inverter_issue_id(entry_id: str) -> str:
    return f"host_inverter_required_{entry_id}"


def _create_host_inverter_repair_issue(hass: HomeAssistant, entry_id: str) -> None:
    """Tell the user to reconfigure to pick the Host inverter."""
    ir.async_create_issue(
        hass,
        DOMAIN,
        issue_id=_host_inverter_issue_id(entry_id),
        is_fixable=False,
        severity=ir.IssueSeverity.WARNING,
        translation_key="host_inverter_required",
    )


def _check_host_inverter_repair_issue(
    hass: HomeAssistant, entry: ConfigEntry, client: ByteWattClient
) -> None:
    """Recheck after setup if host_system_id is empty AND an inverter has
    appeared on the account (e.g. user added one between HA restarts).

    Skips when the repair issue is already raised — otherwise we'd re-login
    on every restart even though the user has been told to reconfigure.
    coordinator.async_config_entry_first_refresh() is doing its own login
    moments after setup; this background check is purely about issue state.
    """
    issue_id = _host_inverter_issue_id(entry.entry_id)
    if ir.async_get(hass).async_get_issue(DOMAIN, issue_id) is not None:
        return  # Already telling the user to reconfigure; no extra login needed.

    async def _check():
        try:
            if not await client.initialize():
                return
            inverters = await client.fetch_inverter_list()
            # >= 1 because async_setup_entry only called this when
            # host_system_id is empty — any inverter at all is enough to
            # justify prompting the user to pick one.
            if len(inverters) >= 1:
                _create_host_inverter_repair_issue(hass, entry.entry_id)
        except Exception as ex:  # noqa: BLE001
            _LOGGER.debug("Could not check inverter count for repair issue: %s", ex)

    # Tie the task to the entry so HA cancels it if the entry unloads mid-check.
    entry.async_create_task(hass, _check())


# ---------------------------------------------------------------------------
# Services — registered once at domain level, accept optional entry_id
# ---------------------------------------------------------------------------

def _configured_entry_ids(hass: HomeAssistant) -> list[str]:
    """Return only real config-entry IDs stored under hass.data[DOMAIN]."""
    return [
        entry_id
        for entry_id, entry_data in hass.data.get(DOMAIN, {}).items()
        if isinstance(entry_data, dict)
        and (
            entry_data.get("coordinator") is not None
            or entry_data.get("manager") is not None
            or entry_data.get("pricing_store") is not None
        )
    ]


def _resolve_entry_id(hass: HomeAssistant, call: ServiceCall) -> str | None:
    """Use the explicit entry_id if given; otherwise the first configured entry."""
    requested = str(call.data.get(ATTR_ENTRY_ID) or "").strip()
    entries = _configured_entry_ids(hass)
    if requested:
        if requested not in entries:
            raise HomeAssistantError(
                f"Unknown ByteWatt entry_id {requested!r}. Configured entries: {entries}"
            )
        return requested
    if len(entries) == 1:
        return entries[0]
    if not entries:
        raise HomeAssistantError("No ByteWatt integration is configured")
    raise HomeAssistantError(
        f"Multiple ByteWatt integrations are configured — pass entry_id to "
        f"disambiguate. Available: {entries}"
    )


def _manager_for(hass: HomeAssistant, call: ServiceCall) -> SettingsManager:
    entry_id = _resolve_entry_id(hass, call)
    return hass.data[DOMAIN][entry_id]["manager"]


def _pricing_store_for(hass: HomeAssistant, call: ServiceCall) -> tuple[PricingScheduleStore, str]:
    entry_id = _resolve_entry_id(hass, call)
    entry_data = hass.data[DOMAIN][entry_id]
    store = entry_data.get("pricing_store")
    if store is None:
        store = PricingScheduleStore(hass, entry_id)
        entry_data["pricing_store"] = store
    return store, entry_id


def _notify_pricing_changed(hass: HomeAssistant, entry_id: str) -> None:
    async_dispatcher_send(hass, signal_pricing_changed(entry_id))


async def _submit_battery_service(
    hass: HomeAssistant, call: ServiceCall, **fields: Any
) -> bool:
    """Service-call entry point: validate + PUT one or more battery fields.

    Uses submit_battery_one_shot so the service does NOT touch the user's
    UI-staged pending changes. Service-call fire-and-forget UX is preserved
    while keeping the Submit-button flow's pending dict isolated.
    """
    manager = _manager_for(hass, call)
    result = await manager.submit_battery_one_shot(fields)
    if not result.battery_attempted:
        return True
    if not result.battery_ok:
        detail = result.battery_error or "see logs for details"
        raise HomeAssistantError(f"Battery settings update failed: {detail}")
    return True


def _register_services(hass: HomeAssistant) -> None:
    """Register all domain-level services."""

    # ---------- Battery: single-field convenience services ----------

    async def handle_set_discharge_time(call: ServiceCall) -> None:
        await _submit_battery_service(
            hass, call, discharge_end_time=call.data.get(ATTR_END_DISCHARGE),
        )

    async def handle_set_discharge_start_time(call: ServiceCall) -> None:
        await _submit_battery_service(
            hass, call, discharge_start_time=call.data.get(ATTR_START_DISCHARGE),
        )

    async def handle_set_charge_start_time(call: ServiceCall) -> None:
        await _submit_battery_service(
            hass, call, charge_start_time=call.data.get(ATTR_START_CHARGE),
        )

    async def handle_set_charge_end_time(call: ServiceCall) -> None:
        await _submit_battery_service(
            hass, call, charge_end_time=call.data.get(ATTR_END_CHARGE),
        )

    async def handle_set_minimum_soc(call: ServiceCall) -> None:
        await _submit_battery_service(
            hass, call, minimum_soc=call.data.get(ATTR_MINIMUM_SOC),
        )

    async def handle_set_charge_cap(call: ServiceCall) -> None:
        await _submit_battery_service(
            hass, call, charge_cap=call.data.get(ATTR_CHARGE_CAP),
        )

    async def handle_update_battery_settings(call: ServiceCall) -> None:
        await _submit_battery_service(
            hass, call,
            discharge_start_time=call.data.get(ATTR_START_DISCHARGE),
            discharge_end_time=call.data.get(ATTR_END_DISCHARGE),
            charge_start_time=call.data.get(ATTR_START_CHARGE),
            charge_end_time=call.data.get(ATTR_END_CHARGE),
            minimum_soc=call.data.get(ATTR_MINIMUM_SOC),
            charge_cap=call.data.get(ATTR_CHARGE_CAP),
        )

    async def handle_start_force_charge(call: ServiceCall) -> None:
        manager = _manager_for(hass, call)
        charge_cap = call.data.get(ATTR_CHARGE_CAP, 100)
        ok = await manager.start_force_charge(int(charge_cap))
        if not ok:
            raise HomeAssistantError("Force charge request failed")
        entry_id = _resolve_entry_id(hass, call)
        coordinator = hass.data[DOMAIN][entry_id].get("coordinator")
        if coordinator:
            await coordinator.async_request_refresh()

    async def handle_stop_force_charge(call: ServiceCall) -> None:
        manager = _manager_for(hass, call)
        ok = await manager.stop_force_charge()
        if not ok:
            raise HomeAssistantError("Stop charge request failed")
        entry_id = _resolve_entry_id(hass, call)
        coordinator = hass.data[DOMAIN][entry_id].get("coordinator")
        if coordinator:
            await coordinator.async_request_refresh()

    # ---------- Grid feed-in ----------

    async def handle_set_grid_feedin_enabled(call: ServiceCall) -> None:
        manager = _manager_for(hass, call)
        try:
            manager.stage_feedin("enabled", call.data[ATTR_FEEDIN_ENABLED])
        except SettingsValidationError as ex:
            raise HomeAssistantError(str(ex)) from ex
        result = await manager.submit()
        if not result.feedin_ok:
            detail = result.feedin_error or "see logs for details"
            raise HomeAssistantError(f"Grid feed-in enable update failed: {detail}")

    async def handle_set_grid_feedin_cutoff_soc(call: ServiceCall) -> None:
        manager = _manager_for(hass, call)
        try:
            manager.stage_feedin("cutoff_soc", call.data[ATTR_FEEDIN_CUTOFF_SOC])
        except SettingsValidationError as ex:
            raise HomeAssistantError(str(ex)) from ex
        result = await manager.submit()
        if not result.feedin_ok:
            detail = result.feedin_error or "see logs for details"
            raise HomeAssistantError(f"Grid feed-in cutoff SOC update failed: {detail}")

    async def handle_update_grid_feedin_slot(call: ServiceCall) -> None:
        slot_1based = call.data[ATTR_FEEDIN_SLOT]
        slot_index = int(slot_1based) - 1
        start = call.data.get(ATTR_FEEDIN_START)
        end = call.data.get(ATTR_FEEDIN_END)
        power = call.data.get(ATTR_FEEDIN_POWER)
        if start is None and end is None and power is None:
            _LOGGER.debug("update_grid_feedin_slot called with no fields — nothing to do")
            return
        manager = _manager_for(hass, call)
        try:
            if start is not None:
                manager.stage_feedin_slot(slot_index, "start", start)
            if end is not None:
                manager.stage_feedin_slot(slot_index, "end", end)
            if power is not None:
                manager.stage_feedin_slot(slot_index, "power", power)
        except SettingsValidationError as ex:
            raise HomeAssistantError(str(ex)) from ex
        result = await manager.submit()
        if not result.feedin_ok:
            detail = result.feedin_error or "see logs for details"
            raise HomeAssistantError(f"Grid feed-in slot update failed: {detail}")

    # ---------- Maintenance ----------

    async def handle_force_reconnect(call: ServiceCall) -> None:
        _LOGGER.warning("Manual reconnect triggered for ByteWatt integration")
        target_entry = call.data.get(ATTR_ENTRY_ID)
        reconnected = False
        for entry_id, entry_data in hass.data[DOMAIN].items():
            if target_entry and entry_id != target_entry:
                continue
            coordinator = entry_data.get("coordinator")
            if not coordinator:
                continue
            try:
                await coordinator._perform_recovery()
                reconnected = True
                _LOGGER.info("Recovery completed for entry %s", entry_id)
            except Exception as err:  # noqa: BLE001 — surface in notification
                _LOGGER.error("Failed to recover entry %s: %s", entry_id, err)
        if not reconnected:
            _LOGGER.error("No active ByteWatt integrations found to reconnect")

    async def handle_health_check(call: ServiceCall) -> None:
        results = {}
        target_entry = call.data.get(ATTR_ENTRY_ID)
        for entry_id, entry_data in hass.data[DOMAIN].items():
            if target_entry and entry_id != target_entry:
                continue
            coordinator = entry_data.get("coordinator")
            if coordinator:
                results[entry_id] = await coordinator.run_health_check()
        if not results:
            _LOGGER.error("No ByteWatt integrations found for health check")
            return
        summary_lines = []
        for entry_id, result in results.items():
            status = result.get("connection_status", "unknown")
            auth_ok = result.get("authentication", {}).get("success", False)
            api_ok = all(c.get("success", False) for c in result.get("api_checks", {}).values())
            summary_lines.append(
                f"Integration {entry_id}: {status} — "
                f"Authentication: {'OK' if auth_ok else 'FAIL'}, "
                f"API: {'OK' if api_ok else 'FAIL'}"
            )
        try:
            notify_create(
                hass,
                "\n".join(summary_lines),
                title="Home Energy Manager Health Check Results",
                notification_id="bytewatt_health_check",
            )
        except (AttributeError, TypeError) as ex:
            _LOGGER.error("Could not create health check notification: %s", ex)

    async def handle_toggle_diagnostics(call: ServiceCall) -> None:
        enable = call.data.get("enable")
        target_entry = call.data.get(ATTR_ENTRY_ID)
        results = {}
        for entry_id, entry_data in hass.data[DOMAIN].items():
            if target_entry and entry_id != target_entry:
                continue
            coordinator = entry_data.get("coordinator")
            if coordinator:
                results[entry_id] = coordinator.toggle_diagnostics_mode(enable)
        if results:
            enabled_now = list(results.values())[0].get("diagnostics_mode", False)
            try:
                notify_create(
                    hass,
                    f"Diagnostics mode: {'enabled' if enabled_now else 'disabled'}",
                    title="Home Energy Manager Diagnostics",
                    notification_id="bytewatt_diagnostics",
                )
            except (AttributeError, TypeError) as ex:
                _LOGGER.error("Could not create diagnostics notification: %s", ex)
        else:
            _LOGGER.error("No ByteWatt integrations found to toggle diagnostics")

    async def handle_ensure_report_history(call: ServiceCall) -> None:
        target_entry = call.data.get(ATTR_ENTRY_ID)
        scope_key = str(call.data.get("scope_key") or "all").strip() or "all"
        start_date = str(call.data.get("start_date") or "").strip()
        end_date = str(call.data.get("end_date") or "").strip()
        force = bool(call.data.get("force", False))
        if not start_date or not end_date:
            raise HomeAssistantError("start_date and end_date are required")
        target_entry_ids = [
            entry_id
            for entry_id, entry_data in hass.data[DOMAIN].items()
            if isinstance(entry_data, dict) and entry_data.get("coordinator")
            and (not target_entry or entry_id == target_entry)
        ]
        if not target_entry_ids:
            raise HomeAssistantError("No Home Energy Manager entries are loaded")

        for entry_id in target_entry_ids:
            await _ensure_report_history_range(
                hass,
                entry_id,
                scope_key=scope_key,
                start_date=start_date,
                end_date=end_date,
                force=force,
            )

    async def handle_pricing_upsert_rule(call: ServiceCall) -> None:
        store, entry_id = _pricing_store_for(hass, call)
        rule = PricingRule.from_dict({
            "rule_id": call.data.get(ATTR_RULE_ID),
            "effective_date": call.data.get(ATTR_EFFECTIVE_DATE),
            "effective_end_date": call.data.get(ATTR_EFFECTIVE_END_DATE),
            "start_time": call.data.get(ATTR_EFFECTIVE_TIME) or "00:00",
            "end_time": call.data.get(ATTR_EFFECTIVE_END_TIME) or "",
            "pricing_type": call.data.get(ATTR_PRICING_TYPE) or "fixed",
            "provider": call.data.get(ATTR_PROVIDER) or "",
            "label": call.data.get(ATTR_LABEL) or "",
            "import_rate": call.data.get(ATTR_IMPORT_RATE),
            "export_rate": call.data.get(ATTR_EXPORT_RATE),
            "supply_charge": call.data.get(ATTR_SUPPLY_CHARGE),
            "controlled_load_1": call.data.get(ATTR_CONTROLLED_LOAD_1),
            "controlled_load_2": call.data.get(ATTR_CONTROLLED_LOAD_2),
            "additional_charge": call.data.get(ATTR_ADDITIONAL_CHARGE),
            "holiday_only": call.data.get(ATTR_HOLIDAY_ONLY, False),
            "days_of_week": call.data.get(ATTR_DAYS_OF_WEEK) or [],
            "notes": call.data.get(ATTR_NOTES) or "",
            "metadata": {
                "region": call.data.get(ATTR_REGION) or "",
                "holiday_source": call.data.get(ATTR_HOLIDAY_SOURCE) or "",
            },
        })
        await store.async_upsert_rule(rule)
        _notify_pricing_changed(hass, entry_id)

    async def handle_pricing_remove_rule(call: ServiceCall) -> None:
        store, entry_id = _pricing_store_for(hass, call)
        rule_id = str(call.data.get(ATTR_RULE_ID) or "").strip()
        if not rule_id:
            raise HomeAssistantError("rule_id is required")
        await store.async_remove_rule(rule_id)
        _notify_pricing_changed(hass, entry_id)

    async def handle_pricing_upsert_group(call: ServiceCall) -> None:
        store, entry_id = _pricing_store_for(hass, call)
        try:
            group = PricingRateGroup.from_dict({
                "group_id": call.data.get(ATTR_GROUP_ID),
                "label": call.data.get(ATTR_LABEL) or "",
                "provider": call.data.get(ATTR_PROVIDER) or "",
                "plan_name": call.data.get(ATTR_PLAN_NAME) or "",
                "effective_start_date": call.data.get(ATTR_EFFECTIVE_START_DATE),
                "pricing_type": call.data.get(ATTR_PRICING_TYPE) or "dynamic",
                "daily_connection_charge": call.data.get(ATTR_DAILY_CONNECTION_CHARGE),
                "other_charges": call.data.get(ATTR_OTHER_CHARGES) or "",
                "notes": call.data.get(ATTR_NOTES) or "",
            })
        except ValueError as err:
            raise HomeAssistantError(str(err)) from err
        try:
            await store.async_upsert_group(group)
        except ValueError as err:
            raise HomeAssistantError(str(err)) from err
        _notify_pricing_changed(hass, entry_id)

    async def handle_pricing_remove_group(call: ServiceCall) -> None:
        store, entry_id = _pricing_store_for(hass, call)
        group_id = str(call.data.get(ATTR_GROUP_ID) or "").strip()
        if not group_id:
            raise HomeAssistantError("group_id is required")
        await store.async_remove_group(group_id)
        _notify_pricing_changed(hass, entry_id)

    async def handle_pricing_upsert_record(call: ServiceCall) -> None:
        store, entry_id = _pricing_store_for(hass, call)
        group_id = str(call.data.get(ATTR_GROUP_ID) or "").strip()
        if not group_id:
            raise HomeAssistantError("group_id is required")
        day_types = call.data.get(ATTR_DAY_TYPES) or []
        if isinstance(day_types, str):
            day_types = [item.strip() for item in day_types.split(",") if item.strip()]
        sell_tiers = {}
        if call.data.get(ATTR_EXPORT_TIER_1_LIMIT) is not None:
            sell_tiers["tier_1_limit_kwh"] = call.data.get(ATTR_EXPORT_TIER_1_LIMIT)
        if call.data.get(ATTR_EXPORT_TIER_1_RATE) is not None:
            sell_tiers["tier_1_rate"] = call.data.get(ATTR_EXPORT_TIER_1_RATE)
        if call.data.get(ATTR_EXPORT_TIER_2_RATE) is not None:
            sell_tiers["tier_2_rate"] = call.data.get(ATTR_EXPORT_TIER_2_RATE)
        try:
            record = PricingRateRecord.from_dict({
                "record_id": call.data.get(ATTR_RECORD_ID),
                "record_type": call.data.get(ATTR_RECORD_TYPE) or "buy",
                "label": call.data.get(ATTR_LABEL) or "",
                "day_types": day_types,
                "start_time": call.data.get(ATTR_EFFECTIVE_TIME) or "00:00",
                "end_time": call.data.get(ATTR_EFFECTIVE_END_TIME) or "23:59",
                "import_rate": call.data.get(ATTR_IMPORT_RATE),
                "export_rate": call.data.get(ATTR_EXPORT_RATE) if call.data.get(ATTR_EXPORT_RATE) is not None else call.data.get(ATTR_EXPORT_TIER_1_RATE),
                "controlled_load_rate": call.data.get(ATTR_CONTROLLED_LOAD_RATE),
                "other_charges": call.data.get(ATTR_OTHER_CHARGES) or "",
                "notes": call.data.get(ATTR_NOTES) or "",
                "metadata": {"sell_tiers": sell_tiers} if sell_tiers else {},
            })
        except ValueError as err:
            raise HomeAssistantError(str(err)) from err
        try:
            await store.async_upsert_record(group_id=group_id, record=record)
        except ValueError as err:
            raise HomeAssistantError(str(err)) from err
        _notify_pricing_changed(hass, entry_id)

    async def handle_pricing_remove_record(call: ServiceCall) -> None:
        store, entry_id = _pricing_store_for(hass, call)
        group_id = str(call.data.get(ATTR_GROUP_ID) or "").strip()
        record_id = str(call.data.get(ATTR_RECORD_ID) or "").strip()
        if not group_id:
            raise HomeAssistantError("group_id is required")
        if not record_id:
            raise HomeAssistantError("record_id is required")
        await store.async_remove_record(group_id=group_id, record_id=record_id)
        _notify_pricing_changed(hass, entry_id)

    async def handle_pricing_set_holidays(call: ServiceCall) -> None:
        store, entry_id = _pricing_store_for(hass, call)
        holiday_dates = call.data.get(ATTR_HOLIDAY_DATES) or []
        if isinstance(holiday_dates, str):
            holiday_dates = [item.strip() for item in holiday_dates.split(",") if item.strip()]
        await store.async_set_holidays(
            holiday_dates=list(holiday_dates),
            holiday_source=str(call.data.get(ATTR_HOLIDAY_SOURCE) or ""),
            region=str(call.data.get(ATTR_REGION) or ""),
        )
        _notify_pricing_changed(hass, entry_id)

    # ---------- Schemas ----------

    _time_schema = vol.All(cv.string)
    _soc_schema = vol.All(vol.Coerce(int), vol.Range(min=1, max=100))
    _feedin_power_schema = vol.All(vol.Coerce(int), vol.Range(min=0, max=FEEDIN_MAX_POWER_W))
    _entry_id_opt = {vol.Optional(ATTR_ENTRY_ID): cv.string}
    _history_schema = vol.Schema({
        vol.Required("scope_key"): cv.string,
        vol.Required("start_date"): cv.string,
        vol.Required("end_date"): cv.string,
        vol.Optional("force", default=False): cv.boolean,
        **_entry_id_opt,
    })
    _pricing_rule_schema = vol.Schema({
        vol.Optional(ATTR_RULE_ID): cv.string,
        vol.Required(ATTR_EFFECTIVE_DATE): cv.string,
        vol.Optional(ATTR_EFFECTIVE_TIME, default="00:00"): cv.string,
        vol.Optional(ATTR_EFFECTIVE_END_DATE): cv.string,
        vol.Optional(ATTR_EFFECTIVE_END_TIME): cv.string,
        vol.Optional(ATTR_PRICING_TYPE, default="fixed"): vol.In(["fixed", "dynamic"]),
        vol.Optional(ATTR_PROVIDER, default=""): cv.string,
        vol.Optional(ATTR_LABEL, default=""): cv.string,
        vol.Optional(ATTR_IMPORT_RATE): vol.Coerce(float),
        vol.Optional(ATTR_EXPORT_RATE): vol.Coerce(float),
        vol.Optional(ATTR_SUPPLY_CHARGE): vol.Coerce(float),
        vol.Optional(ATTR_CONTROLLED_LOAD_1): vol.Coerce(float),
        vol.Optional(ATTR_CONTROLLED_LOAD_2): vol.Coerce(float),
        vol.Optional(ATTR_ADDITIONAL_CHARGE): vol.Coerce(float),
        vol.Optional(ATTR_HOLIDAY_ONLY, default=False): cv.boolean,
        vol.Optional(ATTR_DAYS_OF_WEEK, default=[]): vol.All(cv.ensure_list, [cv.string]),
        vol.Optional(ATTR_NOTES, default=""): cv.string,
        vol.Optional(ATTR_REGION, default=""): cv.string,
        vol.Optional(ATTR_HOLIDAY_SOURCE, default=""): cv.string,
        **_entry_id_opt,
    })
    _pricing_holiday_schema = vol.Schema({
        vol.Required(ATTR_HOLIDAY_DATES): vol.All(cv.ensure_list, [cv.string]),
        vol.Optional(ATTR_HOLIDAY_SOURCE, default=""): cv.string,
        vol.Optional(ATTR_REGION, default=""): cv.string,
        **_entry_id_opt,
    })
    _pricing_group_schema = vol.Schema({
        vol.Optional(ATTR_GROUP_ID): cv.string,
        vol.Optional(ATTR_LABEL, default=""): cv.string,
        vol.Optional(ATTR_PROVIDER, default=""): cv.string,
        vol.Optional(ATTR_PLAN_NAME, default=""): cv.string,
        vol.Required(ATTR_EFFECTIVE_START_DATE): cv.string,
        vol.Optional(ATTR_PRICING_TYPE, default="dynamic"): vol.In(["fixed", "dynamic"]),
        vol.Optional(ATTR_DAILY_CONNECTION_CHARGE): vol.Coerce(float),
        vol.Optional(ATTR_OTHER_CHARGES, default=""): cv.string,
        vol.Optional(ATTR_NOTES, default=""): cv.string,
        **_entry_id_opt,
    })
    _pricing_record_schema = vol.Schema({
        vol.Required(ATTR_GROUP_ID): cv.string,
        vol.Optional(ATTR_RECORD_ID): cv.string,
        vol.Optional(ATTR_RECORD_TYPE, default="buy"): vol.In(["buy", "sell"]),
        vol.Optional(ATTR_LABEL, default=""): cv.string,
        vol.Required(ATTR_DAY_TYPES): vol.All(cv.ensure_list, [cv.string]),
        vol.Required(ATTR_EFFECTIVE_TIME): cv.string,
        vol.Required(ATTR_EFFECTIVE_END_TIME): cv.string,
        vol.Optional(ATTR_IMPORT_RATE): vol.Coerce(float),
        vol.Optional(ATTR_EXPORT_RATE): vol.Coerce(float),
        vol.Optional(ATTR_EXPORT_TIER_1_LIMIT): vol.Coerce(float),
        vol.Optional(ATTR_EXPORT_TIER_1_RATE): vol.Coerce(float),
        vol.Optional(ATTR_EXPORT_TIER_2_RATE): vol.Coerce(float),
        vol.Optional(ATTR_CONTROLLED_LOAD_RATE): vol.Coerce(float),
        vol.Optional(ATTR_OTHER_CHARGES, default=""): cv.string,
        vol.Optional(ATTR_NOTES, default=""): cv.string,
        **_entry_id_opt,
    })

    hass.services.async_register(
        DOMAIN, SERVICE_SET_DISCHARGE_TIME, handle_set_discharge_time,
        schema=vol.Schema({vol.Required(ATTR_END_DISCHARGE): _time_schema, **_entry_id_opt}),
    )
    hass.services.async_register(
        DOMAIN, SERVICE_SET_DISCHARGE_START_TIME, handle_set_discharge_start_time,
        schema=vol.Schema({vol.Required(ATTR_START_DISCHARGE): _time_schema, **_entry_id_opt}),
    )
    hass.services.async_register(
        DOMAIN, SERVICE_SET_CHARGE_START_TIME, handle_set_charge_start_time,
        schema=vol.Schema({vol.Required(ATTR_START_CHARGE): _time_schema, **_entry_id_opt}),
    )
    hass.services.async_register(
        DOMAIN, SERVICE_SET_CHARGE_END_TIME, handle_set_charge_end_time,
        schema=vol.Schema({vol.Required(ATTR_END_CHARGE): _time_schema, **_entry_id_opt}),
    )
    hass.services.async_register(
        DOMAIN, SERVICE_SET_MINIMUM_SOC, handle_set_minimum_soc,
        schema=vol.Schema({vol.Required(ATTR_MINIMUM_SOC): _soc_schema, **_entry_id_opt}),
    )
    hass.services.async_register(
        DOMAIN, SERVICE_SET_CHARGE_CAP, handle_set_charge_cap,
        schema=vol.Schema({vol.Required(ATTR_CHARGE_CAP): _soc_schema, **_entry_id_opt}),
    )
    hass.services.async_register(
        DOMAIN, SERVICE_UPDATE_BATTERY_SETTINGS, handle_update_battery_settings,
        schema=vol.Schema({
            vol.Optional(ATTR_START_DISCHARGE): _time_schema,
            vol.Optional(ATTR_END_DISCHARGE): _time_schema,
            vol.Optional(ATTR_START_CHARGE): _time_schema,
            vol.Optional(ATTR_END_CHARGE): _time_schema,
            vol.Optional(ATTR_MINIMUM_SOC): _soc_schema,
            vol.Optional(ATTR_CHARGE_CAP): _soc_schema,
            **_entry_id_opt,
        }),
    )
    hass.services.async_register(
        DOMAIN, SERVICE_START_FORCE_CHARGE, handle_start_force_charge,
        schema=vol.Schema({
            vol.Optional(ATTR_CHARGE_CAP, default=100): _soc_schema,
            **_entry_id_opt,
        }),
    )
    hass.services.async_register(
        DOMAIN, SERVICE_STOP_FORCE_CHARGE, handle_stop_force_charge,
        schema=vol.Schema(_entry_id_opt),
    )
    hass.services.async_register(
        DOMAIN, SERVICE_SET_GRID_FEEDIN_ENABLED, handle_set_grid_feedin_enabled,
        schema=vol.Schema({vol.Required(ATTR_FEEDIN_ENABLED): cv.boolean, **_entry_id_opt}),
    )
    hass.services.async_register(
        DOMAIN, SERVICE_SET_GRID_FEEDIN_CUTOFF_SOC, handle_set_grid_feedin_cutoff_soc,
        schema=vol.Schema({
            vol.Required(ATTR_FEEDIN_CUTOFF_SOC): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
            **_entry_id_opt,
        }),
    )
    hass.services.async_register(
        DOMAIN, SERVICE_UPDATE_GRID_FEEDIN_SLOT, handle_update_grid_feedin_slot,
        schema=vol.Schema({
            vol.Required(ATTR_FEEDIN_SLOT): vol.All(vol.Coerce(int), vol.Range(min=1, max=FEEDIN_MAX_SLOTS)),
            vol.Optional(ATTR_FEEDIN_START): _time_schema,
            vol.Optional(ATTR_FEEDIN_END): _time_schema,
            vol.Optional(ATTR_FEEDIN_POWER): _feedin_power_schema,
            **_entry_id_opt,
        }),
    )
    hass.services.async_register(
        DOMAIN, SERVICE_FORCE_RECONNECT, handle_force_reconnect,
        schema=vol.Schema(_entry_id_opt),
    )
    hass.services.async_register(
        DOMAIN, SERVICE_HEALTH_CHECK, handle_health_check,
        schema=vol.Schema(_entry_id_opt),
    )
    hass.services.async_register(
        DOMAIN, SERVICE_TOGGLE_DIAGNOSTICS, handle_toggle_diagnostics,
        schema=vol.Schema({vol.Optional("enable"): cv.boolean, **_entry_id_opt}),
    )
    hass.services.async_register(
        DOMAIN, SERVICE_PRICING_UPSERT_RULE, handle_pricing_upsert_rule,
        schema=_pricing_rule_schema,
    )
    hass.services.async_register(
        DOMAIN, SERVICE_PRICING_REMOVE_RULE, handle_pricing_remove_rule,
        schema=vol.Schema({vol.Required(ATTR_RULE_ID): cv.string, **_entry_id_opt}),
    )
    hass.services.async_register(
        DOMAIN, SERVICE_PRICING_SET_HOLIDAYS, handle_pricing_set_holidays,
        schema=_pricing_holiday_schema,
    )
    hass.services.async_register(
        DOMAIN, SERVICE_PRICING_UPSERT_GROUP, handle_pricing_upsert_group,
        schema=_pricing_group_schema,
    )
    hass.services.async_register(
        DOMAIN, SERVICE_PRICING_REMOVE_GROUP, handle_pricing_remove_group,
        schema=vol.Schema({vol.Required(ATTR_GROUP_ID): cv.string, **_entry_id_opt}),
    )
    hass.services.async_register(
        DOMAIN, SERVICE_PRICING_UPSERT_RECORD, handle_pricing_upsert_record,
        schema=_pricing_record_schema,
    )
    hass.services.async_register(
        DOMAIN, SERVICE_PRICING_REMOVE_RECORD, handle_pricing_remove_record,
        schema=vol.Schema({
            vol.Required(ATTR_GROUP_ID): cv.string,
            vol.Required(ATTR_RECORD_ID): cv.string,
            **_entry_id_opt,
        }),
    )
    hass.services.async_register(
        DOMAIN, "ensure_report_history", handle_ensure_report_history,
        schema=_history_schema,
    )
