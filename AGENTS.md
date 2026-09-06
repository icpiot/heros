# HEROS Development Guide

## Repository Scope

- Source of truth: `C:\Dev\repos\heros`
- Do not use the deleted `neovoltBattery_HomeAssistantPlugin` repo unless the user explicitly asks for it.
- Treat this repo as the only active codebase for all work in this session.
- The existing ByteWatt installation at `10.0.0.102` must remain untouched unless explicitly authorized.
- The new test instance is `10.0.0.111`, with config share `\\10.0.0.111\config`. Sync only when requested, after tests pass.

## Repository Layout

- `custom_components/heros/` - Home Assistant integration code
- `examples/www/` - panel and card assets served into Home Assistant
- `examples/panel/` - panel registration examples
- `scripts/` - repo/HA sync helpers
- `tests/` - unit tests

## Working Rules

- Keep changes inside this repo unless the user explicitly requests otherwise.
- Use `heros` for technical identifiers and HEROS for user-facing labels. Keep the system generic across energy providers.
- Do not reintroduce references to the deleted repo.
- If a file or script still contains stale legacy naming, update it to the current repo conventions.
- For longer Codex implementation runs, create a git checkpoint after roughly every 5 meaningful updates when the staged scope can be kept clean.
- When a change materially affects UI behavior, reporting/storage behavior, mappings, or workflow, update the relevant repo docs in the same run.
- Verify the explicitly authorized HA target before any sync. Do not infer a destination from a mapped drive.

## Panel Interaction Rules

- Panel pages receive frequent Home Assistant `hass` updates, so dropdowns that must stay open during selection should use the held custom selector pattern from the shared battery selector.
- Avoid native `<select>` controls for panel setup workflows when a background render can interrupt the click/release cycle.
- A held selector needs explicit open state, render-hold coverage in `_shouldHoldRender()`, delegated handlers for toggle/option/outside-click, and matching fallback-controller state.
- When a UI field name differs from stored mapping keys, translate it before saving so the selected value appears immediately after release.
- For setup screens that need broad mapping controls, keep the mapping card full-width on desktop and let the dropdown menu inherit that width instead of stacking it into a narrow shared column.
- Do not store setup mappings or override state in browser-only storage such as `localStorage` when the value is intended to persist as project/user configuration.
- Setup mappings, hero mapping overrides, and similar configuration choices must persist through HEROS backend config or another shared HA-backed store so they survive browser changes and are consistent across devices.
- Browser-local storage is still acceptable for lightweight UI preferences only, such as the active page, battery selector convenience, debug visibility, settings focus, or a remembered `entry_id` hint. Those keys must not become the source of truth for shared HEROS configuration.

## Validation

- Run the relevant tests before handing back changes.
- For panel JavaScript, check syntax with Node if available.
- For Home Assistant integration changes, validate the affected Python modules and any related tests.

## Documentation Notes

- Keep repo instructions current with the actual tree.
- When instructions conflict with code, the code and repo tree take priority.
- If you add any local-only operational notes for HA sync work, keep them under `.codex/` and out of git.
