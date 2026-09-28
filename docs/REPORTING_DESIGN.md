# HEROS reporting design

## Shared period and navigation rules

[Report period rules](REPORT_PERIODS.md) is the source of truth for date anchors, rolling windows, archive lookup, missing-day handling, chart aggregation, and navigation. The selected date is the end date for rolling multi-day periods; it is not the first calendar date in the window.
## Financial report visual language

Financial reports use Tariff Impact as the layout template: report navigation, date and period controls, summary hero values, chart, legend, and explanatory note remain in the same order and spacing. Desktop summary heroes stay on one row; narrow mobile layouts may wrap.

Colors are semantic and shared with the overview: solar is fluorescent yellow, grid import is orange, feed-in is green, battery charge and discharge use their existing battery colors, and missing or unavailable data is red or slate grey. Every chart must include an explicit legend and must explain unavailable intervals.

## Energy Flow Value report

The planned financial report is **Energy Flow Value**. It shows the cost of grid energy actually purchased, grouped by the selected period. It does not require a sell tariff. The first hero is `Days in period`, followed by import cost, supply charge, and total purchased-energy cost. Missing source dates are counted and explained; supply charge is still calculated for every calendar day in the selected period.

The chart is a stacked energy-flow bar. Solar generation plus grid import is the available energy total. Stacks show the destinations: direct load consumption, battery storage, and feed-in/export. For a day, the x-axis is time and bars are horizontal timeline segments. For week, month, quarter, and year, bars are vertical period buckets (days, weeks, or months respectively). The legend must state that grey means unavailable source data and must distinguish solar, grid import, load, battery storage, and feed-in using the shared semantic colors.

## Financial report roadmap

`Tariff Impact` remains the reference implementation. `Energy Flow Value` is the next built financial report; subsequent financial reports should reuse its period aggregation, hero layout, axis rules, legend treatment, and semantic color tokens rather than introducing report-specific controls or colors.

### Provider data correspondence

For a historical single-battery day, the SoC hero is the 24:00 five-minute value, or the last valid point if 24:00 is absent. For All Batteries, the SoC hero is the provider aggregate summary SoC. A report must never substitute one battery archive for the All Batteries archive. Energy hero totals use the archive summary counters. For the current day, energy counters represent the data received through the current provider refresh. The 24-hour Power Diagram keeps a 00:00-24:00 axis and ends its plotted data at the provider cutoff. The 1H, 6H, and 12H periods end at that same provider cutoff; zero-filled future provider labels must never move a short-period window into the future.


### Power Diagram hero cards

Show completed or data-cutoff energy totals as the primary value. Keep cards compact on desktop, make labels readable, and use short terms: SoC, Solar, Grid import, Feed-in, and Usage. Preserve the multi-card desktop row and the responsive mobile layout. The panel and report both use versioned custom elements so an updated class replaces an earlier browser-cached class after a page reload.

## Operational Report period controls

Operational Report uses the same control contract as Tariff Impact. It must render the shared date navigation, a visible `Period` label, and the period buttons in this order: Day, Week, Month, Quarter, Year. The active period uses the shared active-button treatment. Date navigation and period selection must use the same spacing, typography, borders, colors, and control classes as Tariff Impact. Operational Report aggregation follows the selected period; it must not introduce a separate control style.

## Shared control positioning

Reports with date and period selection must place all selection controls on one secondary control row. The order and positions are: previous-period navigation, date anchor, next-period navigation, `Period` label, then the period buttons. Operational Report must use the same row structure and control classes as Tariff Impact; controls must not be placed inside the report title, hero area, or chart body.


### Report timeline navigation (v233)
Power, Statistical, Operational and Tariff Impact reports share visible Earlier/Later controls above their results. Short periods move within a day and into adjacent dates; longer periods move the date range. Dragging a chart or timeline pans on release. Statistical power samples are normalized to kW before plotting, and Total Load uses consumed only when load is absent. Live UI verification remains required after deployment.
