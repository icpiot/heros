"""Select entities for the Byte-Watt integration."""
from __future__ import annotations

from typing import Any

from homeassistant.components.select import SelectEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity import EntityCategory
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DEVICE_MANUFACTURER, DEVICE_MODEL, DEVICE_NAME, DOMAIN
from .const import CONF_HISTORY_BACKFILL_YEARS, DEFAULT_HISTORY_BACKFILL_YEARS
from .coordinator import ByteWattDataUpdateCoordinator
from .reporting import build_reporting_payload

try:  # pragma: no cover - test harness may stub reporting without this helper
    from .reporting import ByteWattReportHistory
except ImportError:  # pragma: no cover - fallback for focused unit tests
    ByteWattReportHistory = None  # type: ignore[assignment]
from .settings_manager import SettingsManager
from .topology import ByteWattScope, DiscoveredInverter

_CYCLE_OPTIONS = ["Daily", "Weekly"]


def _reporting_payload(
    battery_data: dict[str, Any],
    *,
    aggregate: bool,
    label: str,
    history_hint: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a compact reporting payload for custom Lovelace cards."""
    payload = build_reporting_payload(battery_data, aggregate=aggregate, label=label)
    power_diagram = payload.get("power_diagram") or {}
    payload["power_diagram"] = {
        **power_diagram,
        "date": power_diagram.get("date") or payload.get("reporting_date") or "",
        "meta": power_diagram.get("meta") or {},
        "summary": power_diagram.get("summary") or {},
        "time": power_diagram.get("time") or [],
        "series": power_diagram.get("series") or {},
    }
    meta = payload.setdefault("meta", {})
    meta["history"] = history_hint or {}
    return payload


def _compact_summary(value: dict[str, Any] | None, keys: list[str]) -> dict[str, Any]:
    """Keep only a small set of keys for recorder-safe entity attributes."""
    source = value or {}
    return {key: source.get(key) for key in keys if key in source}


def _direct_api_summary(value: dict[str, Any] | None) -> dict[str, Any]:
    """Expose the direct ByteWatt real-time fields used by the setup page."""
    source = value or {}
    return {
        "soc": source.get("soc"),
        "pbat": source.get("pbat"),
        "pload": source.get("pload"),
        "pgrid": source.get("pgrid"),
        "ppv": source.get("ppv"),
        "ppv1": source.get("ppv1"),
        "ppv2": source.get("ppv2"),
        "ppv3": source.get("ppv3"),
        "ppv4": source.get("ppv4"),
        "powerSource": source.get("powerSource"),
    }


def _history_backfill_days(config_entry: ConfigEntry) -> int:
    """Return the configured archive horizon in days."""
    raw_years = config_entry.options.get(CONF_HISTORY_BACKFILL_YEARS, DEFAULT_HISTORY_BACKFILL_YEARS)
    try:
        years = int(raw_years)
    except (TypeError, ValueError):
        years = DEFAULT_HISTORY_BACKFILL_YEARS
    return max(1, years) * 365


async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator = hass.data[DOMAIN][config_entry.entry_id]["coordinator"]
    manager = hass.data[DOMAIN][config_entry.entry_id]["manager"]

    async_add_entities([
        ByteWattSettingsTargetSelect(hass, coordinator, config_entry, manager),
        ByteWattExecutionCycleSelect(coordinator, config_entry, manager),
    ])


class ByteWattSettingsTargetSelect(CoordinatorEntity, SelectEntity):
    """Select which discovered battery/inverter receives settings writes."""

    _attr_entity_category = EntityCategory.CONFIG

    def __init__(
        self,
        hass: HomeAssistant,
        coordinator: ByteWattDataUpdateCoordinator,
        config_entry: ConfigEntry,
        manager: SettingsManager,
    ) -> None:
        super().__init__(coordinator)
        self._hass = hass
        self._config_entry = config_entry
        self._manager = manager
        self._attr_name = "Settings Target"
        self._attr_unique_id = f"{config_entry.entry_id}_settings_target"
        self._attr_icon = "mdi:battery-switch"

    @property
    def device_info(self) -> dict[str, Any]:
        return {
            "identifiers": {(DOMAIN, self._config_entry.entry_id)},
            "name": DEVICE_NAME,
            "manufacturer": DEVICE_MANUFACTURER,
            "model": DEVICE_MODEL,
        }

    def _live_inventory(self) -> list[DiscoveredInverter]:
        coordinator_data = self.coordinator.data or {}
        live_batteries = coordinator_data.get("live_battery_power", {}).get("batteries", [])
        if live_batteries:
            recovered: list[DiscoveredInverter] = []
            seen: set[tuple[str, str]] = set()
            for index, battery in enumerate(live_batteries, start=1):
                system_id = str(battery.get("system_id", "") or "").strip()
                sys_sn = str(battery.get("sys_sn", "") or "").strip()
                label = str(battery.get("label", "") or "").strip()
                if not label:
                    label = sys_sn or system_id or f"Battery {index}"
                remark = label if label not in {sys_sn, system_id} else ""
                key = (system_id, sys_sn or label)
                if key in seen:
                    continue
                seen.add(key)
                recovered.append(
                    DiscoveredInverter(
                        system_id=system_id,
                        sys_sn=sys_sn,
                        remark=remark,
                    )
                )
            if recovered:
                return recovered
        return []

    def _inventory(self) -> list[DiscoveredInverter]:
        inventory = self._hass.data[DOMAIN][self._config_entry.entry_id].get("inverters", [])
        live_inventory = self._live_inventory()
        merged: dict[tuple[str, str], DiscoveredInverter] = {}
        for inverter in live_inventory:
            key = (
                str(inverter.system_id or "").strip(),
                str(inverter.sys_sn or inverter.display_name).strip(),
            )
            merged[key] = inverter
        for inverter in inventory:
            key = (
                str(inverter.system_id or "").strip(),
                str(inverter.sys_sn or inverter.display_name).strip(),
            )
            merged.setdefault(key, inverter)
        if merged:
            return list(merged.values())
        current_id = self._manager.current_settings_target_id
        current_sys_sn = self._manager.current_settings_target_sys_sn
        if not current_id and current_sys_sn == "All":
            return []
        if current_id or current_sys_sn:
            return [DiscoveredInverter(system_id=current_id, sys_sn=current_sys_sn)]
        return []

    def _options_map(self) -> dict[str, DiscoveredInverter]:
        options: dict[str, DiscoveredInverter] = {}
        used_labels: set[str] = set()
        for inverter in self._inventory():
            label = inverter.display_name
            if label in used_labels:
                label = f"{label} [{inverter.system_id or inverter.sys_sn}]"
            used_labels.add(label)
            options[label] = inverter
        return options

    def _selected_scope(self) -> ByteWattScope | None:
        entry_data = self._hass.data.get(DOMAIN, {}).get(self._config_entry.entry_id, {})
        scope = entry_data.get("settings_scope")
        return scope if isinstance(scope, ByteWattScope) else None

    def _current_inverter(self) -> DiscoveredInverter | None:
        selected_scope = self._selected_scope()
        current_id = ""
        current_sys_sn = ""
        if selected_scope is not None:
            current_id = str(selected_scope.effective_system_id or selected_scope.system_id or "").strip()
            current_sys_sn = str(selected_scope.settings_sys_sn or selected_scope.sys_sn or "").strip()
            if selected_scope.aggregate:
                return None
        else:
            current_id = str(self._manager.current_settings_target_id or "").strip()
            current_sys_sn = str(self._manager.current_settings_target_sys_sn or "").strip()
        for inverter in self._inventory():
            if current_id and inverter.system_id == current_id:
                return inverter
            if current_sys_sn and inverter.sys_sn == current_sys_sn:
                return inverter
        return None

    async def async_update(self) -> None:
        """Refresh the coordinator when Home Assistant asks for an entity update."""
        await self.coordinator.async_request_refresh()

    @property
    def options(self) -> list[str]:
        labels = list(self._options_map())
        return ["All systems", *labels]

    @property
    def available(self) -> bool:
        return bool(self.options)

    @property
    def current_option(self) -> str | None:
        selected_scope = self._selected_scope()
        if selected_scope is not None and selected_scope.aggregate:
            return "All systems"
        current = self._current_inverter()
        if current is not None:
            for label, inverter in self._options_map().items():
                if inverter.system_id == current.system_id or (
                    current.sys_sn and inverter.sys_sn == current.sys_sn
                ):
                    return label
        if selected_scope is not None:
            scope_label = str(selected_scope.label or selected_scope.sys_sn or "").strip()
            if scope_label and scope_label in self.options:
                return scope_label
        for label, inverter in self._options_map().items():
            if inverter.system_id == self._manager.current_settings_target_id:
                return label
        return "All systems" if self.options else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        current = self._current_inverter()
        selected_scope = self._selected_scope()
        coordinator_data = self.coordinator.data or {}
        aggregate_battery = coordinator_data.get("battery") or {}
        selected_battery = coordinator_data.get("selected_battery") or {}
        raw_backfill_years = self._config_entry.options.get(CONF_HISTORY_BACKFILL_YEARS, DEFAULT_HISTORY_BACKFILL_YEARS)
        try:
            backfill_years = max(1, int(raw_backfill_years or DEFAULT_HISTORY_BACKFILL_YEARS))
        except (TypeError, ValueError):
            backfill_years = DEFAULT_HISTORY_BACKFILL_YEARS
        history_hint = {
            "enabled": True,
            "base_url": f"/local/home-energy-manager-history/{self._config_entry.entry_id}/",
            "status": str(
                self._hass.data.get(DOMAIN, {})
                .get(self._config_entry.entry_id, {})
                .get("history_status", "")
            ).strip(),
            "current_scope": (
                selected_scope.sys_sn
                if selected_scope is not None and not selected_scope.aggregate
                else current.sys_sn if current is not None
                else "all"
            ),
            "entry_id": self._config_entry.entry_id,
            "backfill_years": backfill_years,
            "backfill_days": _history_backfill_days(self._config_entry),
        }
        inventory_scopes: list[dict[str, Any]] = [{
            "scope_key": "all",
            "label": "All systems",
            "aggregate": True,
        }]
        seen_scope_keys = {"all"}
        for inverter in self._inventory():
            scope_key = str(inverter.sys_sn or inverter.system_id or "").strip()
            if not scope_key or scope_key in seen_scope_keys:
                continue
            seen_scope_keys.add(scope_key)
            inventory_scopes.append({
                "scope_key": scope_key,
                "label": inverter.display_name,
                "aggregate": False,
            })
        history_scope_key = str(history_hint["current_scope"] or "all").strip() or "all"
        history_summary = {}
        current_scope_label = (
            selected_scope.label
            if selected_scope is not None and not selected_scope.aggregate
            else current.display_name
            if current is not None
            else history_scope_key
        )
        if history_scope_key not in seen_scope_keys and history_scope_key != "all":
            inventory_scopes.append({
                "scope_key": history_scope_key,
                "label": str(current_scope_label or history_scope_key).strip() or history_scope_key,
                "aggregate": False,
            })
        history_hint["inventory_scopes"] = inventory_scopes
        try:
            if ByteWattReportHistory is not None:
                history_store = ByteWattReportHistory(
                    self._hass,
                    self._config_entry.entry_id,
                )
                history_summary = history_store.scope_summary_sync(history_scope_key)
                base_url = str(history_hint.get("base_url") or "").rstrip("/")
                scope_summaries: list[dict[str, Any]] = []
                for scope in inventory_scopes:
                    scope_key = str(scope.get("scope_key") or "").strip()
                    if not scope_key:
                        continue
                    scope_summary = history_store.scope_summary_sync(scope_key)
                    csv_filename = str(scope_summary.get("csv_filename") or "").strip()
                    history_filename = str(scope_summary.get("history_filename") or "").strip()
                    if base_url and csv_filename:
                        scope_summary["csv_url"] = f"{base_url}/{csv_filename}"
                    if base_url and history_filename:
                        scope_summary["history_url"] = f"{base_url}/{history_filename}"
                    scope_summaries.append({
                        "scope_key": scope_key,
                        "label": str(scope.get("label") or scope_key),
                        "aggregate": bool(scope.get("aggregate")),
                        **scope_summary,
                    })
                history_hint["scope_summaries"] = scope_summaries
        except Exception:  # noqa: BLE001
            history_summary = {}
        if history_summary:
            base_url = str(history_hint.get("base_url") or "").rstrip("/")
            csv_filename = str(history_summary.get("csv_filename") or "").strip()
            history_filename = str(history_summary.get("history_filename") or "").strip()
            if base_url and csv_filename:
                history_summary["csv_url"] = f"{base_url}/{csv_filename}"
            if base_url and history_filename:
                history_summary["history_url"] = f"{base_url}/{history_filename}"
            history_hint["scope_summary"] = history_summary
        is_aggregate_scope = selected_scope.aggregate if selected_scope is not None else current is None
        selected_scope_is_battery = selected_scope is not None and not selected_scope.aggregate
        selected_payload = (
            selected_battery
            if selected_scope_is_battery
            else aggregate_battery
        )
        monitoring_summary = _compact_summary(
            selected_payload,
            ["soc", "pbat", "pload", "pgrid", "ppv", "powerSource"],
        )
        selection_summary = {
            "label": (
                selected_scope.label
                if selected_scope_is_battery
                else "All systems"
                if is_aggregate_scope
                else current.display_name
                if current is not None
                else "All systems"
            ),
            "system_id": selected_scope.system_id if selected_scope_is_battery else "" if is_aggregate_scope else current.system_id if current is not None else "",
            "sys_sn": selected_scope.sys_sn if selected_scope_is_battery else "All" if is_aggregate_scope else current.sys_sn if current is not None else "All",
            "remark": selected_scope.label if selected_scope_is_battery else "" if is_aggregate_scope else current.remark if current is not None else "",
        }
        reporting = _reporting_payload(
            selected_payload,
            aggregate=is_aggregate_scope,
            label=selection_summary["label"],
            history_hint=history_hint,
        )
        reporting_meta = reporting.get("meta") or {}
        timezone_obj = getattr(self.coordinator.client, "_timezone", None)
        timezone_name = (
            getattr(timezone_obj, "key", "")
            or getattr(self.coordinator.client, "timezone_code", "")
            or ""
        )
        reporting_summary = {
            "label": reporting.get("label"),
            "aggregate": reporting.get("aggregate"),
            "reporting_date": reporting.get("reporting_date"),
            "saved_at": reporting_meta.get("saved_at"),
            "meta": {
                "saved_at": reporting_meta.get("saved_at"),
                "source": reporting_meta.get("source") or "backend_reporting",
                "storage": reporting_meta.get("storage") or "local_archive",
                "power_diagram_source": reporting_meta.get("power_diagram_source") or "provider_power_diagram",
                "history": reporting_meta.get("history") or {},
                "timezone": timezone_name,
                "timezone_code": getattr(self.coordinator.client, "timezone_code", "") or "",
            },
            "history": reporting_meta.get("history") or {},
            "live": _compact_summary(reporting.get("live"), ["soc", "battery_power", "house_consumption", "grid_power", "pv_power", "power_source"]),
            "today": _compact_summary(reporting.get("today"), ["solar_generation", "load_consumption", "feed_in", "grid_consumption", "battery_charge", "battery_discharge"]),
            "totals": _compact_summary(reporting.get("totals"), ["solar_generation", "feed_in", "battery_charge", "battery_discharge", "house_consumption", "grid_consumption"]),
            "power_diagram": _compact_summary(reporting.get("power_diagram"), ["date", "meta", "summary", "time", "series"]),
            "selection": selection_summary,
        }
        battery_policy = self._manager.battery_policy_summary()
        live_battery_power = coordinator_data.get("live_battery_power") or getattr(
            self.coordinator,
            "live_battery_power_summary",
            {},
        )
        battery_policy_summary = {
            "execution_cycle_label": battery_policy.get("execution_cycle_label"),
            "charge_slot_limit": battery_policy.get("charge_slot_limit"),
            "discharge_slot_limit": battery_policy.get("discharge_slot_limit"),
            "force_charge_active": battery_policy.get("force_charge_active"),
            "live_batteries": live_battery_power.get("batteries", []),
            "total_charge_rate_w": live_battery_power.get("total_charge_rate_w"),
            "total_discharge_rate_w": live_battery_power.get("total_discharge_rate_w"),
            "any_charging": live_battery_power.get("any_charging"),
            "partial_charging": live_battery_power.get("partial_charging"),
        }
        direct_api = {
            "all_systems": _direct_api_summary(aggregate_battery),
            "selected_scope": _direct_api_summary(
                selected_payload
            ),
            "live_batteries": [
                {
                    "label": battery.get("label"),
                    "system_id": battery.get("system_id"),
                    "sys_sn": battery.get("sys_sn"),
                    "soc": battery.get("soc"),
                    "pbat": battery.get("pbat"),
                    "pload": battery.get("load_w"),
                    "pgrid": battery.get("grid_w"),
                    "ppv": battery.get("solar_w"),
                    "ppv1": battery.get("ppv1"),
                    "ppv2": battery.get("ppv2"),
                    "ppv3": battery.get("ppv3"),
                    "ppv4": battery.get("ppv4"),
                    "powerSource": battery.get("power_source"),
                    "forceChargeMode": battery.get("force_charge_mode"),
                }
                for battery in live_battery_power.get("batteries", [])
            ],
        }
        feedin_policy = self._manager.feedin_policy_summary()
        if current is None:
            return {
                "selection": selection_summary,
                "monitoring_summary": monitoring_summary,
                "reporting": reporting_summary,
                "history": history_hint,
                "battery_policy": battery_policy_summary,
                "direct_api": direct_api,
                "feedin_policy": {
                    "enabled": feedin_policy.get("enabled"),
                    "cutoff_soc": feedin_policy.get("cutoff_soc"),
                    "slot_limit": feedin_policy.get("slot_limit"),
                },
            }
        return {
            "selection": selection_summary,
            "monitoring_summary": monitoring_summary,
            "reporting": reporting_summary,
            "history": history_hint,
            "battery_policy": battery_policy_summary,
            "direct_api": direct_api,
            "feedin_policy": {
                "enabled": feedin_policy.get("enabled"),
                "cutoff_soc": feedin_policy.get("cutoff_soc"),
                "slot_limit": feedin_policy.get("slot_limit"),
            },
        }

    async def async_select_option(self, option: str) -> None:
        if option == "All systems":
            scope = ByteWattScope(
                system_id="",
                sys_sn="All",
                label="All systems",
                aggregate=True,
                settings_system_id="",
                settings_sys_sn="",
            )
            await self._manager.async_select_settings_target(scope)
            self._hass.data[DOMAIN][self._config_entry.entry_id]["settings_scope"] = scope
            # Publish the target before the provider refresh, which can take
            # several seconds, so the panel never falls back to the old scope.
            self.async_write_ha_state()
            await self.coordinator.async_request_refresh()
            self.async_write_ha_state()
            return
        inverter = self._options_map().get(option)
        if inverter is None:
            raise HomeAssistantError(f"Unknown settings target: {option}")

        await self._manager.async_select_settings_target(inverter.to_settings_scope())
        self._hass.data[DOMAIN][self._config_entry.entry_id]["settings_scope"] = (
            inverter.to_settings_scope()
        )
        self.async_write_ha_state()
        await self.coordinator.async_request_refresh()
        self.async_write_ha_state()


class ByteWattExecutionCycleSelect(CoordinatorEntity, SelectEntity):
    """Select entity for the cycle strategy execution mode."""

    _attr_entity_category = EntityCategory.CONFIG
    _attr_options = _CYCLE_OPTIONS

    def __init__(
        self,
        coordinator: ByteWattDataUpdateCoordinator,
        config_entry: ConfigEntry,
        manager: SettingsManager,
    ) -> None:
        super().__init__(coordinator)
        self._config_entry = config_entry
        self._manager = manager
        self._attr_name = "Execution Cycle"
        self._attr_unique_id = f"{config_entry.entry_id}_execution_cycle_type"
        self._attr_icon = "mdi:calendar-sync"

    @property
    def device_info(self) -> dict[str, Any]:
        return {
            "identifiers": {(DOMAIN, self._config_entry.entry_id)},
            "name": DEVICE_NAME,
            "manufacturer": DEVICE_MANUFACTURER,
            "model": DEVICE_MODEL,
        }

    @property
    def available(self) -> bool:
        return self._manager.battery_cache is not None

    @property
    def current_option(self) -> str | None:
        value = self._manager.effective_battery("execute_cycle_type")
        if value is None:
            return None
        return _CYCLE_OPTIONS[int(value)] if int(value) in (0, 1) else None

    async def async_select_option(self, option: str) -> None:
        value = 0 if option == "Daily" else 1
        result = await self._manager.submit_battery_one_shot(
            {"execute_cycle_type": value}
        )
        if not result.battery_ok:
            detail = result.battery_error or "see logs for details"
            raise HomeAssistantError(f"Battery settings update failed: {detail}")
        await self.coordinator.async_request_refresh()
        self.async_write_ha_state()
