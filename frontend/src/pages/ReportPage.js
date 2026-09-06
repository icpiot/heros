import { LitElement, css, html } from "lit";
import "../components/EditableGrid.js";
import "../components/HemCard.js";
import { LayoutController } from "../layout/LayoutController.js";
import { LocalStorageLayoutRepository } from "../layout/LocalStorageLayoutRepository.js";
import {
  REPORT_LAYOUT_STORAGE_KEY,
  REPORT_LAYOUT_VERSION,
  reportDefaultLayout,
} from "../layout/reportLayout.js";

export class HemReportPage extends LitElement {
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
      storageKey: REPORT_LAYOUT_STORAGE_KEY,
      version: REPORT_LAYOUT_VERSION,
      defaultLayout: reportDefaultLayout,
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
      { id: "report-summary", template: this._renderSummaryCard() },
      { id: "report-cost", template: this._renderCostCard() },
      { id: "report-solar", template: this._renderSolarCard() },
      { id: "report-battery", template: this._renderBatteryCard() },
      { id: "report-breakdown", template: this._renderBreakdownCard() },
    ];

    return html`
      <section class="page-head">
        <p class="eyebrow">Report</p>
        <h2>Report workspace</h2>
        <p>Mock reporting cards for visually composing the HEROS summary report.</p>
      </section>

      <section class=${this.editingLayout ? "layout-toolbar editing" : "layout-toolbar"}>
        <div>
          <strong>${this.editingLayout ? "Report layout editing is active" : "Report layout"}</strong>
          <span>${this.editingLayout ? "Drag and resize cards, then save." : "Use Edit Layout to arrange report cards."}</span>
        </div>
        <nav aria-label="Report layout editor controls">
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
    return html`<hem-card><p class="card-label">Monthly report</p><h3>July snapshot</h3><strong class="hero-value">74%</strong><p>Self-powered energy share</p></hem-card>`;
  }

  _renderCostCard() {
    return html`<hem-card><p class="card-label">Cost estimate</p><h3>Net bill forecast</h3><strong class="hero-value">$42</strong><p>Mock projection based on current pricing data.</p></hem-card>`;
  }

  _renderSolarCard() {
    const solar = this.hemState.solar;
    return html`<hem-card><p class="card-label">Solar contribution</p><h3>${solar.todayKwh} kWh today</h3>${this._bars([48, 62, 82, 74, 91, 68, 77])}</hem-card>`;
  }

  _renderBatteryCard() {
    const battery = this.hemState.battery;
    return html`
      <hem-card>
        <p class="card-label">Battery impact</p>
        <h3>${battery.selectedBattery}</h3>
        <section class="mini-grid">
          <article><span>Cycles</span><strong>31</strong></article>
          <article><span>Discharge</span><strong>86 kWh</strong></article>
          <article><span>Current</span><strong>${battery.soc}%</strong></article>
        </section>
      </hem-card>
    `;
  }

  _renderBreakdownCard() {
    return html`
      <hem-card>
        <p class="card-label">Energy breakdown</p>
        <h3>Usage sources</h3>
        <section class="rule-list">
          <article><strong>Solar direct</strong><span>42%</span></article>
          <article><strong>Battery</strong><span>32%</span></article>
          <article><strong>Grid import</strong><span>26%</span></article>
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
    .rule-list span {
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
    .rule-list article {
      background: rgba(6, 13, 26, 0.72);
      border: 1px solid rgba(0, 229, 255, 0.18);
      border-radius: 14px;
      padding: 12px;
    }

    .rule-list {
      display: grid;
      gap: 10px;
      margin-top: 16px;
    }

    .rule-list article {
      display: flex;
      gap: 12px;
      justify-content: space-between;
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

customElements.define("hem-report-page", HemReportPage);
