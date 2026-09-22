# Pricing Advanced Setup Examples

This guide contains user-facing examples for configuring complex Electricity
Rates in HEROS Advanced mode.

These examples are illustrative. Users should enter the actual rates, dates,
times, thresholds, tax treatment, and billing rules from their own electricity
plan.

## Example 1 - Tiered / Block Import Pricing

Scenario:

The retailer charges:

- first 10 kWh each day at 20 c/kWh;
- next 10 kWh each day at 30 c/kWh; and
- all remaining daily consumption at 40 c/kWh.

Electricity Plan:

- Retailer / Plan: `Example Energy - Daily Block Plan`
- Effective Date: `2026-01-01`
- End Date: blank
- Mode: `Advanced`
- Rates Include Tax: `Yes`

Tiered Buy Rate:

| Tier | From | To | Rate | Reset Period |
| --- | ---: | ---: | ---: | --- |
| 1 | 0 kWh | 10 kWh | 20 c/kWh | Daily |
| 2 | 10 kWh | 20 kWh | 30 c/kWh | Daily |
| 3 | 20 kWh | No upper limit | 40 c/kWh | Daily |

The final tier has no To Quantity, so it applies to all consumption above
20 kWh for that day.

If the retailer changes any tier threshold or rate later, create a new
effective-dated tariff record rather than editing the historical record.

## Example 2 - Monthly Tiered Import Pricing

Scenario:

The retailer resets the usage tiers each calendar month:

- 0-300 kWh at 25 c/kWh;
- 300-600 kWh at 32 c/kWh;
- above 600 kWh at 38 c/kWh.

Electricity Plan:

- Retailer / Plan: `Example Retailer - Monthly Saver`
- Effective Date: `2026-03-01`
- Mode: `Advanced`

Tiered Buy Rate:

| Tier | From | To | Rate | Reset Period |
| --- | ---: | ---: | ---: | --- |
| 1 | 0 kWh | 300 kWh | 25 c/kWh | Monthly |
| 2 | 300 kWh | 600 kWh | 32 c/kWh | Monthly |
| 3 | 600 kWh | No upper limit | 38 c/kWh | Monthly |

## Example 3 - Residential Demand Charge

Scenario:

The retailer charges for the highest 30-minute average demand measured during
weekday evening peak periods each billing month.

Electricity Plan:

- Retailer / Plan: `Example Utility - Demand Home`
- Effective Date: `2026-07-01`
- Mode: `Advanced`
- Rates Include Tax: `Yes`

Normal Buy Rates:

- Off-Peak: all ordinary non-peak periods at the applicable energy rate.
- Peak Energy: weekdays 16:00-21:00 at the applicable energy rate.

Demand Charge:

- Description: `Weekday Evening Demand`
- Rate: `12.00 currency/kW`
- Measurement Interval: `30 minutes`
- Applicable Days: `Monday-Friday`
- Start Time: `16:00`
- End Time: `21:00`
- Billing Period: `Monthly`
- Effective Date: `2026-07-01`
- End Date: blank

HEROS uses measured power/energy data to identify the applicable maximum demand
for the billing period. The Demand Charge remains separate from normal
currency/kWh energy rates.

## Example 4 - Multiple Fixed Charges

Scenario:

A plan has:

- a daily supply charge;
- a monthly meter fee; and
- a monthly account credit.

Electricity Plan:

- Retailer / Plan: `Example Power - Home Plus`
- Effective Date: `2026-01-01`

Fixed Charge 1:

- Charge Description: `Daily Supply Charge`
- Amount: `1.20`
- Frequency: `Daily`
- Effective Date: `2026-01-01`

Fixed Charge 2:

- Charge Description: `Meter Fee`
- Amount: `8.00`
- Frequency: `Monthly`
- Effective Date: `2026-01-01`

Fixed Charge 3:

- Charge Description: `Account Credit`
- Amount: `-5.00`
- Frequency: `Monthly`
- Effective Date: `2026-01-01`

The negative amount represents a recurring credit.

Different fixed-charge types can apply at the same time.

## Example 5 - Multiple Controlled Loads

Scenario:

A household has a hot-water controlled load and a separately metered EV
charging circuit.

Electricity Plan:

- Retailer / Plan: `Example Retailer - Smart Home`
- Effective Date: `2026-02-01`

Controlled Load 1:

- Description: `Hot Water`
- Effective Date: `2026-02-01`

Rate Period:

- Rate Description: `Off-Peak`
- Days: `All days`
- Start Time: `22:00`
- End Time: `07:00`
- Rate: `18 c/kWh`

Controlled Load 2:

- Description: `EV Circuit`
- Effective Date: `2026-02-01`

Rate Period 1:

- Rate Description: `Super Off-Peak`
- Days: `All days`
- Start Time: `00:00`
- End Time: `06:00`
- Rate: `12 c/kWh`

Rate Period 2:

- Rate Description: `Standard`
- Days: `All days`
- Start Time: `06:00`
- End Time: `00:00`
- Rate: `25 c/kWh`

Each Controlled Load has its own independent rate schedule.

## Example 6 - All-Day Controlled Load Rate

Scenario:

The network controls when the hot-water circuit is energised, but the retailer
charges one controlled-load rate regardless of the actual switching time.

Controlled Load:

- Description: `Hot Water Controlled Load`
- Effective Date: `2026-01-01`

Rate Period:

- Rate Description: `Standard`
- Days: `All days`
- Time: `All Day`
- Rate: `19 c/kWh`

HEROS stores the tariff as an all-day rate. The network's external switching
schedule does not need to be represented as a tariff time window.

## Example 7 - Time-of-Use Buy and Sell Schedules

Scenario:

Import and export rates both vary by time, but they use different schedules.

Electricity Plan:

- Retailer / Plan: `Example Energy - Solar TOU`
- Effective Date: `2026-04-01`

Buy / Import Rates:

| Description | Days | Start | End | Rate |
| --- | --- | --- | --- | ---: |
| Off-Peak | All days | 21:00 | 07:00 | 20 c/kWh |
| Shoulder | Weekdays | 07:00 | 15:00 | 30 c/kWh |
| Peak | Weekdays | 15:00 | 21:00 | 48 c/kWh |

Sell / Export Rates:

| Description | Days | Start | End | Rate |
| --- | --- | --- | --- | ---: |
| Standard Export | All days | 00:00 | 15:00 | 5 c/kWh |
| Solar Peak Export | All days | 15:00 | 21:00 | 12 c/kWh |
| Standard Export | All days | 21:00 | 00:00 | 5 c/kWh |

Buy and Sell schedules are configured separately because their applicable time
periods do not need to match.

## Example 8 - Public Holiday Override

Scenario:

Normal weekday Peak pricing does not apply on public holidays.

Normal Buy Rate:

- Rate Description: `Peak`
- Days: `Weekdays`
- Start Time: `15:00`
- End Time: `21:00`
- Rate: `45 c/kWh`

Public Holiday Buy Rate:

- Rate Description: `Public Holiday`
- Days: `Public Holidays`
- Start Time: `15:00`
- End Time: `21:00`
- Rate: `24 c/kWh`

The Public Holiday record takes precedence over the ordinary weekday record for
dates identified by the configured HEROS holiday source.

## Example 9 - Zero and Negative Rates

Scenario:

A retailer has a midday period where import electricity is free and an export
period where customers are charged to export.

Buy Rate:

- Rate Description: `Free Solar Period`
- Days: `All days`
- Start Time: `11:00`
- End Time: `14:00`
- Rate: `0 c/kWh`

Sell Rate:

- Rate Description: `Negative Export Period`
- Days: `All days`
- Start Time: `12:00`
- End Time: `14:00`
- Rate: `-2 c/kWh`

HEROS permits both values because zero and negative tariff rates are valid
where the actual plan uses them.

## Example 10 - Tax-exclusive Rates

Scenario:

The retailer quotes tariff values before tax.

Electricity Plan:

- Retailer / Plan: `Example Utility - Business Home Plan`
- Effective Date: `2026-01-01`
- Rates Include Tax: `No`
- Tax Percentage: `10%`

The underlying rate records contain the retailer's quoted tax-exclusive values.
HEROS can calculate corresponding tax-inclusive values for reporting.

## Example 11 - Rate Change Requiring a New Record

Scenario:

A Peak rate is 40 c/kWh until 30 June and changes to 44 c/kWh from 1 July.

Existing Peak record:

- Effective Date: `2026-01-01`
- End Date: blank
- Rate: `40 c/kWh`

The user creates a replacement Peak record:

- Effective Date: `2026-07-01`
- Rate: `44 c/kWh`

HEROS prompts to end the existing Peak record.

If confirmed:

- old Peak End Date becomes `2026-06-30`;
- new Peak record begins `2026-07-01`.

The old record is retained for historical calculations.

This same effective-dated approach is used for seasonal or annual tariff
changes. HEROS does not automatically repeat an old seasonal rate each year.

## Example 12 - Dynamic / Market-linked Plan

Scenario:

A retailer publishes changing import and export prices every interval.

Electricity Plan:

- Retailer / Plan: `Example Dynamic Retailer`
- Effective Date: `2026-01-01`
- Mode: `Advanced`
- Dynamic Pricing Source: `example_dynamic_source`

Do not manually enter hundreds of interval prices as ordinary Buy/Sell Rate
records.

The Electricity Plan stores only the link to the Dynamic Pricing Source. The
actual interval prices are stored in the separate dynamic-pricing table/module.

That future module may contain fields such as:

- source/provider identifier;
- interval start/end;
- import price;
- export price;
- raw provider value;
- ingestion timestamp; and
- quality/status metadata.

The exact dynamic-pricing table is intentionally outside the scope of this
guide until that feature is designed.

## Choosing Basic or Advanced

Use **Basic** when the plan can be represented by ordinary flat or time-of-use
Buy/Sell rates, normal fixed charges, and Controlled Loads.

Use **Advanced** when the plan requires one or more of:

- consumption tiers/blocks;
- demand charges;
- market-linked/dynamic pricing;
- other tariff structures that cannot be represented by ordinary day/time rate
  periods.

Switching an Electricity Plan from Basic to Advanced must not discard existing
Basic configuration.
