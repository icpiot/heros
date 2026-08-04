import { LitElement, css, html } from "lit";
import "../components/EditableGrid.js";
import "../components/HemCard.js";
import { LayoutController } from "../layout/LayoutController.js";
import { LocalStorageLayoutRepository } from "../layout/LocalStorageLayoutRepository.js";
import {
  FORECAST_SETUP_LAYOUT_STORAGE_KEY,
  FORECAST_SETUP_LAYOUT_VERSION,
  forecastSetupDefaultLayout,
} from "../layout/forecastSetupLayout.js";

export class HemForecastSetupPage extends LitElement {
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
      storageKey: FORECAST_SETUP_LAYOUT_STORAGE_KEY,
      version: FORECAST_SETUP_LAYOUT_VERSION,
      defaultLayout: forecastSetupDefaultLayout,
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
    const forecast = this.hemState?.forecast ?? {};
    const cards = [
      { id: "forecast-setup-summary", template: this._renderSummaryCard(forecast) },
      { id: "forecast-setup-providers", template: this._renderProvidersCard(forecast) },
      { id: "forecast-setup-mapping", template: this._renderMappingCard(forecast) },
      { id: "forecast-setup-data", template: this._renderDataCard(forecast) },
    ];

    return html`
      <section class="page-head">
        <p class="eyebrow">Forecast setup</p>
        <h2>Forecast mapping workspace</h2>
        <p>Choose a provider profile, map the required sensors, and keep Forecast tab values consistent.</p>
      </section>

      <section class=${this.editingLayout ? "layout-toolbar editing" : "layout-toolbar"}>
        <div>
          <strong>${this.editingLayout ? "Forecast setup editing is active" : "Forecast setup layout"}</strong>
          <span>${this.editingLayout ? "Drag and resize cards, then save." : "Use Edit Layout to arrange mapping cards."}</span>
        </div>
        <nav aria-label="Forecast setup layout editor controls">
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

  _renderSummaryCard(forecast) {
    return html`
      <hem-card>
        <p class="card-label">Selected provider</p>
        <h3>${forecast.providerLabel || "Not configured"}</h3>
        <strong class="hero-value">${forecast.status || "Waiting for a mapping"}</strong>
        <p>${forecast.nextAction || "Pick a provider profile and map its sensors to HEM fields."}</p>
      </hem-card>
    `;
  }

  _renderProvidersCard(forecast) {
    const providers = forecast.providers ?? [];
    return html`
      <hem-card>
        <p class="card-label">Popular mappings</p>
        <h3>Provider presets</h3>
        <section class="provider-list">
          ${providers.map((provider) => html`
            <article class=${provider.id === forecast.provider ? "provider active" : "provider"}>
              <div>
                <strong>${provider.label}</strong>
                <p>${provider.description}</p>
              </div>
              <span>${provider.strength}</span>
            </article>
          `)}
        </section>
      </hem-card>
    `;
  }

  _renderMappingCard(forecast) {
    const mapping = forecast.mapping ?? {};
    const labels = {
      today: "Forecast today",
      tomorrow: "Forecast tomorrow",
      thisHour: "This hour",
      nextHour: "Next hour",
      now: "Power now",
      peakToday: "Peak time today",
      peakTomorrow: "Peak time tomorrow",
    };
    return html`
      <hem-card>
        <p class="card-label">Entity mapping</p>
        <h3>What HEM reads</h3>
        <section class="rule-list">
          ${Object.entries(labels).map(([key, label]) => html`
            <article>
              <strong>${label}</strong>
              <span>${mapping[key] || "Not set"}</span>
            </article>
          `)}
        </section>
      </hem-card>
    `;
  }

  _renderDataCard(forecast) {
    const capture = forecast.capture ?? {};
    return html`
      <hem-card>
        <p class="card-label">Captured values</p>
        <h3>Forecast.Solar example</h3>
        <section class="rule-list">
          <article><strong>Today</strong><span>${capture.todayKwh ?? "—"} kWh</span></article>
          <article><strong>Tomorrow</strong><span>${capture.tomorrowKwh ?? "—"} kWh</span></article>
          <article><strong>This hour</strong><span>${capture.thisHourKwh ?? "—"} kWh</span></article>
          <article><strong>Next hour</strong><span>${capture.nextHourKwh ?? "—"} kWh</span></article>
          <article><strong>Power now</strong><span>${capture.nowKw ?? "—"} kW</span></article>
          <article><strong>Snapshot</strong><span>${forecast.snapshotAt || "Not recorded"}</span></article>
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
    .card-label,
    .rule-list span,
    .provider span {
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
    .layout-toolbar span {
      color: var(--hem-muted);
    }

    .hero-value {
      display: block;
      font-size: clamp(2.1rem, 5vw, 3.4rem);
      line-height: 1.1;
      margin: 14px 0;
    }

    nav {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      justify-content: flex-end;
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

    .rule-list,
    .provider-list {
      display: grid;
      gap: 10px;
      margin-top: 16px;
    }

    .rule-list article,
    .provider {
      background: rgba(6, 13, 26, 0.72);
      border: 1px solid rgba(0, 229, 255, 0.18);
      border-radius: 14px;
      display: flex;
      gap: 12px;
      justify-content: space-between;
      padding: 12px;
    }

    .provider {
      align-items: flex-start;
      flex-direction: column;
    }

    .provider.active {
      border-color: rgba(37, 255, 210, 0.72);
      box-shadow: 0 0 0 1px rgba(37, 255, 210, 0.12);
    }

    .provider strong {
      display: block;
      margin-bottom: 6px;
    }

    .provider p {
      margin: 0;
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

customElements.define("hem-forecast-setup-page", HemForecastSetupPage);
