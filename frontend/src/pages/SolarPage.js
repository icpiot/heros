import { LitElement, css, html } from "lit";
import "../components/EditableGrid.js";
import "../components/HerosCard.js";
import { LayoutController } from "../layout/LayoutController.js";
import { LocalStorageLayoutRepository } from "../layout/LocalStorageLayoutRepository.js";
import {
  SOLAR_LAYOUT_STORAGE_KEY,
  SOLAR_LAYOUT_VERSION,
  solarDefaultLayout,
} from "../layout/solarLayout.js";

export class HerosSolarPage extends LitElement {
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
      storageKey: SOLAR_LAYOUT_STORAGE_KEY,
      version: SOLAR_LAYOUT_VERSION,
      defaultLayout: solarDefaultLayout,
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
      { id: "solar-summary", template: this._renderSummaryCard() },
      { id: "solar-forecast", template: this._renderForecastCard() },
      { id: "solar-export", template: this._renderExportCard() },
      { id: "solar-array", template: this._renderArrayCard() },
      { id: "solar-history", template: this._renderHistoryCard() },
    ];

    return html`
      <section class="page-head">
        <div>
          <p class="eyebrow">Solar</p>
          <h2>Solar workspace</h2>
          <p>Mock solar generation, forecast, export, and array cards for standalone layout design.</p>
        </div>
      </section>

      <section class=${this.editingLayout ? "layout-toolbar editing" : "layout-toolbar"}>
        <div>
          <strong>${this.editingLayout ? "Solar layout editing is active" : "Solar layout"}</strong>
          <span>
            ${this.editingLayout
              ? "Drag cards by the handle, resize with the visible grips, then save."
              : "Use Edit Layout to arrange solar cards visually."}
          </span>
        </div>
        <nav aria-label="Solar layout editor controls">
          ${this.editingLayout
            ? html`
                <button class="heros-button" data-layout-action="save" type="button">Save Layout</button>
                <button class="heros-button secondary" data-layout-action="cancel" type="button">Cancel Changes</button>
                <button class="heros-button secondary" data-layout-action="reset" type="button">Reset Layout</button>
              `
            : html`
                <button class="heros-button" data-layout-action="edit" type="button">Edit Layout</button>
              `}
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

  _renderSummaryCard() {
    const solar = this.herosState.solar;
    return html`
      <heros-card>
        <p class="card-label">Solar now</p>
        <h3>${solar.powerKw} kW</h3>
        <strong class="hero-value">${solar.todayKwh} kWh</strong>
        <p>Generated today</p>
      </heros-card>
    `;
  }

  _renderForecastCard() {
    const solar = this.herosState.solar;
    return html`
      <heros-card>
        <p class="card-label">Forecast</p>
        <h3>${solar.forecast}</h3>
        <section class="mini-grid">
          <article><span>12:00</span><strong>6.1 kW</strong></article>
          <article><span>15:00</span><strong>4.8 kW</strong></article>
          <article><span>18:00</span><strong>1.2 kW</strong></article>
        </section>
      </heros-card>
    `;
  }

  _renderExportCard() {
    const home = this.herosState.home;
    return html`
      <heros-card>
        <p class="card-label">Grid export</p>
        <h3>${home.gridKw} kW</h3>
        <p>${home.todayExportedKwh} kWh exported today</p>
        <div class="bar"><span style="width: 64%"></span></div>
      </heros-card>
    `;
  }

  _renderArrayCard() {
    return html`
      <heros-card>
        <p class="card-label">Array status</p>
        <h3>All strings online</h3>
        <section class="mini-grid">
          <article><span>North</span><strong>2.1 kW</strong></article>
          <article><span>West</span><strong>1.9 kW</strong></article>
          <article><span>East</span><strong>1.6 kW</strong></article>
        </section>
      </heros-card>
    `;
  }

  _renderHistoryCard() {
    return html`
      <heros-card>
        <p class="card-label">Production history</p>
        <h3>7 day average: 19.8 kWh</h3>
        <section class="spark-bars" aria-label="Mock solar production history">
          ${[45, 72, 58, 88, 64, 92, 76].map((height) => html`<span style="height:${height}%"></span>`)}
        </section>
      </heros-card>
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

    p {
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

    button,
    .heros-button {
      background: linear-gradient(135deg, var(--heros-accent), var(--heros-hot));
      border: 0;
      border-radius: 999px;
      color: #06111f;
      cursor: pointer;
      font: inherit;
      font-weight: 900;
      padding: 12px 16px;
    }

    .heros-button.secondary {
      background: rgba(11, 25, 42, 0.86);
      color: var(--heros-text);
    }

    .bar {
      background: rgba(255, 255, 255, 0.08);
      border-radius: 999px;
      height: 14px;
      margin-top: 18px;
      overflow: hidden;
    }

    .bar span {
      background: linear-gradient(90deg, var(--heros-accent), var(--heros-accent-2));
      display: block;
      height: 100%;
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

    .mini-grid strong {
      display: block;
      margin-top: 4px;
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

customElements.define("heros-solar-page", HerosSolarPage);
