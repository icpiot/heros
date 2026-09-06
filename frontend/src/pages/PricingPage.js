import { LitElement, css, html } from "lit";
import "../components/EditableGrid.js";
import "../components/HerosActionButtonCard.js";
import "../components/HerosCard.js";
import "../components/PricingGroupWorkspace.js";
import "../components/PricingGroupEditor.js";
import { LayoutController } from "../layout/LayoutController.js";
import { LocalStorageLayoutRepository } from "../layout/LocalStorageLayoutRepository.js";
import {
  PRICING_LAYOUT_STORAGE_KEY,
  PRICING_LAYOUT_VERSION,
  pricingDefaultLayout,
} from "../layout/pricingLayout.js";

export class HerosPricingPage extends LitElement {
  static properties = {
    herosState: { type: Object },
    selectedGroupId: { state: true },
    editorMode: { state: true },
    editingLayout: { type: Boolean },
    previewingLayout: { type: Boolean },
    groupWorkspaceLayout: { state: true },
    addNewRateGroupLevel: { state: true },
    layout: { type: Array },
  };

  constructor() {
    super();
    this.selectedGroupId = "";
    this.editorMode = "view";
    this.editingLayout = false;
    this.previewingLayout = false;
    this.groupWorkspaceLayout = undefined;
    this.addNewRateGroupLevel = window.localStorage.getItem("heros.frontend.pricing.add-new-rate-group.level") || "group";
    this._handleLayoutAction = this._handleLayoutAction.bind(this);
    this._groupWorkspaceLayoutChanged = this._groupWorkspaceLayoutChanged.bind(this);
    this._itemLevelChanged = this._itemLevelChanged.bind(this);
    this._selectGroupById = this._selectGroupById.bind(this);
    this.repository = new LocalStorageLayoutRepository({
      storageKey: PRICING_LAYOUT_STORAGE_KEY,
      version: PRICING_LAYOUT_VERSION,
      defaultLayout: pricingDefaultLayout,
    });
    this.layoutController = new LayoutController(this.repository);
    this.layout = this.layoutController.layout;
  }

  firstUpdated() {
    this.renderRoot.addEventListener("click", this._handleLayoutAction);
    this.renderRoot.addEventListener("pointerup", this._handleLayoutAction);
    this.renderRoot.addEventListener("keydown", this._handleLayoutAction);
  }

  get groups() {
    return this.herosState?.pricing?.groups ?? [];
  }

  get selectedGroup() {
    return this.groups.find((group) => group.id === this.selectedGroupId) ?? this.groups[0];
  }

  selectGroup(event) {
    this.selectedGroupId = event.target.value;
    this.editorMode = "view";
  }

  render() {
    const group = this.selectedGroup;
    if (this.previewingLayout) {
      return this._renderPricingPreview(group);
    }

    const cards = [
      {
        id: "pricing-summary",
        template: this._renderSummaryCard(group),
      },
      {
        id: "rate-group-list",
        template: this._renderGroupListCard(group),
      },
      ...(this.addNewRateGroupLevel === "page" ? [{
        id: "add-new-rate-group-action",
        compactEditor: true,
        levelTarget: { label: "Move into group", target: "group" },
        template: this._renderAddNewRateGroupActionCard(),
      }] : []),
      {
        id: "rate-record-forms",
        template: this._renderRateRecordFormsCard(group),
      },
      {
        id: "buy-prices-saved",
        template: this._renderSavedRecordsCard(group, "buy"),
      },
      {
        id: "sell-prices-saved",
        template: this._renderSavedRecordsCard(group, "sell"),
      },
    ];

    return html`
      <section class="page-head">
        <div>
          <p class="eyebrow">Pricing</p>
          <h2>Pricing workspace</h2>
          <p>Arrange the standalone pricing editor cards without changing the Home Assistant integration.</p>
        </div>
      </section>

      <section class=${this.editingLayout || this.previewingLayout ? "layout-toolbar editing" : "layout-toolbar"}>
        <div>
          <strong>
            ${this.previewingLayout
              ? "Pricing layout preview"
              : this.editingLayout
                ? "Pricing layout editing is active"
                : "Pricing layout"}
          </strong>
          <span>
            ${this.previewingLayout
              ? "Preview hides edit handles so you can check the real rendered layout before saving."
              : this.editingLayout
                ? "Drag cards by the handle, resize with the visible grips, then preview or save."
              : "Use Edit Layout to rearrange pricing cards visually."}
          </span>
        </div>
        <nav aria-label="Pricing layout editor controls">
          ${this.previewingLayout
            ? html`
                <button class="heros-button" data-layout-action="edit" type="button">Back to Edit</button>
                <button class="heros-button" data-layout-action="save" type="button">Save Layout</button>
                <button class="heros-button secondary" data-layout-action="cancel" type="button">Cancel Changes</button>
                <button class="heros-button secondary" data-layout-action="reset" type="button">Reset Layout</button>
              `
            : this.editingLayout
            ? html`
                <button class="heros-button" data-layout-action="preview" type="button">Preview Layout</button>
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
        .editing=${this.editingLayout && !this.previewingLayout}
        @layout-change=${this._layoutChanged}
        @layout-remove=${this._layoutRemoved}
        @layout-level-change=${this._itemLevelChanged}
      ></heros-editable-grid>
    `;
  }

  _renderPricingPreview(group) {
    const tiles = [
      ["Rate groups", String(this.groups.length)],
      ["Active group rules", String(group?.rules?.length ?? 0)],
      ["Active type", group?.type ?? "dynamic"],
      ["Effective from", group?.effectiveDate ?? "Not set"],
    ];

    return html`
      <section class="page-head">
        <div>
          <p class="eyebrow">Pricing</p>
          <h2>Pricing workspace</h2>
          <p>Arrange the standalone pricing editor cards without changing the Home Assistant integration.</p>
        </div>
      </section>

      <section class="layout-toolbar editing">
        <div>
          <strong>Pricing layout preview</strong>
          <span>Preview hides edit handles so you can check the real rendered layout before saving.</span>
        </div>
        <nav aria-label="Pricing layout preview controls">
          <button class="heros-button" data-layout-action="edit" type="button">Back to Edit</button>
          <button class="heros-button" data-layout-action="save" type="button">Save Layout</button>
          <button class="heros-button secondary" data-layout-action="cancel" type="button">Cancel Changes</button>
          <button class="heros-button secondary" data-layout-action="reset" type="button">Reset Layout</button>
        </nav>
      </section>

      <section class="ha-pricing-preview">
        <section class="ha-hero">
          <h2>Pricing</h2>
          <p>
            Build date-effective rate groups here first. Each group starts on its effective date and supersedes older rates.
            Buy and sell records are saved separately inside the group.
          </p>
        </section>

        <section class="ha-stat-grid">
          ${tiles.map(([label, value]) => html`
            <article>
              <span>${label}</span>
              <strong>${value}</strong>
            </article>
          `)}
        </section>

        <section class="ha-rate-group">
          <header>
            <div>
              <h3>Rate Group List</h3>
            </div>
            <span>${this.groups.length} groups saved</span>
          </header>

          <div class="ha-preview-workspace">
            <pricing-group-workspace
              .group=${group}
              .groups=${this.groups}
              .selectedGroupId=${group?.id ?? ""}
              .mode=${this.editorMode}
              .externalLayout=${this.groupWorkspaceLayout}
              .addNewLevel=${this.addNewRateGroupLevel}
              .editing=${false}
              @group-select=${this._selectGroupById}
              @group-mode-change=${(event) => { this.editorMode = event.detail.mode; }}
            ></pricing-group-workspace>
          </div>

          <section class="ha-records">
            <header>
              <div>
                <h3>Rate Records</h3>
                <p>Add records to the selected group only. Public holiday records override normal day records.</p>
              </div>
              <span>${group?.rules?.length ?? 0} record(s) attached</span>
            </header>
            ${this._renderRecordForm("buy")}
            ${this._renderRecordForm("sell")}
            ${this._renderSavedRecordsCard(group, "buy")}
            ${this._renderSavedRecordsCard(group, "sell")}
          </section>
        </section>
      </section>
    `;
  }

  _renderSummaryCard(group) {
    const activeRules = group?.rules ?? [];
    const tiles = [
      ["Rate groups", String(this.groups.length)],
      ["Active group rules", String(activeRules.length)],
      ["Active type", group?.type ?? "dynamic"],
      ["Effective from", group?.effectiveDate ?? "Not set"],
    ];

    return html`
      <heros-card>
        <header>
          <div>
            <h3>Pricing Summary</h3>
            <p>Matches the real page summary tiles before the rate group workspace.</p>
          </div>
        </header>
        <section class="pricing-tiles">
          ${tiles.map(([label, value]) => html`
            <article>
              <span>${label}</span>
              <strong>${value}</strong>
            </article>
          `)}
        </section>
      </heros-card>
    `;
  }

  _renderGroupListCard(group) {
    return html`
      <heros-card>
        <header>
          <div>
            <h3>Rate Group List</h3>
            <p>${this.groups.length} groups saved</p>
          </div>
        </header>

        <section class="embedded-group-workspace" aria-label="Selected rate group editor">
          <pricing-group-workspace
            .group=${group}
            .groups=${this.groups}
            .selectedGroupId=${group?.id ?? ""}
            .mode=${this.editorMode}
            .externalLayout=${this.groupWorkspaceLayout}
            .addNewLevel=${this.addNewRateGroupLevel}
            .editing=${this.editingLayout && !this.previewingLayout}
            @group-select=${this._selectGroupById}
            @group-mode-change=${(event) => { this.editorMode = event.detail.mode; }}
            @group-layout-change=${this._groupWorkspaceLayoutChanged}
            @group-item-level-change=${this._itemLevelChanged}
          ></pricing-group-workspace>
        </section>
      </heros-card>
    `;
  }

  _renderAddNewRateGroupActionCard() {
    return html`
      <heros-card class="button-card">
        <heros-action-button-card
          class="free-action-button"
          label="Add as new rate group"
          @click=${() => { this.editorMode = "new"; }}
        ></heros-action-button-card>
      </heros-card>
    `;
  }

  _selectGroupById(event) {
    this.selectedGroupId = event.detail.id;
    this.editorMode = "view";
  }

  _renderHaSelectedGroupCard(group) {
    const chips = [
      `Daily connection ${group?.dailySupplyCharge ?? "Not set"} $/day`,
      `Other charges ${group?.otherCharges || "Not set"}`,
      `Notes ${group?.notes || "Not set"}`,
    ];

    return html`
      <article class="ha-selected-group-card">
        <div class="ha-selected-group-main">
          <div class="ha-selected-group-title">
            <h4>${group?.description ?? "No group selected"}</h4>
            <p>Provider not set</p>
          </div>
          <button class="ha-action-button danger" type="button">Delete group</button>
        </div>

        <section class="ha-selected-group-tiles">
          <div>
            <span>Effective Date</span>
            <strong>${group?.effectiveDate ?? "Not set"}</strong>
          </div>
          <div>
            <span>Description</span>
            <strong>${group?.description ?? "Not set"}</strong>
          </div>
          <div>
            <span>Type</span>
            <strong>${group?.type ?? "dynamic"}</strong>
          </div>
          <div>
            <span>Rules</span>
            <strong>${group?.rules?.length ?? 0}</strong>
          </div>
        </section>

        <section class="ha-selected-group-footer">
          <div class="ha-selected-group-chips">
            ${chips.map((chip) => html`<span>${chip}</span>`)}
          </div>
          <div class="ha-selected-group-actions">
            <button class="ha-action-button" type="button">Modify Group</button>
            <button class="ha-action-button" type="button">Add as new rate group</button>
          </div>
        </section>
      </article>
    `;
  }

  _renderGroupWorkspaceCard(group) {
    return html`
      <heros-card>
        <pricing-group-workspace
          .group=${group}
          .mode=${this.editorMode}
          .externalLayout=${this.groupWorkspaceLayout}
          .editing=${this.editingLayout && !this.previewingLayout}
          @group-mode-change=${(event) => { this.editorMode = event.detail.mode; }}
          @group-layout-change=${this._groupWorkspaceLayoutChanged}
        ></pricing-group-workspace>
      </heros-card>
    `;
  }

  _renderRateRecordFormsCard(group) {
    return html`
      <heros-card>
        <header>
          <div>
            <h3>Rate Records</h3>
            <p>Add records to the selected group only. Public holiday records override normal day records.</p>
          </div>
        </header>
        <section class="record-form-grid">
          ${this._renderRecordForm("buy")}
          ${this._renderRecordForm("sell")}
        </section>
      </heros-card>
    `;
  }

  _renderRecordForm(type) {
    const isSell = type === "sell";
    return html`
      <article class=${isSell ? "record-editor sell" : "record-editor buy"}>
        <div class="record-editor__heading">
          <div>
            <strong>${isSell ? "Sell Electricity" : "Buy Electricity"}</strong>
            <span>${isSell ? "Feed-in tariff rows have their own time and day selection" : "Purchase tariff rows are independent from feed-in rows"}</span>
          </div>
          <heros-action-button-card
            class="inline-action-button wide"
            .label=${isSell ? "+ Add sell price" : "+ Add buy price"}
          ></heros-action-button-card>
        </div>
        <div class="record-fields">
          <label class="wide">
            <span>${isSell ? "Feed-in tariff" : "Purchase tariff"}</span>
            <input placeholder="${isSell ? "Feed-in Tariff 1" : "Purchase Tariff 1"}" />
          </label>
          <label>
            <span>Start</span>
            <input type="time" />
          </label>
          <label>
            <span>End</span>
            <input type="time" />
          </label>
          ${isSell
            ? html`
                <label><span>First block up to (kWh)</span><input value="1000" /></label>
                <label><span>First block rate ($/kWh)</span><input value="0.08" /></label>
                <label><span>Remainder rate ($/kWh)</span><input value="0.02" /></label>
              `
            : html`
                <label><span>Import rate ($/kWh)</span><input /></label>
                <label><span>Controlled load ($/kWh)</span><input /></label>
              `}
        </div>
        ${this._renderDaySelector(isSell ? "Sell days" : "Buy days")}
      </article>
    `;
  }

  _renderDaySelector(label) {
    const days = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN", "Public holiday"];
    return html`
      <div class="day-selector">
        <span>${label}</span>
        <div>
          ${days.map((day, index) => html`
            <label>
              <input type="checkbox" ?checked=${index < 5} />
              <b>${day}</b>
            </label>
          `)}
        </div>
      </div>
    `;
  }

  _renderSavedRecordsCard(group, type) {
    const isSell = type === "sell";
    const rules = group?.rules?.filter((rule) => rule.direction === type) ?? [];
    return html`
      <heros-card>
        <header>
          <div>
            <h3>${isSell ? "Sell prices saved" : "Buy prices saved"}</h3>
            <p>${rules.length} item(s)</p>
          </div>
        </header>
        <section class="record-list">
          ${rules.length
            ? rules.map((rule) => html`
                <article class="saved-record">
                  <div class="saved-record__title">
                    <div>
                      <strong>${rule.label ?? rule.id}</strong>
                      <span>${rule.days?.join(", ") ?? "mon, tue, wed, thu, fri"}</span>
                    </div>
                    <button class="ha-action-button compact danger" type="button">Delete record</button>
                  </div>
                  <dl>
                    <div><dt>Days</dt><dd>${rule.days?.join(", ") ?? "mon, tue, wed, thu, fri"}</dd></div>
                    <div><dt>Start</dt><dd>${rule.start}</dd></div>
                    <div><dt>End</dt><dd>${rule.end}</dd></div>
                    <div><dt>Override</dt><dd>Standard</dd></div>
                  </dl>
                  <p>${isSell ? "Sell 0.08 c/kWh" : "Import 0.333 c/kWh · Controlled Not set"}</p>
                </article>
              `)
            : html`
                <article class="empty-state">
                  <strong>No ${isSell ? "sell" : "buy"} records in selected group.</strong>
                  <span>Add a ${isSell ? "sell/feed-in" : "buy/import time window"} record below.</span>
                </article>
              `}
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
    if (action === "preview") this._previewLayout();
    if (action === "save") this._saveLayout();
    if (action === "cancel") this._cancelChanges();
    if (action === "reset") this._resetLayout();
  }

  _editLayout() {
    if (!this.previewingLayout) {
      this.layout = this.layoutController.beginEdit();
    }
    this.editingLayout = true;
    this.previewingLayout = false;
  }

  _previewLayout() {
    if (!this.editingLayout) return;
    this._captureGroupWorkspaceLayout();
    this.previewingLayout = true;
  }

  _groupWorkspaceLayoutChanged(event) {
    this.groupWorkspaceLayout = event.detail.layout;
  }

  _layoutChanged(event) {
    if (event.target !== event.currentTarget) return;
    if (!this.editingLayout) return;
    this.layout = this.layoutController.updateDraft(event.detail.layout);
  }

  _layoutRemoved(event) {
    if (event.target !== event.currentTarget) return;
    if (!this.editingLayout) return;
    this.layout = this.layoutController.hideItem(event.detail.id);
  }

  _itemLevelChanged(event) {
    if (!this.editingLayout || event.detail.id !== "add-new-rate-group-action") return;
    this.addNewRateGroupLevel = event.detail.target === "page" ? "page" : "group";
    window.localStorage.setItem("heros.frontend.pricing.add-new-rate-group.level", this.addNewRateGroupLevel);
  }

  _saveLayout() {
    this._captureGroupWorkspaceLayout();
    this.layout = this.layoutController.save();
    this._groupWorkspace()?.saveLayout();
    this.editingLayout = false;
    this.previewingLayout = false;
  }

  _cancelChanges() {
    this.layout = this.layoutController.cancel();
    this._groupWorkspace()?.cancelLayout();
    this.groupWorkspaceLayout = undefined;
    this.editingLayout = false;
    this.previewingLayout = false;
  }

  _resetLayout() {
    this.layout = this.layoutController.resetToDefaultDraft();
    this._groupWorkspace()?.resetLayout();
    this.groupWorkspaceLayout = this._groupWorkspace()?.layout;
    this.addNewRateGroupLevel = "group";
    window.localStorage.setItem("heros.frontend.pricing.add-new-rate-group.level", this.addNewRateGroupLevel);
    this.editingLayout = true;
    this.previewingLayout = false;
  }

  _groupWorkspace() {
    return this.renderRoot.querySelector("pricing-group-workspace");
  }

  _captureGroupWorkspaceLayout() {
    const workspace = this._groupWorkspace();
    if (workspace?.layout) {
      this.groupWorkspaceLayout = workspace.layout;
    }
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

    .eyebrow {
      color: var(--heros-accent);
      font-size: 0.72rem;
      font-weight: 900;
      letter-spacing: 0.16em;
      margin: 0 0 6px;
      text-transform: uppercase;
    }

    header {
      align-items: center;
      display: flex;
      justify-content: space-between;
      margin-bottom: 18px;
    }

    h2,
    h3,
    p {
      margin: 0;
    }

    h2 {
      font-size: clamp(1.8rem, 3vw, 2.6rem);
    }

    p {
      color: var(--heros-muted);
    }

    .group-selector {
      align-items: end;
      display: grid;
      gap: 12px;
      grid-template-columns: minmax(280px, 1fr) auto;
    }

    .group-selector.stacked {
      align-items: stretch;
      grid-template-columns: 1fr;
      max-width: 520px;
    }

    .embedded-group-workspace {
      margin-top: 18px;
      min-height: 560px;
    }

    label {
      display: grid;
      gap: 6px;
    }

    label span,
    .summary span {
      color: var(--heros-text);
      font-size: 0.86rem;
      font-weight: 800;
    }

    select {
      background: rgba(7, 14, 26, 0.72);
      border: 1px solid var(--heros-border);
      border-radius: 12px;
      color: var(--heros-text);
      font: inherit;
      min-height: 42px;
      padding: 9px 12px;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      justify-content: flex-end;
    }

    .action-note {
      color: var(--heros-muted);
      font-size: 0.9rem;
    }

    .floating-actions {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      justify-content: flex-end;
      min-height: 44px;
      margin-bottom: 14px;
    }

    .group-workspace {
      display: grid;
      gap: 12px;
      height: 100%;
    }

    .group-workspace__actions {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      justify-content: flex-end;
      min-height: 72px;
    }

    .group-action-frame {
      align-items: center;
      border: 1px solid rgba(66, 165, 255, 0.82);
      border-radius: 20px;
      box-shadow: inset 0 0 0 1px rgba(0, 229, 255, 0.12);
      display: flex;
      gap: 12px;
      justify-content: flex-end;
      min-height: 68px;
      padding: 10px 20px;
      width: 100%;
    }

    .inline-action-button {
      --heros-action-padding: 4px;
      display: block;
      height: 44px;
      width: 132px;
    }

    .inline-action-button.wide {
      width: 178px;
    }

    .group-workspace__save {
      align-items: center;
      display: flex;
      justify-content: flex-start;
    }

    .record-action-workspace {
      align-items: center;
      display: flex;
      gap: 14px;
      height: 100%;
      justify-content: flex-end;
    }

    .record-action-workspace span {
      color: var(--heros-muted);
      font-size: 0.78rem;
      font-weight: 900;
      letter-spacing: 0.08em;
      margin-right: auto;
      text-transform: uppercase;
    }

    .ha-pricing-preview {
      display: grid;
      gap: 14px;
    }

    .ha-hero,
    .ha-rate-group {
      background: rgba(8, 18, 31, 0.9);
      border: 1px solid var(--heros-border);
      border-radius: 24px;
      box-shadow: var(--heros-shadow);
      padding: 22px 24px;
    }

    .ha-hero {
      min-height: 104px;
    }

    .ha-hero p {
      margin-top: 22px;
      max-width: 980px;
    }

    .ha-stat-grid {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .ha-stat-grid article {
      background: rgba(8, 18, 31, 0.9);
      border: 1px solid var(--heros-border);
      border-radius: 20px;
      box-shadow: var(--heros-shadow);
      min-height: 72px;
      padding: 14px 18px;
    }

    .ha-stat-grid span,
    .ha-rate-group > header > span,
    .ha-records > header > span {
      color: var(--heros-accent);
      font-size: 0.72rem;
      font-weight: 900;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }

    .ha-stat-grid strong {
      display: block;
      font-size: 1.55rem;
      margin-top: 8px;
    }

    .ha-rate-group > header,
    .ha-records > header {
      align-items: start;
      display: flex;
      justify-content: space-between;
    }

    .ha-group-select-row {
      margin-bottom: 12px;
      max-width: 520px;
    }

    .ha-preview-workspace {
      min-height: 620px;
    }

    .ha-group-action-strip {
      align-items: center;
      display: flex;
      gap: 12px;
      justify-content: flex-end;
      margin: 12px 0 18px;
    }

    .ha-group-save-row {
      display: flex;
      justify-content: flex-start;
      margin-top: 12px;
    }

    .ha-selected-group-card {
      border: 1px solid rgba(96, 175, 255, 0.95);
      border-radius: 18px;
      box-shadow:
        0 0 0 1px rgba(0, 229, 255, 0.08) inset,
        0 18px 50px rgba(0, 0, 0, 0.22);
      margin-top: 14px;
      padding: 18px;
    }

    .ha-selected-group-main,
    .ha-selected-group-footer {
      align-items: center;
      display: flex;
      gap: 18px;
      justify-content: space-between;
    }

    .ha-selected-group-title h4 {
      font-size: 1rem;
      margin: 0 0 4px;
    }

    .ha-selected-group-tiles {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      margin: 16px 0;
    }

    .ha-selected-group-tiles div {
      background: rgba(13, 24, 44, 0.86);
      border-radius: 14px;
      min-height: 58px;
      padding: 12px 14px;
    }

    .ha-selected-group-tiles span {
      color: var(--heros-accent);
      display: block;
      font-size: 0.68rem;
      font-weight: 900;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    .ha-selected-group-tiles strong {
      display: block;
      font-size: 0.92rem;
      font-weight: 500;
      margin-top: 8px;
    }

    .ha-selected-group-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }

    .ha-selected-group-chips span {
      background: rgba(255, 255, 255, 0.06);
      border-radius: 999px;
      color: var(--heros-text);
      padding: 9px 13px;
    }

    .ha-selected-group-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      justify-content: flex-end;
    }

    .ha-records {
      border-top: 1px solid rgba(0, 229, 255, 0.24);
      margin-top: 20px;
      padding-top: 16px;
    }

    .ha-records .record-editor {
      margin-top: 14px;
    }

    .ha-records .record-list {
      margin-top: 18px;
    }

    .ha-pricing-preview pricing-group-editor {
      display: block;
      max-width: 760px;
    }

    .ha-pricing-preview .record-fields {
      grid-template-columns: minmax(240px, 1.1fr) minmax(180px, 1fr) minmax(180px, 1fr);
    }

    .ha-pricing-preview .record-fields input {
      box-sizing: border-box;
    }

    .ha-pricing-preview .record-editor__heading {
      min-height: 58px;
      padding: 12px 16px;
    }

    .ha-pricing-preview .day-selector {
      padding-top: 12px;
    }

    .button-card {
      --heros-card-padding: 10px;
      display: block;
      height: 100%;
    }

    .free-action-button {
      display: block;
      height: 100%;
      min-height: 58px;
      width: 100%;
    }

    .inline-group-summary {
      background: rgba(6, 13, 26, 0.72);
      border: 1px solid rgba(0, 229, 255, 0.18);
      border-radius: 16px;
      display: grid;
      gap: 5px;
      padding: 12px 14px;
    }

    .inline-group-summary span {
      color: var(--heros-accent);
      font-size: 0.72rem;
      font-weight: 900;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }

    .inline-group-summary small {
      color: var(--heros-muted);
    }

    nav {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      justify-content: flex-end;
    }

    button,
    .heros-button,
    .ha-action-button {
      background: linear-gradient(135deg, var(--heros-accent), var(--heros-hot));
      border: 0;
      border-radius: 999px;
      color: #06111f;
      cursor: pointer;
      font: inherit;
      font-weight: 900;
      padding: 12px 16px;
    }

    .ha-action-button {
      align-items: center;
      background: linear-gradient(135deg, #25d8ff 0%, #5fb8ff 45%, #f054e8 100%);
      border: 1px solid rgba(37, 255, 210, 0.45);
      box-shadow:
        0 14px 34px rgba(0, 229, 255, 0.22),
        0 0 0 1px rgba(255, 255, 255, 0.08) inset;
      color: #06111f;
      display: inline-flex;
      font-size: 0.95rem;
      font-weight: 1000;
      justify-content: center;
      letter-spacing: 0.01em;
      min-height: 44px;
      min-width: 150px;
      padding: 12px 20px;
      text-decoration: underline;
      text-decoration-thickness: 1px;
      text-underline-offset: 3px;
      transition: filter 160ms ease, transform 160ms ease, box-shadow 160ms ease;
      white-space: nowrap;
    }

    .ha-action-button:hover {
      filter: brightness(1.06);
      transform: translateY(-1px);
    }

    .ha-action-button:focus-visible {
      outline: 2px solid rgba(255, 255, 255, 0.92);
      outline-offset: 3px;
    }

    .ha-action-button.compact {
      min-height: 40px;
      min-width: 126px;
      padding: 10px 16px;
    }

    .ha-action-button.small {
      font-size: 0.84rem;
      min-height: 36px;
      min-width: 118px;
      padding: 8px 14px;
    }

    .ha-action-button.confirm {
      min-width: 138px;
    }

    .ha-action-button.fill {
      font-size: clamp(0.78rem, 1.1vw, 0.92rem);
      height: 100%;
      min-height: 42px;
      min-width: 0;
      padding: 8px 12px;
      width: 100%;
    }

    .ha-action-button.danger {
      background: linear-gradient(135deg, rgba(31, 219, 255, 0.95), rgba(229, 77, 255, 0.95));
      color: #06111f;
    }

    .heros-button.secondary {
      background: rgba(11, 25, 42, 0.86);
      color: var(--heros-text);
    }

    .summary {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      margin-top: 18px;
    }

    .summary div {
      background: rgba(6, 13, 26, 0.72);
      border-radius: 14px;
      padding: 12px;
    }

    .summary strong {
      display: block;
      margin-top: 8px;
    }

    .summary p {
      background: rgba(255, 255, 255, 0.06);
      border-radius: 999px;
      margin: 0;
      padding: 10px 12px;
    }

    .pricing-tiles {
      display: grid;
      gap: 10px;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    }

    .pricing-tiles article {
      background: rgba(6, 13, 26, 0.72);
      border: 1px solid rgba(0, 229, 255, 0.18);
      border-radius: 16px;
      padding: 14px;
    }

    .pricing-tiles span,
    .saved-record dt {
      color: var(--heros-accent);
      display: block;
      font-size: 0.72rem;
      font-weight: 900;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }

    .pricing-tiles strong {
      display: block;
      font-size: 1.55rem;
      margin-top: 6px;
    }

    .record-form-grid {
      display: grid;
      gap: 14px;
    }

    .record-editor {
      background: rgba(8, 18, 35, 0.8);
      border: 1px solid rgba(0, 229, 255, 0.28);
      border-radius: 18px;
      overflow: hidden;
    }

    .record-editor.sell {
      border-color: rgba(37, 255, 210, 0.55);
    }

    .record-editor__heading {
      align-items: center;
      background: rgba(66, 165, 255, 0.13);
      display: flex;
      gap: 12px;
      justify-content: space-between;
      padding: 16px;
    }

    .record-editor__heading span {
      color: var(--heros-muted);
      display: block;
      font-size: 0.78rem;
      font-weight: 900;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .record-fields {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      padding: 16px;
    }

    .record-fields .wide {
      grid-column: span 1;
    }

    input {
      background: rgba(7, 14, 26, 0.72);
      border: 1px solid var(--heros-border);
      border-radius: 12px;
      color: var(--heros-text);
      min-height: 42px;
      padding: 9px 12px;
      width: 100%;
    }

    .day-selector {
      border-top: 1px solid rgba(0, 229, 255, 0.2);
      padding: 14px 16px 16px;
    }

    .day-selector > span {
      display: block;
      font-weight: 900;
      margin-bottom: 10px;
    }

    .day-selector > div {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }

    .day-selector label {
      align-items: center;
      display: inline-flex;
      gap: 6px;
    }

    .record-list {
      display: grid;
      gap: 10px;
    }

    .record-list article {
      background: rgba(6, 13, 26, 0.72);
      border: 1px solid rgba(0, 229, 255, 0.18);
      border-radius: 14px;
      display: flex;
      justify-content: space-between;
      padding: 12px;
    }

    .record-list span {
      color: var(--heros-muted);
    }

    .saved-record {
      display: grid !important;
      gap: 12px;
    }

    .saved-record__title,
    .saved-record dl {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .saved-record__title {
      align-items: center;
      grid-template-columns: 1fr auto;
    }

    .saved-record dl {
      margin: 0;
    }

    .saved-record dd {
      margin: 4px 0 0;
    }

    .saved-record p,
    .empty-state {
      color: var(--heros-muted);
      margin: 0;
    }

    .empty-state {
      align-items: start !important;
      display: grid !important;
      justify-content: stretch !important;
    }

    @media (max-width: 860px) {
      .group-selector,
      .summary {
        grid-template-columns: 1fr;
      }

      .pricing-tiles,
      .record-fields,
      .saved-record dl {
        grid-template-columns: 1fr;
      }

      .layout-toolbar,
      header {
        align-items: stretch;
        flex-direction: column;
      }

      nav,
      .actions {
        justify-content: flex-start;
      }
    }
  `;
}

customElements.define("heros-pricing-page", HerosPricingPage);
