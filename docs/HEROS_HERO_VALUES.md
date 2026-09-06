# HEROS Hero Values

This file defines the HEROS hero values currently used by the panel and mirrored on the setup page under `HEROS Hero Sensors`.

## What "hero values" means

In HEROS, "hero values" are the live values rendered in the hero or tile sections on panel pages. They are a frontend presentation concept, not a dedicated Home Assistant entity class.

The current source of truth is:

- `examples/www/heros-panel.js`

## Current page definitions

### Overview page

Defined in `_overviewPage()`.

Hero/tile values:

- `Battery`
- `Solar`
- `Grid`
- `Load`
- `Grid consumption now`
- `Grid import today`
- `Feed in today`
- `Consumed today`

### Battery page

Defined in `_batteryPage()`.

Hero/tile values:

- `Battery`
- `Discharge window`
- `Grid charging`
- `Settings target`
- `Battery percentage`
- `Battery power`
- `Charged today`
- `Discharged today`
- `Charge cap`
- `Minimum SOC`
- `Discharge cutoff`
- `UPS reserve`
- `Charge start`
- `Charge end`
- `Discharge start`
- `Discharge end`

### Policy page

Defined in `_policyPage()` via `batteryPolicyTiles`.

Hero/tile values:

- `Active Control State`
- `Selected Target`
- `Battery SOC`
- `Battery Total Charge Rate`
- `<battery label> Charge Rate`
- `Grid to Battery`
- `Solar to Battery`
- `Charging Source`
- `Charge Policy`

Notes:

- `<battery label> Charge Rate` is dynamic and is created once for each live battery row.
- This is already a per-battery hero definition.
- `Battery SOC` is selection-scoped and should reflect the selected battery target, or `All systems`, depending on the active selector state.

### Report page

Defined in `_reportPage()`.

Hero/tile values:

- `Battery SOC`
- `Battery power`
- `PV power`
- `House consumption`
- `Grid consumption`
- `PV generated today`
- `Consumed today`
- `Feed in today`
- `Grid import today`

### Solar page

Defined in `_solarPage()`.

Hero/tile values:

- `Solar now`
- `Grid now`
- `Feed in today`
- `Battery charged`
- `PV power`
- `PV generated today`
- `Consumed today`
- `Grid import today`
- `Self consumption`
- `Self sufficiency`
- `Battery charged from solar`

### History page

Defined in `_historyPage()`.

Hero/tile values:

- `Total solar`
- `Total consumption`
- `Total feed in`
- `Last update`
- `Solar generated today`
- `Consumed today`
- `Grid import today`
- `Feed in today`
- `Battery charged today`
- `Battery discharged today`

## Setup page mirror

The setup page mirror is currently rendered in:

- `_herosHeroSetupItems()`

and displayed in:

- `HEROS Hero Sensors`

Current intent:

- Mirror the hero/tile values used across the panel pages.
- Show them in a simple `Sensor name - value` list.

The setup page now also includes adjacent mapping/debug sections:

- `Battery Hero Mapping Summary`
- `Solar Hero Mapping Summary`
- `Bytewatt Sensors`

These sections are intended to show the direct Bytewatt source values alongside
the active HEROS hero values so mapping issues can be diagnosed without leaving
the setup page.

## Persistence rule

Hero mapping configuration must not be treated as browser-local state when it is
intended to be part of the user or project setup.

That means:

- do not rely on `localStorage` as the final persistence layer for hero mappings
- do not make browser-specific overrides the long-term source of truth
- save hero mapping overrides through HEROS backend config or
  another shared Home Assistant-backed store

Reason:

- mappings must survive browser changes, cache clears, and different devices
- setup behavior must be consistent for every user viewing the same HEROS config

## Current limitation

The setup mirror currently treats most hero values as a flat list of labels and values.

That means it does not yet fully model cases where a single hero concept has multiple live values depending on battery scope, for example:

- `Battery percentage` / `Battery SOC`
- `Battery power`
- other battery-scoped values that may exist for `All systems`, `Battery 1`, `Battery 2`, and additional batteries

In practice, this means there can be more than one valid live value for the same hero concept:

- aggregate value for `All systems`
- per-battery value for each discovered battery

## Required behavior going forward

Hero definitions should support dynamic battery-scoped variants where applicable.

Examples:

- `Battery SOC`
  - `All systems`
  - `Battery 1`
  - `Battery 2`
  - additional batteries if present
- `Battery power`
  - `All systems`
  - per battery where available
- `Charge Rate`
  - already dynamic per live battery row

## Recommended rule

For setup and debug surfaces, hero values should be represented as:

- global hero values
- selection-scoped hero values
- per-battery hero values when the provider exposes multiple battery rows

If a hero value depends on battery selection, the definition should explicitly say whether it is:

- aggregate only
- selected target only
- both aggregate and per-battery

## Bytewatt setup payload model

The setup page currently reads direct provider values from the settings target
entity attribute `direct_api`.

That payload is expected to be structured as:

- `all_systems`
- `selected_scope`
- `live_batteries`

### `all_systems`

This is the aggregate provider view and is the expected source for values such
as:

- aggregate SOC
- aggregate battery power
- aggregate load
- aggregate solar
- aggregate grid / feed-in interpretation

### `selected_scope`

This is the direct API view for the current HEROS battery selector target.

It should change when the user switches between:

- `All systems`
- a selected battery group or inverter

### `live_batteries`

This is the per-battery list returned from HEROS's live provider polling.

Each row is dynamic and may contain:

- `label`
- `system_id`
- `sys_sn`
- `soc`
- `pbat`
- `pload`
- `pgrid`
- `ppv`
- `ppv1`
- `ppv2`
- `ppv3`
- `ppv4`
- `powerSource`
- `forceChargeMode`

Important expectations:

- there may be more than two batteries
- per-battery rows are not fixed to a hardcoded count
- MPPT fields may appear on aggregate and per-battery rows when the provider exposes them
- if a provider field is missing, the setup page should show `Unavailable` rather than silently substituting a stored fallback

## Mapping guidance

Battery-facing hero values should normally map against battery-scoped Bytewatt
fields such as:

- `soc`
- `pbat`
- `pload`
- `pgrid`
- `powerSource`
- `forceChargeMode`

Solar-facing hero values should normally map against:

- `ppv`
- `ppv1`
- `ppv2`
- `ppv3`
- `ppv4`

This is why MPPT mappings belong in the solar summary rather than the battery
summary, even though the values can appear in the same direct API payload.

## Related code locations

- `examples/www/heros-panel.js`
- `_overviewPage()`
- `_batteryPage()`
- `_policyPage()`
- `_reportPage()`
- `_solarPage()`
- `_historyPage()`
- `_herosHeroSetupItems()`
