import { LitElement, css, html, unsafeCSS } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { GridStack } from "gridstack";
import gridStackCss from "gridstack/dist/gridstack.min.css?inline";

export class EditableGrid extends LitElement {
  static properties = {
    items: { type: Array },
    layout: { type: Array },
    editing: { type: Boolean, reflect: true },
    contained: { type: Boolean, reflect: true },
  };

  constructor() {
    super();
    this.items = [];
    this.layout = [];
    this.editing = false;
    this.contained = false;
    this._suppressChange = false;
  }

  firstUpdated() {
    this._initGrid();
  }

  updated(changed) {
    if (!this.grid) return;

    if (changed.has("layout") || changed.has("items")) {
      this._applyLayout();
    }

    if (changed.has("editing")) {
      this._applyEditingMode();
    }
  }

  disconnectedCallback() {
    this.grid?.destroy(false);
    this.grid = undefined;
    super.disconnectedCallback();
  }

  render() {
    const layoutById = new Map(this.layout.map((item) => [item.id, item]));
    const visibleItems = this.items.filter((item) => !layoutById.get(item.id)?.hidden);

    return html`
      <section class=${[
        "grid-shell",
        this.editing ? "editing" : "",
        this.contained ? "contained" : "",
      ].filter(Boolean).join(" ")}>
        <div class="grid-stack" aria-label="Editable Overview card grid">
          ${repeat(visibleItems, (item) => item.id, (item) => {
            const pos = layoutById.get(item.id) ?? {};
            return html`
              <div
                class=${item.compactEditor ? "grid-stack-item compact-editor" : "grid-stack-item"}
                data-card-id=${item.id}
                gs-id=${item.id}
                gs-x=${pos.x ?? 0}
                gs-y=${pos.y ?? 0}
                gs-w=${pos.w ?? 3}
                gs-h=${pos.h ?? 2}
                gs-min-w=${pos.minW ?? 2}
                gs-min-h=${pos.minH ?? 2}
              >
                <div class="grid-stack-item-content">
                  <div class="drag-handle" aria-hidden=${this.editing ? "false" : "true"}>
                    <span>${item.compactEditor ? "Move" : "Drag"}</span>
                  </div>
                  <button
                    class="remove-card"
                    type="button"
                    aria-hidden=${this.editing ? "false" : "true"}
                    aria-label=${`Hide ${item.id} box`}
                    @click=${() => this._removeItem(item.id)}
                  >
                    ${item.compactEditor ? "Hide" : "Delete box"}
                  </button>
                  ${item.levelTarget ? html`
                    <button
                      class="level-card"
                      type="button"
                      aria-hidden=${this.editing ? "false" : "true"}
                      aria-label=${item.levelTarget.label}
                      @click=${() => this._moveLevel(item.id, item.levelTarget.target)}
                    >
                      ${item.levelTarget.label}
                    </button>
                  ` : ""}
                  <div class="edit-hint" aria-hidden=${this.editing ? "false" : "true"}>
                    Drag handle · resize edges
                  </div>
                  <div class="card-content">
                    ${item.template}
                  </div>
                </div>
              </div>
            `;
          })}
        </div>
      </section>
    `;
  }

  _initGrid() {
    const gridElement = this.renderRoot.querySelector(".grid-stack");
    this.grid = GridStack.init({
      column: 12,
      cellHeight: 86,
      margin: 12,
      float: false,
      animate: true,
      disableDrag: !this.editing,
      disableResize: !this.editing,
      draggable: {
        handle: ".drag-handle",
        scroll: true,
      },
      resizable: {
        handles: "n, e, s, w, ne, se, sw, nw",
      },
      columnOpts: {
        breakpoints: [
          { w: 720, c: 1 },
          { w: 1040, c: 6 },
        ],
      },
    }, gridElement);

    this.grid.on("change", () => {
      if (this._suppressChange || !this.editing) return;
      this.dispatchEvent(new CustomEvent("layout-change", {
        detail: { layout: this._serializeLayout() },
        bubbles: true,
        composed: true,
      }));
    });

    this._applyEditingMode();
  }

  _applyLayout() {
    this._suppressChange = true;
    const byId = new Map(this.layout.map((item) => [item.id, item]));

    for (const el of this.renderRoot.querySelectorAll(".grid-stack-item")) {
      const id = el.getAttribute("gs-id");
      const pos = byId.get(id);
      if (!pos) continue;
      this.grid.update(el, {
        id,
        x: pos.x,
        y: pos.y,
        w: pos.w,
        h: pos.h,
        minW: pos.minW,
        minH: pos.minH,
      });
    }

    this.grid.compact();
    this._suppressChange = false;
  }

  _removeItem(id) {
    if (!this.editing) return;

    const item = this.renderRoot.querySelector(`.grid-stack-item[data-card-id="${CSS.escape(id)}"]`);
    if (item) {
      this._suppressChange = true;
      this.grid?.removeWidget(item, false);
      this._suppressChange = false;
    }

    this.dispatchEvent(new CustomEvent("layout-remove", {
      detail: { id },
      bubbles: true,
      composed: true,
    }));
  }

  _moveLevel(id, target) {
    if (!this.editing) return;

    this.dispatchEvent(new CustomEvent("layout-level-change", {
      detail: { id, target },
      bubbles: true,
      composed: true,
    }));
  }

  _applyEditingMode() {
    if (!this.grid) return;
    this.grid.enableMove(this.editing);
    this.grid.enableResize(this.editing);
    this.renderRoot.querySelector(".grid-stack")?.classList.toggle("is-editing", this.editing);
  }

  _serializeLayout() {
    const fallback = new Map(this.layout.map((item) => [item.id, item]));
    return this.grid.engine.nodes
      .map((node) => {
        const id = node.id || node.el?.getAttribute("gs-id") || node.el?.dataset.cardId;
        const base = fallback.get(id) ?? {};
        return {
          ...base,
          id,
          x: node.x,
          y: node.y,
          w: node.w,
          h: node.h,
        };
      })
      .filter((item) => item.id)
      .sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  }

  static styles = [
    unsafeCSS(gridStackCss),
    css`
    :host {
      display: block;
    }

    .grid-shell {
      border-radius: 24px;
      transition: box-shadow 160ms ease, background 160ms ease;
    }

    .grid-shell.editing {
      background:
        linear-gradient(rgba(0, 229, 255, 0.06) 1px, transparent 1px),
        linear-gradient(90deg, rgba(0, 229, 255, 0.06) 1px, transparent 1px);
      background-size: calc(100% / 12) 86px;
      box-shadow: inset 0 0 0 1px rgba(37, 255, 210, 0.18);
      padding: 2px;
    }

    .grid-stack {
      min-height: 360px;
    }

    .grid-stack-item-content {
      border-radius: 20px;
      overflow: hidden;
      position: relative;
    }

    .grid-shell:not(.contained) .grid-stack.is-editing .grid-stack-item,
    .grid-shell:not(.contained) .grid-stack.is-editing .grid-stack-item-content {
      overflow: visible !important;
    }

    .grid-shell.contained,
    .grid-shell.contained .grid-stack,
    .grid-shell.contained .grid-stack-item,
    .grid-shell.contained .grid-stack-item-content {
      overflow: hidden !important;
    }

    .grid-shell.contained.editing {
      padding: 8px;
    }

    .grid-stack-item-content::after {
      border: 1px solid transparent;
      border-radius: 20px;
      content: "";
      inset: 0;
      pointer-events: none;
      position: absolute;
      transition: border-color 140ms ease, box-shadow 140ms ease;
      z-index: 4;
    }

    .card-content {
      height: 100%;
      pointer-events: auto;
    }

    .drag-handle,
    .remove-card,
    .level-card {
      align-items: center;
      background: linear-gradient(135deg, #25d8ff, #f054e8);
      border-radius: 999px;
      color: #03101a;
      cursor: grab;
      display: none;
      font-size: 0.68rem;
      font-weight: 1000;
      height: 26px;
      justify-content: center;
      letter-spacing: 0.08em;
      min-width: 62px;
      padding: 0 10px;
      position: absolute;
      right: 12px;
      text-transform: uppercase;
      top: 12px;
      z-index: 5;
    }

    .remove-card {
      border: 1px solid rgba(37, 255, 210, 0.38);
      cursor: pointer;
      display: none;
      height: 26px;
      min-width: 82px;
      right: 84px;
    }

    .level-card {
      border: 1px solid rgba(37, 255, 210, 0.38);
      cursor: pointer;
      display: none;
      height: 26px;
      min-width: 112px;
      right: 180px;
    }

    .compact-editor .drag-handle,
    .compact-editor .remove-card,
    .compact-editor .level-card {
      font-size: 0.58rem;
      height: 20px;
      min-width: 46px;
      padding: 0 7px;
      top: 6px;
    }

    .compact-editor .drag-handle {
      right: 8px;
    }

    .compact-editor .remove-card {
      min-width: 44px;
      right: 60px;
    }

    .compact-editor .level-card {
      min-width: 86px;
      right: 110px;
    }

    .compact-editor .edit-hint {
      display: none !important;
    }

    .compact-editor .card-content {
      box-sizing: border-box;
      height: 100%;
      padding-top: 26px;
    }

    .edit-hint {
      background: rgba(3, 16, 26, 0.84);
      border: 1px solid rgba(37, 255, 210, 0.42);
      border-radius: 999px;
      bottom: 12px;
      color: var(--heros-muted);
      display: none;
      font-size: 0.68rem;
      font-weight: 800;
      left: 12px;
      letter-spacing: 0.04em;
      padding: 4px 9px;
      pointer-events: none;
      position: absolute;
      text-transform: uppercase;
      z-index: 5;
    }

    .is-editing .grid-stack-item-content {
      cursor: grab;
    }

    .is-editing .grid-stack-item-content::after {
      border-color: rgba(37, 255, 210, 0.52);
      border-style: dashed;
      box-shadow: inset 0 0 0 1px rgba(0, 229, 255, 0.12);
    }

    .is-editing .grid-stack-item-content:active {
      cursor: grabbing;
    }

    .is-editing .drag-handle,
    .is-editing .remove-card,
    .is-editing .level-card,
    .is-editing .edit-hint {
      display: inline-flex;
      pointer-events: auto;
    }

    .is-editing .edit-hint {
      pointer-events: none;
    }

    .is-editing .card-content {
      pointer-events: none;
      user-select: none;
    }

    .grid-stack-placeholder > .placeholder-content {
      background: rgba(37, 255, 210, 0.14);
      border: 1px dashed rgba(37, 255, 210, 0.85);
      border-radius: 20px;
    }

    .is-editing .ui-resizable-handle {
      background: var(--heros-accent);
      border: 2px solid #03101a;
      border-radius: 999px;
      box-shadow: 0 0 14px rgba(0, 229, 255, 0.55);
      display: block !important;
      opacity: 1 !important;
    }

    .is-editing .ui-resizable-n,
    .is-editing .ui-resizable-s {
      height: 12px;
      left: 50%;
      margin-left: -26px;
      width: 52px;
    }

    .is-editing .ui-resizable-n {
      top: -7px;
    }

    .is-editing .ui-resizable-s {
      bottom: -7px;
    }

    .is-editing .ui-resizable-e,
    .is-editing .ui-resizable-w {
      height: 52px;
      margin-top: -26px;
      top: 50%;
      width: 12px;
    }

    .is-editing .ui-resizable-e {
      right: -7px;
    }

    .is-editing .ui-resizable-w {
      left: -7px;
    }

    .is-editing .ui-resizable-ne,
    .is-editing .ui-resizable-se,
    .is-editing .ui-resizable-sw,
    .is-editing .ui-resizable-nw {
      height: 18px;
      width: 18px;
    }

    .is-editing .ui-resizable-ne {
      right: -8px;
      top: -8px;
    }

    .is-editing .ui-resizable-se {
      bottom: -7px;
      right: -7px;
    }

    .is-editing .ui-resizable-sw {
      bottom: -8px;
      left: -8px;
    }

    .is-editing .ui-resizable-nw {
      left: -8px;
      top: -8px;
    }

    @media (max-width: 720px) {
      .grid-shell.editing {
        background-size: 100% 86px;
      }

      .grid-stack {
        min-height: 720px;
      }
    }
  `];
}

customElements.define("heros-editable-grid", EditableGrid);
