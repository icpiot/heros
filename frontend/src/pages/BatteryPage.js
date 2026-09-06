import { LitElement, css, html } from "lit";
import "../components/EditableGrid.js";
import "../components/HerosCard.js";
import { LayoutController } from "../layout/LayoutController.js";
import { LocalStorageLayoutRepository } from "../layout/LocalStorageLayoutRepository.js";
import {
  BATTERY_LAYOUT_STORAGE_KEY,
  BATTERY_LAYOUT_VERSION,
  batteryDefaultLayout,
} from "../layout/batteryLayout.js";

export class HerosBatteryPage extends LitElement {
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
      storageKey: BATTERY_LAYOUT_STORAGE_KEY,
      version: BATTERY_LAYOUT_VERSION,
      defaultLayout: batteryDefaultLayout,
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
      { id: "battery-summary", template: this._renderSummaryCard() },
      { id: "battery-flow", template: this._renderFlowCard() },
      { id: "battery-controls", template: this._renderControlsCard() },
      { id: "battery-mode-actions", template: this._renderModeActionsCard() },
      { id: "battery-forecast", template: this._renderForecastCard() },
      { id: "battery-health", template: this._renderHealthCard() },
    ];

    return html`
      <section class="page-head">
        <div>
          <p class="eyebrow">Battery</p>
          <h2>Battery workspace</h2>
          <p>Mocked battery controls and status cards for standalone layout design.</p>
        </div>
      </section>

      <section class=${this.editingLayout ? "layout-toolbar editing" : "layout-toolbar"}>
        <div>
          <strong>${this.editingLayout ? "Battery layout editing is active" : "Battery layout"}</strong>
          <span>
            ${this.editingLayout
              ? "Drag cards by the handle, resize with the visible grips, then save."
              : "Use Edit Layout to arrange battery cards visually."}
          </span>
        </div>
        <nav aria-label="Battery layout editor controls">
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
    const battery = this.herosState.battery;
    return html`
      <heros-card>
        <p class="card-label">Selected battery</p>
        <h3>${battery.selectedBattery}</h3>
        <strong class="hero-value">${battery.soc}%</strong>
        <p>${battery.mode}</p>
      </heros-card>
    `;
  }

  _renderFlowCard() {
    const battery = this.herosState.battery;
    return html`
      <heros-card>
        <p class="card-label">Battery flow</p>
        <h3>${battery.powerKw} kW</h3>
        <p>${battery.status}</p>
        <div class="bar"><span style="width: 73%"></span></div>
      </heros-card>
    `;
  }

  _renderControlsCard() {
    return html`
      <heros-card>
        <p class="card-label">Mode controls</p>
        <h3>Operating mode</h3>
        <p>Use the movable action card to place mode buttons anywhere in the layout.</p>
      </heros-card>
    `;
  }

  _renderModeActionsCard() {
    return html`
      <heros-card>
        <p class="card-label">Mode action buttons</p>
        <h3>Battery actions</h3>
        <div class="control-stack">
          <button type="button">Self-consumption</button>
          <button type="button">Charge reserve</button>
          <button type="button">Export priority</button>
        </div>
      </heros-card>
    `;
  }

  _renderForecastCard() {
    return html`
      <heros-card>
        <p class="card-label">Battery forecast</p>
        <h3>Evening reserve looks healthy</h3>
        <section class="mini-grid">
          <article><span>18:00</span><strong>68%</strong></article>
          <article><span>21:00</span><strong>51%</strong></article>
          <article><span>00:00</span><strong>39%</strong></article>
        </section>
      </heros-card>
    `;
  }

  _renderHealthCard() {
    return html`
      <heros-card>
        <p class="card-label">Battery health</p>
        <h3>Nominal</h3>
        <section class="mini-grid">
          <article><span>Temp</span><strong>31 °C</strong></article>
          <article><span>Cycles</span><strong>842</strong></article>
          <article><span>Reserve</span><strong>20%</strong></article>
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

    nav,
    .control-stack {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      justify-content: flex-end;
    }

    .control-stack {
      align-items: stretch;
      flex-direction: column;
      justify-content: flex-start;
      margin-top: 16px;
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

customElements.define("heros-battery-page", HerosBatteryPage);
