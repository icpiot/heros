# HEROS Report Catalog

The Reports page presents one compact catalog in place of the former duplicate
navigation strips.

## Navigation model

1. Select a category: **Operational**, **Financial**, **Solar**, or **Data & Diagnostics**.
2. Select a report from the reports shown for that category.
3. Use the shared date and period controls below the catalog.

Only the selected category's report buttons are rendered. This keeps the
navigation short and prevents the same report from appearing in multiple
locations on the page. Category buttons expose their pressed state to assistive
technology, and report buttons expose the current report.

## Categories

- **Operational** — Overview, Operational, Daily Detail, Trend, Battery Compare,
  Battery Balance, Battery Flow, Peak Demand, and Mode Timeline.
- **Financial** — Profit, Cost Summary, Energy Flow Value, Savings, Load
  Shifting, Tariff Impact, Tariff vs Solar, Export Revenue, and
  Self-Consumption Value.
- **Solar** — Solar Capture, Forecast Accuracy, Self-Sufficiency, Predicted vs
  Actual, and Solar Compare.
- **Data & Diagnostics** — Scope Health, Export / Data, Period Compare, Battery
  Export, Export Compare, Seasonal Trend, Anomaly, and Exception.

The catalog is implemented in `examples/www/heros-report-card.009.js` and its
styles are part of the report-card stylesheet embedded by the versioned asset.
