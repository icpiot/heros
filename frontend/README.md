# Home Energy Manager standalone frontend

This is the Vite/Lit development frontend for Home Energy Manager (HEM). It runs outside Home Assistant so UI layout and styling work can happen quickly with hot reload.

The Home Assistant integration under `custom_components/` is not required to run this frontend, and this frontend does not modify it.

## Install

```bash
npm install
```

## Start the development server

```bash
npm run dev
```

Vite starts the app at the local preview URL, normally `http://localhost:5173`, and opens a browser window. Code and style edits hot reload automatically.

## Visual layout editor

The Overview, Policy, Report, Battery, Solar, Forecast, History, Pricing, and Settings pages include a built-in visual editor. VisBug and browser DevTools are not required for normal card positioning.

1. Open the frontend and stay on `Overview`.
2. Click `Edit Layout`.
3. Drag a card by its visible `Drag` handle.
4. Resize cards with the visible edge/corner handles.
5. Click `Save Layout`.
6. Refresh the browser.
7. The saved layout should be restored.

While editing, the grid background, card outline, drag handle, and resize handles are visible. Outside edit mode, those editor affordances are hidden and the page behaves like a normal UI.

## Layout controls

- `Edit Layout` enables drag-and-resize editing.
- `Save Layout` persists the current Overview layout.
- `Cancel Changes` discards unsaved edits and restores the last saved layout.
- `Reset Layout` restores the source-defined default Overview layout as the current draft; click `Save Layout` if you want that reset to persist.

## Current persistence

Overview layout data is currently stored in browser `localStorage` using this versioned key:

```text
hem.frontend.layout.overview.v1
```

Pricing layout data uses its own key:

```text
hem.frontend.layout.pricing.v2
```

Battery layout data uses:

```text
hem.frontend.layout.battery.v2
```

Solar layout data uses:

```text
hem.frontend.layout.solar.v1
```

Forecast layout data uses:

```text
hem.frontend.layout.forecast.v1
```

History layout data uses:

```text
hem.frontend.layout.history.v1
```

Policy layout data uses:

```text
hem.frontend.layout.policy.v1
```

Report layout data uses:

```text
hem.frontend.layout.report.v1
```

Settings layout data uses:

```text
hem.frontend.layout.settings.v1
```

The default layout remains in source control at:

```text
src/layout/overviewLayout.js
```

Invalid or outdated saved layout data is ignored safely and the source-defined default layout is used instead.

## Future Home Assistant connection

The data boundary and layout persistence are deliberately separated:

- `src/services/hemDataProvider.js` currently returns mocked HEM state, and can later be replaced with Home Assistant entity/API data.
- `src/layout/LocalStorageLayoutRepository.js` currently stores layouts in `localStorage`.
- `src/layout/LayoutController.js` manages edit/save/cancel/reset state.
- `src/components/EditableGrid.js` owns the GridStack integration.

That means a future Home Assistant adapter can replace the localStorage repository with a JSON file, Home Assistant storage, or an integration backend API without rewriting the Overview card components.

## Folder structure

```text
frontend/
├── package.json
├── vite.config.js
├── index.html
├── src/
│   ├── main.js
│   ├── App.js
│   ├── components/
│   ├── data/
│   ├── layout/
│   ├── pages/
│   ├── services/
│   ├── assets/
│   └── styles/
```

## File guide

- `package.json` defines Vite scripts and frontend dependencies.
- `vite.config.js` configures the dev server and browser preview.
- `index.html` hosts the Lit app.
- `src/main.js` loads global styles, GridStack CSS, and the app shell.
- `src/App.js` routes between Overview and Pricing in the standalone frontend.
- `src/components/HemShell.js` provides the app frame and navigation.
- `src/components/HemCard.js` provides the shared card surface.
- `src/components/OverviewMetricCard.js` renders Overview card content.
- `src/components/EditableGrid.js` provides the reusable GridStack editable layout component.
- `src/components/LayoutToolbar.js` provides Edit, Save, Cancel, and Reset controls.
- `src/components/PricingGroupEditor.js` preserves the standalone pricing editor mock.
- `src/pages/OverviewPage.js` wires Overview cards to the layout editor.
- `src/pages/PricingPage.js` preserves the standalone pricing route.
- `src/layout/overviewLayout.js` defines stable Overview card IDs and the source default layout.
- `src/layout/LayoutController.js` manages draft, saved, cancel, and reset behaviour.
- `src/layout/LocalStorageLayoutRepository.js` stores and validates layouts through a replaceable persistence boundary.
- `src/data/mockHemState.js` contains initial mock battery, inverter, solar, home, and pricing data.
- `src/services/hemDataProvider.js` is the current mock data-provider boundary.
- `src/styles/base.css` contains shared global styling.
