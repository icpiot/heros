# HEROS test and QA follow-up

Updated 2026-09-29.

## Deployment state

- `.111` is running HEROS panel V926. The module URL uses cache query `v928`; the panel and Pricing page load successfully. A temporary group `TEMP_MOBILE_QA_DELETE_ME` and Buy record remain while the mobile verification cleanup awaits deletion confirmation.
- `.112` was upgraded through the authenticated Home Assistant Terminal ingress. It is running panel V926 with module cache query `v928` and stylesheet layout query `layout=7`. Pricing, Reports, and Policy load successfully; it remains connected to Bytewatt.
- `.112` was not changed in this follow-up. `.111` still has the temporary group/Buy record; no temporary Sell record persisted after the editor save attempt.

## Full pytest

Full collection now completes in the managed runtime. The fix was test isolation rather than a fake Home Assistant package: `test_provider_config.py` now skips cleanly when the HA config-entry API is unavailable, and two stale JavaScript harness assumptions were updated to match the current panel API. No runtime integration code was changed.

```text
195 passed, 7 skipped
```

The seven skips are optional/provider or Home Assistant-dependent tests. Installing the declared `pytest-asyncio` dependency enables the configured `asyncio_mode = auto` setting. A real Home Assistant-backed CI tier remains useful for exercising the complete integration API surface.

## Targeted tests

The supported local subset remains green:

```text
pytest tests/test_roi.py tests/test_panel_contract.py
52 passed
```

## Mobile verification

The Codex In-app Browser viewport capability was used to inspect the live `.111` page at `390 x 844` CSS pixels. The populated Buy card and Buy edit state were checked with the temporary data. Buy record Modify/Delete actions were visible, but the temporary group's Modify/Delete action column was clipped out by the live fixed-column group history layout. A CSS-only mobile override was prepared locally to stack that row and its actions. Deployment is blocked: SMB is unreachable/denied, while strict SSH reaches the expected `.111` fingerprint but the existing approved key is rejected for the previously approved accounts. The Sell editor accepted values but did not persist a Sell row after reload.

The detailed structured notes are in [MOBILE_QA_390X844.md](mobile-qa/MOBILE_QA_390X844.md). Physical iPhone/Safari verification was completed manually. Result: usable on iPhone/Safari. A few minor visual/UX tweaks were observed; no urgent blocker was found. Remaining iPhone/Safari items are optional polish, not release blockers.

### Reproducible mobile QA procedure

1. Open `.111` or `.112` in a browser with real device emulation set to an iPhone portrait viewport (390 x 844 CSS pixels), device pixel ratio 3, and touch enabled.
2. Repeat the nine-page checklist in [MOBILE_QA_390X844.md](mobile-qa/MOBILE_QA_390X844.md), adding Safari/device-specific observations.
3. On Pricing, check populated Buy/Sell cards and Modify/Delete actions when records are available. On Policy, check immediate controls and policy editors. On Reports, check selected-state contrast and chart hit targets. On Settings, check the theme preview and touch target sizing.

## `sensor.py` warning

`custom_components/heros/sensor.py` remains unchanged. Existing handlers call `hass.async_create_task` from dispatcher callbacks:

- `PricingDynamicRateSensor._handle_schedule_changed`
- `PricingScheduleSensor._handle_refresh_signal`
- `PolicyChargeScheduleSensor._handle_refresh_signal`

The calls are present in the pre-existing sensor history and were not introduced by the UI work. Listener cleanup is registered with `async_on_remove`, but the returned refresh tasks are not stored or cancelled. The likely race is a dispatcher refresh queued immediately before entity removal or integration unload; the task can then complete against an entity whose lifecycle has ended. No complete HA traceback was available, and the current Python 3.12 runtime has neither Home Assistant nor `pytest-homeassistant-custom-component` installed, so an HA-backed reproduction could not run. No fix was made. The exact test design and compatible-environment command are documented in `docs/followups/SENSOR_LIFECYCLE_FOLLOWUP.md`.

## Recommended next steps

1. Prepare the managed test runtime with `python -m pip install -r requirements_test.txt` (or install the compatible pinned dependencies in CI), then run `python -m pytest`.
2. Deploy and hard-refresh the local group-action CSS override on `.111`, then verify group and Buy actions again at 390x844 before deleting the temporary QA group.
3. Reproduce the Sell-save persistence failure with a supported temporary record path, then inspect its populated mobile card.
4. Reproduce the sensor warning with HA shutdown/unload logs and add a focused lifecycle test before changing task scheduling or cancellation behavior.
