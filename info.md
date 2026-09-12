# HEROS — Home Energy Reporting & Optimisation System

Monitor, report on, and optimise battery, solar, grid, and household energy data through Home Assistant.

Requires Home Assistant **2024.11.0** or later.

{% if installed %}
## Integration is installed

**To configure:** Settings → Devices & Services → Add Integration → search for
**HEROS** and follow the prompts.

If your provider account has more than one inverter, you'll be asked to choose
the Host inverter used for applicable control and reporting functions.
{% endif %}

## Features

- **Real-time monitoring** — SOC, grid / house / PV / battery power
- **Today's + cumulative energy** — generation, feed-in, grid import, charge / discharge
- **Battery control** — charge / discharge windows, minimum SOC, charge cap,
  per-slot charge & discharge power, grid charging controls
- **Grid Feed-in Control** — enable / disable, cutoff SOC, configurable periods
- **Reporting** — provider-aware daily snapshots and report views
- **Solar forecast support** — mapped forecast values can be captured with report history
- **Staged-edit workflow** — settings changes can be accumulated and submitted together
- **Multi-inverter support** — select the Host during setup and change it later
- **Automatic recovery** — heartbeat monitoring, circuit breaker, and reconnect handling

## Available services

Battery: `heros.set_minimum_soc`, `heros.set_charge_cap`,
`heros.set_discharge_start_time`, `heros.set_discharge_time`,
`heros.set_charge_start_time`, `heros.set_charge_end_time`,
`heros.update_battery_settings`

Grid feed-in: `heros.set_grid_feedin_enabled`,
`heros.set_grid_feedin_cutoff_soc`, `heros.update_grid_feedin_slot`

Maintenance: `heros.force_reconnect`, `heros.health_check`,
`heros.toggle_diagnostics`

All services accept an optional `entry_id` field. With a single configured
provider account it can usually be omitted; with multiple accounts it is
required where HEROS needs to know which config entry to target.

[Full HEROS documentation on GitHub](https://github.com/icpiot/heros)
