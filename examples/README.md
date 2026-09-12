# HEROS UI Examples

This folder contains two UI artifacts linked to the current branch work:

- `lovelace/heros_policy_cards.yaml`
  Immediate-use Lovelace YAML using built-in cards.
- `lovelace/heros_report_card.yaml`
  Minimal view config for the custom reporting card.
- `www/heros-policy-card.js`
  A custom card scaffold that mirrors the HEROS app layout more
  closely while keeping unsupported controls visibly marked as not enabled.
- `www/heros-report-card.js`
  A thin loader that imports the current reporting build.
- `www/heros-report-card.008.js`
  The current reporting card build for power-flow, daily summaries, and chart data.
- `www/heros-debug-card.js`
  A focused inspector card for raw entity state, archive metadata, and probe actions.

The Lovelace filenames use the HEROS namespace. The example entity IDs still
contain `bytewatt` because they match the device name used by the original
ByteWatt installation; entity IDs may differ on a fresh Home Assistant setup.

## Why Both Exist

The integration backend is only partially modeled today. The confirmed controls
already exposed by the integration can be wired now:

- Settings target selector
- Charge enable
- Discharge enable
- Charge cap
- Discharge cutoff SOC
- Execution cycle
- UPS reserve enable
- Off-grid SOC control
- Charge/discharge times
- Feed-in controls
- Submit / discard buttons

The following app controls still need HAR-backed API work before they become
real entities:

- Any separate Start / Stop master action, if the app uses one

The YAML view gives you a usable interface now. The custom card gives you a
closer replica of the app screen without pretending the missing controls work.

## Recommended Setup

For settings changes, do not use the portal's `All` selection.
In parallel-battery systems that path can overwrite shared strategy data in
unpredictable ways.

Recommended approach:

- use `All` only for merged monitoring
- configure settings from the integration's individual battery selector
- prefer a per-battery/host-target setup for charge, discharge, and policy changes

## Panel Dropdowns

The sidebar panel is updated by frequent Home Assistant state pushes. Any panel
dropdown that has to stay open while the user clicks, drags, or releases should
use the same held custom selector pattern as the shared battery selector instead
of a native `<select>`.

For setup pages such as Forecast Setup, a reliable dropdown needs:

- explicit open/closed component state
- inclusion in the render-hold checks while active
- delegated toggle, option, and outside-click handlers
- fallback-controller initialization for the same open-state fields
- a save-time translation when UI field names differ from persisted mapping keys

If the page includes a broad mapping panel, keep that panel full-width on
desktop and let the dropdown inherit the card width directly. That prevents the
menu from collapsing into a narrow shared column and makes long entity lists
usable.

This prevents HA refresh renders from closing the menu before the selected value
is committed and reflected in the visible control.

## Browser Storage Boundary

Use Home Assistant-backed config or files for any setting that should persist
across browsers or devices, including:

- setup mappings
- hero mapping overrides
- pricing configuration
- policy charge schedules

Browser-local storage should be limited to UI convenience only, such as:

- active page memory
- selected battery convenience
- debug toggle visibility
- settings focus
- remembered `entry_id` hint

## Historical Data Workflow

The reporting card is designed to work without a manual download step.

Expected flow:

1. Configure the integration in Home Assistant.
2. Set the **History backfill horizon** in the integration options.
3. Leave HA running so the backend can backfill daily archive rows.
4. Open the report card and select:
   - battery scope
   - period
   - date
5. The card reuses already-downloaded rows from local history.
6. If a selected day is missing, the backend fetches it automatically.
7. If the source has no data for a date, the card should say that clearly.

Notes:

- The archive is stored per scope, so `All systems` and each battery can keep
  separate history.
- The report card's date control should reuse the stored archive first and only
  trigger a backend fetch for the selected day when that scope/date is missing.
- For ByteWatt web history, the dated power diagram comes from the provider
  `staticsByDay` endpoint and is cached locally by HEROS per scope/date so the
  report page does not need to re-download the same day every time.
- Mapped solar forecast entities are also captured into HEROS report snapshots
  going forward, so future forecast-accuracy reports can compare stored
  forecasts against measured generation.
- Forecast.Solar historic averages are optional benchmark/backfill data and
  require a provider plan/API key that allows the `history` endpoint. They are
  not the same as a forecast that was issued on a past date.
- That provider payload is the web-app level of detail. A future Modbus-backed
  history source can be richer, but it should still normalize into the same HEROS
  report payload shape.
- The date picker clamps to today. Future dates are not queried.
- Once a day exists locally, it should load fast on later visits.
- `Today` is live reporting and should not be treated as an archive download.

## Installing The Custom Card

Copy the working file from `examples/www/` to your Home Assistant `www` folder:

- `/config/www/community/heros/heros-policy-card.js`
- `/config/www/community/heros/heros-report-card.js`
- `/config/www/community/heros/heros-report-card.008.js`
- `/config/www/ha-git/heros_git_log.html`

Then add it as a dashboard resource using a fixed filename and a cache-buster:

```yaml
url: /local/community/heros/heros-policy-card.js?v=009
type: module
```

Reporting card:

```yaml
url: /local/community/heros/heros-report-card.js?v=397
type: module
```

Debug card:

```yaml
url: /local/community/heros/heros-debug-card.js?v=036
type: module
```

Log viewer:

```yaml
type: iframe
url: /local/ha-git/heros_git_log.html?v=001
aspect_ratio: 180%
```

If you are using the repo-managed HA pull script from `scripts/ha_git_pull.sh`,
it should also deploy `custom_components/heros` at the same time
so the card and backend stay aligned.

## Resource Counter

To force Home Assistant and the browser to load a fresh custom-card build:

1. Keep the resource filename fixed as `heros-policy-card.js`
2. Increment the internal build number in the JS file
3. Increment only the Lovelace `?v=` value to the same number
4. Keep numbered archive copies in `examples/www/` for rollback/reference

Example next iteration:

```yaml
url: /local/community/heros/heros-policy-card.js?v=009
type: module
```

Reporting card next iteration:

```yaml
url: /local/community/heros/heros-report-card.js?v=397
type: module
```

Debug card next iteration:

```yaml
url: /local/community/heros/heros-debug-card.js?v=036
type: module
```

Current build stamp in this repo:

- Panel: `484`
- Policy card: `009`
- Reporting loader URL: `397`
- Reporting loader import cache-buster: `397`
- Reporting archive file: `008`
- Reporting component: `086`
- Debug card: `036`

## Defaults

The examples now default to the current entity set used in this branch:

- prefix: `house_heros_battery_system`
- submit button: `button.house_heros_battery_system_submit_settings`
- discard button: `button.house_heros_battery_system_discard_pending_settings`

The custom card will use those entities automatically if you do not override
them.

The Lovelace YAML example is also pre-wired to the same entity IDs.

## Optional Overrides

If your entity IDs differ, you can still override them in the custom card.

At a minimum, these battery-policy fields can be overridden:

- `entity_prefix`
- `settings_target`
- `charge_switch`
- `discharge_switch`
- `charge_cap`
- `discharge_cutoff`
- `charge_power`
- `discharge_power`
- `execution_cycle`
- `ups_reserve`
- `offgrid_soc_control`
- `charge_start_time`
- `charge_end_time`
- `discharge_start_time`
- `discharge_end_time`
- `submit_button`
- `discard_button`

Feed-in fields:

- `feedin_enabled`
- `feedin_cutoff`
- `feedin_time_start`
- `feedin_time_end`
- `feedin_power`
- `feedin_submit_button`
- `discard_button`

Optional not-yet-enabled fields:

- `master_action`
