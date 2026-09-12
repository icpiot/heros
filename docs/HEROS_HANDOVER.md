# HEROS rename handover

The project is **HEROS: Home Energy Reporting & Optimisation System**.
It is a generic system for multiple energy providers, not a provider-branded project.

## Repository and namespace

- GitHub: https://github.com/icpiot/heros
- The local working-copy location is environment-specific; use the repository
  root rather than a hard-coded machine path.
- Primary branch: `main`
- Integration package: `custom_components/heros`
- Integration and service domain: `heros`
- Frontend custom elements: `heros-*`
- Served assets: `/local/community/heros/`
- Report/storage paths and frontend preference keys use the new namespace.
- All imports, entity references, examples, deployment paths, and tests were updated together.
- This supersedes the earlier decision to retain compatibility identifiers.

## Installation boundaries

The existing ByteWatt installation is untouched. Do not sync or migrate it
without explicit authorization. Test-instance details belong in local operator
notes rather than this public repository document.

The renamed integration is intended for a fresh installation. It does not
automatically migrate existing config entries, entity registries, recorded
history, reports, browser preferences, dashboards, or automations. Any migration
of an existing installation is separate work requiring backups and validation.

## Provider inspection

ByteWatt remains the implemented provider. Config flow and runtime setup directly
instantiate its client; the coordinator, settings manager, and reporting depend
on ByteWatt behavior. A provider selector alone is not a complete abstraction.
Additional providers need separate adapters and capability-aware shared code.
The naming change did not originally add FoxESS. The current `main` branch now
contains an isolated read-only FoxESS V2 transport and setup-flow support; see
`docs/FOXESS_V2.md` for its scope, acceptance tests, operator-provided signer
asset, and live validation status. It is still not a replacement for the
ByteWatt provider's live entity, reporting, WebSocket, or control paths.

## Validation and publication

Validation is performed by the repository's GitHub Actions workflow. No HA
sync is included in repository changes, and live HA/browser behavior still
requires a hard refresh and supervised validation when runtime work is needed.

Continue work from the saved HEROS project at the new local path.

FoxESS will initially use its cloud API. Modbus is not installed yet.
