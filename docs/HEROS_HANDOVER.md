# HEROS rename handover

The project is **HEROS: Home Energy Reporting & Optimisation System**.
It is a generic system for multiple energy providers, not a provider-branded project.

## Repository and namespace

- GitHub: https://github.com/icpiot/heros
- Local repository: `C:\Dev\repos\heros`.
- The local folder move is complete and verified. The saved HEROS project in
  Codex points to this path. Existing tasks may retain their original working
  directory, so use the explicit new path for commands.
- Working branch: `codex/heros`
- Integration package: `custom_components/heros`
- Integration and service domain: `heros`
- Frontend custom elements: `heros-*`
- Served assets: `/local/community/heros/`
- Report/storage paths and frontend preference keys use the new namespace.
- All imports, entity references, examples, deployment paths, and tests were updated together.
- This supersedes the earlier decision to retain compatibility identifiers.

## Installation boundaries

The existing ByteWatt installation at `10.0.0.102` is untouched. Do not sync or
migrate it without explicit authorization. The new test instance is `10.0.0.111`
with config share `\\10.0.0.111\config`.

The renamed integration is intended for a fresh installation. It does not
automatically migrate existing config entries, entity registries, recorded
history, reports, browser preferences, dashboards, or automations. Any migration
of an existing installation is separate work requiring backups and validation.

## Preventing a blank HEROS panel

On 2026-09-16 this failure recurred for the fifth time. The `/heros` route showed a blank page even though Home Assistant was running, HEROS entities were available, and the panel JavaScript returned HTTP 200. The cause was build drift: Home Assistant registered the custom element `heros-panel-626`, while the served JavaScript defined `heros-panel-627`. A successful asset request does not prove that Home Assistant can mount the custom element.

The following six values form one version contract and must always contain the same build number:

1. `PANEL_COMPONENT_NAME` in `custom_components/heros/__init__.py`
2. the `v=` query in `PANEL_MODULE_URL` in that same file
3. `HEROS_PANEL_BUILD` in `examples/www/heros-panel.js`
4. `examples/www/LATEST_BUILD.txt`
5. the `module_url` in `examples/panel/heros-panel_custom.yaml`
6. the panel module URL shown in `README.md`

Never bump only the JavaScript asset or only the integration registration. For an asset-only deployment, keep the currently registered build number. For a cache-busting deployment, update all six values together, deploy the integration and assets to both HEROS test instances, and restart both instances because the panel registration is created during Home Assistant startup.

Before handover, complete all of these checks:

- Run `node --check examples/www/heros-panel.js`.
- Run `pytest tests/test_panel_contract.py` so build drift fails locally.
- Confirm the deployed `custom_components/heros/__init__.py` and served `heros-panel.js` contain the same build.
- Query Home Assistant's WebSocket command `get_panels` on each target. For the `heros` entry, verify `_panel_custom.name` is `heros-panel-<build>` and `_panel_custom.module_url` ends in `heros-panel.js?v=<build>`.
- Fetch that exact module URL and verify its `HEROS_PANEL_BUILD` is the same `<build>`.
- Confirm HEROS entities are present after restart, then load `/heros` and visually verify the rendered panel. HTTP 200, entity availability, or a passing syntax check alone is insufficient.

If `/heros` is blank, check this version contract first. Do not repeatedly restart Home Assistant until the registered name, registered module URL, served JavaScript build, and build marker agree.

## Provider inspection

ByteWatt remains the implemented provider. Config flow and runtime setup directly
instantiate its client; the coordinator, settings manager, and reporting depend
on ByteWatt behavior. A provider selector alone is not a complete abstraction.
Additional providers need separate adapters and capability-aware shared code.
The naming change did not add FoxESS. Subsequent local work added an isolated
read-only V2 client and Python WASM signer; see `docs/FOXESS_V2.md` for the scope,
acceptance tests, operator-provided signer asset, and live validation status.
The subsequent V2 local regression suite passed 200 tests (31 V2 tests), with
the required real-WASM vector and two additional Node-reference vectors. This
V2 work is not pushed or synced; live credentials are still needed for the
read-only connection check. No setup UI, entity/reporting mapping, WebSocket,
or control implementation was added.

## Validation and publication

Baseline and final suite: 118 tests passed, 2 skipped. All served JavaScript
files pass `node --check`; Python compilation and the Vite production build pass.
Panel build is 484, policy 009, report loader 397/component 086, debug 036.
The user authorized publication of the rename branch. No HA sync is included.
Git history retains its historical names.
Live HA/browser behavior remains unverified; ask the user for a hard refresh
before continuing when runtime validation requires one.

Continue work from the saved HEROS project at the new local path.

FoxESS will initially use its cloud API. Modbus is not installed yet.

### Confirmed custom dropdown interaction pattern (v543)
Battery Selection and the Debug API Query picker use the same reliable HEROS dropdown pattern. Do not use a native `<select>` for panel controls that can receive Home Assistant updates while open.

- Render a button plus an in-card option menu, using the shared selector styles.
- Handle `pointerdown`, `mousedown`, and `click` on the shadow root in capture phase. Resolve the target through `event.composedPath()`, then call `preventDefault()` and `stopPropagation()`.
- Hold panel redraws while the menu is open so state updates cannot close it.
- When an option is chosen, save the selected value, close the menu, and perform the deliberate render.

This was confirmed live for both Battery Selection and Debug API Query. Apply the same pattern to every new HEROS dropdown.