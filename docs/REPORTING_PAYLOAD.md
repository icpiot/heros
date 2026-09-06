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
- `backfill_years`
- `backfill_days`

This is the metadata used by the Report page archive-status section.

## Local archive

The current HEROS local reporting archive lives under:

- `www/heros-history/<entry_id>/history.json`
- `www/heros-history/<entry_id>/<scope>.csv`

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
- longer retention than the compact HEROS report archive

It should not replace the compact HEROS report payload used directly by the panel.

## Current display rules

These rules capture the intended report behavior that still needs to stay
consistent while the archive work continues:

- `Today` should use the live reporting payload first.
- `All systems` should show the combined aggregate view for all batteries.
- Live report scope must come from the current settings-target select state;
  stale `attributes.selection` or `direct_api.selected_scope` values must not
  override a visible `All systems` selection.
- A single battery should only show values that belong to that battery scope.
- System-level generation should stay hidden in a single-battery report unless
  the source data can be mapped directly to that battery.
- If the card is waiting for live or archive data, it should show a status
  message rather than a blank fallback panel.

## Web chart behavior notes

The Bytewatt web chart shows a few presentation details that HEROS should keep in
mind when matching the report experience:

- the chart series are color-shaded areas rather than thick solid strokes
- the legend toggles at the bottom match the line colors and can hide/show
  individual series
- the left axis is labeled in `kW` so the user can read the power scale directly
- the chart shows more precise timeline values than the rounded summary tiles
- hovering or clicking at a point in time opens a tooltip with the per-series
  values for that timestamp
- the top summary tiles should reflect the same values shown in the hover
  tooltip for the selected point
- the summary tiles should be standardized into one row with matching sizing
  and alignment
- the totals should use clear color coding that matches the chart legend
- each total tile color should stay consistent with the underlying element it
  represents
- the labels should not say `Today` when the report context already makes the
  date scope obvious
- the totals row should not leave one tile isolated on the left while the
  others wrap unevenly

## Statistical diagram notes

The monthly/yearly/since-installation chart should behave like an interactive
history drill-down rather than a static bar chart:

- the active period selector should make `Monthly`, `Yearly`, and
  `Since Installation` visually obvious
- the plotted bars should stay lightly shaded rather than feeling like thick
  opaque strokes
- the legend should act as a visibility toggle row for each series
- the legend colors should stay aligned with the chart series colors
- the left axis should communicate `Energy (kWh)` clearly for the statistical
  view
- hovering or clicking a day should show a tooltip for that specific point in
  time
- the tooltip should expose the exact values for all visible series at that
  point
- the top summary values should match the selected tooltip point
- the chart should keep the download action available at the top right
- the month/year selector should control the whole chart context, not just the
  tooltip
- the report layout should remove the large `At a Glance` block from this
  view so the chart starts sooner
- the header controls should be simplified so the battery/date/action controls
  read as one clean toolbar instead of separate highlighted blocks
- the report scope should be documented as `All Batteries` plus per-battery
  views, not a single-battery-only layout
- the date selector should move onto its own dedicated row when the report has
  multiple view controls
- the statistical diagram selector label should change to match the active
  mode, for example `Monthly` when the monthly view is selected
- the report styling should adapt to both light and dark Home Assistant themes
  instead of assuming the light-mode palette only
- the report area should support multiple reports visible at once when users
  want side-by-side comparison instead of a single report-only layout
- the report picker should present available reports as a more explicit report
  list or tab set so users can choose multiple reports more easily
- the layout should leave room for report tiles or stacked report panels rather
  than assuming only one chart section is ever shown
- solar reporting should distinguish Bytewatt solar data from solar-provider
  data so the report catalog can present both sources separately
- solar reporting should also separate predicted vs actual values so the
  report catalog can show forecasted solar apart from measured solar output
- report payloads can include a `forecast` section containing the configured
  forecast provider, mapped forecast entity IDs, current forecast values,
  units, source entity timestamps, and the snapshot timestamp
- profit-style reports should support top-line financial totals such as total
  income and total expenses, a ratio or progress strip, and a monthly/yearly/
  since-installation chart driven by profit-related series
- profit-style reports should keep the legend tied to the financial series such
  as feed-in, self-consumption, and load shifting
- a stacked daily consumption report is worth adding later where the total
  daily load is broken into source buckets such as solar, battery, and grid
- the exact source-mapping rules for that stacked report should be decided when
  the report is built, not locked in yet
- the `Trend` report should be the long-range direction view, while the
  `Statistical diagram` remains the calendar-style history breakdown
- `Trend` should focus on change over time across weeks, months, or the full
  installation history rather than day-by-day drill-down
- battery balance, battery flow, charge policy, tariff vs solar, forecast
  accuracy, self-sufficiency, peak demand, seasonal trend, and anomaly reports
  are all useful additions to the catalog
- battery balance should compare how multiple batteries share work
- battery flow should focus on where battery energy came from and where it went
- charge policy should show scheduled and force-charge activity over time
- tariff vs solar should compare cheap-grid charging against solar charging
- forecast accuracy should compare predicted vs actual energy values
- self-sufficiency should show how much load is covered by local energy
- peak demand should highlight the highest load windows and battery smoothing
- seasonal trend should compare system behavior across seasons
- anomaly should flag unusual days for consumption, generation, or battery use
