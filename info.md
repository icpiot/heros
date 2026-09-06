# Byte-Watt Battery Monitor

Monitor and control your Byte-Watt / Neovolt battery system through Home Assistant.

Requires Home Assistant **2024.11.0** or later.

{% if installed %}
## Integration is installed

**To configure:** Settings → Devices & Services → Add Integration → search for
"Byte-Watt Battery Monitor" and follow the prompts.

If you have more than one inverter on your account you'll be asked to pick the
Host inverter (used for Grid Feed-in and cycle strategy control).
{% endif %}

## Features

- **Real-time monitoring** — SOC, grid / house / PV / battery power
- **Today's + cumulative energy** — generation, feed-in, grid import, charge / discharge
- **Battery control** — charge / discharge windows, minimum SOC, charge cap,
  per-slot charge & discharge power, grid charging switch
- **Grid Feed-in Control** — enable / disable, cutoff SOC, Time Period 1
- **Staged-edit workflow** — UI changes accumulate and are pushed in one shot
  via the **Submit Settings** button (mirrors the portal's Save UX and avoids
  rate-limit failures on rapid sequential writes)
- **Multi-inverter** — pick the Host during setup; change later via Configure
- **Automatic recovery** — heartbeat, circuit breaker, scheduled daily reconnect

## Available services

Battery: `heros.set_minimum_soc`, `heros.set_charge_cap`,
`heros.set_discharge_start_time`, `heros.set_discharge_time`,
`heros.set_charge_start_time`, `heros.set_charge_end_time`,
`heros.update_battery_settings`

Grid feed-in: `heros.set_grid_feedin_enabled`,
`heros.set_grid_feedin_cutoff_soc`, `heros.update_grid_feedin_slot`

Maintenance: `heros.force_reconnect`, `heros.health_check`,
`heros.toggle_diagnostics`

All services accept an optional `entry_id` field (required only when you have
multiple Byte-Watt accounts configured).

[Full documentation on GitHub](https://github.com/candreacchio/neovoltBattery_HomeAssistantPlugin)
