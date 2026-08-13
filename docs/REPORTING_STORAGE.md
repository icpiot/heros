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
