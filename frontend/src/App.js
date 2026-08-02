import { LitElement, css, html } from "lit";
import { createMockHemDataProvider } from "./services/hemDataProvider.js";
import "./components/HemShell.js";
import "./pages/BatteryPage.js";
import "./pages/ForecastPage.js";
import "./pages/HistoryPage.js";
import "./pages/OverviewPage.js";
import "./pages/PolicyPage.js";
import "./pages/PricingPage.js";
import "./pages/ReportPage.js";
import "./pages/SettingsPage.js";
import "./pages/SolarPage.js";

export class HemApp extends LitElement {
  static properties = {
    activePage: { type: String },
    hemState: { type: Object },
  };

  constructor() {
    super();
    this.activePage = "overview";
    this.dataProvider = createMockHemDataProvider();
    this.hemState = this.dataProvider.getSnapshot();
  }

  connectedCallback() {
    super.connectedCallback();
    this._syncPageFromLocation();
    window.addEventListener("hashchange", this._syncPageFromLocation);
  }

  disconnectedCallback() {
    window.removeEventListener("hashchange", this._syncPageFromLocation);
    super.disconnectedCallback();
  }

  _syncPageFromLocation = () => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    this.activePage = hash.get("hem_page") || "overview";
  };

  _selectPage(event) {
    const { page } = event.detail;
    window.location.hash = `hem_page=${page}`;
    this.activePage = page;
  }

  renderPage() {
    if (this.activePage === "pricing") {
      return html`<hem-pricing-page .hemState=${this.hemState}></hem-pricing-page>`;
    }

    if (this.activePage === "battery") {
      return html`<hem-battery-page .hemState=${this.hemState}></hem-battery-page>`;
    }

    if (this.activePage === "solar") {
      return html`<hem-solar-page .hemState=${this.hemState}></hem-solar-page>`;
    }

    if (this.activePage === "forecast") {
      return html`<hem-forecast-page .hemState=${this.hemState}></hem-forecast-page>`;
    }

    if (this.activePage === "history") {
      return html`<hem-history-page .hemState=${this.hemState}></hem-history-page>`;
    }

    if (this.activePage === "policy") {
      return html`<hem-policy-page .hemState=${this.hemState}></hem-policy-page>`;
    }

    if (this.activePage === "report") {
      return html`<hem-report-page .hemState=${this.hemState}></hem-report-page>`;
    }

    if (this.activePage === "settings") {
      return html`<hem-settings-page .hemState=${this.hemState}></hem-settings-page>`;
    }

    return html`<hem-overview-page .hemState=${this.hemState}></hem-overview-page>`;
  }

  render() {
    return html`
      <hem-shell
        .activePage=${this.activePage}
        @page-selected=${this._selectPage}
      >
        ${this.renderPage()}
      </hem-shell>
    `;
  }

  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
    }
  `;
}

customElements.define("hem-app", HemApp);
