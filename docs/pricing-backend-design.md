# Pricing Backend Design

This document describes the pricing data shape used by the Pricing UI.

## Scope

Pricing stays file-backed for now because the dataset is small and the workflow
is easiest to reason about that way. The current live files live under
`www/home-energy-manager/<entry_id>/`, with the older
`www/home-energy-manager-pricing/<entry_id>/` path kept as a legacy read
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

## Implementation checklist

1. Extend `custom_components/home_energy_manager/pricing.py`.
   - Add `PricingRateRecord`.
   - Add `PricingRateGroup`.
   - Add version 2 parsing/serialization to `PricingSchedule`.
   - Keep version 1 rule parsing for migration/backward compatibility.
   - Add active-group and active-record lookup helpers.
   - Add backend overlap validation.

2. Extend `custom_components/home_energy_manager/pricing_store.py`.
   - Add group upsert/remove methods.
   - Add record upsert/remove methods.
   - Persist version 2 schedules to the same `pricing_schedule.json` file.
   - Keep reading old schedules without data loss.

3. Extend `custom_components/home_energy_manager/const.py`.
   - Add service constants:
     - `SERVICE_PRICING_UPSERT_GROUP`
     - `SERVICE_PRICING_REMOVE_GROUP`
     - `SERVICE_PRICING_UPSERT_RECORD`
     - `SERVICE_PRICING_REMOVE_RECORD`
   - Add attribute constants for `group_id`, `record_id`,
     `effective_start_date`, `day_types`, and group-level charges.

4. Extend `custom_components/home_energy_manager/__init__.py`.
   - Register the four new services.
   - Validate duplicate group start dates.
   - Validate record overlaps before saving.
   - Fire the existing pricing-changed dispatcher after group/record changes.

5. Extend `custom_components/home_energy_manager/services.yaml`.
   - Document the four new services and fields.
   - Leave old services documented until migration is complete.

6. Extend `custom_components/home_energy_manager/sensor.py`.
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
