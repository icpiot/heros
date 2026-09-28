# HEROS report period rules

This document is the source of truth for the report toolbar, archive lookup, chart aggregation, and navigation rules. A period control must not change these calculations without updating this document and its tests.

## Shared date anchor

The report date control is an ISO calendar date: `YYYY-MM-DD`.

- `Today` uses the live provider payload. It is not a completed archive day.
- For a historical selection, HEROS reads the saved archive for the visible scope first.
- **All systems** always reads the `all` archive scope. It must never fall back to an individual battery archive.
- A per-battery selection reads only that battery's archive scope.
- The selected date is the **end date** (anchor) for every multi-day rolling period.
- Earlier/Later moves the anchor by the active period length. It does not silently change scope or substitute a different date.

## Period windows

The Power Diagram period selector exposes the hourly windows only: 1H, 6H, 12H, and 24H. Day, Week, Month, Quarter, and Year are available in the Statistical Diagram and analysis reports where daily or rolling aggregation is meaningful.

| Control | Window ending on anchor | Data form | Navigation step |
| --- | --- | --- | --- |
| 1H | Last 60 minutes within the selected day | Five-minute power samples | 60 minutes, crossing dates when needed |
| 6H | Last 360 minutes within the selected day | Five-minute power samples | 360 minutes, crossing dates when needed |
| 12H | Last 720 minutes within the selected day | Five-minute power samples | 720 minutes, crossing dates when needed |
| 24H / Day | `00:00` through `24:00` on the anchor date | Five-minute power samples | One calendar day |
| Week | Anchor minus 6 days through anchor, inclusive (7 days) | Saved daily diagrams/counters | 7 days |
| Month | Anchor minus 30 days through anchor, inclusive (31 days) | Saved daily diagrams/counters | 31 days |
| Quarter | Anchor minus 91 days through anchor, inclusive (92 days) | Saved daily diagrams/counters | 92 days |
| Year | Anchor minus 365 days through anchor, inclusive (366 days) | Saved daily diagrams/counters | 366 days |

These are rolling windows. They are not ISO weeks or calendar-month/quarter/year boundaries. Reports that explicitly state calendar comparison rules, such as Period Compare, document their calendar alignment separately.

## Statistical Diagram

The Statistical Diagram shows power over the selected window and its hero cards show **period energy totals**.

- The Statistical Diagram period selector contains Day, Week, Month, Quarter, and Year. Hourly controls remain available in the Power Diagram only.
- Day plots the saved or live five-minute samples for the anchor date directly.
- Week combines samples into one-hour buckets.
- Month uses three-hour buckets.
- Quarter uses six-hour buckets.
- Year uses one-day buckets.
- Each bucket is the arithmetic average of the available power samples in that bucket, normalised to kW.
- The horizontal axis spans the entire selected period, even when some days have no stored samples. Multi-day tick labels are evenly spaced `YYYY-MM-DD` calendar dates.
- Hero cards above the Statistical Diagram total Solar, Battery discharge, Grid import, Feed-in, and Usage across the selected rolling window. They include a **Period coverage** card showing stored days versus expected days (for example, `5/7 days`).
- Totals include only stored/provider rows in the window. A partial period remains visibly partial through its coverage card; missing dates are not treated as zero-energy days.

## Archive coverage and missing days

A completed download means the provider response for each requested day has been stored or explicitly recorded as unavailable. It does not manufacture data for dates that the provider did not return.

- Stored days are reused by the report card; selecting them must not trigger another download.
- A missing day is omitted from the chart. HEROS does not replace it with a zero-power line.
- A partial Week/Month/Quarter/Year chart therefore contains only the stored dates inside that window.
- Selecting a date that has no local record may request that **one selected day** from a supported web provider. It does not automatically download all missing dates in a longer period.
- Settings shows stored records, provider-confirmed unavailable dates, unrecorded calendar gaps, and stored calendar coverage for the first-to-last stored range. A range is not treated as complete merely because it has both a first and last record.

## Current-day cutoff

For today, provider data can arrive gradually and may contain future timestamp labels filled with zeroes. HEROS plots only through the last meaningful provider flow sample. The 1H, 6H, 12H, 24H, and Day views end at that same cutoff; they never extend the graph into a zero-filled future period.

## Changing these rules

Any implementation change must update:

1. this document;
2. the relevant source comments and focused tests; and
3. the visible report wording when users could otherwise misread a partial result as a complete period.
