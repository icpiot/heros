import { LitElement, css, html } from "lit";

export class HemActionButtonCard extends LitElement {
  static properties = {
    label: { type: String },
    variant: { type: String },
  };

  constructor() {
    super();
    this.label = "";
    this.variant = "";
  }

  render() {
    return html`
      <article>
        <button class=${this.variant} type="button">${this.label}</button>
      </article>
    `;
  }

  static styles = css`
    :host {
      display: block;
      height: 100%;
    }

    article {
      align-items: center;
      background: linear-gradient(145deg, rgba(10, 20, 34, 0.96), rgba(12, 21, 40, 0.9));
      border: 1px solid var(--hem-border);
      border-radius: 20px;
      box-shadow: var(--hem-shadow);
      box-sizing: border-box;
      display: flex;
      height: 100%;
      justify-content: center;
      min-height: 100%;
      padding: var(--hem-action-padding, 10px);
    }

    button {
      align-items: center;
      background: linear-gradient(135deg, #25d8ff 0%, #5fb8ff 45%, #f054e8 100%);
      border: 1px solid rgba(37, 255, 210, 0.45);
      border-radius: 999px;
      box-shadow:
        0 14px 34px rgba(0, 229, 255, 0.22),
        0 0 0 1px rgba(255, 255, 255, 0.08) inset;
      color: #06111f;
      cursor: pointer;
      display: inline-flex;
      font: inherit;
      font-size: clamp(0.78rem, 1.1vw, 0.92rem);
      font-weight: 1000;
      height: 100%;
      justify-content: center;
      letter-spacing: 0.01em;
      min-height: 48px;
      min-width: 0;
      padding: 8px 12px;
      text-decoration: underline;
      text-decoration-thickness: 1px;
      text-underline-offset: 3px;
      transition: filter 160ms ease, transform 160ms ease, box-shadow 160ms ease;
      white-space: nowrap;
      width: 100%;
    }

    button:hover {
      filter: brightness(1.06);
      transform: translateY(-1px);
    }

    button:focus-visible {
      outline: 2px solid rgba(255, 255, 255, 0.92);
      outline-offset: 3px;
    }
  `;
}

customElements.define("hem-action-button-card", HemActionButtonCard);
