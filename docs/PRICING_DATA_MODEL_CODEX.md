# Pricing Data Model - Codex Implementation Reference

This document is the authoritative implementation-oriented field and relationship map for HEROS Pricing.

It is written for Codex and developers implementing the Pricing backend, storage, Home Assistant services, sensors, and panel UI.

It consolidates the approved fields and relationships for:

- Electricity Plans and electricity tariff components
- Finance & ROI
- VPP Programs and compensation
- future Dynamic Pricing linkage

Where this file conflicts with an older pricing field layout, this file and the latest sections of `docs/pricing-backend-design.md` take precedence.

---

## 1. Relationship overview

```text
HEROS Pricing
│
├── Electricity Plans
│   └── Electricity Plan / Rate Group
│       ├── Buy / Import Rate Records
│       ├── Sell / Export Rate Records
│       ├── Fixed Charges
│       ├── Controlled Loads
│       │   └── Controlled Load Rate Periods
│       ├── Tiered / Block Rate Sets          [Advanced]
│       │   └── Tier Rows
│       ├── Demand Charges                    [Advanced]
│       └── Dynamic Pricing Source Link       [Advanced]
│
├── Finance & ROI
│   ├── Installation Costs
│   │   └── Repayment Records
│   └── Reporting consumes both
│
└── VPP
    └── VPP Program
        └── Compensation Components
```

Cardinality:

| Parent | Child | Relationship |
| --- | --- | --- |
| Electricity Plan | Buy Rate | 1 : many |
| Electricity Plan | Sell Rate | 1 : many |
| Electricity Plan | Fixed Charge | 1 : many |
| Electricity Plan | Controlled Load | 1 : many |
| Controlled Load | Controlled Load Rate Period | 1 : many |
| Electricity Plan | Tiered Rate Set | 1 : many |
| Tiered Rate Set | Tier Row | 1 : many |
| Electricity Plan | Demand Charge | 1 : many |
| Electricity Plan | Dynamic Pricing Source | many : 1 by source ID/reference |
| Installation Cost | Repayment | 1 : many |
| VPP Program | Compensation Component | 1 : many |

All child records must store a stable parent identifier. Do not rely on display text to maintain relationships.

---

# 2. Common conventions

## 2.1 Stable IDs

Use stable internal identifiers for entities that can be modified.

Recommended ID fields:

- `group_id` - Electricity Plan / Rate Group
- `record_id` - Buy or Sell Rate
- `fixed_charge_id`
- `controlled_load_id`
- `controlled_load_rate_id`
- `tiered_rate_set_id`
- `tier_id`
- `demand_charge_id`
- `dynamic_pricing_source_id`
- `installation_cost_id`
- `repayment_id`
- `vpp_program_id`
- `vpp_component_id`

Existing IDs should be preserved during migration where practical.

## 2.2 Effective dating

Unless a more specific rule overrides it:

- `effective_start_date` is required.
- `effective_end_date` is optional.
- End Date is inclusive.
- Future-dated records are allowed except Installation Costs.
- Status is calculated and should not be user-editable.
- Gaps are allowed.
- Successive records for the same logical item must not overlap.
- When a new version starts while the previous version is open-ended, HEROS prompts to close the previous record on the day immediately before the new start date.
- If the user declines and overlap would remain, the new record is not saved.

## 2.3 Status

Do not require a persisted Status field unless caching is specifically justified.

Recurring/date-ranged records:

- `Scheduled` - start date is in the future.
- `Active` - start date reached and end date is blank or has not passed.
- `Ended` - end date has passed.

One-off records:

- `Scheduled` before Effective Date.
- `Completed` on/after Effective Date.

## 2.4 Currency

Use Home Assistant's configured currency as the HEROS monetary display source of truth.

Internally:

- energy rates: currency/kWh
- demand/capacity rates: currency/kW
- fixed amounts: currency units

The UI may display cents/kWh or other locally familiar formatting.

## 2.5 Modify/Delete

Unless explicitly overridden:

- Modify loads the selected record into the existing form.
- All stored user-editable fields may be corrected.
- Save re-runs validation.
- Cancel discards unsaved changes.
- System-calculated Status is never directly editable.
- Every delete action requires confirmation.
- Deleting a child never alters neighbouring child records.
- Parent deletion is blocked while dependent child records remain where this document says the relationship is restrictive.

---

# 3. Electricity Plan / Rate Group

The Electricity Plan is the parent of all electricity tariff components.

Only one Electricity Plan may apply on a given date.

## Fields

| Field | Required | Type | Meaning / rules |
| --- | --- | --- | --- |
| `group_id` | Yes | Text/UUID | Stable Electricity Plan identifier |
| `retailer_plan` | Yes | Text | Combined retailer/provider + plan display name |
| `effective_start_date` | Yes | Date | Plan start |
| `effective_end_date` | No | Date | Inclusive plan end |
| `configuration_mode` | Yes | Choice | `basic` or `advanced`; default `basic` |
| `pricing_type` | Yes | Choice | `fixed`, `dynamic`, later `hybrid` if required |
| `rates_include_tax` | Yes | Boolean | Whether entered rates already include GST/VAT/sales tax |
| `tax_percentage` | No | Number | Optional percentage used for gross/net calculation |
| `dynamic_pricing_source_id` | No | Text/UUID | Link only; actual interval prices live elsewhere |
| `notes` | No | Text | Plan notes |
| `metadata` | No | Object | Extension/migration data only; do not hide core fields here |

Calculated:

- Status

## Logical rules

- Electricity Plans cannot overlap.
- Future-dated plans are allowed.
- Gaps are allowed.
- New plan + open previous plan => prompt to end previous one day before the new start.
- If previous plan already has an End Date, new plan must start after it.
- Delete requires confirmation.

## Display/history

Electricity Plan History columns:

- Effective Date
- End Date
- Retailer / Plan
- Mode
- Status
- Action

Order: Effective Date descending.

---

# 4. Basic vs Advanced

`configuration_mode` controls what the UI exposes. It does not select a different data store.

## Basic supports

- flat Buy / Import
- simple TOU Buy / Import
- flat Sell / Export / FIT
- simple TOU Sell / Export / FIT
- multiple Fixed Charges
- multiple Controlled Loads
- multiple rate periods per Controlled Load
- All Days / Weekdays / Weekends / individual weekdays / Public Holidays
- zero rates
- negative rates where legitimate

## Advanced additionally exposes

- Tiered / Block Pricing
- Demand Charges
- Dynamic / Market-linked source linkage
- all Basic features

Changing a plan from Basic to Advanced must not discard Basic data.

---

# 5. Buy / Import Rate Records

Parent: Electricity Plan via `group_id`.

## Fields

| Field | Required | Type | Meaning / rules |
| --- | --- | --- | --- |
| `record_id` | Yes | Text/UUID | Stable rate ID |
| `group_id` | Yes | Text/UUID | Parent Electricity Plan |
| `record_type` | Yes | Choice | `buy` |
| `label` | Yes | Text | Rate description |
| `day_types` | Yes | List | Applicable days |
| `all_day` | Yes | Boolean | Explicit full-day period |
| `start_time` | Conditional | Time | Required unless All Day |
| `end_time` | Conditional | Time | Required unless All Day |
| `import_rate` | Yes | Number | currency/kWh internally |
| `effective_start_date` | Yes | Date | Rate start |
| `effective_end_date` | No | Date | Inclusive rate end |
| `notes` | No | Text | Optional |
| `metadata` | No | Object | Optional extension/migration values |

Calculated:

- Status

## Common labels

Use the existing common-description dropdown plus Add to List/custom description:

- Standard
- Peak
- Shoulder
- Off-Peak
- Super Off-Peak
- Other

Custom descriptions are persistent.

## Day types

Support:

- All days
- Weekdays
- Weekends
- Monday
- Tuesday
- Wednesday
- Thursday
- Friday
- Saturday
- Sunday
- Public Holidays

Storage may continue using normalized values such as `mon`, `tue`, etc.

## Rules

- Multiple Buy records may exist.
- Ordinary day/time windows within the same applicable effective period must not overlap for intersecting day types.
- Public Holiday rates override ordinary weekday/weekend records.
- Public Holiday records may overlap ordinary day records.
- Public Holiday records may not overlap other Public Holiday records for the same effective period.
- Overnight periods are supported.
- `start_time == end_time` is invalid unless represented as explicit `all_day = true`.
- Positive, zero, and negative rates are supported.

---

# 6. Sell / Export / Feed-in Tariff Records

Parent: Electricity Plan via `group_id`.

The structure mirrors Buy Rates but uses `record_type = sell`.

## Fields

| Field | Required | Type | Meaning / rules |
| --- | --- | --- | --- |
| `record_id` | Yes | Text/UUID | Stable rate ID |
| `group_id` | Yes | Text/UUID | Parent Electricity Plan |
| `record_type` | Yes | Choice | `sell` |
| `label` | Yes | Text | Rate description |
| `day_types` | Yes | List | Applicable days |
| `all_day` | Yes | Boolean | Explicit full-day period |
| `start_time` | Conditional | Time | Required unless All Day |
| `end_time` | Conditional | Time | Required unless All Day |
| `export_rate` | Yes | Number | currency/kWh internally |
| `effective_start_date` | Yes | Date | Rate start |
| `effective_end_date` | No | Date | Inclusive rate end |
| `notes` | No | Text | Optional |
| `metadata` | No | Object | Optional extension/migration values |

Rules mirror Buy Rate validation.

Basic mode may contain:

- one flat export rate; or
- multiple simple TOU export rates.

Zero and negative export rates are valid.

---

# 7. Fixed Charges

Parent: Electricity Plan via `group_id`.

Fixed Charges replace dedicated fields such as:

- `daily_connection_charge`
- `subscription_fee`
- `subscription_period`
- structured monetary values previously placed in `other_charges`

These old fields may remain temporarily only for migration/backward compatibility.

## Fields

| Field | Required | Type | Meaning / rules |
| --- | --- | --- | --- |
| `fixed_charge_id` | Yes | Text/UUID | Stable charge ID |
| `group_id` | Yes | Text/UUID | Parent Electricity Plan |
| `description` | Yes | Text | Charge type/name |
| `amount` | Yes | Number | Non-zero; positive charge, negative credit |
| `frequency` | Yes | Choice | See frequencies below |
| `effective_start_date` | Yes | Date | Start |
| `effective_end_date` | Conditional | Date | Optional for recurring; not used for One-off |
| `notes` | No | Text | Optional |
| `metadata` | No | Object | Optional |

Calculated:

- Status

## Frequencies

- Daily
- Weekly
- Fortnightly
- Monthly
- Quarterly
- Yearly
- One-off

## Common descriptions

Common dropdown + Add to List/custom descriptions:

- Daily Supply Charge
- Meter Fee
- Service Fee
- Membership Fee
- Account Fee
- Other

Demand Charge must not be included here.

## Rules

- Amount cannot be zero.
- Positive = charge.
- Negative = credit/discount.
- One-off occurs once on Effective Date and has no End Date.
- Different charge descriptions may overlap.
- Successive records for the same charge description may not overlap.
- Gaps allowed.
- Open previous version uses standard close-previous prompt.

---

# 8. Controlled Loads

Parent: Electricity Plan via `group_id`.

The legacy `controlled_load_rate` field on Buy/Sell records is superseded by this structure.

## Controlled Load parent fields

| Field | Required | Type | Meaning / rules |
| --- | --- | --- | --- |
| `controlled_load_id` | Yes | Text/UUID | Stable Controlled Load ID |
| `group_id` | Yes | Text/UUID | Parent Electricity Plan |
| `description` | Yes | Text | e.g. Hot Water, EV Circuit |
| `effective_start_date` | Yes | Date | Start |
| `effective_end_date` | No | Date | Inclusive end |
| `notes` | No | Text | Optional |
| `metadata` | No | Object | Optional |

Calculated:

- Status

One Electricity Plan may have multiple Controlled Loads.

## Controlled Load Rate Period fields

Parent: Controlled Load via `controlled_load_id`.

| Field | Required | Type | Meaning / rules |
| --- | --- | --- | --- |
| `controlled_load_rate_id` | Yes | Text/UUID | Stable rate ID |
| `controlled_load_id` | Yes | Text/UUID | Parent Controlled Load |
| `label` | Yes | Text | Rate description |
| `day_types` | Yes | List | Applicable days |
| `all_day` | Yes | Boolean | Explicit full-day tariff |
| `start_time` | Conditional | Time | Required unless All Day |
| `end_time` | Conditional | Time | Required unless All Day |
| `rate` | Yes | Number | currency/kWh |
| `effective_start_date` | Yes | Date | Rate start |
| `effective_end_date` | No | Date | Inclusive end |
| `notes` | No | Text | Optional |
| `metadata` | No | Object | Optional |

Use the same Rate Description dropdown + custom description behaviour as Buy/Sell.

All Day must be supported where the network controls the circuit switching externally.

Child date ranges must remain inside the parent Controlled Load and Electricity Plan date ranges.

---

# 9. Tiered / Block Pricing [Advanced]

Parent: Electricity Plan via `group_id`.

A Tiered Rate Set groups a sequence of consumption tiers that share the same applicability and reset rule.

## Tiered Rate Set fields

| Field | Required | Type | Meaning / rules |
| --- | --- | --- | --- |
| `tiered_rate_set_id` | Yes | Text/UUID | Stable set ID |
| `group_id` | Yes | Text/UUID | Parent Electricity Plan |
| `record_type` | Yes | Choice | `buy` initially; model may permit `sell` if required |
| `label` | Yes | Text | User-facing tier set name |
| `reset_period` | Yes | Choice | Daily, Monthly, Billing Period |
| `effective_start_date` | Yes | Date | Start |
| `effective_end_date` | No | Date | Inclusive end |
| `notes` | No | Text | Optional |

Calculated:

- Status

## Tier row fields

Parent: Tiered Rate Set via `tiered_rate_set_id`.

| Field | Required | Type | Meaning / rules |
| --- | --- | --- | --- |
| `tier_id` | Yes | Text/UUID | Stable row ID |
| `tiered_rate_set_id` | Yes | Text/UUID | Parent set |
| `from_quantity` | Yes | Number | Inclusive lower threshold in kWh |
| `to_quantity` | No | Number | Upper threshold; blank for final open-ended tier |
| `rate` | Yes | Number | currency/kWh |
| `sort_order` | Yes | Integer | Tier ordering |

## Rules

- Tiers must be ordered.
- Quantity ranges must not overlap.
- Final tier may omit `to_quantity`.
- A provider rate/threshold change creates a new effective-dated Tiered Rate Set.
- HEROS does not automatically repeat seasonal tiers annually.

---

# 10. Demand Charges [Advanced]

Parent: Electricity Plan via `group_id`.

Demand Charges are separate from Fixed Charges because the amount is calculated from measured maximum demand.

## Fields

| Field | Required | Type | Meaning / rules |
| --- | --- | --- | --- |
| `demand_charge_id` | Yes | Text/UUID | Stable ID |
| `group_id` | Yes | Text/UUID | Parent Electricity Plan |
| `description` | Yes | Text | User-facing name |
| `rate` | Yes | Number | currency/kW |
| `measurement_interval_minutes` | Yes | Integer | e.g. 15 or 30 |
| `day_types` | Yes | List | Applicable days |
| `all_day` | Yes | Boolean | All day or time-limited |
| `start_time` | Conditional | Time | Required unless All Day |
| `end_time` | Conditional | Time | Required unless All Day |
| `billing_period` | Yes | Choice/Text | Period used to determine max demand |
| `effective_start_date` | Yes | Date | Start |
| `effective_end_date` | No | Date | Inclusive end |
| `notes` | No | Text | Optional |
| `metadata` | No | Object | Provider-specific structured extension only when necessary |

Calculated:

- Status

HEROS should calculate applicable maximum demand from measured source data when available.

---

# 11. Dynamic / Market-linked Pricing [Advanced]

The Electricity Plan stores a link only.

Do not store the interval price history in the normal Electricity Plan, Buy Rate, or Sell Rate collections.

## Electricity Plan link field

- `dynamic_pricing_source_id`

## Legacy fields to migrate out of the Electricity Plan

- `dynamic_import_price_entity`
- `dynamic_next_import_price_entity`
- `dynamic_export_price_entity`

These are not discarded conceptually. They belong to the future Dynamic Pricing Source object.

The future Dynamic Pricing module will be designed separately and is expected to own items such as:

- source/provider ID
- import-price entity/source
- next-import-price entity/source
- export-price entity/source
- interval start/end
- actual interval import price
- actual interval export price
- ingestion timestamp
- source quality/status metadata

Do not invent or finalize that table beyond the link requirements until its design pass is completed.

---

# 12. Finance & ROI - Installation Costs

Installation Costs are historical/current only. Future dates are invalid.

## Fields

| Field | Required | Type | Meaning / rules |
| --- | --- | --- | --- |
| `installation_cost_id` | Yes | Text/UUID | Stable internal parent ID |
| `effective_date` | Yes | Date | Cost incurred / work installed; cannot be future |
| `description` | Yes | Text | Free text |
| `amount` | Yes | Number | Non-zero; positive or negative |
| `notes` | No | Text | Optional if implementation already supports it |
| `metadata` | No | Object | Optional extension only |

Logical uniqueness:

`Effective Date + Description`

Negative values represent rebates/refunds/credits.

## Relationship

Installation Cost 1 : many Repayment Records.

Deletion is blocked while linked Repayment records remain.

Repayments must be deleted or reassigned first.

---

# 13. Finance & ROI - Repayments

Parent: Installation Cost via `installation_cost_id`.

One Installation Cost may have many effective-dated Repayment records.

## Fields

| Field | Required | Type | Meaning / rules |
| --- | --- | --- | --- |
| `repayment_id` | Yes | Text/UUID | Stable ID |
| `installation_cost_id` | Yes | Text/UUID | Parent Installation Cost |
| `effective_date` | Yes | Date | First repayment occurrence |
| `end_date` | No | Date | Inclusive stop date for recurring repayment |
| `amount` | Yes | Number | Non-zero; positive or negative |
| `frequency` | Yes | Choice | Weekly, Fortnightly, Monthly, Quarterly, Yearly, One-off |
| `notes` | No | Text | Optional |

Calculated:

- Status

## Rules

- Effective Date may be future.
- Effective Date cannot precede parent Installation Cost Effective Date.
- End Date cannot precede Effective Date.
- One-off has no End Date.
- Same Installation Cost repayment periods may not overlap.
- Gaps allowed.
- A new repayment must have a later Effective Date than the latest repayment for that Installation Cost.
- If latest repayment is open-ended, prompt to end it the day before the new one starts.
- If declined, do not save the overlapping new repayment.
- Reassignment to another Installation Cost is allowed only if all target chronology/overlap rules pass.

Logical uniqueness:

`Installation Cost ID + Repayment Effective Date`

## Schedule semantics

- Weekly = every 7 days from Effective Date.
- Fortnightly = every 14 days.
- Monthly = calendar monthly anchored to Effective Date.
- Quarterly = every 3 calendar months.
- Yearly = calendar yearly.
- One-off = once on Effective Date.
- Month-end anchor uses last valid day when target month is shorter.
- Feb 29 yearly uses Feb 28 in non-leap years and returns to Feb 29 in leap years.
- End Date stops future occurrences; it does not create an extra occurrence.
- A scheduled occurrence exactly on End Date is included.

---

# 14. VPP Program

Only one VPP Program may apply on a given date.

## Fields

| Field | Required | Type | Meaning / rules |
| --- | --- | --- | --- |
| `vpp_program_id` | Yes | Text/UUID | Stable Program ID |
| `provider` | Yes | Text | Provider |
| `program_plan_name` | No | Text | Optional program/plan |
| `effective_date` | Yes | Date | Program start |
| `end_date` | No | Date | Inclusive end |
| `notes` | No | Text | Optional |

Calculated:

- Status

## Rules

- Future-dated programs allowed.
- Programs cannot overlap.
- Gaps allowed.
- Open-ended current Program + new Program => close-previous prompt.
- If confirmed, old End Date = day before new Effective Date.
- If declined, do not save the overlapping Program.
- Parent deletion is blocked while Compensation Components remain linked.

---

# 15. VPP Compensation Components

Parent: VPP Program via `vpp_program_id`.

Multiple components may coexist and overlap when the VPP legitimately pays them simultaneously.

Multiple components of the same type are allowed.

## Common fields

| Field | Required | Type | Meaning / rules |
| --- | --- | --- | --- |
| `vpp_component_id` | Yes | Text/UUID | Stable component ID |
| `vpp_program_id` | Yes | Text/UUID | Parent Program |
| `label` | Yes | Text | Mandatory free-text description |
| `component_type` | Yes | Choice | See types below |
| `effective_date` | Yes | Date | Component start |
| `end_date` | Conditional | Date | Optional/inclusive where recurring |
| `value` | Yes | Number | Meaning depends on type |
| `frequency` | Conditional | Choice | Required for repeating cycle types |
| `basis` | Conditional | Text | Required for percentage-based payment |
| `condition_type` | No | Choice | See condition types |
| `notes` | No | Text | Provider-specific rules |

Calculated:

- Status

## Component types

- Energy Payment - value = currency/kWh
- Capacity Payment - value = currency/kW; frequency where applicable
- Fixed Recurring Payment - value = fixed currency amount + frequency
- One-off Incentive - value = fixed currency amount; no End Date/Frequency
- Event Payment - value = fixed currency amount per event
- Percentage-based Payment - value = percentage; Basis required

## Frequencies where applicable

- Weekly
- Fortnightly
- Monthly
- Quarterly
- Yearly

## Condition types

- Always
- VPP event only
- Seasonal
- Performance-based
- Provider-defined/custom

## Parent/child date rules

- Component Effective Date cannot precede Program Effective Date.
- If Program has End Date, component cannot extend beyond it.
- Component End Date cannot precede its Effective Date.

---

# 16. Legacy field migration map

Current Pricing fields must be mapped deliberately.

| Current field | Final treatment |
| --- | --- |
| `group_id` | Keep as Electricity Plan ID |
| group `label` | Migrate into `retailer_plan` where appropriate |
| `provider` | Merge into `retailer_plan`; retain temporarily if needed for migration |
| `effective_start_date` | Keep |
| `pricing_type` | Keep for fixed/dynamic source type; do not use for Basic/Advanced |
| `daily_connection_charge` | Migrate to Fixed Charge: Daily Supply Charge |
| `subscription_fee` | Migrate to Fixed Charge |
| `subscription_period` | Becomes Fixed Charge frequency |
| `dynamic_import_price_entity` | Move into future Dynamic Pricing Source |
| `dynamic_next_import_price_entity` | Move into future Dynamic Pricing Source |
| `dynamic_export_price_entity` | Move into future Dynamic Pricing Source |
| group `other_charges` | Structured monetary items migrate to Fixed Charges; free text may migrate to Notes |
| group `notes` | Keep |
| `record_id` | Keep |
| `record_type` | Keep |
| record `label` | Keep |
| `day_types` | Keep |
| `start_time` | Keep |
| `end_time` | Keep |
| `import_rate` | Keep for Buy records |
| `export_rate` | Keep for Sell records |
| `controlled_load_rate` | Migrate to Controlled Load + Controlled Load Rate child records |
| record `other_charges` | Structured charges migrate out; free text may migrate to Notes |
| record `notes` | Keep |
| `metadata` | Keep for extension/migration, not for hiding first-class fields |

New Electricity Plan fields:

- `effective_end_date`
- `configuration_mode`
- `rates_include_tax`
- `tax_percentage`
- `dynamic_pricing_source_id`

---

# 17. Recommended versioned storage shape

This is a structural example, not a requirement to use these exact class names.

```json
{
  "version": 3,
  "electricity_plans": [
    {
      "group_id": "uuid",
      "retailer_plan": "Example Energy - Home TOU",
      "effective_start_date": "2026-07-01",
      "effective_end_date": null,
      "configuration_mode": "basic",
      "pricing_type": "fixed",
      "rates_include_tax": true,
      "tax_percentage": 10,
      "dynamic_pricing_source_id": null,
      "notes": "",
      "buy_rates": [],
      "sell_rates": [],
      "fixed_charges": [],
      "controlled_loads": [],
      "tiered_rate_sets": [],
      "demand_charges": []
    }
  ],
  "installation_costs": [],
  "repayments": [],
  "vpp_programs": []
}
```

A normalized store is also acceptable. The critical requirement is preserving stable IDs and the parent-child relationships above.

---

# 18. Codex implementation rules

Codex must not flatten child entities back into unrelated text fields.

Do not:

- place multiple fixed charges back into `other_charges`;
- represent multiple Controlled Loads using one `controlled_load_rate`;
- place dynamic interval price history in ordinary Buy/Sell rate records;
- use display labels as foreign keys;
- infer a child-parent relationship from matching text;
- discard existing IDs during migration without a reason;
- silently overwrite historical effective-dated records to represent a later tariff change.

Do:

- preserve stable IDs;
- store explicit parent IDs;
- enforce parent/child date boundaries;
- enforce overlap rules on the relevant logical item;
- calculate Status rather than asking users to maintain it;
- retain historical records;
- use the existing common Rate Description/Add to List behaviour where specified;
- keep Basic and Advanced as UI exposure modes over the same data model;
- migrate existing fields without data loss.

---

# 19. Implementation order

Recommended sequence for Codex:

1. Introduce version 3 data classes/schema while preserving version 2 reads.
2. Add Electricity Plan end date, configuration mode, tax fields, and source link.
3. Preserve and extend Buy/Sell records with effective dates and All Day support.
4. Add Fixed Charge child collection and migrate existing supply/subscription fields.
5. Add Controlled Load parent + rate child collection and migrate legacy controlled-load values.
6. Add Advanced Tiered Rate Set + Tier Rows.
7. Add Advanced Demand Charges.
8. Add Dynamic Pricing Source ID link only; do not build interval storage yet.
9. Add Finance parent-child IDs if not already present.
10. Add VPP parent-child IDs if not already present.
11. Update Home Assistant services and sensor payloads.
12. Update panel forms/tables for Basic and Advanced.
13. Add migration tests, relationship tests, overlap tests, date-boundary tests, and UI contract tests.
14. Deploy and perform live + visual verification.

A task is not complete until the implemented UI has been visually verified. If Codex cannot access the browser/UI, it must request a screenshot rather than claiming completion.
