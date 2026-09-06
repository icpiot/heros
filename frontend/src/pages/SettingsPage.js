import { LitElement, css, html } from "lit";
import "../components/EditableGrid.js";
import "../components/HemCard.js";
import { LayoutController } from "../layout/LayoutController.js";
import { LocalStorageLayoutRepository } from "../layout/LocalStorageLayoutRepository.js";
import {
  SETTINGS_LAYOUT_STORAGE_KEY,
  SETTINGS_LAYOUT_VERSION,
  settingsDefaultLayout,
} from "../layout/settingsLayout.js";

export class HemSettingsPage extends LitElement {
  static properties = {
    hemState: { type: Object },
    editingLayout: { type: Boolean },
    layout: { type: Array },
  };

  constructor() {
    super();
    this.editingLayout = false;
    this._handleLayoutAction = this._handleLayoutAction.bind(this);
    this.repository = new LocalStorageLayoutRepository({
      storageKey: SETTINGS_LAYOUT_STORAGE_KEY,
      version: SETTINGS_LAYOUT_VERSION,
      defaultLayout: settingsDefaultLayout,
    });
    this.layoutController = new LayoutController(this.repository);
    this.layout = this.layoutController.layout;
  }

  firstUpdated() {
    this.renderRoot.addEventListener("click", this._handleLayoutAction);
    this.renderRoot.addEventListener("pointerup", this._handleLayoutAction);
    this.renderRoot.addEventListener("keydown", this._handleLayoutAction);
  }

  render() {
    const cards = [
      { id: "settings-connection", template: this._renderConnectionCard() },
      { id: "settings-forecast", template: this._renderForecastCard() },
      { id: "settings-theme", template: this._renderThemeCard() },
      { id: "settings-data", template: this._renderDataCard() },
      { id: "settings-entities", template: this._renderEntitiesCard() },
      { id: "settings-debug", template: this._renderDebugCard() },
    ];

    return html`
      <section class="page-head">
        <p class="eyebrow">Settings</p>
        <h2>Settings workspace</h2>
        <p>Mock settings, entity mapping, theme, and diagnostics cards for standalone layout design.</p>
      </section>

      <section class=${this.editingLayout ? "layout-toolbar editing" : "layout-toolbar"}>
        <div>
          <strong>${this.editingLayout ? "Settings layout editing is active" : "Settings layout"}</strong>
          <span>${this.editingLayout ? "Drag and resize cards, then save." : "Use Edit Layout to arrange settings cards."}</span>
        </div>
        <nav aria-label="Settings layout editor controls">
          ${this.editingLayout
            ? html`
                <button data-layout-action="save" type="button">Save Layout</button>
                <button class="secondary" data-layout-action="cancel" type="button">Cancel Changes</button>
                <button class="secondary" data-layout-action="reset" type="button">Reset Layout</button>
              `
            : html`<button data-layout-action="edit" type="button">Edit Layout</button>`}
        </nav>
      </section>

      <hem-editable-grid
        .items=${cards}
        .layout=${this.layout}
        .editing=${this.editingLayout}
        @layout-change=${this._layoutChanged}
      ></hem-editable-grid>
    `;
  }

  _renderConnectionCard() {
    return html`
      <hem-card>
        <p class="card-label">Connection</p>
        <h3>HEROS</h3>
        <section class="rule-list">
          <article><strong>Status</strong><span>Connected</span></article>
          <article><strong>Source</strong><span>Mock provider</span></article>
        </section>
      </hem-card>
    `;
  }

  _renderThemeCard() {
    return html`
      <hem-card>
        <p class="card-label">Theme</p>
        <h3>Theme selection</h3>
        <div class="pill-row">
          <button type="button">Dark</button>
          <button type="button">Neon</button>
          <button type="button">Classic</button>
        </div>
        <p>Theme controls live on Settings in the standalone app.</p>
      </hem-card>
    `;
  }

  _renderForecastCard() {
    const forecast = this.hemState?.forecast ?? {};
    const providerCount = forecast.providers?.length ?? 0;
    return html`
      <hem-card>
        <p class="card-label">Forecast</p>
        <h3>Mapping setup</h3>
        <section class="rule-list">
          <article><strong>Provider</strong><span>${forecast.providerLabel || "Not set"}</span></article>
          <article><strong>Profiles</strong><span>${providerCount} popular mappings</span></article>
          <article><strong>Snapshot</strong><span>${forecast.snapshotAt || "Not recorded"}</span></article>
        </section>
        <p>Use the Forecast page to map entities from Forecast.Solar, Solcast, or template sensors.</p>
      </hem-card>
    `;
  }

  _renderDataCard() {
    return html`
      <hem-card>
        <p class="card-label">Data</p>
        <h3>Mock data provider</h3>
        <strong class="hero-value">Local</strong>
        <p>Ready to swap for Home Assistant entities later.</p>
      </hem-card>
    `;
  }

  _renderEntitiesCard() {
    return html`
      <hem-card>
        <p class="card-label">Entity mapping</p>
        <h3>Primary devices</h3>
        <section class="rule-list">
          <article><strong>Battery</strong><span>${this.hemState.battery.selectedBattery}</span></article>
          <article><strong>Inverter</strong><span>${this.hemState.inverter.status}</span></article>
          <article><strong>Solar</strong><span>${this.hemState.solar.powerKw} kW</span></article>
        </section>
      </hem-card>
    `;
  }

  _renderDebugCard() {
    return html`
      <hem-card>
        <p class="card-label">Diagnostics</p>
        <h3>Frontend runtime</h3>
        <section class="rule-list">
          <article><strong>Mode</strong><span>Standalone Vite</span></article>
          <article><strong>Persistence</strong><span>localStorage</span></article>
          <article><strong>Layout key</strong><span>settings.v1</span></article>
        </section>
      </hem-card>
    `;
  }

  _handleLayoutAction(event) {
    if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
    const path = event.composedPath?.() ?? [];
    const button = path.find((item) => item?.dataset?.layoutAction)
      ?? event.target.closest?.("[data-layout-action]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const action = button.dataset.layoutAction;
    if (action === "edit") this._editLayout();
    if (action === "save") this._saveLayout();
    if (action === "cancel") this._cancelChanges();
    if (action === "reset") this._resetLayout();
  }

  _editLayout() {
    this.layout = this.layoutController.beginEdit();
    this.editingLayout = true;
  }

  _layoutChanged(event) {
    if (!this.editingLayout) return;
    this.layout = this.layoutController.updateDraft(event.detail.layout);
  }

  _saveLayout() {
    this.layout = this.layoutController.save();
    this.editingLayout = false;
  }

  _cancelChanges() {
    this.layout = this.layoutController.cancel();
    this.editingLayout = false;
  }

  _resetLayout() {
    this.layout = this.layoutController.resetToDefaultDraft();
    this.editingLayout = true;
  }

  static styles = css`
    .page-head,
    .layout-toolbar {
      background: rgba(8, 18, 31, 0.9);
      border: 1px solid var(--hem-border);
      border-radius: 24px;
      box-shadow: var(--hem-shadow);
      margin-bottom: 16px;
      padding: 22px;
    }

    .layout-toolbar {
      align-items: center;
      border-radius: 20px;
      display: flex;
      gap: 16px;
      justify-content: space-between;
      padding: 16px;
    }

    .layout-toolbar.editing {
      border-color: rgba(37, 255, 210, 0.75);
      box-shadow: 0 0 0 1px rgba(37, 255, 210, 0.14), var(--hem-shadow);
    }

    .eyebrow,
    .card-label {
      color: var(--hem-accent);
      font-size: 0.72rem;
      font-weight: 900;
      letter-spacing: 0.14em;
      margin: 0 0 6px;
      text-transform: uppercase;
    }

    h2,
    h3,
    p {
      margin: 0;
    }

    h2 {
      font-size: clamp(1.8rem, 3vw, 2.6rem);
    }

    h3 {
      font-size: 1.35rem;
    }

    p,
    .layout-toolbar span,
    .rule-list span {
      color: var(--hem-muted);
    }

    .hero-value {
      display: block;
      font-size: clamp(2.4rem, 6vw, 4.8rem);
      line-height: 1;
      margin: 14px 0;
    }

    nav,
    .pill-row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      justify-content: flex-end;
    }

    .pill-row {
      justify-content: flex-start;
      margin: 16px 0;
    }

    button {
      background: linear-gradient(135deg, var(--hem-accent), var(--hem-hot));
      border: 0;
      border-radius: 999px;
      color: #06111f;
      cursor: pointer;
      font: inherit;
      font-weight: 900;
      padding: 12px 16px;
    }

    button.secondary {
      background: rgba(11, 25, 42, 0.86);
      color: var(--hem-text);
    }

    .rule-list {
      display: grid;
      gap: 10px;
      margin-top: 16px;
    }

    .rule-list article {
      background: rgba(6, 13, 26, 0.72);
      border: 1px solid rgba(0, 229, 255, 0.18);
      border-radius: 14px;
      display: flex;
      gap: 12px;
      justify-content: space-between;
      padding: 12px;
    }

    @media (max-width: 860px) {
      .layout-toolbar {
        align-items: stretch;
        flex-direction: column;
      }

      nav {
        justify-content: flex-start;
      }
    }
  `;
}

customElements.define("hem-settings-page", HemSettingsPage);
