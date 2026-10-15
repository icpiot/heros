# HEROS sensor lifecycle follow-up

Updated 2026-10-15.

## Finding

`custom_components/heros/sensor.py` had three dispatcher-triggered refresh handlers with a lifecycle race:

- `PricingDynamicRateSensor._handle_schedule_changed`
- `PricingScheduleSensor._handle_refresh_signal`
- `PolicyChargeScheduleSensor._handle_refresh_signal`

Each entity already registered its dispatcher unsubscribe callback with `async_on_remove`. `PricingDynamicRateSensor` also registered its Home Assistant state listener that way. The issue was that the handlers called `self.hass.async_create_task(...)` without retaining the returned task.

The reproduced race was:

1. A dispatcher refresh signal schedules a refresh task.
2. Entity removal/unload begins while the refresh task is still pending.
3. Home Assistant invokes the entity `async_on_remove` callbacks.
4. The already-created refresh task continues after removal.
5. The task resumes and calls `async_write_ha_state()` after the entity lifecycle has ended.

The race was reproduced with an HA-backed probe against `PricingScheduleSensor`. The probe confirmed that the refresh task remained active after removal callbacks, completed afterward, and called `async_write_ha_state()` again after removal.

No complete production Home Assistant traceback was captured, but the unsafe lifecycle timing was reproduced.

## Decision

A focused lifecycle fix was implemented after HA-backed reproduction confirmed the race.

The fix was committed in:

```text
1f1b19d fix: cancel sensor refresh tasks on removal
```

The fix applies lifecycle-safe refresh task handling to the affected sensor paths. It retains refresh task handles, coalesces duplicate refresh requests, cancels pending refresh tasks on entity removal, clears task references on completion, and guards state writes after awaited refresh work.

The change preserves the existing schedule calculations and continues using Home Assistant's task API rather than `asyncio.create_task`, so task ownership remains visible to Home Assistant.

## Lifecycle reproduction status

A compatible HA-backed environment was available in the repository `.venv` using Home Assistant 2026.9.1 and `pytest-homeassistant-custom-component==0.13.364`. The managed Python 3.12 runtime remained unsuitable because the declared HA test dependency requires Python 3.14+ and compatible HA binary dependencies.

A disposable HA-backed probe exercised `PricingScheduleSensor` by:

1. creating a HA test instance and sensor;
2. running `async_added_to_hass()`;
3. emitting the refresh signal;
4. blocking the async storage refresh;
5. invoking entity removal callbacks while the refresh task was pending;
6. releasing the blocked refresh;
7. draining the event loop.

Observed result:

- the refresh task remained active after removal callbacks;
- the refresh completed after removal;
- `async_write_ha_state()` was called again after removal;
- no pending task remained after completion.

A focused HA-backed regression test was then added in:

```text
tests/test_sensor_lifecycle.py
```

The test verifies that a dispatcher refresh task is pending, removal callbacks cancel it, no post-removal state write occurs, and no task remains pending.

## Required refactor when HA lifecycle testing is available

The required lifecycle refactor has now been implemented.

Implemented behaviour:

1. Store the task returned by `hass.async_create_task`.
2. Coalesce duplicate refresh signals while a refresh task is already pending.
3. Register task cleanup with `async_on_remove`.
4. Cancel any pending refresh task during entity removal.
5. Clear the task handle when the task finishes.
6. Guard refresh completion before calling `async_write_ha_state` if the entity is no longer lifecycle-active.
7. Guard the dynamic pricing state-listener write path with lifecycle state.
8. Allow cancellation to complete without logging it as an application error.

The refactor was implemented without rewriting pricing or policy schedule calculations.

## Validation in this task

Local/HA-backed validation for the lifecycle fix:

- `custom_components/heros/sensor.py` compilation passed.
- `tests/test_sensor_lifecycle.py` passed: 1 passed.
- Focused panel tests passed: 52 passed.
- `git diff --check` passed.

A broader suite run reported:

```text
230 passed, 3 skipped, 1 failed, 30 errors
```

Known unrelated issues from that run:

- 30 tests could not create the Windows pytest temporary directory under `C:\Users\iekovm\AppData\Local\Temp\pytest-of-iekovm`.
- `test_entry_unload_keeps_the_sidebar_panel_registered_across_reloads` remained failing independently of the sensor lifecycle change.

Manual `.112` verification after deployment confirmed:

- `/config/custom_components/heros/sensor.py` contains the lifecycle task-management fix.
- `_lifecycle_active`, cleanup, task tracking, coalescing, completion clearing, and guarded state writes are present.
- `python3 -m py_compile /config/custom_components/heros/sensor.py` completed without error.
- Post-restart logs showed no targeted `sensor.py` lifecycle warning.
- No `async_write_ha_state` lifecycle error, sensor traceback, task exception, cancellation error, or entity removal/unload failure was observed.

`.111` was not touched by the sensor lifecycle deployment. Its later Pricing panel deployment did not include `sensor.py`.

Separate unrelated log follow-ups observed during `.112` verification:

- Recorder warning: `select.heros_settings_target` state attributes exceed 16,384 bytes.
- Neovolta API: HTTP 429 / operation-too-fast responses.

## Remaining risk

The reproduced lifecycle race has been fixed and verified on `.112`, but `.111` has not yet been updated with the verified `sensor.py` lifecycle fix.

The remaining risk is therefore limited to any instance that has not yet received commit `1f1b19d`. Those instances may still have the old dispatcher refresh task behaviour until the fix is deployed.

Recorder attribute-size warnings and Neovolta API rate-limit errors are separate follow-ups and are not part of the sensor lifecycle fix.
