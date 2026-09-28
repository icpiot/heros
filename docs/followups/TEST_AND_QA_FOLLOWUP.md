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

The available browser automation exposes tab navigation, DOM inspection, screenshots, and clicks, but no viewport/device emulation API. `playwright.setViewportSize` is not available. A true iPhone portrait screenshot could not be captured in this environment, so no full iPhone claim is made.

The CSS contains responsive rules for narrow selectors, stacked policy/pricing editors, wrapped report controls, and compact Buy/Sell cards. A later manual or device-capable browser pass should inspect all nine pages at 390x844 and record screenshots.

### Reproducible mobile QA procedure

1. Open `.111` or `.112` in a browser with real device emulation set to an iPhone portrait viewport (390 x 844 CSS pixels), device pixel ratio 3, and touch enabled.
2. Visit Overview, Policy, Reports, Battery, Solar, History, Pricing, Settings, and Mapping. Capture one full-page screenshot per page.
3. On every page, check that the document has no horizontal overflow, navigation and buttons are not clipped, text remains readable, and cards stack within the viewport.
4. On Pricing, check the group editor, date inputs, Buy cards, Sell cards, and Modify/Delete actions. On Policy, check immediate controls and policy editors. On Reports, check catalog wrapping, period/date controls, selected-state contrast, and chart bounds. On Settings, check the theme preview. Record any issue with page, viewport, screenshot, and selector/component.

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
