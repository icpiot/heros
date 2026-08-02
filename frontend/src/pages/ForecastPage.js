import { LitElement, css, html } from "lit";
import "../components/EditableGrid.js";
import "../components/HemCard.js";
import { LayoutController } from "../layout/LayoutController.js";
import { LocalStorageLayoutRepository } from "../layout/LocalStorageLayoutRepository.js";
import {
  FORECAST_LAYOUT_STORAGE_KEY,
  FORECAST_LAYOUT_VERSION,
  forecastDefaultLayout,
} from "../layout/forecastLayout.js";

export class HemForecastPage extends LitElement {
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
    const cards = [
      { id: "forecast-summary", template: this._renderSummaryCard() },
      { id: "forecast-solar", template: this._renderSolarCard() },
      { id: "forecast-battery", template: this._renderBatteryCard() },
      { id: "forecast-load", template: this._renderLoadCard() },
      { id: "forecast-pricing", template: this._renderPricingCard() },
    ];

    return html`
      <section class="page-head">
        <p class="eyebrow">Forecast</p>
        <h2>Forecast workspace</h2>
        <p>Mock forward-looking solar, battery, load, and price cards for layout design.</p>
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

      <hem-editable-grid
        .items=${cards}
        .layout=${this.layout}
        .editing=${this.editingLayout}
        @layout-change=${this._layoutChanged}
      ></hem-editable-grid>
    `;
  }

  _renderSummaryCard() {
    return html`
      <hem-card>
        <p class="card-label">Today outlook</p>
        <h3>Clear afternoon</h3>
        <strong class="hero-value">8.4 kWh</strong>
        <p>Expected surplus after house load</p>
      </hem-card>
    `;
  }

  _renderSolarCard() {
    return html`
      <hem-card>
        <p class="card-label">Solar forecast</p>
        <h3>Peak 6.1 kW</h3>
        ${this._bars([35, 65, 92, 78, 48, 16])}
      </hem-card>
    `;
  }

  _renderBatteryCard() {
    return html`
      <hem-card>
        <p class="card-label">Battery forecast</p>
        <h3>Reserve at sunset</h3>
        <section class="mini-grid">
          <article><span>18:00</span><strong>68%</strong></article>
          <article><span>21:00</span><strong>51%</strong></article>
          <article><span>00:00</span><strong>39%</strong></article>
        </section>
      </hem-card>
    `;
  }

  _renderLoadCard() {
    return html`
      <hem-card>
        <p class="card-label">Load forecast</p>
        <h3>Evening load expected</h3>
        <section class="mini-grid">
          <article><span>Base</span><strong>0.8 kW</strong></article>
          <article><span>Peak</span><strong>3.2 kW</strong></article>
          <article><span>Total</span><strong>12.6 kWh</strong></article>
        </section>
      </hem-card>
    `;
  }

  _renderPricingCard() {
    return html`
      <hem-card>
        <p class="card-label">Price window</p>
        <h3>Export before 16:00</h3>
        <p>Mock recommendation: keep battery reserve above 35% before the evening period.</p>
      </hem-card>
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
    .mini-grid span {
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
      background: linear-gradient(180deg, var(--hem-accent-2), var(--hem-accent));
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

customElements.define("hem-forecast-page", HemForecastPage);
