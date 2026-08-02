import { LitElement, css, html } from "lit";
import "./EditableGrid.js";
import "./HemActionButtonCard.js";
import "./HemCard.js";
import "./PricingGroupEditor.js";
import { LayoutController } from "../layout/LayoutController.js";
import { LocalStorageLayoutRepository } from "../layout/LocalStorageLayoutRepository.js";
import {
  PRICING_GROUP_WORKSPACE_LAYOUT_STORAGE_KEY,
  PRICING_GROUP_WORKSPACE_LAYOUT_VERSION,
  pricingGroupWorkspaceDefaultLayout,
} from "../layout/pricingGroupWorkspaceLayout.js";

export class PricingGroupWorkspace extends LitElement {
  static properties = {
    group: { type: Object },
    groups: { type: Array },
    selectedGroupId: { type: String, attribute: "selected-group-id" },
    mode: { type: String },
    editing: { type: Boolean },
    externalLayout: { type: Array },
    addNewLevel: { type: String, attribute: "add-new-level" },
    layout: { type: Array },
  };

  constructor() {
    super();
    this.groups = [];
    this.selectedGroupId = "";
    this.mode = "view";
    this.editing = false;
    this.addNewLevel = "group";
    this.externalLayout = undefined;
    this.repository = new LocalStorageLayoutRepository({
      storageKey: PRICING_GROUP_WORKSPACE_LAYOUT_STORAGE_KEY,
      version: PRICING_GROUP_WORKSPACE_LAYOUT_VERSION,
      defaultLayout: pricingGroupWorkspaceDefaultLayout,
    });
    this.layoutController = new LayoutController(this.repository);
    this.layout = this.layoutController.layout;
  }

  updated(changed) {
    if (!changed.has("externalLayout") || !Array.isArray(this.externalLayout)) return;
    this.layout = this.layoutController.updateDraft(this.externalLayout);
  }

  render() {
    const cards = [
      {
        id: "group-selector",
        compactEditor: true,
        template: html`
          <hem-card class="inner-card">
            <label class="group-selector">
              <span>Effective Date / Description</span>
              <select @change=${this._selectGroup}>
                ${this.groups.map((item) => html`
                  <option value=${item.id} ?selected=${item.id === this.selectedGroupId}>
                    ${item.effectiveDate} — ${item.description}
                  </option>
                `)}
              </select>
            </label>
          </hem-card>
        `,
      },
      {
        id: "group-modify-action",
        compactEditor: true,
        template: html`
          <hem-card class="inner-card">
            <div class="group-action-frame">
              <hem-action-button-card
                class="inline-action-button"
                label="Modify Group"
                @click=${() => this._setMode("modify")}
              ></hem-action-button-card>
            </div>
          </hem-card>
        `,
      },
      ...(this.addNewLevel === "group" ? [{
        id: "add-new-rate-group-action",
        compactEditor: true,
        levelTarget: { label: "Move to page", target: "page" },
        template: html`
          <hem-card class="inner-card">
            <div class="group-action-frame">
              <hem-action-button-card
                class="inline-action-button wide"
                label="Add as new rate group"
                @click=${() => this._setMode("new")}
              ></hem-action-button-card>
            </div>
          </hem-card>
        `,
      }] : []),
      {
        id: "group-fields",
        compactEditor: true,
        template: html`
          <hem-card class="inner-card">
            <pricing-group-editor
              hide-actions
              .mode=${this.mode === "view" ? "modify" : this.mode}
              .group=${this.mode === "new" ? undefined : this.group}
            ></pricing-group-editor>
          </hem-card>
        `,
      },
      {
        id: "group-save-button",
        compactEditor: true,
        template: html`
          <hem-card class="inner-card">
            <hem-action-button-card
              class="inline-action-button wide"
              .label=${this.mode === "new" ? "Save new group" : "Save active group"}
            ></hem-action-button-card>
          </hem-card>
        `,
      },
    ];

    return html`
      <section class="workspace">
        <hem-editable-grid
          .items=${cards}
          .layout=${this.layout}
          .editing=${this.editing}
          .contained=${true}
          @layout-change=${this._layoutChanged}
          @layout-remove=${this._layoutRemoved}
          @layout-level-change=${this._levelChanged}
        ></hem-editable-grid>
      </section>
    `;
  }

  _setMode(mode) {
    this.mode = mode;
    this.dispatchEvent(new CustomEvent("group-mode-change", {
      detail: { mode },
      bubbles: true,
      composed: true,
    }));
  }

  _selectGroup(event) {
    this.dispatchEvent(new CustomEvent("group-select", {
      detail: { id: event.target.value },
      bubbles: true,
      composed: true,
    }));
  }

  _layoutChanged(event) {
    if (!this.editing) return;
    event.stopPropagation();
    this.layout = this.layoutController.updateDraft(event.detail.layout);
    this._notifyLayoutChanged();
  }

  _layoutRemoved(event) {
    if (!this.editing) return;
    event.stopPropagation();
    this.layout = this.layoutController.hideItem(event.detail.id);
    this._notifyLayoutChanged();
  }

  _levelChanged(event) {
    if (!this.editing) return;
    event.stopPropagation();

    this.dispatchEvent(new CustomEvent("group-item-level-change", {
      detail: event.detail,
      bubbles: true,
      composed: true,
    }));
  }

  saveLayout() {
    this.layout = this.layoutController.save();
  }

  cancelLayout() {
    this.layout = this.layoutController.cancel();
  }

  resetLayout() {
    this.layout = this.layoutController.resetToDefaultDraft();
    this._notifyLayoutChanged();
  }

  _notifyLayoutChanged() {
    this.dispatchEvent(new CustomEvent("group-layout-change", {
      detail: { layout: this.layout },
      bubbles: true,
      composed: true,
    }));
  }

  static styles = css`
    :host {
      display: block;
      height: 100%;
    }

    .workspace {
      height: 100%;
      min-height: 100%;
    }

    .inner-card {
      --hem-card-padding: 10px;
    }

    .group-selector {
      align-content: center;
      display: grid;
      gap: 6px;
      height: 100%;
    }

    .group-selector span {
      color: var(--hem-text);
      font-size: 0.86rem;
      font-weight: 800;
    }

    .group-selector select {
      background: rgba(7, 14, 26, 0.72);
      border: 1px solid var(--hem-border);
      border-radius: 12px;
      color: var(--hem-text);
      font: inherit;
      min-height: 42px;
      padding: 9px 12px;
      width: 100%;
    }

    .group-action-frame {
      align-items: center;
      border: 1px solid rgba(66, 165, 255, 0.82);
      border-radius: 20px;
      box-shadow: inset 0 0 0 1px rgba(0, 229, 255, 0.12);
      display: flex;
      gap: 12px;
      height: 100%;
      justify-content: flex-end;
      min-height: 58px;
      padding: 8px 18px;
    }

    .inline-action-button {
      --hem-action-padding: 8px;
      display: block;
      height: 100%;
      min-height: 56px;
      width: 132px;
    }

    .inline-action-button.wide {
      width: 178px;
    }
  `;
}

customElements.define("pricing-group-workspace", PricingGroupWorkspace);
