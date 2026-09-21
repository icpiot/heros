# Pricing - Finance & ROI Codex Implementation Contract

This file defines the implementation and verification contract for the HEROS Pricing page **Finance & ROI** section.

The functional design is documented in:

- `docs/pricing-backend-design.md`

Codex must use that document as the source of truth for Finance & ROI behaviour.

## Completion rule

Do **not** consider this task complete until every applicable item in this file has been implemented and verified.

Partial implementation is not completion.

If visual verification cannot be performed directly, request a screenshot from the user. Do not claim visual completion without seeing the resulting UI.

## Backend requirements

Implement the Finance & ROI data model described in `docs/pricing-backend-design.md`.

Required behaviour includes:

- Installation Cost records with:
  - Effective Date
  - Description
  - Amount
- Installation Cost logical key:
  - `Effective Date + Description`
- Repayment records linked to exactly one Installation Cost.
- Repayment logical key:
  - `Installation Cost key + Repayment Effective Date`
- Multiple repayment records may exist for one Installation Cost.
- Repayment fields:
  - Installation Cost
  - Effective Date
  - optional End Date
  - Amount
  - Frequency
- Supported repayment frequencies:
  - Weekly
  - Fortnightly
  - Monthly
  - Quarterly
  - Yearly
  - One-off
- Automatic repayment Status calculation:
  - Scheduled
  - Active
  - Ended
  - Completed
- Repayment Status must not be user-editable.
- Reports and calculations that consume Finance & ROI records must use the current stored values after add, modify, reassign, or delete operations.

## Installation Cost validation

Codex must implement and test all of the following:

- Effective Date is required.
- Effective Date cannot be in the future.
- Description is required.
- Description is free text.
- Amount is required.
- Amount cannot equal zero.
- Positive Amount values are allowed.
- Negative Amount values are allowed.
- Duplicate `Effective Date + Description` combinations are rejected.
- An Installation Cost cannot be deleted while linked Repayment records exist.
- Linked repayments must first be deleted or reassigned.
- All deletions require confirmation.

## Repayment validation

Codex must implement and test all of the following:

- Installation Cost link is mandatory.
- Effective Date is mandatory.
- Effective Date may be future-dated.
- Effective Date cannot be earlier than the linked Installation Cost Effective Date.
- End Date is optional.
- End Date cannot be earlier than Effective Date.
- Amount is mandatory.
- Amount cannot equal zero.
- Positive Amount values are allowed.
- Negative Amount values are allowed.
- Frequency is mandatory.
- Duplicate repayment logical keys are rejected.
- Repayments for the same Installation Cost cannot overlap.
- Gaps between repayment periods are allowed.
- A new repayment Effective Date must be later than the latest existing repayment Effective Date for the same Installation Cost.
- Earlier or equal Effective Dates are invalid.
- The same chronology and overlap rules apply when modifying or reassigning a repayment.

## Repayment schedule rules

Implement and test:

- Weekly = every 7 days from Effective Date.
- Fortnightly = every 14 days from Effective Date.
- Monthly = every calendar month from Effective Date.
- Quarterly = every 3 calendar months from Effective Date.
- Yearly = every calendar year from Effective Date.
- One-off = one occurrence on Effective Date only.
- Effective Date is always the first repayment occurrence.
- End Date does not create an additional repayment.
- A scheduled repayment exactly on the End Date is included.
- A recurring repayment with no End Date remains active indefinitely.
- If a monthly or quarterly target day does not exist, use the last valid day of the target month.
- A yearly repayment anchored to 29 February uses 28 February in non-leap years and returns to 29 February in leap years.

## New repayment after an open-ended repayment

When a newer repayment is added for an Installation Cost whose latest repayment has no End Date:

1. Prompt the user to confirm whether the existing repayment should be ended.
2. If **Yes**:
   - set the existing repayment End Date to the day before the new repayment Effective Date;
   - save the new repayment.
3. If **No**:
   - do not save the new repayment because the overlap is invalid.

If the latest existing repayment already has an End Date, the new repayment must start after it.

## Frontend requirements

### Installation Costs

The form must support:

- Effective Date
- Description
- Amount
- Add/Save
- Modify
- Delete
- Cancel while modifying

Installation History must show:

- Effective Date
- Description
- Amount
- Action

Installation History must be ordered by Effective Date descending.

Modify must load the selected Installation Cost into the existing form.

All Installation Cost fields may be changed while modifying.

### Repayments

The form must support:

- Installation Cost selector
- Effective Date
- End Date
- Amount
- Frequency
- Add Repayment Change
- Save Changes while modifying
- Cancel while modifying

Modify must load the selected repayment into the existing form.

All stored repayment fields may be changed while modifying:

- Installation Cost
- Effective Date
- End Date
- Amount
- Frequency

Status must not be editable.

Repayment reassignment to another Installation Cost is allowed only if all validation rules pass against the target Installation Cost.

## Installation Cost selector display

The selector must list all available Installation Cost records.

Display rule:

- if Description is unique, show Description only;
- if the same Description exists on multiple Installation Cost records, append the Installation Effective Date.

Example:

- `Solar Upgrade`
- `Solar Upgrade - 15/08/2026`

The displayed label is not the stored relationship key. The repayment must reference the actual parent Installation Cost record.

## Repayment History

Repayment History must be a flat table containing:

- Installation Description
- Effective Date
- End Date
- Amount
- Frequency
- Status
- Action

Sorting:

1. Installation Description
2. Repayment Effective Date descending within each Installation Cost

Only the linked Installation Description is shown from the parent Installation Cost unless the Effective Date is required to disambiguate duplicate descriptions.

Status is calculated automatically and displayed in the table only.

## Status rules

### Recurring repayments

- Scheduled:
  - Effective Date is in the future.
- Active:
  - Effective Date has been reached;
  - and End Date is blank or has not passed.
- Ended:
  - End Date has passed.

On the End Date itself, status remains Active.

It becomes Ended the following day.

### One-off repayments

- Scheduled:
  - Effective Date is in the future.
- Completed:
  - Effective Date has been reached.

## Delete behaviour

All delete actions require confirmation.

Deleting a Repayment:

- deletes only that record;
- does not extend neighbouring records;
- does not merge neighbouring records;
- does not change adjacent End Dates or Effective Dates;
- may leave a valid gap.

Deleting an Installation Cost:

- is blocked while linked repayments exist;
- must clearly tell the user that linked repayments must be deleted or reassigned first.

## Data refresh behaviour

After a successful:

- add;
- modify;
- reassign; or
- delete

the affected tables and any linked calculations/reports must use the updated stored values.

The implementation may use on-demand calculation, caching, or pre-calculation. The required result is that users and reports see the current data.

## Automated tests required

Codex must add or extend tests covering at minimum:

- Installation Cost required fields.
- Installation Cost zero-value rejection.
- Positive and negative Installation Cost amounts.
- Future Installation Cost date rejection.
- Installation Cost duplicate-key rejection.
- Installation Cost delete blocking with linked repayments.
- Repayment parent-link requirement.
- Repayment Effective Date validation against parent Installation Cost.
- End Date validation.
- Repayment zero-value rejection.
- Positive and negative Repayment amounts.
- Repayment logical-key uniqueness.
- No-overlap rules.
- Gap allowance.
- Newer Effective Date requirement.
- Open-ended repayment confirmation behaviour.
- Automatic closing of the prior repayment.
- Modify chronology validation.
- Reassignment validation.
- Weekly schedule logic.
- Fortnightly schedule logic.
- Monthly month-end handling.
- Quarterly month-end handling.
- Yearly leap-year handling.
- One-off behaviour.
- Status calculation.
- Delete behaviour.
- Table ordering where logic is testable.

All relevant tests must pass before completion is reported.

## Deployment verification

Before reporting completion:

- deploy the implementation to the intended HEROS test/live Home Assistant instance;
- restart/reload the required HEROS components if needed;
- confirm the updated code is the version actually running;
- verify no new relevant errors are present in Home Assistant logs.

## Live functional verification

Verify the feature using real UI interactions, not only unit tests.

At minimum verify:

- add Installation Cost;
- modify Installation Cost;
- delete Installation Cost;
- blocked Installation Cost deletion with linked repayments;
- add Repayment;
- add a newer repayment and confirm automatic closing of the prior record;
- reject an overlap;
- allow a gap;
- modify Repayment;
- reassign Repayment;
- delete Repayment;
- One-off repayment;
- future-dated repayment;
- automatic Status;
- positive and negative amounts;
- zero-value rejection;
- duplicate-key rejection.

## Visual verification

Codex must visually confirm that the Pricing page shows the final Finance & ROI design correctly.

Verify at minimum:

- field labels;
- field order;
- Installation Cost selector;
- End Date;
- Frequency options;
- Repayment History columns;
- Status column;
- Modify mode;
- Save Changes control;
- Cancel control;
- confirmation prompts;
- validation messages;
- table refresh after changes;
- no broken or clipped layout.

If Codex cannot access the browser/UI, it must request a screenshot from the user and perform visual verification from that screenshot.

**The task is not complete without visual verification.**

## Final handback requirements

Codex may report the Finance & ROI task complete only when:

- implementation is complete;
- automated tests pass;
- deployment is complete;
- live functional verification passes;
- visual verification passes;
- no known requirement in this file remains incomplete.

The final handback must clearly state:

- what was implemented;
- what tests were run and their result;
- where it was deployed;
- what live checks were performed;
- how visual verification was completed;
- any known limitation that remains.

If any required item remains incomplete, report it as incomplete rather than handing the task back as complete.
