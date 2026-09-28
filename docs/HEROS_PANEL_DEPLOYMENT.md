# HEROS panel deployment and recovery procedure

## Failure pattern

A HEROS or HACS page can show a blank screen even when Home Assistant is healthy and `/heros` returns HTTP 200. This happens when the in-app browser keeps a failed custom-panel module in its cache, or when a panel asset is changed while the host is still restarting.

## Required release steps

1. Make the code change.
2. Run `node --check examples/www/heros-panel.js`.
3. Run the relevant tests, at minimum `tests/test_roi.py` and `tests/test_panel_contract.py`.
4. Bump the panel build number in all release markers:
   - `examples/www/heros-panel.js`
   - `custom_components/heros/__init__.py`
   - `examples/www/LATEST_BUILD.txt`
   - `README.md`
   - `examples/panel/heros-panel_custom.yaml`
5. Copy the matched backend and panel assets to both `.111` and `.112`.
6. Restart Home Assistant only when backend files changed. Do not report completion while restart requests are still pending.
7. Verify both hosts:
   - `/api/config` responds with a valid HA version using the token.
   - `/heros` returns HTTP 200.
   - `/local/community/heros/LATEST_BUILD.txt` reports the new build.
   - The served panel JavaScript contains the new feature.
8. Open the live page in a fresh browser tab and perform one Ctrl+F5 hard refresh. This browser verification is required before calling the release complete.

## Blank-page recovery

1. Confirm `/api/config`, `/heros`, and HACS return HTTP 200. If they do not, wait for HA startup or fix HA first.
2. Do not repeatedly restart a healthy host.
3. Bump the panel module cache-buster to a new build number and deploy the panel plus `__init__.py` together.
4. Close the existing HEROS tab, open a fresh tab using the live URL, and hard refresh once.
5. If the page is still blank, inspect the browser console and roll back the last panel JavaScript change as a matched JS/CSS pair before making another UI edit.

A successful file copy or HTTP 200 response is not sufficient evidence that the panel works. The release is complete only after the fresh-tab browser check succeeds.
