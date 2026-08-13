# Home Energy Manager Development Guide

## Repository Scope

- Source of truth: `C:\Dev\repos\home-energy-manager`
- Do not use the deleted `neovoltBattery_HomeAssistantPlugin` repo unless the user explicitly asks for it.
- Treat this repo as the only active codebase for all work in this session.
- Prefer the direct Home Assistant config share `\\10.0.0.102\config\` for Codex sync work.
- `H:\` may exist as a mapped mirror of the live HA config tree, but do not depend on it being available in the current agent session.

## Repository Layout

- `custom_components/home_energy_manager/` - Home Assistant integration code
- `examples/www/` - panel and card assets served into Home Assistant
- `examples/panel/` - panel registration examples
- `scripts/` - repo/HA sync helpers
- `tests/` - unit tests

## Working Rules

- Keep changes inside this repo unless the user explicitly requests otherwise.
- Prefer `home_energy_manager` naming in code, docs, UI labels, and service names.
- Do not reintroduce references to the deleted repo.
- If a file or script still contains stale legacy naming, update it to the current repo conventions.
- For longer Codex implementation runs, create a git checkpoint after roughly every 5 meaningful updates when the staged scope can be kept clean.
- When a change materially affects UI behavior, reporting/storage behavior, mappings, or workflow, update the relevant repo docs in the same run.
- For live HA sync work, prefer copying to `\\10.0.0.102\config\...` directly. Use `H:\` only when it is confirmed available and there is a reason to prefer it.

## Panel Interaction Rules

- Panel pages receive frequent Home Assistant `hass` updates, so dropdowns that must stay open during selection should use the held custom selector pattern from the shared battery selector.
- Avoid native `<select>` controls for panel setup workflows when a background render can interrupt the click/release cycle.
- A held selector needs explicit open state, render-hold coverage in `_shouldHoldRender()`, delegated handlers for toggle/option/outside-click, and matching fallback-controller state.
- When a UI field name differs from stored mapping keys, translate it before saving so the selected value appears immediately after release.
- For setup screens that need broad mapping controls, keep the mapping card full-width on desktop and let the dropdown menu inherit that width instead of stacking it into a narrow shared column.
- Do not store setup mappings or override state in browser-only storage such as `localStorage` when the value is intended to persist as project/user configuration.
- Setup mappings, hero mapping overrides, and similar configuration choices must persist through Home Energy Manager backend config or another shared HA-backed store so they survive browser changes and are consistent across devices.
- Browser-local storage is still acceptable for lightweight UI preferences only, such as the active page, battery selector convenience, debug visibility, settings focus, or a remembered `entry_id` hint. Those keys must not become the source of truth for shared HEM configuration.

## Validation

- Run the relevant tests before handing back changes.
- For panel JavaScript, check syntax with Node if available.
- For Home Assistant integration changes, validate the affected Python modules and any related tests.

## Documentation Notes

- Keep repo instructions current with the actual tree.
- When instructions conflict with code, the code and repo tree take priority.
- If you add any local-only operational notes for HA sync work, keep them under `.codex/` and out of git.
