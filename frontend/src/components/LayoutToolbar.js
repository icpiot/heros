import { LitElement, css, html } from "lit";

export class LayoutToolbar extends LitElement {
  static properties = {
    editing: { type: Boolean },
    dirty: { type: Boolean },
  };

  render() {
    return html`
      <div class=${this.editing ? "toolbar editing" : "toolbar"}>
        <div>
          <strong>${this.editing ? "Layout editing is active" : "Overview layout"}</strong>
          <span>
            ${this.editing
              ? "Drag cards by the handle, resize with the visible grips, then save."
              : "Use Edit Layout to move or resize cards visually."}
          </span>
        </div>
        <nav aria-label="Layout editor controls">
          <slot name="actions"></slot>
        </nav>
      </div>
    `;
  }

  static styles = css`
    .toolbar {
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

    .toolbar.editing {
      border-color: rgba(37, 255, 210, 0.75);
      box-shadow: 0 0 0 1px rgba(37, 255, 210, 0.14), var(--heros-shadow);
    }

    strong,
    span {
      display: block;
    }

    span {
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

    ::slotted(.heros-button) {
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

    ::slotted(.heros-button.secondary) {
      background: rgba(11, 25, 42, 0.86);
      color: var(--heros-text);
    }

    @media (max-width: 780px) {
      .toolbar {
        align-items: stretch;
        flex-direction: column;
      }

      nav {
        justify-content: flex-start;
      }
    }
  `;
}

customElements.define("heros-layout-toolbar", LayoutToolbar);
