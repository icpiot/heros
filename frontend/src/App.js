import { LitElement, css, html } from "lit";
import { createMockHerosDataProvider } from "./services/herosDataProvider.js";
import "./components/HerosShell.js";
import "./pages/BatteryPage.js";
import "./pages/ForecastPage.js";
import "./pages/ForecastSetupPage.js";
import "./pages/HistoryPage.js";
import "./pages/OverviewPage.js";
import "./pages/PolicyPage.js";
import "./pages/PricingPage.js";
import "./pages/ReportPage.js";
import "./pages/SettingsPage.js";
import "./pages/SolarPage.js";

export class HerosApp extends LitElement {
  static properties = {
    activePage: { type: String },
    herosState: { type: Object },
  };

  constructor() {
    super();
    this.activePage = "overview";
    this.dataProvider = createMockHerosDataProvider();
    this.herosState = this.dataProvider.getSnapshot();
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
    this.activePage = hash.get("heros_page") || "overview";
  };

  _selectPage(event) {
    const { page } = event.detail;
    window.location.hash = `heros_page=${page}`;
    this.activePage = page;
  }

  renderPage() {
    if (this.activePage === "pricing") {
      return html`<heros-pricing-page .herosState=${this.herosState}></heros-pricing-page>`;
    }

    if (this.activePage === "battery") {
      return html`<heros-battery-page .herosState=${this.herosState}></heros-battery-page>`;
    }

    if (this.activePage === "solar") {
      return html`<heros-solar-page .herosState=${this.herosState}></heros-solar-page>`;
    }

    if (this.activePage === "forecast") {
      return html`<heros-forecast-page .herosState=${this.herosState}></heros-forecast-page>`;
    }

    if (this.activePage === "forecast-setup") {
      return html`<heros-forecast-setup-page .herosState=${this.herosState}></heros-forecast-setup-page>`;
    }

    if (this.activePage === "history") {
      return html`<heros-history-page .herosState=${this.herosState}></heros-history-page>`;
    }

    if (this.activePage === "policy") {
      return html`<heros-policy-page .herosState=${this.herosState}></heros-policy-page>`;
    }

    if (this.activePage === "report") {
      return html`<heros-report-page .herosState=${this.herosState}></heros-report-page>`;
    }

    if (this.activePage === "settings") {
      return html`<heros-settings-page .herosState=${this.herosState}></heros-settings-page>`;
    }

    return html`<heros-overview-page .herosState=${this.herosState}></heros-overview-page>`;
  }

  render() {
    return html`
      <heros-shell
        .activePage=${this.activePage}
        @page-selected=${this._selectPage}
      >
        ${this.renderPage()}
      </heros-shell>
    `;
  }

  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
    }
  `;
}

customElements.define("heros-app", HerosApp);
