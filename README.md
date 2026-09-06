# HEROS Integration for Home Assistant

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://github.com/custom-components/hacs)

Monitor and control battery, solar, and energy data from Home Assistant.

The long-term goal is a Frigate-style sidebar panel for daily operation, with
cards kept as optional building blocks rather than the primary UI.

Requires Home Assistant **2024.11.0** or later.

Current live development validation is against Home Assistant OS with Core
**2026.9.0**, Supervisor **2026.08.0**, Operating System **18.2**, and Frontend
**20260826.4**.

## Naming

This project is now called **HEROS**: **Home Energy Reporting & Optimisation
System**.

Use **HA HEM** when referring to Home Assistant's built-in Home Energy
Management / Energy Dashboard functionality. Use **HEROS** for this custom
system and its reporting, tariff analysis, battery/solar optimisation, and
automated energy-control features.

The Home Assistant integration domain, services, entity IDs, storage folders,
custom element tags, and served asset paths intentionally remain
`home_energy_manager` / `home-energy-manager` for compatibility with existing
installations, dashboards, automations, helpers, and browser caches.

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
- **Forecast history support** — mapped solar forecast entities are captured in
  HEROS report snapshots going forward, with optional Forecast.Solar
  historic-average source settings for future benchmark/backfill reports.

## Installation

### HACS (recommended)

1. Install [HACS](https://hacs.xyz/) if you haven't already.
2. HACS → Integrations → ⋮ → Custom repositories → add this repo URL → Category: Integration.
3. Install **HEROS** and restart Home Assistant.
4. Settings → Devices & Services → Add Integration → search for **HEROS**.
5. Enter your credentials and complete the provider/setup flow. The sidebar panel is added automatically after the integration loads.

### Sidebar panel

The sidebar panel is registered automatically by the integration after setup.
No `panel_custom.yaml` entry is required.

The panel is served from:

`/local/community/home-energy-manager/home-energy-manager-panel.js?v=483`

The panel ships with built-in theme presets:

- `midnight`
- `sunrise`
- `neon`

The Home Assistant deploy scripts are manifest-driven:
[`scripts/ha_deploy.manifest`](C:\Dev\repos\home-energy-manager\scripts\ha_deploy.manifest)
controls which repo paths are copied into HA, so the same script shape can be
reused for other projects by swapping the manifest and environment variables.
For Codex-driven live sync work, prefer the direct Home Assistant config share
`\\10.0.0.102\config\` rather than relying on a mapped `H:\` drive being
present in the current session.

### Development workflow

For ongoing Codex-assisted work in this repo:

- checkpoint to git after roughly every 5 meaningful implementation updates
- keep major UI, reporting, mapping, or storage changes reflected in the repo docs
- avoid bundling unrelated dirty-worktree changes into the same checkpoint

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
HEROS → ⋮ → Reconfigure.

### Setup persistence

Setup mappings and hero-mapping overrides are intended to be shared Home Energy
Manager configuration, not browser-local preferences.

That means forecast setup mappings, battery setup mappings, and hero mapping
overrides should be loaded from Home Assistant-backed config and saved through
HEROS services rather than browser-only storage.

### Setup page mapping model

The Setup page now treats Bytewatt provider data and HEROS hero values as two
separate layers:

- `Bytewatt Sensors` shows the direct provider payload HEROS is currently reading
- `Battery Hero Mapping Summary` maps battery-facing HEROS hero values to Bytewatt fields
- `Solar Hero Mapping Summary` maps solar and MPPT-facing HEROS hero values to Bytewatt fields
- `HEROS Hero Sensors` mirrors the active HEROS hero outputs so they can be compared against the direct provider values

The direct provider payload is scope-aware and can include:

- `all_systems`
- `selected_scope`
- `live_batteries`

This means a single concept such as SOC, battery power, load, or solar can have:

- an aggregate `All systems` value
- a `Selected scope` value for the active battery selector target
- one or more per-battery rows

When Bytewatt exposes MPPT power fields, the Setup page can also surface:

- `ppv1`
- `ppv2`
- `ppv3`
- `ppv4`

Per-battery rows are dynamic. HEROS does not assume there are only two batteries.
If Bytewatt returns more live battery rows, the setup summaries expand to match.

### Forecast history

HEROS now records mapped solar forecast values inside each reporting snapshot so
future predicted-vs-actual reports have HEROS-owned forecast history rather than
depending only on Home Assistant Recorder.

The optional Forecast.Solar historic-average source is configured separately
from the live forecast sensor mapping. It is intended for benchmark/backfill
data when the provider plan supports the Forecast.Solar `history` endpoint.
Public Forecast.Solar access does not provide this history endpoint.

See [docs/FORECAST_HISTORY.md](C:\Dev\repos\home-energy-manager\docs\FORECAST_HISTORY.md)
for the required settings and service flow.

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

Pricing configuration must not rely on browser `localStorage`.
Saved pricing data belongs in the Home Assistant-backed pricing files above so
it stays consistent across browsers and devices. Any temporary panel-only
editing state should remain in memory only.

The panel still uses browser storage for a few UI-only preferences:

- active page / URL fragment convenience
- selected battery target
- debug page visibility toggle
- settings-page focus tab
- remembered `entry_id` hint used to reconnect the same HA config entry

Those values are intentionally local to the current browser. They are not part
of the shared HEROS configuration model.

## Reporting storage

HEROS reporting currently uses a compact local archive for provider-aware daily
snapshots and CSV exports, while InfluxDB is the planned long-term store for
detailed sensor history.

InfluxDB is not wired up by HEROS yet. The current live reporting/history flow
still reads and writes only through the local HEROS archive.

Each stored report row now keeps both:

- the normalized HEROS power-diagram/report payload used by the panel
- the original dated provider chart payload for that scope/day

That lets HEROS reuse previously downloaded web-history days without fetching the
same provider chart data again.

Report and archive diagnostics should read that HA-served archive directly.
They must not depend on browser `localStorage` copies of report history.

See [docs/REPORTING_STORAGE.md](C:/Dev/repos/home-energy-manager/docs/REPORTING_STORAGE.md)
for the current archive layout and the intended split between HEROS report
storage and InfluxDB time-series retention.

See [docs/REPORTING_PAYLOAD.md](C:/Dev/repos/home-energy-manager/docs/REPORTING_PAYLOAD.md)
for the compact reporting payload contract used by the Report page and embedded
report card.

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

After install, Settings → Devices & Services → HEROS → Configure:

- **Scan interval** (seconds) — minimum 30, default 60. Changes apply
  immediately (the integration reloads on options changes).

## Troubleshooting

- **A repair issue says "Host inverter not configured"** — you have more than
  one inverter on the account and no Host has been selected. Reconfigure
  (Settings → Devices & Services → HEROS → ⋮ → Reconfigure) and pick one.
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
