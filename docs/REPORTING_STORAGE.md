# Reporting Storage

## Current HEROS report storage

HEROS already maintains a compact local report archive for the
panel and export flows.

Current local storage:

- `www/heros-history/<entry_id>/history.json`
- `www/heros-history/<entry_id>/<scope>.csv`

What this archive stores:

- one provider-aware report snapshot per day and scope
- power-diagram data used by the report card
- the full dated provider chart payload returned for that day/scope
- mapped solar forecast snapshots captured from Home Assistant forecast
  entities at archive/report build time
- missing-date markers so empty provider days are not fetched forever
- lightweight CSV exports generated from the stored report rows
- compact per-scope archive summaries used by the Report page

Those per-scope archive summaries include:

- derived archive health shown on the Report page
- known archive-day count shown on the Report page
- derived archive coverage percentage shown on the Report page
- derived archive completeness summary shown on the Report page
- derived archive freshness shown on the Report page
- derived archive age shown on the Report page
- derived archive lag shown on the Report page
- derived archive range shown on the Report page
- compact archive snapshot summary shown on the Report page
- derived archive snapshot sentence shown on the Report page
- sectioned archive-status grouping shown on the Report page
- per-scope archive coverage cards shown on the Report page
- direct archive file links shown on the Report page when URLs are available
- stored report-row count
- missing-date count
- first and last stored dates
- last archive update timestamp
- matching scope CSV filename when one exists
- matching scope CSV URL when one exists
- history archive filename and URL

Scope model:

- `all` for merged monitoring
- one scope per live/discovered battery target

## Background flow

The integration currently seeds and extends this archive through
`ensure_report_history`.

Background behavior:

- a fresh install schedules initial report-history backfill
- each scope is downloaded independently
- valid power-diagram rows are persisted to `history.json`
- each stored row keeps both the normalized HEROS chart series and the original
  provider day payload so later report work does not need to re-download the
  same web chart day
- the aggregate `all` scope should store the provider day chart as well, using
  the provider's aggregate chart request shape for `All Batteries` rather than
  falling back to a one-point synthesized snapshot
- aggregate ByteWatt requests should follow the observed web shape:
  - live/totals use `sysSn=All` with a blank `stationId`
  - the day-chart request uses the provider account `userId`, which may need
    to be discovered from menu/device payloads when login does not expose it
- per-scope CSV summaries are regenerated after each stored snapshot
- report diagnostics should read the HA-served archive directly rather than
  caching history rows in browser `localStorage`
- report scope coverage should include `all` plus each live/discovered battery
  scope exposed by the settings-target selector
- when the selected date is today, the report card now also keeps an in-memory
  per-scope live time-series cache built from each 10-second direct API poll so
  battery swaps can redraw immediately without waiting for archive backfill
- when a live scope is selected, the current direct API snapshot should also be
  seeded into that in-memory time-series cache immediately so the chart can
  reuse the newest point before the next 10-second poll lands
- when a scope has already rendered for the selected date, switching away and
  back should restore that cached scope first, then layer the next live poll on
  top instead of blanking the chart immediately
- for the current day, the live report should keep preferring a real backend
  provider chart when one is already present for the selected scope/date and
  only fall back to that in-memory time-series cache when the backend chart is
  still missing or too sparse to draw a useful report
- when the live time-series cache is used for the aggregate scope, current-day
  energy totals should be derived from the cached poll intervals instead of
  inheriting stale full-day backend totals from an older base report
- that live cache is held only in the active report-card session and resets when
  the local browser day changes; it is a rendering cache rather than shared HEROS
  configuration
- live chart refresh cadence is period-aware: `1H` can refresh every minute,
  while `6H`, `12H`, and `24H` should refresh at most every five minutes
- archived/historical dates should not auto-refresh from live polling, because
  their chart data is static after the selected archive row has loaded
- archived rows can still be incomplete if they were persisted before the day
  fully settled; a full 289-point provider time array with zero-filled values
  after the last meaningful late-evening point should be treated as an
  incomplete tail, not a trustworthy finished day
- when an incomplete historical tail is detected, the report should keep the
  valid portion visible, show a status note, and force a refresh for that scope
  and date
- historical dates should default back to `24H` when the date changes so the
  user first sees the complete archived day
- when a historical date uses `1H`, `6H`, or `12H`, the chart should use the
  last hovered/clicked chart point as the focus anchor; the compact focus-time
  selector is a manual override for choosing the time slice directly
- live/today short ranges should continue to anchor around the newest available
  point rather than a historical focus time

## InfluxDB direction

InfluxDB is the intended long-term store for detailed sensor history.

Current status:

- planned target only
- no HEROS-managed Influx write path is implemented yet
- current report/history features still rely on the HEROS local archive described above

Planned role for InfluxDB:

- retain detailed time-series sensor data for long-range analysis
- support higher-resolution historical queries than the compact HEROS archive
- complement the HEROS report archive rather than replace it

HEROS local archive remains responsible for:

- provider-aware report snapshots
- report-card rendering inputs
- daily report exports
- lightweight local history inspection inside Home Assistant

InfluxDB should be treated as the long-term detailed sensor backend, while HEROS
keeps the compact provider/report-oriented layer used directly by the panel.

## Current open issues

These are the reporting items that still need attention:

- `2026-08-09` is missing from the stored archive even though the provider
  history is available online and should have been refreshable.
- `Today` should never wait on archive backfill when live data is already
  available.
- `All Batteries` should keep `history.current_scope` as `all`; it must not
  inherit the first/current battery scope while the aggregate selector is active.
- For today's report, rich archived provider chart data should take precedence
  over sparse live memory points, with live values overlaid onto the archived
  chart when both are available.
- A stored `all` archive row with only one `00:00` point and
  `power_diagram_source: synthesized_from_backend_snapshot` is a backend fetch
  failure signal, not a valid aggregate day chart.
- When a sparse synthesized `all` row is detected, the report page should treat
  it as missing history and request a fresh archive download instead of
  reusing it as a valid chart.
- Opening the battery selector should not clear the current report; live
  updates should be held while the selector is open so the current chart stays
  visible until a new scope is actually chosen.
- Opening the battery selector should not push the embedded report card into a
  pending/loading state before the user actually commits a new battery scope.
- If a Home Assistant update lands while the selector menu is open, the report
  card should defer its full rerender until the selector closes instead of
  clearing and rebuilding the chart mid-click.
- Once a battery or aggregate scope has already rendered for the selected date,
  switching away and back should restore that chart instantly from in-memory
  scope cache while the background refresh catches up.
- The shared battery selector should update in place during open, close, and
  commit actions rather than replacing its whole DOM block, so selector
  interaction does not trigger report flashing.
- Single-battery reports should remain battery-scoped and hide system-wide
  generation values unless they can be tied directly to that battery.
- The report page should show a clear status message whenever it is loading
  live data, loading archive data, or waiting for a scope refresh.
- Chart click/tap should not freeze hover or parent-card behavior; on
  historical charts it may commit the hovered/nearest point as the short-range
  anchor, while live charts should still treat click/tap as a no-op.

## Web chart presentation notes

The provider web chart currently shows these interaction details that HEROS should
preserve or mirror when the report work resumes:

- the plotted series use shaded fills instead of only line outlines
- the bottom legend acts as a set of visibility toggles
- the Y-axis communicates `kW` directly on the left side of the chart
- the chart timeline shows more granular values than the rounded top summary
  tiles
- hover/click tooltips expose the exact values at a chosen time point
- the summary tiles at the top should stay consistent with the tooltip values
- the summary tiles should be standardized into one row with matching sizing
  and alignment
- the totals should use clear color coding that matches the chart legend
- each total tile color should stay consistent with the underlying element it
  represents
- the labels should not say `Today` when the report context already makes the
  date scope obvious
- the totals row should not leave one tile isolated on the left while the
  others wrap unevenly

## UI requirements to carry across report pages

These layout rules are intended to apply to the report catalog, power diagram,
statistical diagram, solar, pricing, and future report pages so the whole HEROS
report area stays compact and consistent:

- keep report controls in the smallest practical number of rows
- make the next Report-page UI pass explicitly space-optimization focused
- remove avoidable white space before the first live chart so users do not need
  to scroll through filler panels before reaching active report content
- keep lines, paddings, and chrome visually tight; prefer thin chart strokes,
  compact toolbars, and denser spacing over oversized decorative spacing
- keep the report version badge inline with the report title and matched to the
  same row height instead of giving the version its own row or oversized block
- compress the top Report description area into a short compact summary and do
  not reserve a tall card for a few lines of text
- treat the report chart as the primary content target and let surrounding copy
  support it without pushing it below the fold
- move date or period selectors onto their own row when the controls start to
  crowd the header
- when the controls do fit, keep them on the same row rather than creating a
  new full-height row unnecessarily
- avoid wasting horizontal space with uneven card widths or a lone tile on a
  separate line
- prefer compact, matching summary tiles with shared sizing and aligned labels
- keep color coding consistent between the chart series, legend, and summary
  tiles
- treat battery SOC as right-axis context, not as a competing left-axis power
  series: label it as `BAT SOC`, draw it softly behind power flows, and keep
  `Load`, `Solar`, `Feed-in`, and `Consumed` as the primary power series
- render power diagrams as shaded area-first charts with thin outlines, closer
  to the provider web chart, rather than heavy competing line graphs
- use expandable menus or grouped tabs for report catalogs instead of very tall
  stacked lists
- let categories expand downward from a single compact header row
- hide non-applicable tiles or metrics when a specific scope cannot provide
  them, especially for per-battery views
- keep all-systems summaries separate from single-battery summaries
- make the active report type obvious without requiring extra vertical chrome
- allow the layout to adapt cleanly to both light and dark Home Assistant
  themes
- preserve enough room for multiple reports on one page when comparison is
  useful
- keep interactive legends and tooltips visible and easy to reach without
  enlarging the overall layout
- standardize terminology so labels do not shift between `Today`, `All
  Batteries`, and per-battery scope unless the scope genuinely changes

### Power diagram short-range period presets

The compact power-diagram toolbar should add short-range period presets before
any week-scale option is considered:

- `1H`
- `6H`
- `12H`
- existing `24H`

Current direction:

- ignore `1W` for now
- keep the period presets compact enough to sit in the same visual header row
  when space allows
- use the active period state as a strong visual cue without increasing row
  height unnecessarily
- make the period presets work as a chart-range shortcut, not as a replacement
  for the date selector

## Statistical diagram notes

The statistical diagram should be documented as a separate interactive history
view with these behaviors:

- `Monthly`, `Yearly`, and `Since Installation` are the primary chart modes
- the active mode should be easy to identify at a glance
- the bars should read as shaded history values, not just thick line strokes
- the legend should toggle each series on and off
- the legend colors should match the plotted series
- the left axis should label `Energy (kWh)` clearly
- the hover/click tooltip should reveal the exact values for the chosen day or
  point
- the top summary values should stay synchronized with the tooltip point
- the download button should remain accessible in the top-right area
- the date or period selector should drive the full chart context
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
- mapped solar forecast values are now captured into each report payload under
  `forecast` and persisted with archive rows/CSVs so future predicted-vs-actual
  reports have durable provider forecast history, not only current HA state
- profit-style reports should support top-line financial totals such as total
  income and total expenses, a ratio or progress strip, and a monthly/yearly/
  since-installation chart driven by profit-related series
- profit-style reports should keep the legend tied to the financial series such
  as feed-in, self-consumption, and load shifting
- a stacked daily consumption report is worth adding later where the total
  daily load is broken into source buckets such as solar, battery, and grid
- the exact source-mapping rules for that stacked report should be decided when
  the report is built, not locked in yet
- Forecast.Solar historic-average backfill should be treated as an optional
  benchmark source and cached by HEROS after a successful provider test, rather
  than being fetched repeatedly for the same date/site/plane
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

Live report interaction notes:

- opening the shared battery selector must push `selectorOpen` into the
  embedded report immediately so a background Home Assistant update does not
  clear the chart during the click/release cycle
- choosing a new battery scope must push `pendingSelection` into the embedded
  report immediately so the report can reuse its last cached scope snapshot
  before the next provider refresh lands
- live report charts may plot direct API watt values, but the report UI should
  normalize the chart axis and summary power figures into `kW` so the live view
  reads consistently against the provider chart presentation
- when the Home Assistant selector state changes before the reporting payload
  catches up, the active report scope should follow the selector state first so
  the report does not keep showing the last battery label or cached scope by
  mistake
- for the current day, a sparse synthesized backend snapshot should not outrank
  a richer in-memory live chart for the same scope; use the backend day chart
  only when it contains a real time-series
- the shared battery selector should include live `direct_api.live_batteries`
  rows as option sources as well, so the menu still lists every live battery
  even when the backend select options have not caught up yet
- chart tooltips must convert browser pointer coordinates into the SVG viewBox
  before choosing the nearest point, then convert marker and tooltip positions
  back into screen pixels so hover remains accurate at every responsive chart
  width
- chart point inspection is hover-driven; click/tap on the chart should not lock
  or stop the chart because live charts still need to keep following live data
- chart clicks inside the plot should be swallowed from parent-card behavior so
  they do not trigger focus or selection side effects that can freeze hover
- on historical `24H` views, clicking or hovering a point should set the
  inspection anchor used when the user then changes to `1H`, `6H`, or `12H`
- the power diagram should include a transparent SVG hit target over the plot
  area so chart interactions are not dependent on landing exactly on a line or
  shaded polygon
- the transparent SVG hit target should sit above plotted series and plotted
  layers should not consume pointer events, so hover still works after any
  legend series is hidden
- the chart's left-to-right refresh reveal should only run for meaningful chart
  context changes such as date, scope, period, view, or empty/sparse/rich state
  transitions; routine live poll points should update the chart without making
  the whole graph look like it is constantly rebuilding
- routine live poll points should update the report body in place rather than
  replacing the full card shell, so hover state and page position feel stable
  while the 10-second live stream is active
- live time-series samples should be bucketed to the provider refresh cadence
  rather than exact render seconds, so unrelated Home Assistant state updates
  do not create extra chart redraws between real provider samples
- live time-series render cadence is period-aware: `1H` samples/redraws at most
  once per minute, while `6H`, `12H`, and `24H` sample/redraw at most once every
  five minutes
- historical dates must not capture live time-series samples or run the live
  refresh path; archived-day charts should stay stable while users inspect
  hover values

## Independent installation dates

HEROS treats the solar/inverter installation and the battery installation as
separate dates. They may be the same date, but they do not have to be.

- **Solar/inverter installation date** controls backfill for inverter and plant
  history: PV production, PV power, load, grid import/export, feed-in, EPS,
  and other inverter or solar time-series values.
- **Battery installation date** controls backfill for battery history: SOC,
  battery power, charge/discharge energy, battery temperature, health, cycles,
  capacity, and per-battery values.

The dates are configuration values, not guesses derived from the first value
returned by the cloud. Settings should allow each date to be selected or
manually overridden independently, reject future dates, and provide an
automatic/provider-derived option when FoxESS exposes a reliable installation
or commissioning date. A battery replacement is recorded by changing the
battery date for the replacement scope; the original battery's archived
history remains associated with its earlier scope.

When a report combines solar and battery data, HEROS must respect both coverage
windows. It must not invent battery values before the battery date or solar
values before the solar/inverter date. The report should show the applicable
coverage period for each stream, so a partially populated early period is
understood as missing provider history rather than zero generation or zero
battery activity.

For the current installation, the initial value supplied by the operator is
**6 September 2026**. Set both dates to `2026-09-06` initially, then adjust
the battery date independently if the battery system was commissioned later.

FoxESS history is collected from the provider's day and week history
endpoints, while HEROS stores the normalized daily snapshot and time-series
payload in the local archive. This archive is separate from Home Assistant's
recorder history and is the source used for report backfill and export.
## Derived battery interruption marker

The FoxESS V2 power diagram can show a **red vertical line** labelled **Error
occurred** in the point tooltip. This is a derived operational marker, not a
provider-confirmed inverter fault.

HEROS adds one marker at the start of a qualifying run: battery discharge is
25 W or less while grid import and load are both at least 100 W and battery SOC
is above 10%. It does not require the immediately preceding five-minute point
to contain discharge, because FoxESS can omit that value at the transition.
The first matching point receives the marker; the remaining continuous run does
not receive repeated alerts.

The current FoxESS V2 cloud history does not expose the inverter or BMS fault
reason needed to classify the event further. When Modbus telemetry is added,
HEROS should correlate this marker with battery enable state, inverter alarms,
BMS fault codes, contactor state, and per-battery availability. Until then, the
marker means that battery discharge stopped unexpectedly; it does not diagnose
the cause.
## Mode Timeline report

Mode Timeline is a separate FoxESS V2 report view. It reads every available
five-minute history point and groups consecutive points into operating periods;
it does not smooth, aggregate, or replace source values.

A period is labelled, in priority order, **Error occurred**, **Battery
charging**, **Battery discharging**, **Grid importing**, **Grid exporting**,
**Solar supplying**, or **Balanced / idle**. Error occurred follows the
derived battery interruption marker and occupies its source five-minute
interval. Hovering any period shows its exact start and end time. These are
operational interpretations of cloud telemetry; Modbus alarm and BMS data will
later provide confirmed fault classification.
## Daily Detail report

Daily Detail is a FoxESS V2 report view that displays every available
five-minute source point for the selected day. Each row shows the timestamp,
SOC, solar, battery discharge, battery charge, grid import, feed-in, total
load, and the derived operating status. Power values are shown as positive
magnitudes so charging and discharging remain directly comparable in their own
columns.

A red **Error occurred** status is shown for the same derived battery
interruption event used by the Power Diagram and Mode Timeline. A yellow
**Missing N five-minute points** status is added immediately after a source
timestamp gap. Missing values are separately labelled rather than represented
as zero. This report is the row-level audit view behind the visual reports and
its CSV download exports the same selected-day data.

## Tariff Impact report

Tariff Impact is a FoxESS V2 report view that calculates an estimated daily
energy cost from the selected day's five-minute source points and the saved
date-effective pricing schedule. It chooses the most recent tariff group
effective on the selected date, then applies its import and feed-in $/kWh
records by day type and time window. Public-holiday rows take precedence when
the selected date is recorded as a public holiday.

The report shows import cost, feed-in credit, the daily connection charge, net
daily cost, and avoided grid-only cost. Its timeline represents each available
five-minute interval and exposes the active import/export rate and interval
cost on hover. Source gaps are explicitly marked and excluded rather than
being filled with assumed energy. When no applicable pricing schedule exists,
the report explains the required Pricing-page setup instead of producing a
zero-cost estimate. These figures are an operational estimate from available
FoxESS telemetry, not a bill reconciliation.
## Report toolbar placement requirements

All report views share one date-picker location in the secondary toolbar. Power Diagram time presets (1H, 6H, 12H, 24H) sit immediately after the date picker. Tariff period controls (Day, Week, Month, Quarter, Year) use the same position and replace the power presets. Period labels are bold, controls use the active theme, and the selected period is visibly highlighted. Do not introduce a second date selector inside a report card.

Power Diagram uses the same toolbar rule: the shared date selector comes first, followed by a bold Period label and the 1H/6H/12H/24H controls.

### Report layout guardrails for future reports

Every new report view must reuse the existing report toolbar structure. The date navigation belongs in the shared secondary toolbar at the same location as the other report views. Report-specific period controls follow the date navigation in that toolbar; they must not be added inside the report card or as a second date picker. Use the same date input, previous/next controls, fixed control sizing, theme variables, padding, and selected-state styling.

Before deployment, verify the following in a real browser at the same viewport:

1. Open Power Diagram and record the left edge of the date input and the Period label.
2. Switch to the new report and confirm those two left edges are unchanged.
3. Switch back and repeat once more; no control may move, resize, or change date formatting unexpectedly.
4. Select every report-specific period and confirm the selected button is visibly highlighted using the active theme.
5. Hard-refresh the browser and repeat the switch check to catch stale module URLs or cache-buster mistakes.

The implementation is not complete until this visual switch check passes. Record the report build, panel build, cache-busted module URL, and the browser used for the check in the handback. Syntax checks and asset hash checks alone do not count as visual verification.
### Mandatory interaction test before handback

Do not hand a report change back after only source inspection, unit-style checks, syntax validation, deployment hashes, or an unauthenticated browser render. Before handback, exercise the changed interaction in the authenticated live HEROS UI at `http://10.0.0.111/heros`.

For navigation changes, record the initial date, every clicked report/period/date/previous/next control, and the resulting displayed date after each step. Verify both a period change and a previous/next move. If the authenticated live UI cannot be accessed, state that the work remains unverified and do not describe it as tested or complete.

The handback must state the report build, panel build, browser used, exact interaction sequence, and observed result. The user should only need to hard-refresh and independently confirm after this verification has passed.

### Tariff grouped-period aggregation

For Week, Month, Quarter, and Year, Tariff Impact must calculate from every saved
five-minute history record within the selected calendar period. The calendar
start must not be treated as a prerequisite for a result: an installation that
began part-way through a month must aggregate the available saved days.

Energy-derived values (import cost, feed-in credit, and avoided grid-only cost)
use only valid saved source intervals. The supply charge is separate: apply it
for every date in the selected period on which a tariff group is effective,
even when the energy source data for that date is absent. The grouped summary
must show `Days in period` as `saved-data days / tariff-effective days`, and its
note must state both counts. A grouped tariff view must use the local HEROS
archive and must not request FoxESS history merely because the first calendar
day has no record.

Before handback, use the authenticated live UI to verify a period whose first
calendar day predates the first saved record. Confirm it renders a non-zero
multi-day supply charge, counts the saved days, and does not show a FoxESS
credential or history-request error.
### Tariff Impact timeline labels

Tariff Impact must show an X-axis that describes the visible segments: Day uses
time of day; Week uses one segment per day; Month uses one segment per calendar
week; Quarter and Year use one segment per calendar month. The axis labels and
bar boundaries must represent the same buckets. Keep the colour legend as a
separate explanation of Import cost, Feed-in credit, No applicable tariff rate,
and Missing source interval. Tooltip text must use plain ASCII separators so it
remains readable in every browser font.