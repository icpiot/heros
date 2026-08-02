import { LitElement, css, html } from "lit";

export class HemCard extends LitElement {
  render() {
    return html`<article><slot></slot></article>`;
  }

  static styles = css`
    :host {
      display: block;
      height: 100%;
    }

    article {
      background: linear-gradient(145deg, rgba(10, 20, 34, 0.96), rgba(12, 21, 40, 0.9));
      border: 1px solid var(--hem-border);
      border-radius: 20px;
      box-shadow: var(--hem-shadow);
      box-sizing: border-box;
      height: 100%;
      min-height: 100%;
      padding: var(--hem-card-padding, 18px);
    }
  `;
}

customElements.define("hem-card", HemCard);
