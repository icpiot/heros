import { LitElement, css, html } from "lit";
import "../components/EditableGrid.js";
import "../components/OverviewMetricCard.js";
import { LocalStorageLayoutRepository } from "../layout/LocalStorageLayoutRepository.js";
import { LayoutController } from "../layout/LayoutController.js";
import {
  createOverviewCards,
  OVERVIEW_LAYOUT_STORAGE_KEY,
  OVERVIEW_LAYOUT_VERSION,
  overviewDefaultLayout,
} from "../layout/overviewLayout.js";

export class HerosOverviewPage extends LitElement {
  static properties = {
    herosState: { type: Object },
    editing: { type: Boolean },
    layout: { type: Array },
  };

  constructor() {
    super();
    this.editing = false;
    this._handleToolbarAction = this._handleToolbarAction.bind(this);
    this.repository = new LocalStorageLayoutRepository({
      storageKey: OVERVIEW_LAYOUT_STORAGE_KEY,
      version: OVERVIEW_LAYOUT_VERSION,
      defaultLayout: overviewDefaultLayout,
    });
    this.layoutController = new LayoutController(this.repository);
    this.layout = this.layoutController.layout;
  }

  firstUpdated() {
    this.renderRoot.addEventListener("click", this._handleToolbarAction);
    this.renderRoot.addEventListener("pointerup", this._handleToolbarAction);
    this.renderRoot.addEventListener("keydown", this._handleToolbarAction);
  }

  render() {
    const cards = createOverviewCards(this.herosState).map((card) => ({
      id: card.id,
      template: html`
        <heros-overview-metric-card
          .label=${card.label}
          .value=${card.value}
          .note=${card.note}
        ></heros-overview-metric-card>
      `,
    }));

    return html`
      <section class="page-head">
        <div>
          <p class="eyebrow">Overview</p>
          <h2>Energy snapshot</h2>
          <p>Mocked HEROS data is intentionally behind a provider boundary so the same cards can later use Home Assistant entities.</p>
        </div>
      </section>

      <section class=${this.editing ? "layout-toolbar editing" : "layout-toolbar"}>
        <div>
          <strong>${this.editing ? "Layout editing is active" : "Overview layout"}</strong>
          <span>
            ${this.editing
              ? "Drag cards by the handle, resize with the visible grips, then save."
              : "Use Edit Layout to move or resize cards visually."}
          </span>
        </div>
        <nav aria-label="Layout editor controls">
          ${this.editing
            ? html`
                <button class="heros-button" data-layout-action="save" type="button" aria-label="Save Layout">Save Layout</button>
                <button class="heros-button secondary" data-layout-action="cancel" type="button" aria-label="Cancel Changes">Cancel Changes</button>
                <button class="heros-button secondary" data-layout-action="reset" type="button" aria-label="Reset Layout">Reset Layout</button>
              `
            : html`
                <button class="heros-button" data-layout-action="edit" type="button" aria-label="Edit Layout">Edit Layout</button>
              `}
        </nav>
      </section>

      <heros-editable-grid
        .items=${cards}
        .layout=${this.layout}
        .editing=${this.editing}
        @layout-change=${this._layoutChanged}
      ></heros-editable-grid>
    `;
  }

  _editLayout() {
    this.layout = this.layoutController.beginEdit();
    this.editing = true;
  }

  _handleToolbarAction(event) {
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

  _layoutChanged(event) {
    if (!this.editing) return;
    this.layout = this.layoutController.updateDraft(event.detail.layout);
  }

  _saveLayout() {
    this.layout = this.layoutController.save();
    this.editing = false;
  }

  _cancelChanges() {
    this.layout = this.layoutController.cancel();
    this.editing = false;
  }

  _resetLayout() {
    this.layout = this.layoutController.resetToDefaultDraft();
    this.editing = true;
  }

  static styles = css`
    .page-head {
      background: rgba(8, 18, 31, 0.9);
      border: 1px solid var(--heros-border);
      border-radius: 24px;
      box-shadow: var(--heros-shadow);
      margin-bottom: 16px;
      padding: 22px;
    }

    h2 {
      font-size: clamp(1.8rem, 3vw, 2.6rem);
      margin: 0;
    }

    p {
      color: var(--heros-muted);
      margin: 8px 0 0;
      max-width: 760px;
    }

    .eyebrow {
      color: var(--heros-accent);
      font-size: 0.72rem;
      font-weight: 900;
      letter-spacing: 0.16em;
      margin: 0 0 6px;
      text-transform: uppercase;
    }

    .layout-toolbar {
      align-items: center;
      background: rgba(8, 18, 31, 0.9);
      border: 1px solid var(--heros-border);
      border-radius: 20px;
      display: flex;
      gap: 16px;
      justify-content: space-between;
      margin-bottom: 16px;
      padding: 16px;
    }

    .layout-toolbar.editing {
      border-color: rgba(37, 255, 210, 0.75);
      box-shadow: 0 0 0 1px rgba(37, 255, 210, 0.14), var(--heros-shadow);
    }

    .layout-toolbar strong,
    .layout-toolbar span {
      display: block;
    }

    .layout-toolbar span {
      color: var(--heros-muted);
      font-size: 0.92rem;
      margin-top: 2px;
    }

    nav {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      justify-content: flex-end;
    }

    .heros-button {
      align-items: center;
      border: 1px solid rgba(0, 229, 255, 0.55);
      border-radius: 999px;
      background: linear-gradient(135deg, #25d8ff, #f054e8);
      box-shadow: 0 12px 36px rgba(0, 229, 255, 0.22);
      color: #03101a;
      display: inline-flex;
      font-weight: 900;
      gap: 8px;
      justify-content: center;
      min-height: 44px;
      padding: 0 18px;
    }

    .heros-button.secondary {
      background: rgba(11, 25, 42, 0.86);
      color: var(--heros-text);
    }

    @media (max-width: 780px) {
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

customElements.define("heros-overview-page", HerosOverviewPage);
