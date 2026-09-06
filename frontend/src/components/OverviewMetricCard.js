import { LitElement, css, html } from "lit";
import "./HerosCard.js";

export class OverviewMetricCard extends LitElement {
  static properties = {
    label: { type: String },
    value: { type: String },
    note: { type: String },
    accent: { type: String },
  };

  render() {
    return html`
      <heros-card>
        <span class="label">${this.label}</span>
        <strong>${this.value}</strong>
        <small>${this.note}</small>
      </heros-card>
    `;
  }

  static styles = css`
    :host {
      display: block;
      height: 100%;
    }

    .label {
      color: var(--heros-accent);
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
      color: var(--heros-muted);
      display: block;
      margin-top: 8px;
    }
  `;
}

customElements.define("heros-overview-metric-card", OverviewMetricCard);
