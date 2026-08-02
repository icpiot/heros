import { LitElement, css, html } from "lit";
import "./HemCard.js";

export class OverviewMetricCard extends LitElement {
  static properties = {
    label: { type: String },
    value: { type: String },
    note: { type: String },
    accent: { type: String },
  };

  render() {
    return html`
      <hem-card>
        <span class="label">${this.label}</span>
        <strong>${this.value}</strong>
        <small>${this.note}</small>
      </hem-card>
    `;
  }

  static styles = css`
    :host {
      display: block;
      height: 100%;
    }

    .label {
      color: var(--hem-accent);
      display: block;
      font-size: 0.78rem;
      font-weight: 900;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }

    strong {
      display: block;
      font-size: clamp(1.55rem, 3vw, 2.15rem);
      margin-top: 8px;
    }

    small {
      color: var(--hem-muted);
      display: block;
      margin-top: 8px;
    }
  `;
}

customElements.define("hem-overview-metric-card", OverviewMetricCard);
