# Reporting Payload Contract

## Purpose

The Home Energy Manager Report page and embedded report card both rely on the
shared reporting payload exposed on the settings-target select entity.

Primary source:

- `select.house_<prefix>_settings_target`

Key attributes:

- `attributes.reporting`
- `attributes.history`
- `attributes.selection`

## Reporting attribute

`attributes.reporting` is the compact payload used by the report UI.

Top-level structure:

- `label`
- `aggregate`
- `reporting_date`
- `saved_at`
- `meta`
- `history`
- `live`
- `today`
- `totals`
- `power_diagram`

### `meta`

Used to describe where the payload came from and how it should be interpreted.

Expected keys:

- `saved_at`
- `source`
- `storage`
- `power_diagram_source`
- `history`
- `timezone`
- `timezone_code`

Current values:

- `source: backend_reporting`
- `storage: local_archive`
- `power_diagram_source: provider_power_diagram` or `synthesized_from_backend_snapshot`

### `live`

Current real-time values used by the report hero and live summary areas.

Keys:

- `soc`
- `battery_power`
- `house_consumption`
- `grid_power`
- `pv_power`
- `power_source`

### `today`

Current day summary values.

Keys:

- `solar_generation`
- `load_consumption`
- `feed_in`
- `grid_consumption`
- `battery_charge`
- `battery_discharge`

### `totals`

Longer-running provider totals kept in the compact payload.

Keys:

- `solar_generation`
- `feed_in`
- `battery_charge`
- `battery_discharge`
- `house_consumption`
- `grid_consumption`

### `power_diagram`

Chart payload used by the report card.

Keys:

- `date`
- `meta`
- `summary`
- `time`
- `series`

## History attribute

`attributes.history` describes the HEM local archive status.

Expected keys:

- `enabled`
- `base_url`
- `status`
- `current_scope`
- `entry_id`
- `backfill_years`
- `backfill_days`

This is the metadata used by the Report page archive-status section.

## Local archive

The current HEM local reporting archive lives under:

- `www/home-energy-manager-history/<entry_id>/history.json`
- `www/home-energy-manager-history/<entry_id>/<scope>.csv`

This archive is used for:

- provider-aware daily report snapshots
- chart/power-diagram reuse
- CSV exports
- backfill progress and history inspection

## InfluxDB role

InfluxDB is the planned long-term detailed sensor backend.

It should hold:

- detailed time-series sensor history
- higher-resolution analysis data
- longer retention than the compact HEM report archive

It should not replace the compact HEM report payload used directly by the panel.
