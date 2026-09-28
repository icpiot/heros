# HEROS sensor lifecycle follow-up

Updated 2026-09-28.

## Finding

`custom_components/heros/sensor.py` has three dispatcher-triggered refresh handlers:

- `PricingDynamicRateSensor._handle_schedule_changed`
- `PricingScheduleSensor._handle_refresh_signal`
- `PolicyChargeScheduleSensor._handle_refresh_signal`

Each entity registers its dispatcher unsubscribe callback with `async_on_remove`. `PricingDynamicRateSensor` also registers its Home Assistant state listener that way. The handlers then call `self.hass.async_create_task(...)` without retaining the returned task.

The integration unload path unloads platforms and stops the coordinator heartbeat, while Home Assistant removes the entities and invokes their `async_on_remove` callbacks. A queued refresh task is therefore the likely source of the existing warning if a dispatcher signal arrives just before removal or while the event loop is shutting down. There is no captured traceback in the repository or available logs that proves the exact warning text or phase.

## Decision

No `sensor.py` change was made. A task-management change is not safe to validate in the current environment because Home Assistant itself is not installed in the local test runtime and there is no unload/reload integration harness.

## Lifecycle reproduction status

An HA-backed reproduction cannot run in this checkout. `importlib.util.find_spec("homeassistant")` and `find_spec("pytest_homeassistant_custom_component")` both return no module, while `requirements_test.txt` declares `pytest-homeassistant-custom-component==0.13.364` and notes that this release requires Python 3.14+. The managed runtime is Python 3.12.14. Existing tests use narrow per-module fakes and are not a suitable substitute for HA entity lifecycle behavior.

The focused test should be added as `tests/test_sensor_lifecycle.py` in a compatible HA-backed environment. It should instantiate each affected sensor with a real or HA-test `HomeAssistant`, patch the store refresh coroutine so it remains pending, call `async_added_to_hass()`, emit the corresponding dispatcher signal, invoke entity removal/unload, drain the event loop, and assert that no refresh task remains pending and no `async_write_ha_state` call occurs after removal. The test should also assert listener cleanup and cover the state-listener path for `PricingDynamicRateSensor`.

Expected assertions:

- the signal schedules at most one refresh task;
- entity removal invokes task cleanup;
- a pending refresh is cancelled or safely ignored;
- no task is left pending after unload;
- no lifecycle warning is emitted.

Run it in the compatible environment with:

```text
python -m pip install -r requirements_test.txt
python -m pytest tests/test_sensor_lifecycle.py
python -m pytest
```

## Required refactor when HA lifecycle testing is available

1. Add a small shared helper for these three sensor classes that stores the task returned by `hass.async_create_task`.
2. Coalesce or cancel an already-pending refresh task rather than creating unbounded refreshes.
3. Register task cancellation with `async_on_remove` and clear the handle when the task finishes.
4. Guard the refresh completion before calling `async_write_ha_state` if the entity is no longer added to Home Assistant.
5. Add an HA-backed test that emits the dispatcher signal, unloads the entity/integration, and asserts the pending task is cancelled or completes without a lifecycle warning.

The change must preserve the existing schedule calculations and use Home Assistant's task API, not `asyncio.create_task`, so task ownership remains visible to HA.

## Validation in this task

- `sensor.py` remained unchanged.
- Python AST compilation passed.
- Full pytest passed: 195 passed, 7 skipped.
- Targeted tests passed: 52 passed.

## Remaining risk

The warning may recur during a real HA reload or shutdown until the managed-task refactor is implemented and validated with a Home Assistant lifecycle test.
