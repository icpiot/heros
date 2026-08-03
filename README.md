# Home Energy Manager Integration for Home Assistant

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://github.com/custom-components/hacs)

Monitor and control battery, solar, and energy data from Home Assistant.

The long-term goal is a Frigate-style sidebar panel for daily operation, with
cards kept as optional building blocks rather than the primary UI.

Requires Home Assistant **2024.11.0** or later.

## Features

- **Real-time monitoring** — SOC, grid / house / PV / battery power flows
- **Cumulative + today's energy** — solar generation, feed-in, grid import, charge / discharge
- **Battery control** — charge / discharge time windows, minimum SOC, charge cap,
  per-slot charge & discharge power, grid charging on/off, discharge time control on/off
- **Grid Feed-in Control** — enable/disable, cutoff SOC, Time Period 1 start/end/power
- **Staged-edit workflow** — UI changes accumulate in a *pending* store and are
  pushed to the inverter in one shot via the **Submit Settings** button (mirrors
  the portal's Save button and avoids the API's rate-limit failures on rapid
  sequential writes). A **Discard Pending Settings** button drops them.
- **Multi-inverter support** — pick which inverter is the Host during setup, change
  it later via Configure (no need to delete and re-add).
- **Automatic recovery** — heartbeat monitoring, circuit breaker, auto-reconnect.

## Installation

### HACS (recommended)

1. Install [HACS](https://hacs.xyz/) if you haven't already.
2. HACS → Integrations → ⋮ → Custom repositories → add this repo URL → Category: Integration.
3. Install **Home Energy Manager** and restart Home Assistant.
4. Settings → Devices & Services → Add Integration → search for **Home Energy Manager**.
5. Enter your credentials and complete the provider/setup flow. The sidebar panel is added automatically after the integration loads.

### Sidebar panel

The sidebar panel is registered automatically by the integration after setup.
No `panel_custom.yaml` entry is required.

The panel is served from:

`/local/community/home-energy-manager/home-energy-manager-panel.js?v=010`

The panel ships with built-in theme presets:

- `midnight`
- `sunrise`
- `neon`

The Home Assistant deploy scripts are manifest-driven:
[`scripts/ha_deploy.manifest`](C:\Dev\repos\home-energy-manager\scripts\ha_deploy.manifest)
controls which repo paths are copied into HA, so the same script shape can be
reused for other projects by swapping the manifest and environment variables.

### Manual

Copy `custom_components/home_energy_manager` into your Home Assistant `custom_components/`
directory, restart, then add the integration as above.

## Setup

You'll be asked for:

- **Username** (your provider portal email)
- **Password**
- **Scan interval** — 30 s minimum (default 60 s)

If the account has more than one inverter, a second step asks you to pick the
**Host inverter**. Single-inverter accounts skip that step automatically.

To change which inverter is the Host later: Settings → Devices & Services →
Home Energy Manager → ⋮ → Reconfigure.

## Entities

| Platform | Entities |
|---|---|
| `sensor` | 30+ sensors covering real-time power, today's energy, cumulative totals, environmental stats |
| `switch` | Grid Charging Battery, Battery Discharge Time Control, Grid Feed-in Function |
| `number` | Minimum SOC, Battery Charge Cap, Battery Charge Power, Battery Discharge Power, Grid Feed-in Cutoff SOC, Grid Feed-in Time1 Power |
| `time`   | Charge Start/End, Discharge Start/End, Grid Feed-in Time1 Start/End |
| `button` | **Submit Settings**, **Discard Pending Settings** |

### Submit/Discard workflow

Changing a switch / number / time entity **does not** immediately write to the
inverter. The change is held locally and shown on the entity. Press
**Submit Settings** to push everything pending in one transaction. Press
**Discard Pending Settings** to drop staged changes and revert entities to the
inverter's current state.

On a successful submit, a persistent notification confirms. On a failure, the
notification explains which batch failed and why, and the pending changes are
**preserved** so you can fix the issue and press Submit again.

## Services

The legacy "set this one thing" services still work — they stage the change
and submit immediately (no Submit button press needed for services):

- `home_energy_manager.set_minimum_soc` — set minimum battery SOC (1–100 %)
- `home_energy_manager.set_charge_cap` — set charge cap (1–100 %)
- `home_energy_manager.set_discharge_start_time` / `set_discharge_time` — discharge window
- `home_energy_manager.set_charge_start_time` / `set_charge_end_time` — charge window
- `home_energy_manager.update_battery_settings` — set any combination in one call

Grid Feed-in:

- `home_energy_manager.set_grid_feedin_enabled` — toggle Grid Feed-in Function on/off
- `home_energy_manager.set_grid_feedin_cutoff_soc` — set discharging cutoff SOC (0–100 %)
- `home_energy_manager.update_grid_feedin_slot` — set start/end/power for slot 1–6

Maintenance:

- `home_energy_manager.force_reconnect` — drop the session and re-authenticate
- `home_energy_manager.health_check` — run network + auth + API diagnostics
- `home_energy_manager.toggle_diagnostics` — verbose API logging on/off

All services accept an optional `entry_id` field. If you have a single
provider account configured you can omit it; with multiple accounts it's
required (the call will tell you which entry_ids exist).

## Pricing storage

Pricing remains file-based for now because the dataset is small and the panel
already works well with a lightweight store.

- Current storage root: `www/home-energy-manager/<entry_id>/`
- Live schedule file: `pricing_schedule.json`
- Historical pricing file: `pricing.json`
- Legacy fallback: `www/home-energy-manager-pricing/<entry_id>/` remains
  readable while old data is being cleaned up

This keeps the pricing workflow simple and keeps the shared state easy to
inspect in Home Assistant's `www` folder.

## Example automations

```yaml
automation:
  - alias: "Peak — discharge"
    trigger:
      platform: state
      entity_id: sensor.electricity_price_tier
      to: 'peak'
    action:
      service: home_energy_manager.update_battery_settings
      data:
        start_discharge: "17:00"
        end_discharge: "22:00"
        minimum_soc: 20

  - alias: "Off-peak — charge"
    trigger:
      platform: state
      entity_id: sensor.electricity_price_tier
      to: 'off_peak'
    action:
      service: home_energy_manager.update_battery_settings
      data:
        start_charge: "01:00"
        end_charge: "05:00"

  - alias: "Daytime — enable grid feed-in"
    trigger:
      platform: time
      at: "09:00:00"
    action:
      service: home_energy_manager.set_grid_feedin_enabled
      data:
        feedin_enabled: true
```

## Configuration options

After install, Settings → Devices & Services → Home Energy Manager → Configure:

- **Scan interval** (seconds) — minimum 30, default 60. Changes apply
  immediately (the integration reloads on options changes).

## Troubleshooting

- **A repair issue says "Host inverter not configured"** — you have more than
  one inverter on the account and no Host has been selected. Reconfigure
  (Settings → Devices & Services → Home Energy Manager → ⋮ → Reconfigure) and pick one.
- **Submit button shows partial failure** — the notification names which
  batch failed (battery or grid feed-in) and the error reason. Your unsaved
  changes are kept; fix and Submit again.
- **Entity shows "unavailable"** — the integration hasn't yet fetched the
  relevant settings from the API. Usually transient; check logs if it persists.
- **Cumulative totals briefly drop at midnight** — known timezone quirk of the
  API; the integration mitigates it by querying through tomorrow's date.

### Real-time field mapping

| API field | Sensor |
|---|---|
| `pgrid` | Grid Consumption (W) |
| `pload` | House Consumption (W) |
| `pbat` | Battery Power (W) |
| `ppv` | PV Power (W) |
| `soc` | Battery Percentage (%) |
| `epvT` | Total Solar Generation (kWh) |
| `eout` | Total Feed In (kWh) |
| `echarge` | Total Battery Charge (kWh) |
| `edischarge` | Total Battery Discharge (kWh) |
| `epv2load` | PV Power to House (kWh) |
| `epvcharge` | PV Charging Battery (kWh) |
| `eload` | Total House Consumption (kWh) |
| `egridCharge` | Grid Based Battery Charge (kWh) |
| `einput` | Grid Power Consumption (kWh) |

Enable debug logging in `configuration.yaml` to see all fields the API returns:

```yaml
logger:
  default: info
  logs:
    custom_components.home_energy_manager: debug
```

## Support

Open an issue at https://github.com/icpiot/home-energy-manager/issues.

## Credits

Originally built with the Home Assistant community and Claude AI. Subsequent
contributors are credited in the commit history.
