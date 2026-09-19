# HEROS Task List

## Pricing

- [x] Build UI-only Pricing page for date-effective rate groups.
- [x] Support fixed/dynamic group type in the UI.
- [x] Support multiple rate records per group.
- [x] Support weekday, weekend, and public holiday record day types.
- [x] Warn and block saving overlapping day/time records inside a group.
- [x] Allow deleting individual records.
- [x] Allow deleting whole groups.
- [x] Deploy and live-test Pricing UI in Chrome.
- [x] Draft backend persistence design for user review.
- [x] Add backend implementation checklist for Pricing persistence.
- [x] Review and approve the UI/backend data model with the user.
- [x] Add backend rate-group/record dataclasses and pure validation tests.
- [x] Add pricing store persistence for groups and records.
- [x] Add Home Assistant services for save/delete rate groups and records.
- [x] Replace localStorage-only draft storage with Home Assistant persistence.
- [x] Add backend rate-group model so a group start date supersedes earlier groups.
- [x] Expose rate groups through the pricing schedule sensor.
- [x] Wire panel save/delete buttons to backend services after model approval.
- [x] Add Workday integration support for public holiday detection.
- [x] Decide how dynamic provider feeds should be represented beyond manual day/time records. See `docs/DYNAMIC_PRICING_FEEDS.md`.

## Future work (P3)

- [x] Define and test the finance data model for installation costs and date-effective repayment changes.`r`n- [ ] Add a dedicated Settings finance section for solar and battery installation costs.
- [ ] Add date-effective repayment schedule rows, so a changed repayment amount is retained for ROI calculations.
- [ ] Add ROI and payback reporting once costs and repayment history are configured.
- [ ] Keep history backfill in its own optional Settings section; new installations do not need it, while existing installations may trigger a historical download later.
## Forecast

- [x] Revisit Forecast after the user provides the missing context.
- [x] Confirm whether forecast integration/entities are installed.
- [x] Wire configured forecast entities into the dashboard once available.

## Initial debrief / outstanding cleanup

- [ ] Battery selector flash/regression needs a supervised fix session with the user present.
- [ ] Continue checking dashboard cache/version refresh after each panel deploy.
- [ ] Keep `.gitignore` local hygiene changes separate until the user asks to resolve them.
- [x] Review legacy naming cleanup separately; see `docs/LEGACY_NAMING_REVIEW.md` for compatibility boundaries and the safe clean-up sequence.