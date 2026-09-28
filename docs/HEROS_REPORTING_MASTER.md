# HEROS Reporting Master Specification

## Provider capability model

HEROS report views consume a provider-neutral normalised reporting payload and local archive. Providers must supply or be mapped into that contract; report views must not be duplicated per provider.

The normalised five-minute payload includes timestamps, state of charge, solar, load, grid import, feed-in, battery charge, and battery discharge where available. The local archive stores the normalised daily record and may retain the original provider payload for audit and future remapping.

## Web API export source calculation

The web API export reports classify each exported interval as either **Solar export** or **Battery export**. The provider's `feed_in` value is the total export to the grid. Source classification uses the aligned interval values for `solar_generation`, household `load`, battery `charge`, battery `discharge`, and battery `soc`.

Use this decision order:

1. When the battery is full (at or within the provider's full-SOC tolerance), solar generation is present, and grid export is present, classify the export as **Solar export**. The full battery means available solar is not being stored, so the concurrent export is surplus solar.
2. When battery discharge is present during grid export, classify the export as **Battery export**.
3. For remaining intervals, use the aligned energy balance to assign the export to the source that supplies the surplus:

   `grid export = solar generation + battery discharge - battery charge - household load`

The calculation is performed at the provider interval cadence before totals are summed for a day, week, month, quarter, or year. It must not classify an interval from SOC alone: SOC is used with the power direction and export readings. The report always assigns an export interval to one of the two source columns; it does not display an `unknown` source.

Provider data must be time-aligned and use consistent units before applying this rule. Small simultaneous charge/discharge values or balance differences caused by sampling, rounding, and inverter losses are resolved using the decision order above. The source classification is an operational attribution rule, not a claim that the provider directly measured the origin of every exported watt.

## ByteWatt history capability

ByteWatt exposes five-minute historical data through its API. The observed web-history columns include Date, BAT, Load, Solar, Feed-in, and Consumed. This establishes that ByteWatt can supply the time-series foundation for HEROS reporting.

The current ByteWatt integration retrieves real-time and cumulative values only. It does not yet call, normalise, or archive the ByteWatt five-minute history endpoint. Therefore detailed historical reports are not yet enabled for ByteWatt even though the reporting UI and archive contract are provider-neutral.

Required ByteWatt work:

1. Call the documented ByteWatt history endpoint for a selected date and scope.
2. Confirm every raw field's meaning, unit, sign convention, timezone, and interval cadence.
3. Map the result into the HEROS normalised power-diagram payload.
4. Preserve the raw dated ByteWatt payload in the local archive alongside the normalised record.
5. Use the common report views without provider-specific UI forks.

## Report compatibility requirements

Power Diagram, Mode Timeline, and Daily Detail require timestamped five-minute values. Tariff Impact additionally requires confirmed grid-import power and load power for each interval. Do not assume the ByteWatt `Consumed` field is grid import: confirm its provider meaning before using it for tariff calculation.

If direct battery charge and discharge fields are unavailable, the report must label the limitation rather than infer a power value from state-of-charge changes. The mapping may still use state of charge, solar, load, and feed-in once their meanings and units are confirmed.

## Provider documentation standard

Every provider must have a documented mapping table that lists raw field, HEROS target field, unit, sign convention, cadence, evidence source, and report features enabled by that field. Provider-specific data collection belongs in provider adapters; report rules and UI behaviour belong in the shared reporting implementation.
## Date and layout standards

Report dates are stored, navigated, exported, and displayed in ISO 8601 calendar form: `YYYY-MM-DD`. The visible report date control must show that ISO value regardless of browser or operating-system locale; its calendar action may open the browser native picker. Month values use `YYYY-MM`, quarter values use `YYYY-Qn`, and year values use `YYYY`.

The date selector stays in the shared report-toolbar position for every report. Period controls follow it, beginning with a bold `Period` label and a consistent gap. Do not create a second date selector or move controls between views.

For grouped Tariff Impact periods, the six summary values — days in period, import cost, feed-in credit, supply charge, net cost, and avoided grid-only cost — occupy one row on desktop. At narrow/mobile widths, including iPhone, the grid may reflow for legibility.

## Archive refresh messaging

An archive that ends before the selected period is shown as an informational refresh note. It must not be styled as an error: existing points remain usable while HEROS requests the missing interval. The no-history case may remain a warning because there are no stored points to display.


## Button overlay alignment

Active button gradients must be clipped to the button's rounded padding box and use a zero-position, full-size background. This prevents a one-pixel color overlay bleed at the edge of report controls and keeps the rule consistent across tabs, period buttons, operational controls, and chart actions.


## Button hover alignment

Report controls do not lift on hover or focus. The previous one-pixel vertical transform shifted the gradient overlay relative to the control edge; hover and focus retain the same pixel position while using shadow or color changes for emphasis.


## Operational empty periods

Operational periods with zero error events retain the same Errors by date and Recurring times report frames, with neutral empty-state text. This keeps the layout stable while making the absence of events explicit.


## Analysis report batch

Trend, Energy Flow, Self-Sufficiency, Battery Compare, Battery Balance, and Battery Flow share the report toolbar and period navigation, but each renders a purpose-built report. Period totals use archived daily records for day-and-longer ranges and integrate provider power samples for 1H, 6H, and 12H ranges.


## Analysis report context

Each analysis report displays its selected period and anchor date in the report header so testers can distinguish the active archive window from the current live feed.


## Analysis report navigation

The six analysis reports use the same earlier/later timeline navigation as the core reports. Shifts advance by the selected period and clamp future navigation to the current local date.


## Analysis report-specific summaries

Trend plots actual solar and household-load pairs by date. Energy Flow separates sources, the energy-balance hub, and destinations without claiming unsupported source-to-destination routing. Self-Sufficiency shows a gauge calculated from demand minus grid import. Battery Compare uses a live comparison table; Battery Balance shows SOC spread against the fleet average; Battery Flow shows charge, discharge, throughput, and net battery movement.


## Analysis report visuals

The six views intentionally use different visual structures: trend columns, flow nodes, a circular gauge, a comparison table, SOC balance tracks, and bidirectional battery-flow lanes. Shared colors and controls remain consistent, while the report body matches the question each report answers. Trend date columns expose a keyboard-accessible hover tooltip containing solar, household load, grid import, feed-in, battery charge, and battery discharge values. The tooltip uses a reserved information band above the columns so it does not cover the selected values. Trend also shows a kWh scale beside the daily columns. Peak Demand, Solar Capture, Forecast Accuracy, Predicted vs Actual, Solar Compare, Scope Health, Export / Data, Day Compare, Seasonal Trend, Anomaly, and Exception are available as non-financial reports.


## Analysis archive coverage

Each analysis report displays the number of archived days behind the selected result so limited history and missing source coverage are visible during testing.


## Analysis coverage note

Analysis report frames state whether archived days are available for the selected scope, preventing a zero or partial result from being mistaken for a complete history.

## Chart presentation standard

All chart reports use the Power Diagram presentation standard. The y-axis has a visible unit label beside the scale; the x-axis has a visible explanation of its date or time values. Dates and times stay along the bottom edge of the plot. Data labels and legends live in dedicated chart sections so they do not overlap plotted data. Horizontal reference lines align with the y-axis ticks and provide a visual path from each value to the plotted point or bar. Hover or keyboard focus reveals the values for the selected chart section without obscuring the plotted data. Every legend names the series, uses the matching series color, and groups related series under a clear category label. Chart notes explain the calculation or limitation in plain language.
## Power Diagram status explanation

The status help panel explains each status in a dedicated row. Every status name is bold, and rows have visible separation so the priority order can be scanned without reading a wrapped paragraph. The panel is a separate overlay and must not cover the plotted data when opened.

## Period comparison alignment

Period Compare aggregates the selected calendar period and the immediately preceding period of the same length. Month, quarter, and year selections use calendar boundaries; the comparison labels and date ranges match the selected period.
