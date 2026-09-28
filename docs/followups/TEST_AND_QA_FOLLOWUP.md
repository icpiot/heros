# HEROS test and QA follow-up

Updated 2026-09-28.

## Deployment state

- `.111` is running HEROS panel V926. The module URL uses cache query `v928`; the panel and Pricing page load successfully and the temporary Buy verification record has been removed.
- `.112` was upgraded through the authenticated Home Assistant Terminal ingress. It is running panel V926 with module cache query `v928` and stylesheet layout query `layout=7`. Pricing, Reports, and Policy load successfully; it remains connected to Bytewatt.
- Both hosts show empty Buy and Sell sections after verification. No temporary records remain.

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

The Codex In-app Browser viewport capability was used to inspect the live `.111` page at `390 x 844` CSS pixels. After a report of overlapping, clipped, and hidden content, all nine HEROS pages were rechecked visually and with an element-level DOM scan. The original suspected defects were not reproduced: no local card/container overflow, clipped controls, out-of-viewport controls, or independent heading/control overlaps were found. Pricing Buy/Sell states, Policy editor stacking, Reports catalog/date/period controls, and the Settings theme preview were inspected in their deeper page sections.

The detailed structured notes are in [MOBILE_QA_390X844.md](mobile-qa/MOBILE_QA_390X844.md). This is a real narrow viewport check, but it is not a physical iPhone or device-pixel-ratio/touch-emulation test. Safari-specific rendering, touch hit targets, and safe-area behavior remain suitable for a later device-capable pass.

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
2. Use a browser or device tool with 390x844 viewport emulation to capture all requested page screenshots and check overflow, controls, cards, date inputs, and theme previews.
3. Reproduce the sensor warning with HA shutdown/unload logs and add a focused lifecycle test before changing task scheduling or cancellation behavior.
