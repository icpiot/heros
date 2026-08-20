"""Constants for the Home Energy Manager integration."""

DOMAIN = "home_energy_manager"
CONF_PROVIDER = "provider"
PROVIDER_BYTEWATT = "bytewatt"
PROVIDER_OTHER = "other"
DEVICE_NAME = "Home Energy Manager"
DEVICE_MANUFACTURER = "Home Energy Manager"
DEVICE_MODEL = "Battery Management System"

# Configuration
CONF_USERNAME = "username"
CONF_PASSWORD = "password"
CONF_SCAN_INTERVAL = "scan_interval"
CONF_HISTORY_BACKFILL_YEARS = "history_backfill_years"
CONF_RECOVERY_ENABLED = "recovery_enabled"
CONF_HEARTBEAT_INTERVAL = "heartbeat_interval"
CONF_MAX_DATA_AGE = "max_data_age"
CONF_STALE_CHECKS_THRESHOLD = "stale_checks_threshold"
CONF_NOTIFY_ON_RECOVERY = "notify_on_recovery"
CONF_DIAGNOSTICS_MODE = "diagnostics_mode"
CONF_AUTO_RECONNECT_TIME = "auto_reconnect_time"

# Defaults
DEFAULT_SCAN_INTERVAL = 10  # 10 seconds
DEFAULT_HISTORY_BACKFILL_YEARS = 2
MIN_SCAN_INTERVAL = 10  # 10 seconds
DEFAULT_RECOVERY_ENABLED = True
DEFAULT_HEARTBEAT_INTERVAL = 120  # 2 minutes
DEFAULT_MAX_DATA_AGE = 300  # 5 minutes
DEFAULT_STALE_CHECKS_THRESHOLD = 3
DEFAULT_NOTIFY_ON_RECOVERY = True
DEFAULT_DIAGNOSTICS_MODE = False
DEFAULT_AUTO_RECONNECT_TIME = "03:30:00"  # 3:30 AM

# Services
SERVICE_SET_DISCHARGE_TIME = "set_discharge_time"  # Legacy service
SERVICE_SET_DISCHARGE_START_TIME = "set_discharge_start_time"
SERVICE_SET_CHARGE_START_TIME = "set_charge_start_time"
SERVICE_SET_CHARGE_END_TIME = "set_charge_end_time"
SERVICE_SET_MINIMUM_SOC = "set_minimum_soc"
SERVICE_SET_CHARGE_CAP = "set_charge_cap"
SERVICE_UPDATE_BATTERY_SETTINGS = "update_battery_settings"
SERVICE_START_FORCE_CHARGE = "start_force_charge"
SERVICE_STOP_FORCE_CHARGE = "stop_force_charge"
SERVICE_START_DISCHARGE_NOW = "start_discharge_now"
SERVICE_STOP_DISCHARGE_NOW = "stop_discharge_now"
SERVICE_START_FEEDIN_NOW = "start_feedin_now"
SERVICE_STOP_FEEDIN_NOW = "stop_feedin_now"
SERVICE_FORCE_RECONNECT = "force_reconnect"  # Force client reconnection for troubleshooting
SERVICE_HEALTH_CHECK = "health_check"  # Check connection health and return diagnostics
SERVICE_TOGGLE_DIAGNOSTICS = "toggle_diagnostics"  # Toggle diagnostic logging
SERVICE_REFRESH_STATE = "refresh_state"
SERVICE_PRICING_UPSERT_RULE = "pricing_upsert_rule"
SERVICE_PRICING_REMOVE_RULE = "pricing_remove_rule"
SERVICE_PRICING_SET_HOLIDAYS = "pricing_set_holidays"
SERVICE_PRICING_UPSERT_GROUP = "pricing_upsert_group"
SERVICE_PRICING_REMOVE_GROUP = "pricing_remove_group"
SERVICE_PRICING_UPSERT_RECORD = "pricing_upsert_record"
SERVICE_PRICING_REMOVE_RECORD = "pricing_remove_record"
SERVICE_SET_PANEL_THEME = "set_panel_theme"
SERVICE_SET_FORECAST_MAPPING = "set_forecast_mapping"
SERVICE_SET_BATTERY_MAPPING = "set_battery_mapping"
SERVICE_SET_HERO_MAPPING = "set_hero_mapping"
SERVICE_POLICY_CHARGE_SAVE = "policy_charge_save"

# Service attributes
ATTR_END_DISCHARGE = "end_discharge"
ATTR_START_DISCHARGE = "start_discharge"
ATTR_START_CHARGE = "start_charge"
ATTR_END_CHARGE = "end_charge"
ATTR_MINIMUM_SOC = "minimum_soc"
ATTR_CHARGE_CAP = "charge_cap"
ATTR_ENTRY_ID = "entry_id"
ATTR_RULE_ID = "rule_id"
ATTR_GROUP_ID = "group_id"
ATTR_RECORD_ID = "record_id"
ATTR_RECORD_TYPE = "record_type"
ATTR_EFFECTIVE_DATE = "effective_date"
ATTR_EFFECTIVE_START_DATE = "effective_start_date"
ATTR_EFFECTIVE_TIME = "effective_time"
ATTR_EFFECTIVE_END_DATE = "effective_end_date"
ATTR_EFFECTIVE_END_TIME = "effective_end_time"
ATTR_PRICING_TYPE = "pricing_type"
ATTR_PROVIDER = "provider"
ATTR_PLAN_NAME = "plan_name"
ATTR_LABEL = "label"
ATTR_IMPORT_RATE = "import_rate"
ATTR_EXPORT_RATE = "export_rate"
ATTR_EXPORT_TIER_1_LIMIT = "export_tier_1_limit"
ATTR_EXPORT_TIER_1_RATE = "export_tier_1_rate"
ATTR_EXPORT_TIER_2_RATE = "export_tier_2_rate"
ATTR_SUPPLY_CHARGE = "supply_charge"
ATTR_CONTROLLED_LOAD_1 = "controlled_load_1"
ATTR_CONTROLLED_LOAD_2 = "controlled_load_2"
ATTR_CONTROLLED_LOAD_RATE = "controlled_load_rate"
ATTR_ADDITIONAL_CHARGE = "additional_charge"
ATTR_DAILY_CONNECTION_CHARGE = "daily_connection_charge"
ATTR_OTHER_CHARGES = "other_charges"
ATTR_HOLIDAY_ONLY = "holiday_only"
ATTR_DAYS_OF_WEEK = "days_of_week"
ATTR_DAY_TYPES = "day_types"
ATTR_NOTES = "notes"
ATTR_HOLIDAY_DATES = "holiday_dates"
ATTR_HOLIDAY_SOURCE = "holiday_source"
ATTR_REGION = "region"
ATTR_POLICY_ENABLED = "policy_enabled"
ATTR_POLICY_NAME = "policy_name"
ATTR_IMMEDIATE_CUTOFF_SOC = "immediate_cutoff_soc"
ATTR_ROWS = "rows"

# Sensor types
SENSOR_SOC = "soc"
SENSOR_GRID_CONSUMPTION = "grid_consumption"
SENSOR_HOUSE_CONSUMPTION = "house_consumption"
SENSOR_BATTERY_POWER = "battery_power"
SENSOR_PV = "pv_power"
SENSOR_LAST_UPDATE = "last_update"
SENSOR_BATTERY_TEMPERATURE = "battery_temperature"
SENSOR_BATTERY_VOLTAGE = "battery_voltage"
SENSOR_BATTERY_CURRENT = "battery_current"
SENSOR_BATTERY_CYCLES = "battery_cycles"
SENSOR_BATTERY_STATE_OF_HEALTH = "battery_state_of_health"
SENSOR_GRID_VOLTAGE = "grid_voltage"
SENSOR_GRID_CURRENT = "grid_current"
SENSOR_GRID_FREQUENCY = "grid_frequency"
SENSOR_INVERTER_TEMPERATURE = "inverter_temperature"
SENSOR_OPERATING_MODE = "operating_mode"
SENSOR_FAULT_CODE = "fault_code"
SENSOR_ALARM_STATE = "alarm_state"
SENSOR_POWER_FACTOR = "power_factor"
SENSOR_REACTIVE_POWER = "reactive_power"
SENSOR_BACKUP_OUTPUT_POWER = "backup_output_power"
SENSOR_BACKUP_LOAD_POWER = "backup_load_power"
SENSOR_EPS_OUTPUT_POWER = "eps_output_power"
SENSOR_PV_STRING_1_VOLTAGE = "pv_string_1_voltage"
SENSOR_PV_STRING_1_CURRENT = "pv_string_1_current"
SENSOR_PV_STRING_2_VOLTAGE = "pv_string_2_voltage"
SENSOR_PV_STRING_2_CURRENT = "pv_string_2_current"
SENSOR_PV_INPUT_TOTAL_POWER = "pv_input_total_power"
SENSOR_BATTERY_USABLE_CAPACITY = "battery_usable_capacity"
SENSOR_BATTERY_REMAINING_CAPACITY = "battery_remaining_capacity"
SENSOR_BATTERY_STATE_OF_HEALTH_PERCENT = "battery_state_of_health"
SENSOR_COMMUNICATION_STATUS = "communication_status"
SENSOR_SOLAR_FORECAST = "solar_forecast"
SENSOR_FORECAST_GENERATION_TODAY = "forecast_generation_today"
SENSOR_FORECAST_GENERATION_TOMORROW = "forecast_generation_tomorrow"
SENSOR_TARIFF_CURRENT_PRICE = "tariff_current_price"
SENSOR_TARIFF_NEXT_PRICE = "tariff_next_price"
SENSOR_DYNAMIC_PRICING_ENABLED = "dynamic_pricing_enabled"
SENSOR_EXPORT_SPIKE_PRICE = "export_spike_price"
SENSOR_BATTERY_WEAR_COST = "battery_wear_cost"
SENSOR_DAILY_COST_ESTIMATE = "daily_cost_estimate"
SENSOR_DAILY_INCOME_ESTIMATE = "daily_income_estimate"
SENSOR_PRICING_SCHEDULE = "pricing_schedule"
SENSOR_POLICY_CHARGE_SCHEDULE = "policy_charge_schedule"

# Grid stats sensor types
SENSOR_TOTAL_SOLAR = "total_solar_generation"
SENSOR_TOTAL_FEED_IN = "total_feed_in"
SENSOR_TOTAL_BATTERY_CHARGE = "total_battery_charge"
SENSOR_TOTAL_BATTERY_DISCHARGE = "total_battery_discharge"
SENSOR_PV_POWER_HOUSE = "pv_power_house"
SENSOR_PV_CHARGING_BATTERY = "pv_charging_battery"
SENSOR_TOTAL_HOUSE_CONSUMPTION = "total_house_consumption"
SENSOR_GRID_BATTERY_CHARGE = "grid_battery_charge"
SENSOR_GRID_POWER_CONSUMPTION = "grid_power_consumption"

# Daily stats sensor types
SENSOR_PV_GENERATED_TODAY = "pv_generated_today"
SENSOR_CONSUMED_TODAY = "consumed_today"
SENSOR_FEED_IN_TODAY = "feed_in_today"
SENSOR_GRID_IMPORT_TODAY = "grid_import_today"
SENSOR_BATTERY_CHARGED_TODAY = "battery_charged_today"
SENSOR_BATTERY_DISCHARGED_TODAY = "battery_discharged_today"
SENSOR_SELF_CONSUMPTION = "self_consumption"
SENSOR_SELF_SUFFICIENCY = "self_sufficiency"
SENSOR_TREES_PLANTED = "trees_planted"
SENSOR_CO2_REDUCTION = "co2_reduction_tons"

# Circuit breaker and connection constants
MAX_DIAGNOSTIC_LOGS = 100
RECENT_DATA_THRESHOLD = 300  # 5 minutes in seconds
STALE_DATA_THRESHOLD = 3600  # 1 hour in seconds
HTTPS_PORT = 443

# Grid Feed-in Control constants
SERVICE_SET_GRID_FEEDIN_ENABLED = "set_grid_feedin_enabled"
SERVICE_SET_GRID_FEEDIN_CUTOFF_SOC = "set_grid_feedin_cutoff_soc"
SERVICE_UPDATE_GRID_FEEDIN_SLOT = "update_grid_feedin_slot"

ATTR_FEEDIN_ENABLED = "feedin_enabled"
ATTR_FEEDIN_CUTOFF_SOC = "feedin_cutoff_soc"
ATTR_FEEDIN_SLOT = "slot"
ATTR_FEEDIN_START = "start_time"
ATTR_FEEDIN_END = "end_time"
ATTR_FEEDIN_POWER = "power_watts"

# Host inverter selection
CONF_HOST_SYSTEM_ID = "host_system_id"
CONF_HOST_SYS_SN = "host_sys_sn"
CONF_FORECAST_PROVIDER = "forecast_provider"
CONF_FORECAST_GENERATION_TODAY_ENTITY = "forecast_generation_today_entity"
CONF_FORECAST_GENERATION_TOMORROW_ENTITY = "forecast_generation_tomorrow_entity"
CONF_FORECAST_GENERATION_THIS_HOUR_ENTITY = "forecast_generation_this_hour_entity"
CONF_FORECAST_GENERATION_NEXT_HOUR_ENTITY = "forecast_generation_next_hour_entity"
CONF_FORECAST_GENERATION_REMAINING_TODAY_ENTITY = "forecast_generation_remaining_today_entity"
CONF_FORECAST_POWER_NOW_ENTITY = "forecast_power_now_entity"
CONF_FORECAST_POWER_IN_1_HOUR_ENTITY = "forecast_power_in_1_hour_entity"
CONF_FORECAST_POWER_IN_12_HOURS_ENTITY = "forecast_power_in_12_hours_entity"
CONF_FORECAST_POWER_IN_24_HOURS_ENTITY = "forecast_power_in_24_hours_entity"
CONF_FORECAST_PEAK_TODAY_ENTITY = "forecast_peak_today_entity"
CONF_FORECAST_PEAK_TOMORROW_ENTITY = "forecast_peak_tomorrow_entity"
CONF_SOLAR_FORECAST_ENTITY = "solar_forecast_entity"
CONF_PANEL_THEME = "panel_theme"
CONF_BATTERY_PROVIDER = "battery_provider"
CONF_BATTERY_PERCENTAGE_ENTITY = "battery_percentage_entity"
CONF_BATTERY_POWER_ENTITY = "battery_power_entity"
CONF_BATTERY_TEMPERATURE_ENTITY = "battery_temperature_entity"
CONF_BATTERY_VOLTAGE_ENTITY = "battery_voltage_entity"
CONF_BATTERY_CURRENT_ENTITY = "battery_current_entity"
CONF_BATTERY_CYCLES_ENTITY = "battery_cycles_entity"
CONF_BATTERY_STATE_OF_HEALTH_ENTITY = "battery_state_of_health_entity"
CONF_BATTERY_USABLE_CAPACITY_ENTITY = "battery_usable_capacity_entity"
CONF_BATTERY_REMAINING_CAPACITY_ENTITY = "battery_remaining_capacity_entity"
CONF_BATTERY_STATE_OF_HEALTH_PERCENT_ENTITY = "battery_state_of_health_percent_entity"
CONF_BATTERY_WEAR_COST_ENTITY = "battery_wear_cost_entity"
CONF_TOTAL_BATTERY_CHARGE_ENTITY = "total_battery_charge_entity"
CONF_TOTAL_BATTERY_DISCHARGE_ENTITY = "total_battery_discharge_entity"
CONF_PV_CHARGING_BATTERY_ENTITY = "pv_charging_battery_entity"
CONF_GRID_BATTERY_CHARGE_ENTITY = "grid_battery_charge_entity"
CONF_BATTERY_CHARGED_TODAY_ENTITY = "battery_charged_today_entity"
CONF_BATTERY_DISCHARGED_TODAY_ENTITY = "battery_discharged_today_entity"
CONF_BATTERY_HERO_MAPPING = "battery_hero_mapping"
CONF_SOLAR_HERO_MAPPING = "solar_hero_mapping"

FORECAST_PROVIDER_NONE = "none"
FORECAST_PROVIDER_FORECAST_SOLAR = "forecast_solar"
FORECAST_PROVIDER_OTHER = "other"

# Config entry schema version — bump and add an async_migrate_entry branch
# whenever you change the shape of entry.data.
CURRENT_ENTRY_VERSION = 3

# Maximum number of feed-in slots the inverter supports (per the
# timePeriodLimit field on getFeedStrategyList — confirmed against a HAR
# capture from the Byte-Watt portal).
FEEDIN_MAX_SLOTS = 6

# Practical max feed-in power in watts — hardware top end is ~20 kW on
# the inverters Byte-Watt targets. Used for both service-call validation
# and entity slider max.
FEEDIN_MAX_POWER_W = 20000


def signal_pending_changed(entry_id: str) -> str:
    """Dispatcher signal name for pending-store changes on a given entry."""
    return f"bytewatt_pending_{entry_id}"


def signal_pricing_changed(entry_id: str) -> str:
    """Dispatcher signal name for pricing-store changes on a given entry."""
    return f"bytewatt_pricing_{entry_id}"


def signal_policy_charge_changed(entry_id: str) -> str:
    """Dispatcher signal name for policy-charge-store changes on a given entry."""
    return f"bytewatt_policy_charge_{entry_id}"
