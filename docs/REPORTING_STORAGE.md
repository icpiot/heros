# Reporting Storage

## Current HEM report storage

Home Energy Manager already maintains a compact local report archive for the
panel and export flows.

Current local storage:

- `www/home-energy-manager-history/<entry_id>/history.json`
- `www/home-energy-manager-history/<entry_id>/<scope>.csv`

What this archive stores:

- one provider-aware report snapshot per day and scope
- power-diagram data used by the report card
- the full dated provider chart payload returned for that day/scope
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
- each stored row keeps both the normalized HEM chart series and the original
  provider day payload so later report work does not need to re-download the
  same web chart day
- per-scope CSV summaries are regenerated after each stored snapshot
- report diagnostics should read the HA-served archive directly rather than
  caching history rows in browser `localStorage`
- report scope coverage should include `all` plus each live/discovered battery
  scope exposed by the settings-target selector

## InfluxDB direction

InfluxDB is the intended long-term store for detailed sensor history.

Current status:

- planned target only
- no HEM-managed Influx write path is implemented yet
- current report/history features still rely on the HEM local archive described above

Planned role for InfluxDB:

- retain detailed time-series sensor data for long-range analysis
- support higher-resolution historical queries than the compact HEM archive
- complement the HEM report archive rather than replace it

HEM local archive remains responsible for:

- provider-aware report snapshots
- report-card rendering inputs
- daily report exports
- lightweight local history inspection inside Home Assistant

InfluxDB should be treated as the long-term detailed sensor backend, while HEM
keeps the compact provider/report-oriented layer used directly by the panel.

## Current open issues

These are the reporting items that still need attention:

- `2026-08-09` is missing from the stored archive even though the provider
  history is available online and should have been refreshable.
- `Today` should never wait on archive backfill when live data is already
  available.
- `All systems` should render immediately from the current aggregate payload
  instead of showing a fallback blank state.
- Single-battery reports should remain battery-scoped and hide system-wide
  generation values unless they can be tied directly to that battery.
- The report page should show a clear status message whenever it is loading
  live data, loading archive data, or waiting for a scope refresh.

## Web chart presentation notes

The provider web chart currently shows these interaction details that HEM should
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
statistical diagram, solar, pricing, and future report pages so the whole HEM
report area stays compact and consistent:

- keep report controls in the smallest practical number of rows
- move date or period selectors onto their own row when the controls start to
  crowd the header
- avoid wasting horizontal space with uneven card widths or a lone tile on a
  separate line
- prefer compact, matching summary tiles with shared sizing and aligned labels
- keep color coding consistent between the chart series, legend, and summary
  tiles
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
