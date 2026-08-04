# Home Energy Manager Development Guide

## Repository Scope

- Source of truth: `C:\Dev\repos\home-energy-manager`
- Do not use the deleted `neovoltBattery_HomeAssistantPlugin` repo unless the user explicitly asks for it.
- Treat this repo as the only active codebase for all work in this session.
- The Home Assistant config mount for this workspace is `H:\`, which mirrors the live HA config tree used for sync work.

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

## Panel Interaction Rules

- Panel pages receive frequent Home Assistant `hass` updates, so dropdowns that must stay open during selection should use the held custom selector pattern from the shared battery selector.
- Avoid native `<select>` controls for panel setup workflows when a background render can interrupt the click/release cycle.
- A held selector needs explicit open state, render-hold coverage in `_shouldHoldRender()`, delegated handlers for toggle/option/outside-click, and matching fallback-controller state.
- When a UI field name differs from stored mapping keys, translate it before saving so the selected value appears immediately after release.

## Validation

- Run the relevant tests before handing back changes.
- For panel JavaScript, check syntax with Node if available.
- For Home Assistant integration changes, validate the affected Python modules and any related tests.

## Documentation Notes

- Keep repo instructions current with the actual tree.
- When instructions conflict with code, the code and repo tree take priority.
- If you add any local-only operational notes for HA sync work, keep them under `.codex/` and out of git.
