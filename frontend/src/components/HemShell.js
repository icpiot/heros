import { LitElement, css, html } from "lit";

const pages = [
  ["overview", "Overview", "Overview"],
  ["policy", "Policy", "Policy"],
  ["report", "Report", "Report"],
  ["battery", "Battery", "Battery"],
  ["solar", "Solar", "Solar"],
  ["forecast", "Forecast", "Forecast"],
  ["forecast-setup", "Setup", "Forecast Setup"],
  ["history", "History", "History"],
  ["pricing", "Pricing", "Pricing"],
  ["settings", "Settings", "Settings"],
];

export class HemShell extends LitElement {
  static properties = {
    activePage: { type: String },
  };

  render() {
    return html`
      <main>
        <header>
          <div>
            <p class="eyebrow">Standalone frontend</p>
            <h1>HEROS</h1>
            <p class="lede">Develop and visually tune HEROS outside Home Assistant.</p>
          </div>
          <nav aria-label="HEROS pages">
            ${pages.map(([page, icon, label]) => html`
              <button
                class=${this.activePage === page ? "active" : ""}
                @click=${() => this.dispatchEvent(new CustomEvent("page-selected", {
                  detail: { page },
                  bubbles: true,
                  composed: true,
                }))}
              >
                <span>${icon}</span>
                ${label}
              </button>
            `)}
          </nav>
        </header>
        <slot></slot>
      </main>
    `;
  }

  static styles = css`
    main {
      margin: 0 auto;
      max-width: 1280px;
      padding: 28px;
    }

    header {
      background: linear-gradient(135deg, rgba(13, 30, 50, 0.95), rgba(12, 19, 40, 0.92));
      border: 1px solid var(--hem-border);
      border-radius: 24px;
      box-shadow: var(--hem-shadow);
      margin-bottom: 20px;
      padding: 24px;
    }

    h1 {
      font-size: clamp(2rem, 4vw, 3.6rem);
      line-height: 1;
      margin: 0;
    }

    .eyebrow {
      color: var(--hem-accent);
      font-size: 0.75rem;
      font-weight: 900;
      letter-spacing: 0.14em;
      margin: 0 0 8px;
      text-transform: uppercase;
    }

    .lede {
      color: var(--hem-muted);
      margin: 10px 0 0;
    }

    nav {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 22px;
    }

    button {
      align-items: center;
      background: rgba(3, 16, 26, 0.84);
      border: 1px solid rgba(0, 229, 255, 0.5);
      border-radius: 999px;
      color: var(--hem-text);
      display: inline-flex;
      font-weight: 900;
      gap: 10px;
      min-height: 42px;
      padding: 0 22px;
    }

    button.active {
      background: linear-gradient(135deg, #25d8ff, #f054e8);
      color: #03101a;
    }

    span {
      color: var(--hem-accent);
      font-weight: 900;
    }

    button.active span {
      color: #03101a;
    }

    @media (max-width: 700px) {
      main {
        padding: 16px;
      }
    }
  `;
}

customElements.define("hem-shell", HemShell);
