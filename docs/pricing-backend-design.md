# Pricing Backend Design

> Codex implementation reference: see `docs/PRICING_DATA_MODEL_CODEX.md` for the consolidated field list, stable IDs, parent-child links, migration map, and implementation order.

This document describes the pricing data shape used by the Pricing UI.

## Scope

Pricing stays file-backed for now because the dataset is small and the workflow
is easiest to reason about that way. The current live files live under
`www/heros/<entry_id>/`, with the older
`www/heros-pricing/<entry_id>/` path kept as a legacy read
fallback during cleanup.

## Data model

Pricing should be stored as date-effective rate groups.

```json
{
  "version": 2,
  "updated_at": "2026-07-19T00:00:00+00:00",
  "holiday_source": "workday",
  "region": "NSW",
  "groups": [
    {
      "group_id": "uuid",
      "label": "Rates from Jan 1",
      "provider": "Retailer",
      "plan_name": "Plan name",
      "effective_start_date": "2026-01-01",
      "pricing_type": "dynamic",
      "daily_connection_charge": 1.234,
      "other_charges": "Metering charge: ...",
      "notes": "",
      "records": [
        {
          "record_id": "uuid",
          "label": "Peak",
          "day_types": ["mon", "tue", "wed", "thu", "fri"],
          "start_time": "14:00",
          "end_time": "20:00",
          "import_rate": 0.42,
          "export_rate": 0.05,
          "controlled_load_rate": null,
          "other_charges": "",
          "notes": ""
        }
      ]
    }
  ]
}
```

## Group semantics

- A group becomes active on `effective_start_date`.
- A group remains active until the next group starts.
- No explicit end date is required.
- If two groups have the same `effective_start_date`, the backend should reject
  the save and return a clear error.
- The active group at a given date is the latest group whose start date is less
  than or equal to that date.

## Record semantics

- Records apply only inside their parent group.
- Fixed and dynamic pricing both use records. A fixed-price plan can still vary
  by day, time, and public holiday status.
- Records are selected by day type and time window.
- Supported day types:
  - `mon`
  - `tue`
  - `wed`
  - `thu`
  - `fri`
  - `sat`
  - `sun`
  - `public_holiday`
- Public holiday records are overrides and should be evaluated before standard
  weekday/weekend records. They may overlap standard weekday/weekend records
  because the holiday condition takes precedence.
- Overnight windows are allowed and should be interpreted as two segments:
  `start_time` to midnight and midnight to `end_time`.
- A record where `start_time == end_time` is invalid.

## Overlap validation

The backend should reject overlapping records inside the same group when they
share any day type and their time windows intersect.

Examples:

- Mon-Fri 14:00-20:00 conflicts with Fri 19:00-21:00.
- Fri 14:00-20:00 does not conflict with Fri 20:00-23:00.
- `public_holiday` does not conflict with `mon` because public holiday records
  are overrides.
- `public_holiday` 00:00-23:59 conflicts with another `public_holiday`
  12:00-18:00.

The UI already performs this validation, but the backend must repeat it so API
or service calls cannot save invalid data.

## Proposed Home Assistant services

### `pricing_upsert_group`

Create or update a rate group.

Fields:

- `group_id` optional
- `label`
- `provider`
- `plan_name`
- `effective_start_date` required
- `pricing_type` fixed/dynamic
- `daily_connection_charge`
- `other_charges`
- `notes`
- `entry_id` optional

### `pricing_remove_group`

Delete a rate group and all child records.

Fields:

- `group_id` required
- `entry_id` optional

### `pricing_upsert_record`

Create or update one record inside a group.

Fields:

- `group_id` required
- `record_id` optional
- `label`
- `day_types` required
- `start_time` required
- `end_time` required
- `import_rate`
- `export_rate`
- `controlled_load_rate`
- `other_charges`
- `notes`
- `entry_id` optional

Rates are stored as dollars/kWh. Example: `0.42` means 42 cents/kWh.

### `pricing_remove_record`

Delete one record inside a group.

Fields:

- `group_id` required
- `record_id` required
- `entry_id` optional

## Sensor payload

The pricing schedule sensor should expose:

- `group_count`
- `record_count`
- `active_group`
- `active_record`
- `groups`
- `holiday_source`
- `region`
- `updated_at`

For compatibility during migration, it can also continue exposing the old
`rules`, `rule_count`, and `date_map` attributes until the panel no longer uses
them.

## Workday integration boundary

Workday should not be required to save pricing groups.

The later Workday pass should:

- detect whether the Home Assistant Workday integration/entities are configured;
- allow the user to choose the Workday entity or region;
- use that signal to decide whether today is a public holiday;
- apply `public_holiday` records ahead of standard day records.

## Migration

Existing version 1 schedules should remain readable.

Suggested migration:

- Convert each old `PricingRule.effective_date` bucket into one generated group.
- Preserve old rule IDs as record IDs where possible.
- Map old fields:
  - `supply_charge` -> `daily_connection_charge` on the group when shared
  - `controlled_load_1` -> `controlled_load_rate`
  - `holiday_only` -> `day_types: ["public_holiday"]`
  - `days_of_week` -> `day_types`
- Store migrated schedules as `version: 2`.

## Approved model decisions

- Fixed pricing is still based on day, time, and public holiday records.
- Rates are stored as dollars/kWh, e.g. `0.42`.
- Public holiday records may overlap standard weekday/weekend records because
  they override those records. Public holiday records should still be checked
  against other public holiday records for overlap.


## Finance & ROI

The **Finance & ROI** section records capital costs and repayment history
associated with the home energy system. These records are source data for HEROS
ROI reporting and may be combined with feed-in tariff income, VPP income,
calculated solar generation value, and other applicable financial or energy
data.

The Finance & ROI page is primarily an input and history-management surface.
Calculated totals, repayment progress, ROI, and related financial outputs belong
in reporting rather than in the data-entry tables.

### Installation Costs

Installation Costs record expenses associated with the user's home energy
system. Typical records include the initial solar installation, later panel
upgrades, batteries, inverter replacement, switchboard/electrical work, and
other associated home-energy costs.

Negative values are supported for rebates, refunds, credits, or other
reductions in overall installation cost.

Installation Cost fields:

- **Effective Date** - required. The date the cost was incurred or the
  equipment/work was installed. Future dates are not valid.
- **Description** - required free text.
- **Amount** - required, non-zero. Positive and negative values are supported.

The logical Installation Cost key is:

`Effective Date + Description`

Duplicate Installation Cost keys are not permitted.

Installation History contains:

- Effective Date
- Description
- Amount
- Action

Records are ordered by Effective Date descending, with the most recent record
first.

**Modify** loads the selected record into the existing Installation Cost form.
Effective Date, Description, and Amount may all be changed, subject to the same
validation rules as a new record.

**Delete** always requires confirmation. An Installation Cost cannot be deleted
while Repayment records are linked to it. Linked repayments must first be
deleted or reassigned to another valid Installation Cost.

### Repayments

Every Repayment record must be linked to exactly one Installation Cost. One
Installation Cost may have multiple Repayment records so changes to repayment
terms can be preserved historically.

A genuine change to repayment terms is recorded as a new effective-dated
Repayment record. Existing history must not be edited merely to represent a
later repayment change. Modify is used to correct an existing record.

Repayment fields:

- **Installation Cost** - required parent Installation Cost.
- **Effective Date** - required. The first repayment occurrence for the record.
- **End Date** - optional manual end date for recurring repayments.
- **Amount** - required, non-zero. Positive and negative values are supported.
- **Frequency** - required.

Supported frequencies:

- Weekly
- Fortnightly
- Monthly
- Quarterly
- Yearly
- One-off

Repayment schedule semantics:

- Weekly means every 7 days from the Effective Date.
- Fortnightly means every 14 days from the Effective Date.
- Monthly means every calendar month from the Effective Date.
- Quarterly means every 3 calendar months from the Effective Date.
- Yearly means every calendar year from the Effective Date.
- One-off occurs once on the Effective Date and does not use an End Date.
- For monthly or quarterly schedules, if the target day does not exist in the
  target month, use the last valid day of that month.
- A yearly schedule anchored to 29 February uses 28 February in non-leap years
  and returns to 29 February in leap years.

The End Date only stops future scheduled repayments. It does not itself create
an additional repayment. A scheduled repayment falling exactly on the End Date
is included. If End Date is blank, a recurring repayment remains active
indefinitely.

### Repayment validation

Repayment records must satisfy all of the following:

- Effective Date is required and may be future-dated.
- Effective Date cannot be earlier than the linked Installation Cost Effective
  Date.
- End Date is optional.
- End Date cannot be earlier than Effective Date.
- Amount cannot be zero.
- Positive and negative Amount values are permitted.
- Repayments linked to the same Installation Cost cannot overlap.
- Gaps between repayment periods are permitted.
- For the same Installation Cost, each new Repayment Effective Date must be
  later than the latest existing Repayment Effective Date.
- Earlier or duplicate Repayment Effective Dates are invalid.

If the latest repayment for an Installation Cost has no End Date and a newer
repayment is added, HEROS must prompt the user to confirm whether the existing
repayment should be ended.

If confirmed, HEROS sets the existing repayment End Date to the day immediately
before the new Effective Date. For example, a new repayment beginning
`2026-07-01` ends the previous open-ended repayment on `2026-06-30`.

If the user does not confirm, the new repayment is not saved because overlapping
repayments for the same Installation Cost are not permitted.

If the existing repayment already has an End Date, the new repayment must begin
after that End Date.

The same chronology and no-overlap validation applies when modifying or
reassigning a repayment.

### Repayment Modify and Delete

Selecting **Modify** loads the selected repayment into the existing Repayment
form. The form enters edit mode with **Save Changes** and **Cancel** controls.

All stored repayment fields may be changed:

- linked Installation Cost
- Effective Date
- End Date
- Amount
- Frequency

Status is system-calculated and is not user-editable.

Repayments may be reassigned to a different Installation Cost, but the record
must pass all date, uniqueness, and overlap validation against the target
Installation Cost before the reassignment is saved.

All Repayment deletions require confirmation. Deleting a Repayment removes only
that record. HEROS does not automatically extend, merge, or alter neighbouring
repayment periods. Any resulting gap remains.

### Repayment Status

Repayment Status is calculated automatically by HEROS and is displayed only in
Repayment History.

Recurring repayment statuses:

- **Scheduled** - Effective Date is in the future.
- **Active** - Effective Date has been reached and End Date has not passed.
- **Ended** - End Date has passed.

A recurring repayment with no End Date remains Active indefinitely after its
Effective Date. On the End Date itself it is still Active and becomes Ended the
following day.

One-off repayment statuses:

- **Scheduled** - Effective Date is in the future.
- **Completed** - Effective Date has been reached.

### Repayment History

Repayment History uses a single flat table with these columns:

- Installation Description
- Effective Date
- End Date
- Amount
- Frequency
- Status
- Action

Only the linked Installation Description is shown from the parent Installation
Cost.

Where an Installation Description is unique, only the description is shown.
Where the same description exists on more than one Installation Cost, append
the Installation Effective Date to disambiguate the parent record.

The displayed label is only user-facing. The stored repayment relationship must
reference the actual parent Installation Cost record.

Repayment History is ordered by Installation Description and then Repayment
Effective Date descending within each Installation Cost.

### Finance record keys

The logical uniqueness rules are:

- **Installation Cost key** = `Effective Date + Description`
- **Repayment record key** = `Installation Cost key + Repayment Effective Date`

Duplicate logical keys are not permitted.

### Reporting relationship

Installation Costs and Repayments are source financial records. Any HEROS report
or calculation consuming these records must use the current stored values after
records are added, modified, reassigned, or deleted.

The implementation may calculate values on demand, pre-calculate them, or cache
them; the required behaviour is that linked reports reflect the current stored
data.

### Finance & ROI implementation requirements

The current Finance & ROI implementation must be extended to support the final
model above. Outstanding work includes:

- enforce required Installation Cost Description;
- enforce non-zero Installation Cost Amount;
- allow positive and negative Installation Cost Amount values;
- reject future Installation Cost Effective Dates;
- enforce the unique Installation Cost key;
- block Installation Cost deletion while linked repayments exist;
- require confirmation for every delete action;
- add the mandatory Installation Cost selector to Repayments;
- support multiple Repayment records per Installation Cost;
- remove the need for a separate Repayment Description;
- add optional Repayment End Date;
- add One-off repayment frequency;
- implement Weekly, Fortnightly, Monthly, Quarterly, Yearly, and One-off
  schedule logic;
- implement month-end and leap-year schedule handling;
- allow future-dated Repayment Effective Dates;
- enforce non-zero Repayment Amount while allowing positive and negative values;
- enforce Repayment Effective Date against the parent Installation Cost date;
- enforce End Date against Effective Date;
- enforce the Repayment logical key;
- prevent overlapping repayments for the same Installation Cost;
- allow gaps between repayment periods;
- prompt to end an open-ended repayment when a newer repayment is added;
- if confirmed, auto-set the prior End Date to the day before the new Effective
  Date;
- reject the new record if the user declines and an overlap would remain;
- apply the same chronology and overlap validation to Modify and reassignment;
- allow repayment reassignment to another Installation Cost;
- add automatic Repayment Status calculation;
- add Status to Repayment History;
- use the existing repayment form for Modify mode with Save Changes and Cancel;
- allow all stored repayment fields except Status to be edited;
- ensure deleting a repayment never alters neighbouring repayment records;
- update Repayment History to the final column set and ordering rules;
- apply Installation Description disambiguation only when duplicate descriptions
  exist; and
- refresh affected tables after successful add, modify, reassign, or delete
  operations.



## VPP Programs and Compensation

The **VPP** section must support Virtual Power Plant compensation models used
internationally rather than assuming every VPP pays a single fixed cents/kWh
rate.

HEROS models VPP data as:

- a parent **VPP Program**; and
- one or more child **Compensation Components**.

Only one VPP Program may be active at a time, but a program may contain
multiple compensation components and may contain multiple components of the
same type where the provider's scheme requires it.

### Currency

HEROS does not define a separate VPP currency.

All monetary VPP values use the currency configured in Home Assistant. The
Home Assistant currency is the source of truth for display and financial
reporting across HEROS.

Energy and capacity rates should be stored internally in standard base units,
for example currency/kWh and currency/kW, even when the UI displays a more
familiar local representation such as cents/kWh.

### VPP Program fields

A VPP Program contains:

- **Provider** - required free text.
- **Program / Plan Name** - optional free text.
- **Effective Date** - required.
- **End Date** - optional and inclusive.
- **Status** - calculated automatically by HEROS.

VPP Program status values are:

- **Scheduled** - Effective Date is in the future.
- **Active** - Effective Date has been reached and End Date is blank or has not
  passed.
- **Ended** - End Date has passed.

On the End Date itself, the program is still Active and becomes Ended the
following day.

Future-dated VPP Programs are allowed.

Only one VPP Program may be active for a given date. Gaps between programs are
allowed.

If a new VPP Program is created while the current program has no End Date,
HEROS must prompt the user to confirm whether the current program should end.
If confirmed, HEROS sets the current program End Date to the day immediately
before the new Program Effective Date. If declined, the new program is not
saved because overlapping programs are not permitted.

If the existing program already has an End Date, a new VPP Program must begin
after it.

### Compensation Components

Each VPP Program may contain one or more Compensation Components.

Every component contains:

- **Label / Description** - required free text.
- **Component Type** - required.
- **Effective Date** - required.
- **End Date** - optional and inclusive where the component is recurring.
- **Value** - required and interpreted according to Component Type.
- **Frequency** - required only for component types that recur by cycle.
- **Basis** - required only where the payment is percentage-based.
- **Condition Type** - optional where compensation depends on a condition.
- **Notes** - optional free text for provider-specific rules.
- **Status** - calculated automatically by HEROS.

A component Effective Date cannot be earlier than the parent VPP Program
Effective Date.

If the parent VPP Program has an End Date, the component cannot extend beyond
that date.

A component End Date cannot be earlier than its own Effective Date.

Components may overlap where the VPP scheme legitimately pays more than one
compensation component at the same time.

### Supported Compensation Component types

HEROS should support the following initial component types for worldwide
compatibility.

#### Energy Payment

Compensation based on energy delivered during qualifying VPP activity.

Required data:

- Label
- Effective Date
- optional End Date
- Rate in currency/kWh

Example:

- Label: `VPP Event Energy Payment`
- Rate displayed to user: `70 c/kWh`
- Stored rate: `0.70 currency/kWh`

#### Capacity Payment

Compensation based on available or delivered power capacity.

Required data:

- Label
- Effective Date
- optional End Date
- Rate in currency/kW
- Frequency where the provider pays the capacity amount on a repeating cycle

Example:

- Label: `Monthly Capacity Credit`
- Rate: `10.00 currency/kW`
- Frequency: Monthly

#### Fixed Recurring Payment

A fixed monetary amount paid on a repeating cycle.

Required data:

- Label
- Effective Date
- optional End Date
- Amount
- Frequency

Supported frequencies should reuse the HEROS finance frequency model where
applicable:

- Weekly
- Fortnightly
- Monthly
- Quarterly
- Yearly

Example:

- Label: `VPP Participation Credit`
- Amount: `25.00`
- Frequency: Monthly

#### One-off Incentive

A fixed monetary amount paid once.

Required data:

- Label
- Effective Date
- Amount

No End Date or Frequency is required.

Example:

- Label: `VPP Signup Incentive`
- Effective Date: `2026-07-01`
- Amount: `500.00`

#### Event Payment

A fixed monetary amount paid per qualifying VPP event.

Required data:

- Label
- Effective Date
- optional End Date
- Amount per event

Example:

- Label: `Event Participation Bonus`
- Amount: `20.00 per event`

#### Percentage-based Payment

Compensation calculated as a percentage of another defined amount.

Required data:

- Label
- Effective Date
- optional End Date
- Percentage
- Basis

The Basis describes what the percentage applies to.

Example:

- Label: `Market Revenue Share`
- Percentage: `20%`
- Basis: `VPP market revenue`

### Condition Types

Some international VPP schemes only pay a component when a provider-defined
condition is met.

HEROS should support these initial condition types:

- **Always**
- **VPP event only**
- **Seasonal**
- **Performance-based**
- **Provider-defined / custom**

For Seasonal components, the component Effective Date and End Date define the
applicable season.

For Performance-based components, HEROS records that payment depends on measured
performance rather than assuming the configured nominal rate is guaranteed.

For Provider-defined / custom conditions, Notes should be used to describe the
provider rule until a more specific structured model is required.

### VPP Program and Component Modify/Delete behaviour

The same effective-dated record behaviour used elsewhere on the Pricing page
applies.

- Modify loads the selected record into the existing form.
- Stored user-editable fields may be changed.
- Status remains system-calculated and cannot be edited.
- Save re-runs all date and parent/child validation.
- Cancel discards unsaved edits.
- Every deletion requires confirmation.
- A parent VPP Program cannot be deleted while Compensation Components remain
  linked to it.
- Components must first be deleted or reassigned before the Program may be
  deleted.
- Deleting a child component removes only that component and does not alter
  neighbouring or sibling components.
- Tables refresh after successful add, modify, reassign, or delete operations.

### VPP Program logical key

Because only one VPP Program may begin on a given date, the logical VPP Program
key is:

`VPP Program Effective Date`

Duplicate VPP Program Effective Dates are not permitted.

Child Compensation Components should use a stable internal identifier rather
than depending on their display Label for identity.

### VPP History

The VPP Program history table should show:

- Effective Date
- End Date
- Provider
- Program / Plan Name
- Status
- Action

Records are ordered by Effective Date descending.

Compensation Components should be visible beneath or within the selected VPP
Program and should expose enough information to identify the component type,
label, dates, configured value/rate, and Status.

### User examples

The following examples are intended to help users understand how to enter
common VPP arrangements.

#### Example 1 - Simple energy-only VPP

A provider pays 70 cents/kWh whenever it dispatches the battery.

VPP Program:

- Provider: `Example Energy`
- Program / Plan Name: `Battery Rewards`
- Effective Date: `2026-01-01`
- End Date: blank

Compensation Component:

- Label: `VPP Event Energy Payment`
- Component Type: Energy Payment
- Effective Date: `2026-01-01`
- End Date: blank
- Rate: `70 c/kWh`
- Condition Type: VPP event only

HEROS uses this rate only for qualifying VPP-event energy.

#### Example 2 - Energy payment plus monthly capacity credit

A VPP pays both an event energy payment and a recurring capacity credit.

VPP Program:

- Provider: `Example Utility`
- Program / Plan Name: `Flex Battery Program`
- Effective Date: `2026-03-01`

Component 1:

- Label: `Event Energy Payment`
- Component Type: Energy Payment
- Effective Date: `2026-03-01`
- Rate: `30 c/kWh`
- Condition Type: VPP event only

Component 2:

- Label: `Monthly Capacity Credit`
- Component Type: Capacity Payment
- Effective Date: `2026-03-01`
- Rate: `8.00 currency/kW`
- Frequency: Monthly
- Condition Type: Performance-based

Both components may be active at the same time because they compensate different
parts of the same program.

#### Example 3 - Signup incentive plus ongoing monthly credit

A provider pays an upfront incentive and an ongoing monthly participation
credit.

VPP Program:

- Provider: `Example VPP`
- Program / Plan Name: `Home Battery Flex`
- Effective Date: `2026-05-01`

Component 1:

- Label: `Signup Incentive`
- Component Type: One-off Incentive
- Effective Date: `2026-05-01`
- Amount: `500.00`

Component 2:

- Label: `Monthly Participation Credit`
- Component Type: Fixed Recurring Payment
- Effective Date: `2026-05-01`
- Amount: `15.00`
- Frequency: Monthly

#### Example 4 - Seasonal capacity rates

A program pays different capacity rates in summer and winter.

VPP Program:

- Provider: `Example Grid Services`
- Effective Date: `2026-01-01`
- End Date: `2026-12-31`

Component 1:

- Label: `Summer Capacity Rate`
- Component Type: Capacity Payment
- Effective Date: `2026-12-01`
- End Date: `2026-12-31`
- Rate: `12.00 currency/kW`
- Frequency: Monthly
- Condition Type: Seasonal

Component 2:

- Label: `Winter Capacity Rate`
- Component Type: Capacity Payment
- Effective Date: `2026-06-01`
- End Date: `2026-08-31`
- Rate: `8.00 currency/kW`
- Frequency: Monthly
- Condition Type: Seasonal

The components use their own dates while remaining inside the parent Program
date range.

#### Example 5 - Percentage revenue share

A provider pays the customer a percentage of market revenue earned by the VPP.

VPP Program:

- Provider: `Example Aggregator`
- Effective Date: `2026-01-01`

Compensation Component:

- Label: `Market Revenue Share`
- Component Type: Percentage-based Payment
- Effective Date: `2026-01-01`
- Percentage: `20%`
- Basis: `VPP market revenue`
- Condition Type: Provider-defined / custom
- Notes: `Provider calculates distributable market revenue monthly.`

#### Example 6 - Changing VPP provider

Existing Program:

- Provider: `Provider A`
- Effective Date: `2026-01-01`
- End Date: blank

The user adds Provider B with an Effective Date of `2026-09-01`.

HEROS prompts to end Provider A.

If the user confirms:

- Provider A End Date becomes `2026-08-31`.
- Provider B begins on `2026-09-01`.

If the user declines, Provider B is not saved because two VPP Programs cannot
be active at the same time.

### VPP reporting relationship

VPP Programs and Compensation Components are source data for HEROS financial
and ROI reporting.

Where the component type can be calculated directly from recorded HEROS data,
HEROS should calculate the applicable VPP income from the configured component.

Where the provider supplies a performance or revenue value that HEROS cannot
derive independently, the component definition must preserve the payment basis
so externally supplied values can be incorporated correctly by reporting.


## Electricity Rates - Final Approved Design

This section defines the final intended Electricity Rates model and supersedes
earlier rate-group details in this document wherever they conflict.

The design goal is to keep common residential tariff setup simple while still
supporting complex international tariff structures. HEROS therefore uses one
underlying tariff model with two user-interface levels:

- **Basic** - the default experience for flat and straightforward time-of-use
  residential tariffs.
- **Advanced** - exposes additional tariff structures only when required.

Basic and Advanced are not separate data stores. Advanced mode exposes more of
the same Electricity Plan model. A plan may be changed from Basic to Advanced
without losing its existing configuration.

### Electricity Plan

An Electricity Plan is the parent record for all electricity tariff components.

Only one Electricity Plan may apply on a given date.

Plan fields:

- **Retailer / Plan** - required free text. Retailer and plan name are combined
  into one user-facing field.
- **Effective Date** - required.
- **End Date** - optional and inclusive.
- **Mode** - Basic or Advanced. Basic is the default.
- **Rates Include Tax** - required Yes/No indication of whether entered tariff
  values already include GST, VAT, sales tax, or equivalent.
- **Tax Percentage** - optional where HEROS needs to calculate gross or net
  values.
- **Notes** - optional.
- **Status** - calculated automatically and not user-editable.

Plan Status values are:

- **Scheduled** - Effective Date is in the future.
- **Active** - Effective Date has been reached and End Date is blank or has not
  passed.
- **Ended** - End Date has passed.

The End Date itself remains Active. The plan becomes Ended on the following day.

Future-dated Electricity Plans are allowed. Gaps between plans are allowed.

If a new Electricity Plan is added while the existing plan is open-ended, HEROS
must prompt the user to end the existing plan on the day immediately before the
new Effective Date. If confirmed, HEROS updates the old End Date and saves the
new plan. If declined, the new plan is not saved because plan date ranges may
not overlap.

If the previous plan already has an End Date, the new plan must begin after it.

Every deletion requires confirmation.

### Basic mode

Basic mode is intentionally capable enough for normal residential tariffs and
does not mean "single rate only".

Basic supports:

- flat Buy / Import pricing;
- straightforward time-of-use Buy / Import pricing;
- flat Sell / Export / Feed-in Tariff pricing;
- straightforward time-of-use Sell / Export pricing;
- multiple Fixed Charges;
- optional multiple Controlled Loads;
- multiple rate periods for each Controlled Load;
- ordinary day and time selection;
- Public Holiday rate periods;
- zero rates where legitimate; and
- negative rates where legitimate.

Basic does not expose tiered/block, demand, or market-linked configuration.

### Buy / Import Rates

Buy / Import Rates are configured separately from Sell / Export Rates because
their schedules may differ.

Each Buy Rate record contains:

- **Rate Description** - required. Uses the existing common-description dropdown
  and Add to List/custom-description behaviour.
- **Days** - required.
- **Start Time** - required unless the record is explicitly All Day.
- **End Time** - required unless the record is explicitly All Day.
- **Rate** - required, stored internally in currency/kWh.
- **Effective Date** - required.
- **End Date** - optional and inclusive.
- **Status** - calculated automatically.
- **Notes** - optional.

Common descriptions should include:

- Standard
- Peak
- Shoulder
- Off-Peak
- Super Off-Peak
- Other

Custom descriptions may be added and persisted using the existing Pricing page
description-management behaviour.

Supported day selections in Basic include:

- All days
- Weekdays
- Weekends
- individual days Monday through Sunday
- Public Holidays

Multiple Buy Rate periods are allowed so normal Peak / Shoulder / Off-Peak
pricing remains a Basic configuration.

Rate values may be positive, zero, or negative where the tariff legitimately
requires them.

### Sell / Export / Feed-in Tariff Rates

Sell / Export Rates use a separate section and the same simple day/time model as
Buy Rates.

Each Sell Rate record contains:

- Rate Description
- Days
- Start Time
- End Time
- Rate
- Effective Date
- optional End Date
- Status
- optional Notes

Basic Sell Rates may be either:

- one flat export rate; or
- multiple time-of-use export periods.

Zero export rates are valid. Negative export rates are also supported where a
tariff can charge for export.

The same description dropdown and Add to List/custom-description behaviour used
by Buy Rates is reused here.

### Time-window validation

Within the same logical rate set, overlapping day/time windows are not
permitted unless a documented precedence rule applies.

Overnight periods are supported. For validation, an overnight period is treated
as two time segments split at midnight.

A start time equal to the end time is invalid unless the UI explicitly stores
the record as All Day rather than as a zero-length window.

Public Holiday records override ordinary weekday/weekend records and therefore
may coexist with them. Public Holiday records must still be checked against
other Public Holiday records for overlap.

### Fixed Charges

Fixed Charges are separate child records because a plan may contain several
simultaneous fixed or recurring charges.

Common descriptions include:

- Daily Supply Charge
- Meter Fee
- Service Fee
- Membership Fee
- Account Fee
- Other

Demand Charges are not Fixed Charges and belong to the Advanced Demand Charges
component.

Fixed Charge fields:

- **Charge Description** - required. Uses a common dropdown plus the existing
  Add to List/custom-description behaviour.
- **Amount** - required and non-zero.
- **Frequency** - required.
- **Effective Date** - required.
- **End Date** - optional and inclusive for recurring charges.
- **Status** - calculated automatically.
- **Notes** - optional.

Supported frequencies:

- Daily
- Weekly
- Fortnightly
- Monthly
- Quarterly
- Yearly
- One-off

A One-off charge applies once on its Effective Date and does not use an End
Date.

Positive values represent charges. Negative values represent recurring credits
or discounts. Zero is invalid.

Different Fixed Charge descriptions may overlap. Two effective-dated records for
the same Fixed Charge description may not overlap.

When a new record for the same Charge Description begins while the previous
record is open-ended, HEROS applies the standard close-previous prompt and, if
confirmed, ends the old record on the day before the new Effective Date.

Gaps are allowed.

### Controlled Loads

Controlled Load is a separate optional child tariff component.

A single Electricity Plan may contain multiple Controlled Loads, for example:

- Controlled Load 1 - Hot Water
- Controlled Load 2 - EV Circuit
- Pool Pump
- Dedicated Heating Circuit

Each Controlled Load parent contains:

- **Description** - required.
- **Effective Date** - required.
- **End Date** - optional and inclusive.
- **Status** - calculated automatically.
- **Notes** - optional.

Each Controlled Load may contain multiple rate periods.

Controlled Load Rate Period fields:

- Rate Description
- Days
- Start Time
- End Time
- Rate
- Effective Date
- optional End Date
- Status
- optional Notes

The same common Rate Description dropdown and Add to List/custom-description
behaviour used by Buy and Sell Rates is reused here.

Controlled Load rate periods may be Flat, Peak, Shoulder, Off-Peak, or another
custom description.

All Day is supported. This is important where a network controls when power is
available but the tariff itself is a single flat controlled-load rate.

### Advanced mode

Advanced mode exposes tariff structures that go beyond ordinary flat or
day/time-based residential pricing.

Advanced initially supports:

- Tiered / Block Pricing
- Demand Charges
- Dynamic / Market-linked pricing references
- the full Basic feature set

Advanced mode does not replace Basic configuration. Existing Basic records
remain valid and visible.

### Tiered / Block Pricing

Tiered pricing supports rates that depend on accumulated consumption.

Each tier contains:

- **From Quantity** - inclusive lower threshold.
- **To Quantity** - upper threshold; optional for the final open-ended tier.
- **Rate** - currency/kWh.
- **Reset Period** - required.

Supported Reset Period values:

- Daily
- Monthly
- Billing Period

Tiers must form a valid ordered set for the applicable tariff definition.
Overlapping quantity ranges are not permitted.

The final tier may omit To Quantity to represent all consumption above its From
Quantity.

A change in the provider's tier rates or thresholds must create a new
effective-dated tariff record. HEROS must not assume that a seasonal or annual
rate automatically repeats.

### Demand Charges

Demand Charges are an optional Advanced component and are intentionally separate
from Fixed Charges because the billed amount depends on measured maximum power
rather than a fixed recurring amount.

A Demand Charge record contains at minimum:

- **Description** - required.
- **Rate** - currency/kW.
- **Measurement Interval** - for example 15 or 30 minutes.
- **Applicable Days** - required.
- **Start Time** - required unless All Day.
- **End Time** - required unless All Day.
- **Billing Period** - required.
- **Effective Date** - required.
- **End Date** - optional and inclusive.
- **Status** - calculated automatically.
- **Notes** - optional.

A change in demand-charge rules or pricing creates a new effective-dated
Demand Charge record.

HEROS should calculate the applicable maximum demand from measured energy/power
data where the required source data is available.

### Dynamic / Market-linked pricing

Dynamic interval prices are not stored as ordinary Electricity Rate records.

The Electricity Plan or Rate Group stores only a reference to the applicable
Dynamic Pricing Source.

The actual dynamic interval prices belong in a separate data table/module to be
designed independently.

This separation allows:

- one Dynamic Pricing Source to feed Buy prices;
- one source to feed Sell prices;
- one source to feed both where appropriate;
- interval price history to be retained independently from tariff definition
  history; and
- provider/API-specific ingestion logic to remain outside the ordinary Pricing
  configuration model.

The dynamic data model will be specified separately when that feature is
designed.

### Seasonal changes

HEROS does not treat seasonal price periods as automatically repeating every
year.

If a tariff changes for a new season or year, a new effective-dated record is
required.

This preserves the actual historical rates applied by the retailer rather than
assuming that a previous year's seasonal values remain valid.

### Tax handling

HEROS records whether Electricity Plan rates are entered tax-inclusive or
tax-exclusive.

Where required, an optional Tax Percentage may be stored so HEROS can calculate
the corresponding gross or net amount for reporting.

The configured Home Assistant currency remains the monetary display source of
truth throughout HEROS.

### Rate values

Electricity rates may be:

- positive;
- zero; or
- negative.

This applies where the underlying tariff legitimately allows the value. The
model must not reject zero or negative rates merely because most ordinary
residential tariffs are positive.

### Effective-dated child behaviour

Unless a more specific rule above overrides it, all effective-dated Electricity
Plan child records use the same established Pricing-page behaviour:

- Effective Date is required.
- End Date is optional and inclusive where applicable.
- future-dated records are allowed.
- Status is system-calculated and not editable.
- gaps are allowed.
- successive records for the same logical item may not overlap.
- when an open-ended record is replaced, HEROS prompts to close it on the day
  before the new record starts.
- if the user declines and overlap would remain, the new record is not saved.
- Modify uses the existing form with Save Changes and Cancel.
- all stored user-editable fields may be corrected through Modify.
- Save re-runs all applicable validation.
- every deletion requires confirmation.
- deleting one child record does not merge, extend, or otherwise alter adjacent
  records.
- affected tables refresh after successful add, modify, or delete.

Parent/child dates must remain valid. A child Effective Date cannot be earlier
than its parent Electricity Plan Effective Date, and a child cannot extend
beyond the parent's End Date when one exists.

### Electricity Plan history

The Electricity Plan history table should show:

- Effective Date
- End Date
- Retailer / Plan
- Mode
- Status
- Action

Records are ordered by Effective Date descending.

Child sections should expose their own history records beneath or within the
selected Electricity Plan.

### User setup examples

Detailed user-facing Advanced setup examples are maintained separately in:

`docs/PRICING_ADVANCED_SETUP_EXAMPLES.md`

Keeping the examples separate prevents this backend/design document from
becoming a UI walkthrough while still providing concrete configurations that
users and implementers can follow.


## Implementation checklist

1. Extend `custom_components/heros/pricing.py`.
   - Add `PricingRateRecord`.
   - Add `PricingRateGroup`.
   - Add version 2 parsing/serialization to `PricingSchedule`.
   - Keep version 1 rule parsing for migration/backward compatibility.
   - Add active-group and active-record lookup helpers.
   - Add backend overlap validation.

2. Extend `custom_components/heros/pricing_store.py`.
   - Add group upsert/remove methods.
   - Add record upsert/remove methods.
   - Persist version 2 schedules to the same `pricing_schedule.json` file.
   - Keep reading old schedules without data loss.

3. Extend `custom_components/heros/const.py`.
   - Add service constants:
     - `SERVICE_PRICING_UPSERT_GROUP`
     - `SERVICE_PRICING_REMOVE_GROUP`
     - `SERVICE_PRICING_UPSERT_RECORD`
     - `SERVICE_PRICING_REMOVE_RECORD`
   - Add attribute constants for `group_id`, `record_id`,
     `effective_start_date`, `day_types`, and group-level charges.

4. Extend `custom_components/heros/__init__.py`.
   - Register the four new services.
   - Validate duplicate group start dates.
   - Validate record overlaps before saving.
   - Fire the existing pricing-changed dispatcher after group/record changes.

5. Extend `custom_components/heros/services.yaml`.
   - Document the four new services and fields.
   - Leave old services documented until migration is complete.

6. Extend `custom_components/heros/sensor.py`.
   - Expose `group_count`, `record_count`, `groups`, `active_group`, and
     `active_record`.
   - Keep `rule_count`, `rules`, and `date_map` attributes during transition.

7. Update the panel after backend model approval.
   - Load initial groups from the pricing schedule sensor.
   - Replace localStorage save/delete actions with Home Assistant service calls.
   - Keep localStorage only as an unsaved form draft fallback.
   - Show backend validation errors in the existing warning banner.

8. Add/extend tests.
   - `tests/test_pricing.py`: group/record validation, active lookup, migration.
   - `tests/test_pricing_store.py`: persist/load/upsert/delete groups and records.
   - `tests/test_panel_contract.py`: panel calls the new service names.
   - `tests/test_pricing_panel_ui_logic.py`: keep UI overlap/delete behavior.

## Suggested implementation order

1. Backend dataclasses and pure validation tests.
2. Store persistence tests.
3. Service registration and schemas.
4. Sensor attributes.
5. Panel service wiring.
6. HA deploy/restart.
7. Chrome live test with cache-busted version loop.

## Public holiday dates

Public holiday dates come from the configured Weekdays integration rather than being entered manually in each Buy or Sell record. HEROS stores the selected holiday source and region with the pricing configuration and refreshes the resolved `holiday_dates` list from the integration on its normal update cycle. Each refresh replaces the stored list with the current and upcoming dates (and may retain past dates for history). Buy and Sell records marked **Public holiday** are matched against the refreshed dates when selecting the applicable rate.
