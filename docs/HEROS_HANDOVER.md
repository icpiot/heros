# HEROS rename handover

The project is **HEROS: Home Energy Reporting & Optimisation System**.
It is a generic system for multiple energy providers, not a provider-branded project.

## Repository and namespace

- GitHub: https://github.com/icpiot/heros
- Intended local repository: `C:\Dev\repos\heros`.
- Local folder move is pending: Windows rejected it because another process has
  the repository open. Close the project and terminals using it, rename the
  folder to `heros`, then reopen it. The current task still uses the original
  local directory until that move succeeds.
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
No FoxESS implementation was added during this naming change.

## Validation and publication

Baseline and final suite: 118 tests passed, 2 skipped. All served JavaScript
files pass `node --check`; Python compilation and the Vite production build pass.
Panel build is 484, policy 009, report loader 397/component 086, debug 036.
No HA sync or code push is included. Renaming the GitHub repository does not
publish this branch. Git history retains its historical names.
Live HA/browser behavior remains unverified; ask the user for a hard refresh
before continuing when runtime validation requires one.

After completing the pending folder move, reopen Codex from the new local path. Existing tasks may retain
their old working directory and need to be continued from the renamed project.
