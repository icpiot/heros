import { LitElement, css, html } from "lit";
import "../components/EditableGrid.js";
import "../components/HerosCard.js";
import { LayoutController } from "../layout/LayoutController.js";
import { LocalStorageLayoutRepository } from "../layout/LocalStorageLayoutRepository.js";
import {
  FORECAST_LAYOUT_STORAGE_KEY,
  FORECAST_LAYOUT_VERSION,
  forecastDefaultLayout,
} from "../layout/forecastLayout.js";

export class HerosForecastPage extends LitElement {
  static properties = {
    herosState: { type: Object },
    editingLayout: { type: Boolean },
    layout: { type: Array },
  };

  constructor() {
    super();
    this.editingLayout = false;
    this._handleLayoutAction = this._handleLayoutAction.bind(this);
    this.repository = new LocalStorageLayoutRepository({
      storageKey: FORECAST_LAYOUT_STORAGE_KEY,
      version: FORECAST_LAYOUT_VERSION,
      defaultLayout: forecastDefaultLayout,
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
    const forecast = this.herosState?.forecast ?? {};
    const cards = [
      { id: "forecast-summary", template: this._renderSummaryCard(forecast) },
      { id: "forecast-solar", template: this._renderSolarCard(forecast) },
      { id: "forecast-battery", template: this._renderBatteryCard(forecast) },
      { id: "forecast-load", template: this._renderLoadCard(forecast) },
      { id: "forecast-pricing", template: this._renderPricingCard(forecast) },
    ];

    return html`
      <section class="page-head">
        <p class="eyebrow">Forecast</p>
        <h2>Forecast workspace</h2>
        <p>Mapped forecast values from Forecast.Solar or another configured integration.</p>
      </section>

      <section class=${this.editingLayout ? "layout-toolbar editing" : "layout-toolbar"}>
        <div>
          <strong>${this.editingLayout ? "Forecast layout editing is active" : "Forecast layout"}</strong>
          <span>${this.editingLayout ? "Drag and resize cards, then save." : "Use Edit Layout to arrange forecast cards."}</span>
        </div>
        <nav aria-label="Forecast layout editor controls">
          ${this.editingLayout
            ? html`
                <button data-layout-action="save" type="button">Save Layout</button>
                <button class="secondary" data-layout-action="cancel" type="button">Cancel Changes</button>
                <button class="secondary" data-layout-action="reset" type="button">Reset Layout</button>
              `
            : html`<button data-layout-action="edit" type="button">Edit Layout</button>`}
        </nav>
      </section>

      <heros-editable-grid
        .items=${cards}
        .layout=${this.layout}
        .editing=${this.editingLayout}
        @layout-change=${this._layoutChanged}
      ></heros-editable-grid>
    `;
  }

  _renderSummaryCard(forecast) {
    const capture = forecast.capture ?? {};
    return html`
      <heros-card>
        <p class="card-label">Today outlook</p>
        <h3>${forecast.providerLabel || "No provider mapped"}</h3>
        <strong class="hero-value">${capture.todayKwh ?? "—"} kWh</strong>
        <p>${forecast.nextAction || "Map forecast entities in setup to unlock planning."}</p>
      </heros-card>
    `;
  }

  _renderSolarCard(forecast) {
    const capture = forecast.capture ?? {};
    return html`
      <heros-card>
        <p class="card-label">Solar forecast</p>
        <h3>Peak ${capture.nowKw ?? "—"} kW now</h3>
        ${this._bars([36, 61, 90, 82, 50, 18])}
      </heros-card>
    `;
  }

  _renderBatteryCard(forecast) {
    const capture = forecast.capture ?? {};
    return html`
      <heros-card>
        <p class="card-label">Battery forecast</p>
        <h3>Reserve at sunset</h3>
        <section class="mini-grid">
          <article><span>Today</span><strong>${capture.todayKwh ?? "—"} kWh</strong></article>
          <article><span>Tomorrow</span><strong>${capture.tomorrowKwh ?? "—"} kWh</strong></article>
          <article><span>Confidence</span><strong>${forecast.confidence || "Unknown"}</strong></article>
        </section>
      </heros-card>
    `;
  }

  _renderLoadCard(forecast) {
    const capture = forecast.capture ?? {};
    return html`
      <heros-card>
        <p class="card-label">Load forecast</p>
        <h3>Planning against demand</h3>
        <section class="mini-grid">
          <article><span>This hour</span><strong>${capture.thisHourKwh ?? "—"} kWh</strong></article>
          <article><span>Next hour</span><strong>${capture.nextHourKwh ?? "—"} kWh</strong></article>
          <article><span>Snapshot</span><strong>${forecast.snapshotAt || "—"}</strong></article>
        </section>
      </heros-card>
    `;
  }

  _renderPricingCard(forecast) {
    return html`
      <heros-card>
        <p class="card-label">Price window</p>
        <h3>${forecast.mapping?.today ? "Use mapped forecast with pricing" : "Waiting for forecast mapping"}</h3>
        <p>Charge when the cheapest window lines up with a predicted solar shortfall.</p>
      </heros-card>
    `;
  }

  _bars(values) {
    return html`<section class="spark-bars">${values.map((height) => html`<span style="height:${height}%"></span>`)}</section>`;
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
      border: 1px solid var(--heros-border);
      border-radius: 24px;
      box-shadow: var(--heros-shadow);
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
      box-shadow: 0 0 0 1px rgba(37, 255, 210, 0.14), var(--heros-shadow);
    }

    .eyebrow,
    .card-label,
    .mini-grid span {
      color: var(--heros-accent);
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
      color: var(--heros-muted);
    }

    .hero-value {
      display: block;
      font-size: clamp(2.4rem, 6vw, 4.8rem);
      line-height: 1;
      margin: 14px 0;
    }

    nav {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      justify-content: flex-end;
    }

    button {
      background: linear-gradient(135deg, var(--heros-accent), var(--heros-hot));
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
      color: var(--heros-text);
    }

    .mini-grid {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      margin-top: 16px;
    }

    .mini-grid article {
      background: rgba(6, 13, 26, 0.72);
      border: 1px solid rgba(0, 229, 255, 0.18);
      border-radius: 14px;
      padding: 12px;
    }

    .spark-bars {
      align-items: end;
      display: flex;
      gap: 10px;
      height: 130px;
      margin-top: 18px;
    }

    .spark-bars span {
      background: linear-gradient(180deg, var(--heros-accent-2), var(--heros-accent));
      border-radius: 999px 999px 4px 4px;
      flex: 1;
      min-width: 16px;
    }

    @media (max-width: 860px) {
      .layout-toolbar {
        align-items: stretch;
        flex-direction: column;
      }

      nav {
        justify-content: flex-start;
      }

      .mini-grid {
        grid-template-columns: 1fr;
      }
    }
  `;
}

customElements.define("heros-forecast-page", HerosForecastPage);
