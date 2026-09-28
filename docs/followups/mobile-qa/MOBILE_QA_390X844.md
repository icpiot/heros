# HEROS narrow mobile QA

Updated 2026-09-29.

## Test setup

- Host: `http://10.0.0.111/heros`
- Browser: Codex In-app Browser
- Viewport: `390 x 844` CSS pixels
- Theme: Minimalist
- Build shown: V926 (live CSS fix not yet deployed)
- All checks were performed against the live authenticated page with the viewport override enabled.

## Recheck status

**Mobile QA recheck: a real Pricing group action defect was reproduced and documented.**

The pass was repeated after the report of overlapping, clipped, and hidden content. This second pass used both visual screenshots and an element-level DOM scan rather than relying only on page-level `scrollWidth`.

## Inspection results

| Page | Result | Notes |
| --- | --- | --- |
| Overview | Pass | Header and 5+4 navigation wrap cleanly; battery selector and overview cards fit the viewport. |
| Pricing | Partial | A populated Buy card and Buy edit state were inspected. Buy Modify/Delete are visible. The group history row's Modify/Delete actions were clipped out by the mobile fixed-column layout; a local CSS override was prepared but could not be deployed in this pass. The Sell editor accepted values but did not persist a Sell row after reload. |
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
- A temporary populated Buy record was visible on `.111`; its card and edit-state Modify/Delete actions were visible at 390 x 844.
- The temporary group's own Modify/Delete actions were not visible in the live mobile card because its fixed grid columns pushed the action column outside the card.
- The Sell editor accepted temporary values, but no Sell row persisted after save/reload, so populated Sell layout remains unverified.
- Browser console warnings/errors: none reported by the browser tooling.

The live screenshots used for inspection showed the populated Buy card/edit state and the clipped group action state. The browser screenshot bytes were inspected in-session; no persistent PNG artifact was created.

## Scope limitation

This verifies the responsive layout at the requested 390×844 viewport. It is not a physical iPhone or device-pixel-ratio/touch-emulation test. A later device-capable pass may still check Safari-specific rendering, touch hit targets, and device safe-area behavior.

A CSS-only mobile override was prepared in `examples/www/heros-panel.css` to stack the group row and its actions. Deployment to `.111` remains blocked: SMB is unreachable/denied, and strict SSH reaches the expected host fingerprint (`SHA256:XNZCsKEJPJ8HZi4WOLgrVASg7wQ8idZcyo3D5ty4rWA`) but the existing approved key is rejected for the previously approved accounts. The HMAC transport issue was isolated with `hmac-sha2-256-etm@openssh.com`; no account accepted the key. The live fix has not been verified.
