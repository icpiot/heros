# Pricing Backend Design

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
