import { LitElement, css, html } from "lit";
import "../components/EditableGrid.js";
import "../components/HerosCard.js";
import { LayoutController } from "../layout/LayoutController.js";
import { LocalStorageLayoutRepository } from "../layout/LocalStorageLayoutRepository.js";
import {
  POLICY_LAYOUT_STORAGE_KEY,
  POLICY_LAYOUT_VERSION,
  policyDefaultLayout,
} from "../layout/policyLayout.js";

export class HerosPolicyPage extends LitElement {
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
      storageKey: POLICY_LAYOUT_STORAGE_KEY,
      version: POLICY_LAYOUT_VERSION,
      defaultLayout: policyDefaultLayout,
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
      { id: "policy-summary", template: this._renderSummaryCard() },
      { id: "policy-import", template: this._renderImportPolicyCard() },
      { id: "policy-export", template: this._renderExportPolicyCard() },
      { id: "policy-battery", template: this._renderBatteryPolicyCard() },
      { id: "policy-automation", template: this._renderAutomationCard() },
    ];

    return html`
      <section class="page-head">
        <p class="eyebrow">Policy</p>
        <h2>Policy workspace</h2>
        <p>Mock HEROS operating policy cards for standalone layout design.</p>
      </section>

      <section class=${this.editingLayout ? "layout-toolbar editing" : "layout-toolbar"}>
        <div>
          <strong>${this.editingLayout ? "Policy layout editing is active" : "Policy layout"}</strong>
          <span>${this.editingLayout ? "Drag and resize cards, then save." : "Use Edit Layout to arrange policy cards."}</span>
        </div>
        <nav aria-label="Policy layout editor controls">
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

  _renderSummaryCard() {
    return html`
      <heros-card>
        <p class="card-label">Active policy</p>
        <h3>Balanced self-use</h3>
        <strong class="hero-value">Auto</strong>
        <p>Prioritise home load, preserve evening battery reserve, export solar surplus.</p>
      </heros-card>
    `;
  }

  _renderImportPolicyCard() {
    return html`
      <heros-card>
        <p class="card-label">Import policy</p>
        <h3>Avoid peak import</h3>
        <section class="rule-list">
          <article><strong>Peak window</strong><span>16:00 → 21:00</span></article>
          <article><strong>Max grid import</strong><span>2.5 kW</span></article>
        </section>
      </heros-card>
    `;
  }

  _renderExportPolicyCard() {
    return html`
      <heros-card>
        <p class="card-label">Export policy</p>
        <h3>Export surplus solar</h3>
        <section class="rule-list">
          <article><strong>Export limit</strong><span>5.0 kW</span></article>
          <article><strong>Min feed-in rate</strong><span>$0.08/kWh</span></article>
        </section>
      </heros-card>
    `;
  }

  _renderBatteryPolicyCard() {
    return html`
      <heros-card>
        <p class="card-label">Battery policy</p>
        <h3>Evening reserve</h3>
        <section class="mini-grid">
          <article><span>Min</span><strong>20%</strong></article>
          <article><span>Target</span><strong>55%</strong></article>
          <article><span>Max</span><strong>95%</strong></article>
        </section>
      </heros-card>
    `;
  }

  _renderAutomationCard() {
    return html`
      <heros-card>
        <p class="card-label">Automation rules</p>
        <h3>3 active rules</h3>
        <section class="rule-list">
          <article><strong>Solar surplus</strong><span>Charge battery</span></article>
          <article><strong>Price spike</strong><span>Hold reserve</span></article>
          <article><strong>Public holiday</strong><span>Use holiday pricing</span></article>
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

    p,
    .layout-toolbar span,
    .rule-list span {
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

customElements.define("heros-policy-page", HerosPolicyPage);
