# Reporting Payload Contract

## Purpose

The HEROS Report page and embedded report card both rely on the
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
- `forecast`
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

For aggregate `All Batteries` reporting, HEROS should prefer a real
`provider_power_diagram` and only fall back to
`synthesized_from_backend_snapshot` when the provider day chart endpoint
returns no usable series for that scope/date.

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

Zero totals are valid data and must be preserved as `0`, not replaced by the
matching current-day value just because Python treated `0` as falsy.

### `power_diagram`

Chart payload used by the report card.

Keys:

- `date`
- `meta`
- `summary`
- `time`
- `series`
- `raw_provider`
- `provider_payload`

`raw_provider` is the compact subset HEROS reads most often for report logic.

`provider_payload` is the full dated provider chart payload saved with the
archive row so future report features can reuse the original downloaded source
without calling the web chart endpoint again for the same day/scope.

Provider chart curves are stored in the provider scale as returned by the web
chart payload. In the current Bytewatt web flow that means the power-diagram
series and related point-in-time power summary values are typically expressed
in `kW`, while direct live battery snapshots such as `pbat`, `pload`, `pgrid`,
and `ppv` remain raw provider realtime values in `W`.

The report-card UI may still normalize those live realtime power values into
`kW` for chart-axis and summary display so the live report reads consistently
with the provider chart, but the stored direct API payload must stay in its
original units.

### `forecast`

Mapped solar forecast values captured when the reporting payload was built.

Expected keys:

- `provider`
- `saved_at`
- `entities`
- `values`

The `entities` map records the configured source entity IDs. The `values` map
records the state, unit, and source `last_updated` timestamp for each mapped
forecast sensor. This is HEROS-owned forecast snapshot history going forward; it
is not a provider historic-average curve.

Forecast.Solar historic-average data, when configured later, should remain a
separate benchmark source so reports can distinguish:

- actual measured generation
- forecast snapshots captured by HEROS at the time
- provider historic averages for the same site/plane/date

## History attribute

`attributes.history` describes the HEROS local archive status.

Expected keys:

- `enabled`
- `base_url`
- `status`
- `current_scope`
- `entry_id`

This is the metadata used by the Report page archive-status section.

## Local archive

The authoritative provider-aware daily report archive is `/config/heros-history/<entry_id>/archive.sqlite3` (schema version 1). Report retrieval, coverage, missing dates, and download job state come from SQLite. The panel requests bounded date ranges from the backend. A successful day is stored independently, and an interrupted download resumes from committed records.

The older `www/heros-history/<entry_id>/history.json`, its `.bak`, and scope CSVs remain as migration and rollback material. They are not rewritten by normal SQLite archive operations. See [ARCHIVE_SQLITE.md](ARCHIVE_SQLITE.md) for backup, export, recovery, and rollback procedures.

## Future detailed telemetry

Future Modbus or other high-frequency sensor history needs a separate storage design. HEROS does not install or write to InfluxDB for daily report archiving.
## Financial report calculations

Financial views use the same date range and saved tariff schedule as Tariff Impact. Import cost is grid import energy priced by the active buy record; supply charges are summed per expected calendar day; export revenue is feed-in energy priced by the active sell record; net cost is import cost plus supply charges minus export credit. Savings is the avoided grid-only cost for household demand. Solar self-consumption value prices solar used on site at the active import rate. Solar and battery export remain separate classifications while total feed-in remains the reconciliation value.
