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
