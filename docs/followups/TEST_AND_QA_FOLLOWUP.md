# HEROS test and QA follow-up

Updated 2026-10-01.

## Deployment state

- GitHub `main` is clean and pushed.
- Latest pushed commit is `1f1b19d fix: cancel sensor refresh tasks on removal`.
- `.112` has been verified on HEROS panel V945.
- `.112` Pricing workflows have been verified:
  - HEROS loads.
  - Pricing loads.
  - Add group opens the editor.
  - Group save/persist works.
  - Group delete works.
  - Buy save/persist works.
  - Buy Modify opens the editor.
  - Buy Delete works.
  - Temporary QA data was removed.
- `.111` was not touched during the latest `.112` Pricing or sensor lifecycle verification work.
- Physical iPhone/Safari verification was completed manually. Result: usable on iPhone/Safari. A few minor visual/UX tweaks were observed; no urgent blocker was found. Remaining iPhone/Safari items are optional polish, not release blockers.

## Full pytest

Known results from the lifecycle fix task:

```text
sensor.py compilation: passed
tests/test_sensor_lifecycle.py: 1 passed
panel tests: 52 passed
git diff --check: passed
```

The broader full-suite run still has unrelated local/runtime issues:

```text
230 passed, 3 skipped, 1 failed, 30 errors
```

Known unrelated issues:

- `30` tests cannot create the Windows pytest temporary directory under `C:\Users\iekovm\AppData\Local\Temp\pytest-of-iekovm`.
- `test_entry_unload_keeps_the_sidebar_panel_registered_across_reloads` remains failing independently of the sensor lifecycle change.

These full-suite issues are separate from the verified `sensor.py` lifecycle fix.

## Targeted tests

The supported local focused panel subset remains green:

```text
pytest tests/test_panel_contract.py tests/test_pricing_panel_ui_logic.py
52 passed
```

The sensor lifecycle regression test was added and passed in the compatible HA-backed `.venv` environment:

```text
pytest tests/test_sensor_lifecycle.py
1 passed
```

## Mobile verification

The Codex In-app Browser viewport capability was used to inspect the live UI at `390 x 844` CSS pixels during earlier mobile verification work. Subsequent physical iPhone/Safari verification was completed manually.

Result:

- HEROS is usable on iPhone/Safari.
- A few minor visual/UX tweaks were observed.
- No urgent blocker was found.
- Remaining iPhone/Safari items are optional polish, not release blockers.

The detailed structured notes are in [MOBILE_QA_390X844.md](mobile-qa/MOBILE_QA_390X844.md).

## Reproducible mobile QA procedure

1. Open `.111` or `.112` in a browser with real device emulation set to an iPhone portrait viewport: `390 x 844` CSS pixels, device pixel ratio 3, and touch enabled.
2. Repeat the nine-page checklist in [MOBILE_QA_390X844.md](mobile-qa/MOBILE_QA_390X844.md), adding Safari/device-specific observations.
3. On Pricing, check populated Buy/Sell cards and Modify/Delete actions when records are available.
4. On Policy, check immediate controls and policy editors.
5. On Reports, check selected-state contrast and chart hit targets.
6. On Settings, check the theme preview and touch target sizing.

## Pricing verification

`.112` Pricing workflow verification is complete on V945.

Verified:

- HEROS loads.
- Pricing loads.
- Add group opens the editor.
- Save group and Cancel appear.
- Temporary group creation works.
- Temporary group persists after reload.
- Temporary group deletion works.
- Temporary Buy record creation works.
- Temporary Buy record persists after reload.
- Buy Modify opens the editor with saved values.
- Buy Delete works.
- Temporary QA group and Buy record were removed.
- Reload confirmed temporary data remained absent.
- No visible browser errors appeared during the workflow.

Relevant pushed fixes include:

```text
d7a9261 fix: open pricing group editor
a4f193d fix: bind pricing add group action
211e415 fix: improve pricing panel action handling
f990974 fix: show pricing actions on mobile
b044c2c fix: restore pricing calendar picker
```

## `sensor.py` lifecycle verification

The earlier `sensor.py` lifecycle warning investigation has now been reproduced, fixed, deployed to `.112`, and manually verified.

Affected handlers were:

- `PricingDynamicRateSensor._handle_schedule_changed`
- `PricingScheduleSensor._handle_refresh_signal`
- `PolicyChargeScheduleSensor._handle_refresh_signal`

The reproduced race was that dispatcher-triggered refresh tasks were created with `hass.async_create_task(...)` without retaining task handles. A pending refresh task could survive entity removal/unload and later call `async_write_ha_state()` after the entity lifecycle had ended.

The fix was committed in:

```text
1f1b19d fix: cancel sensor refresh tasks on removal
```

The fix adds lifecycle-safe refresh task handling:

- refresh task handles are retained;
- duplicate pending refreshes are coalesced;
- pending refresh tasks are cancelled on entity removal;
- task references are cleared on completion;
- state writes are guarded after awaited refresh work;
- dynamic sensor state-change writes are guarded by lifecycle state;
- cancellation is handled without logging it as an application error.

A Home Assistant-backed regression test was added in:

```text
tests/test_sensor_lifecycle.py
```

Manual `.112` verification confirmed:

- `/config/custom_components/heros/sensor.py` contains the lifecycle task-management fix;
- `_lifecycle_active`, cleanup, task tracking, coalescing, completion clearing, and guarded state writes are present;
- `python3 -m py_compile /config/custom_components/heros/sensor.py` completed without error;
- post-restart logs showed no targeted `sensor.py` lifecycle warning;
- no `async_write_ha_state` lifecycle error, sensor traceback, task exception, cancellation error, or entity removal/unload failure was observed.

`.111` was not touched during this verification.

## Separate follow-ups observed

The following issues were observed during verification but are separate from the sensor lifecycle fix.

- Recorder warning: `select.heros_settings_target` state attributes exceed 16,384 bytes.
- Neovolta API: HTTP 429 / operation-too-fast responses.

## Recommended next steps

1. Record the `.112` sensor lifecycle verification in `docs/followups/SENSOR_LIFECYCLE_FOLLOWUP.md` if not already updated.
2. Decide when to deploy the verified `sensor.py` lifecycle fix to `.111`.
3. Investigate the Recorder warning where `select.heros_settings_target` state attributes exceed 16,384 bytes.
4. Investigate Neovolta API HTTP 429 / operation-too-fast responses separately.
5. Continue optional iPhone/Safari visual polish later.
