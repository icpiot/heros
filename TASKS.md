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
- [ ] Replace localStorage-only draft storage with Home Assistant persistence.
- [x] Add backend rate-group model so a group start date supersedes earlier groups.
- [ ] Expose rate groups through the pricing schedule sensor.
- [ ] Wire panel save/delete buttons to backend services after model approval.
- [ ] Add Workday integration support for public holiday detection.
- [ ] Decide how dynamic provider feeds should be represented beyond manual day/time records.

## Forecast

- [ ] Revisit Forecast after the user provides the missing context.
- [ ] Confirm whether forecast integration/entities are installed.
- [ ] Wire configured forecast entities into the dashboard once available.

## Initial debrief / outstanding cleanup

- [ ] Battery selector flash/regression needs a supervised fix session with the user present.
- [ ] Continue checking dashboard cache/version refresh after each panel deploy.
- [ ] Keep `.gitignore` local hygiene changes separate until the user asks to resolve them.
- [ ] Review legacy naming cleanup separately; broad internal ByteWatt/provider names remain throughout the repo and should not be renamed casually.
