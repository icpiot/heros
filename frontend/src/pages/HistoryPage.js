import { LitElement, css, html } from "lit";
import "../components/EditableGrid.js";
import "../components/HemCard.js";
import { LayoutController } from "../layout/LayoutController.js";
import { LocalStorageLayoutRepository } from "../layout/LocalStorageLayoutRepository.js";
import {
  HISTORY_LAYOUT_STORAGE_KEY,
  HISTORY_LAYOUT_VERSION,
  historyDefaultLayout,
} from "../layout/historyLayout.js";

export class HemHistoryPage extends LitElement {
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
      storageKey: HISTORY_LAYOUT_STORAGE_KEY,
      version: HISTORY_LAYOUT_VERSION,
      defaultLayout: historyDefaultLayout,
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
      { id: "history-summary", template: this._renderSummaryCard() },
      { id: "history-import-export", template: this._renderImportExportCard() },
      { id: "history-battery", template: this._renderBatteryCard() },
      { id: "history-solar-chart", template: this._renderSolarChartCard() },
      { id: "history-events", template: this._renderEventsCard() },
    ];

    return html`
      <section class="page-head">
        <p class="eyebrow">History</p>
        <h2>History workspace</h2>
        <p>Mock historical energy, battery, solar, and event cards for layout design.</p>
      </section>

      <section class=${this.editingLayout ? "layout-toolbar editing" : "layout-toolbar"}>
        <div>
          <strong>${this.editingLayout ? "History layout editing is active" : "History layout"}</strong>
          <span>${this.editingLayout ? "Drag and resize cards, then save." : "Use Edit Layout to arrange history cards."}</span>
        </div>
        <nav aria-label="History layout editor controls">
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
        <p class="card-label">Today total</p>
        <h3>Net energy</h3>
        <strong class="hero-value">-5.5 kWh</strong>
        <p>Export positive for the day</p>
      </hem-card>
    `;
  }

  _renderImportExportCard() {
    const home = this.hemState.home;
    return html`
      <hem-card>
        <p class="card-label">Import / export</p>
        <h3>Grid activity</h3>
        <section class="mini-grid">
          <article><span>Import</span><strong>${home.todayImportedKwh} kWh</strong></article>
          <article><span>Export</span><strong>${home.todayExportedKwh} kWh</strong></article>
          <article><span>Now</span><strong>${home.gridKw} kW</strong></article>
        </section>
      </hem-card>
    `;
  }

  _renderBatteryCard() {
    const battery = this.hemState.battery;
    return html`
      <hem-card>
        <p class="card-label">Battery history</p>
        <h3>${battery.selectedBattery}</h3>
        <section class="mini-grid">
          <article><span>Start</span><strong>42%</strong></article>
          <article><span>Peak</span><strong>91%</strong></article>
          <article><span>Now</span><strong>${battery.soc}%</strong></article>
        </section>
      </hem-card>
    `;
  }

  _renderSolarChartCard() {
    return html`
      <hem-card>
        <p class="card-label">Solar production</p>
        <h3>Last 7 days</h3>
        ${this._bars([45, 72, 58, 88, 64, 92, 76])}
      </hem-card>
    `;
  }

  _renderEventsCard() {
    return html`
      <hem-card>
        <p class="card-label">Events</p>
        <h3>Recent HEROS activity</h3>
        <section class="events">
          <article><strong>09:14</strong><span>Solar exceeded home load</span></article>
          <article><strong>12:22</strong><span>Battery charge limit reached</span></article>
          <article><strong>18:03</strong><span>Evening load started</span></article>
        </section>
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
    .layout-toolbar span,
    .events span {
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

    .mini-grid article,
    .events article {
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

    .events {
      display: grid;
      gap: 10px;
      margin-top: 16px;
    }

    .events article {
      display: grid;
      gap: 4px;
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

customElements.define("hem-history-page", HemHistoryPage);
