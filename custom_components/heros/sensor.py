"""Sensor platform for HEROS integration."""
import logging
from typing import Callable, Dict, Optional, Any
from datetime import datetime

from homeassistant.components.sensor import SensorEntity, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity import EntityCategory
from homeassistant.helpers.update_coordinator import (
    CoordinatorEntity,
    DataUpdateCoordinator,
)
from homeassistant.util import dt as dt_util
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import (
    DEVICE_MANUFACTURER,
    DEVICE_MODEL,
    DEVICE_NAME,
    DOMAIN,
    SENSOR_SOC,
    SENSOR_GRID_CONSUMPTION,
    SENSOR_HOUSE_CONSUMPTION,
    SENSOR_BATTERY_POWER,
    SENSOR_PV,
    SENSOR_LAST_UPDATE,
    SENSOR_BATTERY_TEMPERATURE,
    SENSOR_BATTERY_VOLTAGE,
    SENSOR_BATTERY_CURRENT,
    SENSOR_BATTERY_CYCLES,
    SENSOR_BATTERY_STATE_OF_HEALTH,
    SENSOR_GRID_VOLTAGE,
    SENSOR_GRID_CURRENT,
    SENSOR_GRID_FREQUENCY,
    SENSOR_INVERTER_TEMPERATURE,
    SENSOR_OPERATING_MODE,
    SENSOR_FAULT_CODE,
    SENSOR_ALARM_STATE,
    SENSOR_POWER_FACTOR,
    SENSOR_REACTIVE_POWER,
    SENSOR_BACKUP_OUTPUT_POWER,
    SENSOR_BACKUP_LOAD_POWER,
    SENSOR_EPS_OUTPUT_POWER,
    SENSOR_PV_STRING_1_VOLTAGE,
    SENSOR_PV_STRING_1_CURRENT,
    SENSOR_PV_STRING_2_VOLTAGE,
    SENSOR_PV_STRING_2_CURRENT,
    SENSOR_PV_INPUT_TOTAL_POWER,
    SENSOR_BATTERY_USABLE_CAPACITY,
    SENSOR_BATTERY_REMAINING_CAPACITY,
    SENSOR_COMMUNICATION_STATUS,
    SENSOR_SOLAR_FORECAST,
    SENSOR_FORECAST_GENERATION_TODAY,
    SENSOR_FORECAST_GENERATION_TOMORROW,
    SENSOR_TARIFF_CURRENT_PRICE,
    SENSOR_TARIFF_NEXT_PRICE,
    SENSOR_DYNAMIC_PRICING_ENABLED,
    SENSOR_EXPORT_SPIKE_PRICE,
    SENSOR_BATTERY_WEAR_COST,
    SENSOR_DAILY_COST_ESTIMATE,
    SENSOR_DAILY_INCOME_ESTIMATE,
    SENSOR_PRICING_SCHEDULE,
    SENSOR_POLICY_CHARGE_SCHEDULE,
    SENSOR_TOTAL_SOLAR,
    SENSOR_TOTAL_FEED_IN,
    SENSOR_TOTAL_BATTERY_CHARGE,
    SENSOR_PV_POWER_HOUSE,
    SENSOR_PV_CHARGING_BATTERY,
    SENSOR_TOTAL_HOUSE_CONSUMPTION,
    SENSOR_GRID_BATTERY_CHARGE,
    SENSOR_GRID_POWER_CONSUMPTION,
    SENSOR_PV_GENERATED_TODAY,
    SENSOR_CONSUMED_TODAY,
    SENSOR_FEED_IN_TODAY,
    SENSOR_GRID_IMPORT_TODAY,
    SENSOR_BATTERY_CHARGED_TODAY,
    SENSOR_BATTERY_DISCHARGED_TODAY,
    SENSOR_SELF_CONSUMPTION,
    SENSOR_SELF_SUFFICIENCY,
    SENSOR_TREES_PLANTED,
    SENSOR_CO2_REDUCTION,
    SENSOR_TOTAL_BATTERY_DISCHARGE,
    signal_pricing_changed,
    signal_policy_charge_changed,
)

from .policy_charge_store import PolicyChargeScheduleStore
from .pricing_store import PricingScheduleStore

_LOGGER = logging.getLogger(__name__)

async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
):
    """Set up the Byte-Watt sensor platform."""
    coordinator = hass.data[DOMAIN][entry.entry_id]["coordinator"]
    
    # Define SOC sensors
    soc_sensors = [
        ByteWattSensor(
            coordinator, 
            entry, 
            SENSOR_SOC, 
            "Battery Percentage", 
            "battery", 
            "soc", 
            "%", 
            "mdi:battery"
        ),
        ByteWattSensor(
            coordinator, 
            entry, 
            SENSOR_GRID_CONSUMPTION, 
            "Grid Consumption", 
            "power", 
            "pgrid", 
            "W", 
            "mdi:transmission-tower"
        ),
        ByteWattSensor(
            coordinator, 
            entry, 
            SENSOR_HOUSE_CONSUMPTION, 
            "House Consumption", 
            "power", 
            "pload", 
            "W", 
            "mdi:home-lightning-bolt"
        ),
        ByteWattSensor(
            coordinator, 
            entry, 
            SENSOR_BATTERY_POWER, 
            "Battery Power", 
            "power", 
            "pbat", 
            "W", 
            "mdi:battery-charging"
        ),
        ByteWattSensor(
            coordinator, 
            entry, 
            SENSOR_PV, 
            "PV Power", 
            "power", 
            "ppv", 
            "W", 
            "mdi:solar-power"
        ),
        ByteWattLastUpdateSensor(
            coordinator, 
            entry, 
            SENSOR_LAST_UPDATE, 
            "Last Update", 
            "timestamp", 
            "", 
            "mdi:clock-outline",
            entity_category=EntityCategory.DIAGNOSTIC
        ),
    ]
    
    # Define grid stats sensors - modified to use "energy" device_class for kWh sensors
    grid_sensors = [
        ByteWattGridSensor(
            coordinator, 
            entry, 
            SENSOR_TOTAL_SOLAR, 
            "Total Solar Generation", 
            "energy",  # Changed to "energy" for Energy Dashboard
            "Total_Solar_Generation", 
            "kWh", 
            "mdi:solar-power"
        ),
        ByteWattGridSensor(
            coordinator, 
            entry, 
            SENSOR_TOTAL_FEED_IN, 
            "Total Feed In", 
            "energy",  # Changed to "energy" for Energy Dashboard
            "Total_Feed_In", 
            "kWh", 
            "mdi:transmission-tower-export"
        ),
        ByteWattGridSensor(
            coordinator, 
            entry, 
            SENSOR_TOTAL_BATTERY_CHARGE, 
            "Total Battery Charge", 
            "energy",  # Changed to "energy" for Energy Dashboard
            "Total_Battery_Charge", 
            "kWh", 
            "mdi:battery-charging"
        ),
        ByteWattGridSensor(
            coordinator,
            entry,
            SENSOR_TOTAL_BATTERY_DISCHARGE,
            "Total Battery Discharge",
            "energy",
            "Total_Battery_Discharge",
            "kWh",
            "mdi:battery-minus"
        ),
        ByteWattGridSensor(
            coordinator, 
            entry, 
            SENSOR_PV_POWER_HOUSE, 
            "PV Power to House", 
            "energy",  # Changed to "energy" for Energy Dashboard
            "PV_Power_House", 
            "kWh", 
            "mdi:solar-power-variant"
        ),
        ByteWattGridSensor(
            coordinator, 
            entry, 
            SENSOR_PV_CHARGING_BATTERY, 
            "PV Charging Battery", 
            "energy",  # Changed to "energy" for Energy Dashboard
            "PV_Charging_Battery", 
            "kWh", 
            "mdi:solar-power-variant-outline"
        ),
        ByteWattGridSensor(
            coordinator, 
            entry, 
            SENSOR_TOTAL_HOUSE_CONSUMPTION, 
            "Total House Consumption", 
            "energy",  # Changed to "energy" for Energy Dashboard
            "Total_House_Consumption", 
            "kWh", 
            "mdi:home-lightning-bolt"
        ),
        ByteWattGridSensor(
            coordinator, 
            entry, 
            SENSOR_GRID_BATTERY_CHARGE, 
            "Grid Based Battery Charge", 
            "energy",  # Changed to "energy" for Energy Dashboard
            "Grid_Based_Battery_Charge", 
            "kWh", 
            "mdi:transmission-tower-import"
        ),
        ByteWattGridSensor(
            coordinator, 
            entry, 
            SENSOR_GRID_POWER_CONSUMPTION, 
            "Grid Power Consumption", 
            "energy",  # Changed to "energy" for Energy Dashboard
            "Grid_Power_Consumption", 
            "kWh", 
            "mdi:transmission-tower"
        ),
    ]
    
    
    # Define daily stats sensors
    daily_stats_sensors = [
        ByteWattGridSensor(
            coordinator, 
            entry, 
            SENSOR_PV_GENERATED_TODAY, 
            "PV Generated Today", 
            "energy",
            "PV_Generated_Today", 
            "kWh", 
            "mdi:solar-power"
        ),
        ByteWattGridSensor(
            coordinator, 
            entry, 
            SENSOR_CONSUMED_TODAY, 
            "Consumed Today", 
            "energy",
            "Consumed_Today", 
            "kWh", 
            "mdi:home-lightning-bolt"
        ),
        ByteWattGridSensor(
            coordinator, 
            entry, 
            SENSOR_FEED_IN_TODAY, 
            "Feed In Today", 
            "energy",
            "Feed_In_Today", 
            "kWh", 
            "mdi:transmission-tower-export"
        ),
        ByteWattGridSensor(
            coordinator, 
            entry, 
            SENSOR_GRID_IMPORT_TODAY, 
            "Grid Import Today", 
            "energy",
            "Grid_Import_Today", 
            "kWh", 
            "mdi:transmission-tower-import"
        ),
        ByteWattGridSensor(
            coordinator, 
            entry, 
            SENSOR_BATTERY_CHARGED_TODAY, 
            "Battery Charged Today", 
            "energy",
            "Battery_Charged_Today", 
            "kWh", 
            "mdi:battery-plus"
        ),
        ByteWattGridSensor(
            coordinator, 
            entry, 
            SENSOR_BATTERY_DISCHARGED_TODAY, 
            "Battery Discharged Today", 
            "energy",
            "Battery_Discharged_Today", 
            "kWh", 
            "mdi:battery-minus"
        ),
        ByteWattSensor(
            coordinator, 
            entry, 
            SENSOR_SELF_CONSUMPTION, 
            "Self Consumption", 
            None,  # No device class for percentage
            "Self_Consumption", 
            "%", 
            "mdi:home-battery"
        ),
        ByteWattSensor(
            coordinator, 
            entry, 
            SENSOR_SELF_SUFFICIENCY, 
            "Self Sufficiency", 
            None,  # No device class for percentage
            "Self_Sufficiency", 
            "%", 
            "mdi:home-battery-outline"
        ),
        ByteWattSensor(
            coordinator, 
            entry, 
            SENSOR_TREES_PLANTED, 
            "Trees Planted", 
            None,
            "Trees_Planted", 
            "trees", 
            "mdi:tree"
        ),
        ByteWattSensor(
            coordinator, 
            entry, 
            SENSOR_CO2_REDUCTION, 
            "CO2 Reduction", 
            None,
            "CO2_Reduction_Tons", 
            "tons", 
            "mdi:molecule-co2"
        ),
    ]

    placeholder_sensors = [
        ByteWattSensor(coordinator, entry, SENSOR_BATTERY_TEMPERATURE, "Battery Temperature", "temperature", "battery_temperature", "°C", "mdi:thermometer"),
        ByteWattSensor(coordinator, entry, SENSOR_BATTERY_VOLTAGE, "Battery Voltage", "voltage", "battery_voltage", "V", "mdi:flash"),
        ByteWattSensor(coordinator, entry, SENSOR_BATTERY_CURRENT, "Battery Current", "current", "battery_current", "A", "mdi:current-dc"),
        ByteWattSensor(coordinator, entry, SENSOR_BATTERY_CYCLES, "Battery Cycles", None, "battery_cycles", "cycles", "mdi:cached"),
        ByteWattSensor(coordinator, entry, SENSOR_BATTERY_STATE_OF_HEALTH, "Battery State of Health", None, "battery_state_of_health", "%", "mdi:battery-heart"),
        ByteWattSensor(coordinator, entry, SENSOR_GRID_VOLTAGE, "Grid Voltage", "voltage", "grid_voltage", "V", "mdi:transmission-tower"),
        ByteWattSensor(coordinator, entry, SENSOR_GRID_CURRENT, "Grid Current", "current", "grid_current", "A", "mdi:transmission-tower"),
        ByteWattSensor(coordinator, entry, SENSOR_GRID_FREQUENCY, "Grid Frequency", None, "grid_frequency", "Hz", "mdi:sine-wave"),
        ByteWattSensor(coordinator, entry, SENSOR_INVERTER_TEMPERATURE, "Inverter Temperature", "temperature", "inverter_temperature", "°C", "mdi:thermometer"),
        ByteWattSensor(coordinator, entry, SENSOR_OPERATING_MODE, "Operating Mode", None, "operating_mode", "", "mdi:cog"),
        ByteWattSensor(coordinator, entry, SENSOR_FAULT_CODE, "Fault Code", None, "fault_code", "", "mdi:alert-circle-outline"),
        ByteWattSensor(coordinator, entry, SENSOR_ALARM_STATE, "Alarm State", None, "alarm_state", "", "mdi:alarm-light-outline"),
        ByteWattSensor(coordinator, entry, SENSOR_POWER_FACTOR, "Power Factor", None, "power_factor", "", "mdi:percent"),
        ByteWattSensor(coordinator, entry, SENSOR_REACTIVE_POWER, "Reactive Power", "power", "reactive_power", "var", "mdi:flash"),
        ByteWattSensor(coordinator, entry, SENSOR_BACKUP_OUTPUT_POWER, "Backup Output Power", "power", "backup_output_power", "W", "mdi:power-socket"),
        ByteWattSensor(coordinator, entry, SENSOR_BACKUP_LOAD_POWER, "Backup Load Power", "power", "backup_load_power", "W", "mdi:home-lightning-bolt"),
        ByteWattSensor(coordinator, entry, SENSOR_EPS_OUTPUT_POWER, "EPS Output Power", "power", "eps_output_power", "W", "mdi:power-plug"),
        ByteWattSensor(coordinator, entry, SENSOR_PV_STRING_1_VOLTAGE, "PV String 1 Voltage", "voltage", "pv_string_1_voltage", "V", "mdi:solar-panel"),
        ByteWattSensor(coordinator, entry, SENSOR_PV_STRING_1_CURRENT, "PV String 1 Current", "current", "pv_string_1_current", "A", "mdi:solar-panel"),
        ByteWattSensor(coordinator, entry, SENSOR_PV_STRING_2_VOLTAGE, "PV String 2 Voltage", "voltage", "pv_string_2_voltage", "V", "mdi:solar-panel"),
        ByteWattSensor(coordinator, entry, SENSOR_PV_STRING_2_CURRENT, "PV String 2 Current", "current", "pv_string_2_current", "A", "mdi:solar-panel"),
        ByteWattSensor(coordinator, entry, SENSOR_PV_INPUT_TOTAL_POWER, "PV Input Total Power", "power", "pv_input_total_power", "W", "mdi:solar-power"),
        ByteWattSensor(coordinator, entry, SENSOR_BATTERY_USABLE_CAPACITY, "Battery Usable Capacity", "energy", "battery_usable_capacity", "kWh", "mdi:battery"),
        ByteWattSensor(coordinator, entry, SENSOR_BATTERY_REMAINING_CAPACITY, "Battery Remaining Capacity", "energy", "battery_remaining_capacity", "kWh", "mdi:battery"),
        ByteWattSensor(coordinator, entry, SENSOR_COMMUNICATION_STATUS, "Communication Status", None, "communication_status", "", "mdi:lan-connect"),
        ByteWattSensor(coordinator, entry, SENSOR_SOLAR_FORECAST, "Solar Forecast", "energy", "solar_forecast", "kWh", "mdi:weather-sunny"),
        ByteWattSensor(coordinator, entry, SENSOR_FORECAST_GENERATION_TODAY, "Forecast Generation Today", "energy", "forecast_generation_today", "kWh", "mdi:weather-sunny"),
        ByteWattSensor(coordinator, entry, SENSOR_FORECAST_GENERATION_TOMORROW, "Forecast Generation Tomorrow", "energy", "forecast_generation_tomorrow", "kWh", "mdi:weather-sunny"),
        ByteWattSensor(coordinator, entry, SENSOR_TARIFF_CURRENT_PRICE, "Tariff Current Price", None, "tariff_current_price", "", "mdi:cash"),
        ByteWattSensor(coordinator, entry, SENSOR_TARIFF_NEXT_PRICE, "Tariff Next Price", None, "tariff_next_price", "", "mdi:cash-clock"),
        ByteWattSensor(coordinator, entry, SENSOR_DYNAMIC_PRICING_ENABLED, "Dynamic Pricing Enabled", None, "dynamic_pricing_enabled", "", "mdi:cash-sync"),
        ByteWattSensor(coordinator, entry, SENSOR_EXPORT_SPIKE_PRICE, "Export Spike Price", None, "export_spike_price", "", "mdi:cash-plus"),
        ByteWattSensor(coordinator, entry, SENSOR_BATTERY_WEAR_COST, "Battery Wear Cost", None, "battery_wear_cost", "", "mdi:chart-line"),
        ByteWattSensor(coordinator, entry, SENSOR_DAILY_COST_ESTIMATE, "Daily Cost Estimate", None, "daily_cost_estimate", "", "mdi:currency-usd"),
        ByteWattSensor(coordinator, entry, SENSOR_DAILY_INCOME_ESTIMATE, "Daily Income Estimate", None, "daily_income_estimate", "", "mdi:currency-usd"),
    ]

    pricing_sensors = [
        PricingScheduleSensor(coordinator, entry),
        PolicyChargeScheduleSensor(coordinator, entry),
    ]

    async_add_entities(soc_sensors + grid_sensors + daily_stats_sensors + placeholder_sensors + pricing_sensors)


class ByteWattSensor(CoordinatorEntity, SensorEntity):
    """Representation of a Byte-Watt Sensor."""

    def __init__(
        self,
        coordinator: DataUpdateCoordinator,
        config_entry: ConfigEntry,
        sensor_type: str,
        name: str,
        device_class: str,
        attribute: str,
        unit: str,
        icon: str,
        entity_category: Optional[EntityCategory] = None,
    ):
        """Initialize the sensor."""
        super().__init__(coordinator)
        self._config_entry = config_entry
        self._sensor_type = sensor_type
        self._attribute = attribute
        self._attr_name = name
        self._attr_unique_id = f"{config_entry.entry_id}_{sensor_type}"
        self._attr_device_class = device_class
        # HA forbids unit_of_measurement on certain device classes (e.g. timestamp);
        # treat the empty string as None to silence the deprecation warning that
        # will become a hard validation error in a future HA release.
        self._attr_native_unit_of_measurement = unit if unit else None
        self._attr_icon = icon
        self._attr_entity_category = entity_category

    @property
    def device_info(self):
        """Return device info."""
        return {
            "identifiers": {(DOMAIN, self._config_entry.entry_id)},
            "name": DEVICE_NAME,
            "manufacturer": DEVICE_MANUFACTURER,
            "model": DEVICE_MODEL,
        }

    @property
    def native_value(self):
        """Return the state of the sensor."""
        try:
            if not self.coordinator.data or "battery" not in self.coordinator.data:
                return None
            
            battery_data = self.coordinator.data["battery"]
            value = battery_data.get(self._attribute)
            
            if value is None:
                # First time encountering a missing attribute, log it at info level 
                # to help with troubleshooting new API responses
                _LOGGER.debug(
                    f"Attribute '{self._attribute}' not found in battery data for {self._attr_name}. "
                    f"Available attributes: {list(battery_data.keys())}"
                )
                return None
                
            # Return the value, converting string values to float if needed for numerical sensors
            if self._attr_device_class == "power" and isinstance(value, (str, int, float)):
                try:
                    return float(value)
                except (ValueError, TypeError):
                    return value
            return value
        except Exception as ex:
            _LOGGER.error(f"Error getting sensor state for {self._attr_name}: {ex}")
            return None


class ByteWattGridSensor(ByteWattSensor):
    """Representation of a Byte-Watt Grid Sensor."""

    def __init__(
        self,
        coordinator,
        config_entry,
        sensor_type,
        name,
        device_class,
        attribute,
        unit,
        icon,
        entity_category=None,
    ):
        """Initialize the sensor."""
        super().__init__(
            coordinator, 
            config_entry, 
            sensor_type, 
            name, 
            device_class, 
            attribute, 
            unit, 
            icon,
            entity_category
        )
        # Add state_class for energy sensors (kWh)
        if unit == "kWh":
            self._attr_state_class = SensorStateClass.TOTAL_INCREASING

    @property
    def native_value(self):
        """Return the state of the sensor."""
        try:
            if not self.coordinator.data or "battery" not in self.coordinator.data:
                return None
            
            # In the new API, all data is in the battery object
            # Try to find matching attributes in the battery data
            battery_data = self.coordinator.data["battery"]
            
            # Handle special case for energy metrics which may be in a different format
            if self._attribute in battery_data:
                return battery_data.get(self._attribute)
            
            # If data isn't available, we'll log it at debug level
            _LOGGER.debug(f"Grid sensor {self._attribute} data not found in battery response")
            return None
        except Exception as ex:
            _LOGGER.error(f"Error getting grid sensor state: {ex}")
            return None
            
    @property
    def available(self) -> bool:
        """Return if entity is available."""
        # Many grid sensors may not be available in the new API
        if not self.coordinator.data or "battery" not in self.coordinator.data:
            return False
            
        # Check if this attribute exists in the data
        return self._attribute in self.coordinator.data["battery"]


class ByteWattLastUpdateSensor(ByteWattSensor):
    """Representation of a Byte-Watt Last Update Sensor that doesn't rely on createTime."""
    
    def __init__(
        self,
        coordinator,
        config_entry,
        sensor_type,
        name,
        device_class,
        unit,
        icon,
        entity_category=None,
    ):
        """Initialize the Last Update sensor."""
        super().__init__(
            coordinator, 
            config_entry, 
            sensor_type, 
            name, 
            device_class, 
            "last_update",  # Use a custom attribute name
            unit, 
            icon,
            entity_category
        )

    @property
    def native_value(self):
        """Return the last update time based on coordinator's last successful update."""
        try:
            if hasattr(self.coordinator, '_last_successful_update') and self.coordinator._last_successful_update:
                return self.coordinator._last_successful_update
            return None
        except Exception as ex:
            _LOGGER.error(f"Error getting last update time: {ex}")
            return None
    
    @property
    def available(self) -> bool:
        """Return if entity is available."""
        return hasattr(self.coordinator, '_last_successful_update') and self.coordinator._last_successful_update is not None


class PricingScheduleSensor(CoordinatorEntity, SensorEntity):
    """Expose the persisted pricing schedule back to the panel."""

    def __init__(self, coordinator: DataUpdateCoordinator, config_entry: ConfigEntry):
        super().__init__(coordinator)
        self._config_entry = config_entry
        self._store = PricingScheduleStore(coordinator.hass, config_entry.entry_id)
        self._attr_name = "Pricing Schedule"
        self._attr_unique_id = f"{config_entry.entry_id}_pricing_schedule"
        self._attr_icon = "mdi:currency-usd"
        self._attr_entity_category = EntityCategory.DIAGNOSTIC
        self._schedule = None
        self._signal = signal_pricing_changed(config_entry.entry_id)

    @property
    def device_info(self):
        return {
            "identifiers": {(DOMAIN, self._config_entry.entry_id)},
            "name": DEVICE_NAME,
            "manufacturer": DEVICE_MANUFACTURER,
            "model": DEVICE_MODEL,
        }

    async def async_added_to_hass(self):
        self.async_on_remove(async_dispatcher_connect(self.hass, self._signal, self._handle_refresh_signal))
        await self._refresh_schedule()

    def _handle_refresh_signal(self) -> None:
        self.hass.async_create_task(self._refresh_schedule())

    async def _refresh_schedule(self) -> None:
        self._schedule = await self._store.async_schedule()
        self.async_write_ha_state()

    async def async_update(self) -> None:
        await self._refresh_schedule()

    @property
    def available(self) -> bool:
        return self._schedule is not None

    @property
    def native_value(self):
        if self._schedule is None:
            return "Unavailable"
        if self._schedule.groups:
            record_count = sum(len(group.records) for group in self._schedule.groups)
            return f"{len(self._schedule.groups)} group(s), {record_count} record(s)"
        return f"{len(self._schedule.rules)} rule(s)"

    @property
    def extra_state_attributes(self):
        if self._schedule is None:
            return {}
        active = self._schedule.active_rule(dt_util.now())
        active_group = self._schedule.active_group(dt_util.now())
        record_count = sum(len(group.records) for group in self._schedule.groups)
        return {
            "rule_count": len(self._schedule.rules),
            "group_count": len(self._schedule.groups),
            "record_count": record_count,
            "holiday_count": len(self._schedule.holiday_dates),
            "holiday_source": self._schedule.holiday_source,
            "region": self._schedule.region,
            "holiday_dates": [item.isoformat() for item in self._schedule.holiday_dates],
            "date_map": self._schedule.rules_by_date(),
            "rules": [rule.to_dict() for rule in self._schedule.rules],
            "groups": [group.to_dict() for group in self._schedule.groups],
            "active_rule": active.to_dict() if active is not None else None,
            "active_group": active_group.to_dict() if active_group is not None else None,
            "updated_at": self._schedule.updated_at.isoformat() if self._schedule.updated_at else None,
            "active_type": active_group.pricing_type if active_group is not None else (active.pricing_type if active is not None else None),
            "active_provider": active_group.provider if active_group is not None else (active.provider if active is not None else None),
        }


class PolicyChargeScheduleSensor(CoordinatorEntity, SensorEntity):
    """Expose persisted policy charge schedules back to the panel."""

    def __init__(self, coordinator: DataUpdateCoordinator, config_entry: ConfigEntry):
        super().__init__(coordinator)
        self._config_entry = config_entry
        self._store = PolicyChargeScheduleStore(coordinator.hass, config_entry.entry_id)
        self._attr_name = "Policy Charge Schedule"
        self._attr_unique_id = f"{config_entry.entry_id}_policy_charge_schedule"
        self._attr_icon = "mdi:battery-charging"
        self._attr_entity_category = EntityCategory.DIAGNOSTIC
        self._schedule_set = None
        self._signal = signal_policy_charge_changed(config_entry.entry_id)

    @property
    def device_info(self):
        return {
            "identifiers": {(DOMAIN, self._config_entry.entry_id)},
            "name": DEVICE_NAME,
            "manufacturer": DEVICE_MANUFACTURER,
            "model": DEVICE_MODEL,
        }

    async def async_added_to_hass(self):
        self.async_on_remove(async_dispatcher_connect(self.hass, self._signal, self._handle_refresh_signal))
        await self._refresh_schedule_set()

    def _handle_refresh_signal(self) -> None:
        self.hass.async_create_task(self._refresh_schedule_set())

    async def _refresh_schedule_set(self) -> None:
        self._schedule_set = await self._store.async_schedule_set()
        self.async_write_ha_state()

    async def async_update(self) -> None:
        await self._refresh_schedule_set()

    @property
    def available(self) -> bool:
        return self._schedule_set is not None

    @property
    def native_value(self):
        if self._schedule_set is None:
            return "Unavailable"
        return f"{len(self._schedule_set.schedules)} scope(s)"

    @property
    def extra_state_attributes(self):
        if self._schedule_set is None:
            return {}
        return {
            "schedule_count": len(self._schedule_set.schedules),
            "schedules": [schedule.to_dict() for schedule in self._schedule_set.schedules],
            "updated_at": self._schedule_set.updated_at,
        }

