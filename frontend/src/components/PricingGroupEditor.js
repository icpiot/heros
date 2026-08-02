import { LitElement, css, html } from "lit";

const emptyGroup = {
  description: "",
  effectiveDate: "",
  type: "dynamic",
  dailySupplyCharge: "",
  otherCharges: "",
  notes: "",
};

export class PricingGroupEditor extends LitElement {
  static properties = {
    group: { type: Object },
    mode: { type: String },
    hideActions: { type: Boolean, attribute: "hide-actions" },
  };

  constructor() {
    super();
    this.hideActions = false;
  }

  get draft() {
    return { ...emptyGroup, ...(this.group ?? {}) };
  }

  render() {
    const group = this.draft;

    return html`
      <form class="editor">
        <label class="group">
          <span>Group</span>
          <input value=${group.description} placeholder="Rates from" />
        </label>

        <label class="date">
          <span>Effective Date</span>
          <input type="date" value=${group.effectiveDate} />
        </label>

        <label class="type">
          <span>Type</span>
          <select>
            <option value="dynamic" ?selected=${group.type === "dynamic"}>Dynamic</option>
            <option value="fixed" ?selected=${group.type === "fixed"}>Fixed</option>
          </select>
        </label>

        <label class="supply">
          <span>Daily Supply Charge</span>
          <input type="text" inputmode="decimal" value=${group.dailySupplyCharge} />
        </label>

        <label class="wide">
          <span>Other charges</span>
          <textarea>${group.otherCharges}</textarea>
        </label>

        <label class="wide">
          <span>Notes</span>
          <textarea>${group.notes}</textarea>
        </label>

        ${this.hideActions ? "" : html`
          <div class="actions">
            <button class="ha-action-button" type="button">${this.mode === "new" ? "Add as new rate group" : "Save active group"}</button>
          </div>
        `}
      </form>
    `;
  }

  static styles = css`
    .editor {
      align-items: end;
      display: grid;
      gap: 8px 10px;
      grid-template-columns:
        minmax(190px, 1.45fr)
        minmax(128px, 0.72fr)
        minmax(112px, 0.58fr)
        minmax(112px, 0.58fr);
      margin-top: 12px;
      max-width: 100%;
      width: 100%;
    }

    label {
      display: grid;
      gap: 4px;
    }

    span {
      color: var(--hem-text);
      font-size: 0.86rem;
      font-weight: 800;
    }

    input,
    select,
    textarea {
      background: rgba(7, 14, 26, 0.72);
      border: 1px solid var(--hem-border);
      border-radius: 12px;
      box-sizing: border-box;
      color: var(--hem-text);
      font: inherit;
      min-height: 40px;
      padding: 8px 12px;
      width: 100%;
    }

    textarea {
      height: 38px;
      min-height: 38px;
      resize: none;
    }

    .wide,
    .actions {
      grid-column: 1 / -1;
    }

    button,
    .ha-action-button {
      background: linear-gradient(135deg, #25d8ff 0%, #5fb8ff 45%, #f054e8 100%);
      border: 1px solid rgba(37, 255, 210, 0.35);
      border-radius: 999px;
      box-shadow:
        0 14px 34px rgba(0, 229, 255, 0.22),
        0 0 0 1px rgba(255, 255, 255, 0.08) inset;
      color: #06111f;
      cursor: pointer;
      font: inherit;
      font-weight: 1000;
      min-height: 44px;
      min-width: 160px;
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

    @media (max-width: 820px) {
      .editor {
        grid-template-columns: 1fr;
        width: 100%;
      }
    }
  `;
}

customElements.define("pricing-group-editor", PricingGroupEditor);
