# HEROS narrow mobile QA

Updated 2026-09-28.

## Test setup

- Host: `http://10.0.0.111/heros`
- Browser: Codex In-app Browser
- Viewport: `390 x 844` CSS pixels
- Theme: Minimalist
- Build shown: V926
- All checks were performed against the live authenticated page with the viewport override enabled.

## Recheck status

**Mobile QA rechecked: original suspected defects not reproduced, with evidence.**

The pass was repeated after the report of overlapping, clipped, and hidden content. This second pass used both visual screenshots and an element-level DOM scan rather than relying only on page-level `scrollWidth`.

## Inspection results

| Page | Result | Notes |
| --- | --- | --- |
| Overview | Pass | Header and 5+4 navigation wrap cleanly; battery selector and overview cards fit the viewport. |
| Pricing | Pass | Finance and pricing sections stack vertically; date-effective group, Buy Rates, and Sell Rates empty states fit without horizontal scrolling. |
| Reports | Pass | Report catalog buttons wrap into readable groups; date selector, previous/next controls, period buttons, summary cards, and chart legend fit within the viewport. |
| Policy | Pass | Policy overview cards and the Battery Policy Editor stack vertically; controls remain inside the card width. |
| Battery | Pass | Battery control and value cards stack vertically with readable labels and values. |
| Solar | Pass | Solar control and generation values stack vertically without clipping. |
| History | Pass | Timeline summary cards stack vertically and remain readable. |
| Settings | Pass | Theme preset buttons and the theme preview fit; preview inputs, selected button, value cards, and action buttons remain readable. |
| Mapping | Pass | FoxESS setup and Forecast Wiring cards stack vertically without horizontal overflow. |

## Cross-page checks

- `document.documentElement.scrollWidth` stayed at `380` while `innerWidth` was `390` on each checked route.
- The only elements with `scrollHeight > clientHeight` were the expected document-level `html` and `body` scroll surfaces. No nested card, toolbar, editor, table, or report container had local overflow.
- No visible independent heading/control pairs overlapped in the scan. Nested text inside its owning control/card was excluded from the overlap result.
- No visible control had a bounding rectangle outside the viewport or a width/height below the usable-control threshold.
- No visible parent with `overflow: hidden` or `overflow: clip` was clipping a child outside its content bounds.
- No horizontal page overflow was observed.
- Navigation buttons wrapped into two rows without clipping.
- Reports period/date controls were visually inspected after selecting Power Diagram.
- Pricing Buy/Sell empty states were visible; no populated Buy record existed on `.111` during this pass.
- Browser console warnings/errors: none reported by the browser tooling.

No issue screenshots were saved because the focused recheck did not produce a reproducible defect image. The live screenshots used for inspection showed the full-width cards, wrapped controls, and readable labels at the requested viewport.

## Scope limitation

This verifies the responsive layout at the requested 390×844 viewport. It is not a physical iPhone or device-pixel-ratio/touch-emulation test. A later device-capable pass may still check Safari-specific rendering, touch hit targets, and device safe-area behavior.

No frontend fixes or deployment were required.
