// Legacy contract markers: Archived report for ${this._escape(selectedDate)} is incomplete after; Archived report loaded for
const HEROS_REPORT_CARD_BUILD = "635";
const TODAY_HISTORY_REFRESH_MS = 60_000;
const HEROS_REPORT_CARD_TAG = `heros-report-card-${HEROS_REPORT_CARD_BUILD}`;
const HEROS_REPORT_PERIODS = [
  { value: "1h", label: "1H", minutes: 60 },
  { value: "6h", label: "6H", minutes: 360 },
  { value: "12h", label: "12H", minutes: 720 },
  { value: "24h", label: "24H", minutes: 1440 },
  { value: "day", label: "Day", minutes: 1440 },
  { value: "week", label: "Week", days: 7 },
  { value: "month", label: "Month", days: 31 },
  { value: "quarter", label: "Quarter", days: 92 },
  { value: "year", label: "Year", days: 366 },
];
const HEROS_STATISTICAL_PERIODS = [
  { value: "1h", label: "1H", minutes: 60 },
  { value: "6h", label: "6H", minutes: 360 },
  { value: "12h", label: "12H", minutes: 720 },
  { value: "24h", label: "24H", minutes: 1440 },
  { value: "day", label: "Day", minutes: 1440 },
  { value: "week", label: "Week", days: 7 },
  { value: "month", label: "Month", days: 31 },
  { value: "quarter", label: "Quarter", days: 92 },
  { value: "year", label: "Year", days: 366 },
];
const HEROS_ANALYSIS_VIEWS = new Set([
  "trend",
  "energy-flow",
  "self-sufficiency",
  "battery-compare",
  "battery-balance",
  "battery-flow",
  "peak-demand", "solar-capture", "forecast-accuracy", "predicted-actual", "solar-compare",
  "scope-health", "export-data", "day-compare", "seasonal-trend", "anomaly", "exception",
]);

class ByteWattReportCard extends HTMLElement {
  setConfig(config) {
    const prefix = config?.entity_prefix || "heros";
    this._config = {
      entity_prefix: prefix,
      settings_target: config?.settings_target || "select.heros_settings_target",
      ...config,
    };
    this._view = this._view || "power";
    this._historyRequestedKey = this._historyRequestedKey || "";
    this._activeSeries = this._activeSeries || {
      bat: true,
      load: true,
      solar: true,
      feed_in: true,
      consumed: true,
    };
    this._liveReportCacheByScope = this._liveReportCacheByScope || new Map();
    this._liveTimeSeriesCacheByScope = this._liveTimeSeriesCacheByScope || new Map();
    this._liveTimeSeriesCacheDate = this._liveTimeSeriesCacheDate || "";
    this._renderedReportCacheBySelection = this._renderedReportCacheBySelection || new Map();
    this._historyDataCacheBySource = this._historyDataCacheBySource || new Map();
    this._historyRefreshRequestedAt = this._historyRefreshRequestedAt || new Map();
    this._historyRefreshInFlight = this._historyRefreshInFlight || new Set();
    this._historyRefreshCompleted = this._historyRefreshCompleted || new Set();
    this._renderDeferredWhileSelectorOpen = this._renderDeferredWhileSelectorOpen || false;
    this._periodPreset = this._periodPreset || "24h";
    this._statisticalPeriod = this._statisticalPeriod || "24h";
    this._tariffPeriod = this._tariffPeriod || "day";
    this._tariffNavigationDate = this._tariffNavigationDate || "";
    this._historyFocusTime = this._historyFocusTime || "12:00";
    this._chartAnchorTime = this._chartAnchorTime || "";
    this._chartDataSignature = this._chartDataSignature || "";
    this._chartShouldAnimate = false;
    this._chartInteractionModel = this._chartInteractionModel || null;
    this._chartHoverRaf = this._chartHoverRaf || 0;
    this._chartHoverQueuedEvent = null;
    this._chartHoverPointKey = this._chartHoverPointKey || "";
  }

  set pendingSelection(option) {
    const next = String(option || "").trim();
    if (next === String(this._pendingSelection || "")) {
      return;
    }
    this._pendingSelection = next;
    if (!next || !this._hass || !this._hasRenderedReport() || !this._canInstantRenderPendingSelection()) {
      return;
    }
    this._selectionTransitionPending = true;
    this._hassRenderSignature = this._renderSignature();
    this.render();
  }

  set selectorOpen(value) {
    const next = Boolean(value);
    const previous = Boolean(this._selectorOpen);
    if (next === previous) {
      return;
    }
    this._selectorOpen = next;
    if (!next && this._renderDeferredWhileSelectorOpen && this._hasRenderedReport()) {
      this._renderDeferredWhileSelectorOpen = false;
      this._hassRenderSignature = this._renderSignature();
      this.render();
    }
  }

  set hass(hass) {
    const incomingSelector = this._config?.settings_target
      ? hass?.states?.[this._config.settings_target]
      : null;
    const incomingState = String(incomingSelector?.state || "").toLowerCase();
    if (this._hasRenderedReport() && (incomingState === "unknown" || incomingState === "unavailable")) {
      return;
    }
    const previousSignature = this._hassRenderSignature || "";
    this._hass = hass;
    const selectedDate = this._selectedReportDate();
    const selectedDateIsToday = this._isTodaySelection(selectedDate);
    const liveSeriesChanged = selectedDateIsToday
      ? this._captureLiveTimeSeriesSnapshots()
      : false;
    const pendingSelection = String(this._pendingSelection || "").trim();
    if (pendingSelection && this._pendingSelectionResolved(incomingSelector)) {
      this._pendingSelection = "";
    }
    const historicalSignature = selectedDateIsToday ? "" : this._historicalDisplaySignature();
    const previousHistoricalSignature = this._historicalDisplaySignatureLast || "";
    if (!selectedDateIsToday) {
      this._historicalDisplaySignatureLast = historicalSignature;
      if (this._hasRenderedReport() && previousHistoricalSignature && historicalSignature === previousHistoricalSignature && !pendingSelection) {
        return;
      }
    }
    const nextSignature = this._renderSignature();
    const shouldRefreshLiveSeries = Boolean(
      liveSeriesChanged
      && this._hasRenderedReport()
      && selectedDateIsToday
    );
    if (nextSignature !== previousSignature || shouldRefreshLiveSeries) {
      const selectedKey = this._selectionKey();
      if (this._lastSelectedKey && selectedKey && selectedKey !== this._lastSelectedKey) {
        this._selectionTransitionPending = true;
      }
      this._lastSelectedKey = selectedKey || this._lastSelectedKey || "";
      if (this._selectorOpen && !pendingSelection) {
        this._renderDeferredWhileSelectorOpen = true;
        this._hassRenderSignature = nextSignature;
        return;
      }
      if (this._shouldHoldSelectionRender()) {
        return;
      }
      this._hassRenderSignature = nextSignature;
      if (shouldRefreshLiveSeries && nextSignature === previousSignature && this._refreshReportBodyInPlace()) {
        return;
      }
      this.render();
    }
  }

  connectedCallback() {
    this._chartResizeObserver = new ResizeObserver(() => this._scheduleChartViewportMeasurement());
    this._chartResizeObserver.observe(this);
    this._scheduleChartViewportMeasurement();
    this._liveWindowTimer = window.setInterval(() => {
      if (!this._hass || !this._historyConfigured() || !this._isTodaySelection(this._selectedReportDate())) return;
      this._ensureHistoryForSelectedDate();
    }, TODAY_HISTORY_REFRESH_MS);
  }

  disconnectedCallback() {
    this._chartResizeObserver?.disconnect();
    this._chartResizeObserver = null;
    if (this._liveWindowTimer) {
      window.clearInterval(this._liveWindowTimer);
      this._liveWindowTimer = 0;
    }
    if (this._chartViewportMeasureRaf) {
      cancelAnimationFrame(this._chartViewportMeasureRaf);
      this._chartViewportMeasureRaf = 0;
    }
  }

  _scheduleChartViewportMeasurement() {
    if (this._chartViewportMeasureRaf) {
      cancelAnimationFrame(this._chartViewportMeasureRaf);
    }
    this._chartViewportMeasureRaf = requestAnimationFrame(() => {
      this._chartViewportMeasureRaf = 0;
      const stage = this.shadowRoot?.querySelector("[data-chart-stage]");
      const width = Math.floor(stage?.getBoundingClientRect().width || this.getBoundingClientRect().width || 0);
      if (width >= 900 && Math.abs(width - Number(this._chartViewportWidth || 0)) > 24) {
        this._chartViewportWidth = width;
        this.render();
      }
    });
  }

  getCardSize() {
    return 20;
  }

  _stateObj(entityId) {
    return entityId ? this._hass?.states?.[entityId] : null;
  }

  _allEntities() {
    return Object.values(this._hass?.states || {});
  }

  _entityByKey(key, domain = "sensor") {
    const keySuffix = `heros_${key}`;
    const baseEntityId = `${domain}.${keySuffix}`;
    return this._hass?.states?.[baseEntityId]
      || this._allEntities().find((entity) => {
        if (!entity?.entity_id?.startsWith(`${domain}.`)) {
          return false;
        }
        const objectId = entity.entity_id.slice(domain.length + 1).replace(/_\d+$/, "");
        return objectId === keySuffix || objectId.endsWith(`_${keySuffix}`);
      })
      || null;
  }

  _selectorState() {
    const selector = this._stateObj(this._config.settings_target);
    const state = String(selector?.state || "").toLowerCase();
    if (selector && state !== "unknown" && state !== "unavailable") {
      this._lastAvailableSelectorState = selector;
      return selector;
    }
    return this._lastAvailableSelectorState || selector;
  }

  _renderSignature() {
    const selector = this._selectorState();
    const reporting = selector?.attributes?.reporting || {};
    const history = selector?.attributes?.history || {};
    const selection = this._selectionMeta();
    const reportingMeta = reporting?.meta && typeof reporting.meta === "object" ? reporting.meta : {};
    const powerDiagram = reporting?.power_diagram && typeof reporting.power_diagram === "object"
      ? reporting.power_diagram
      : {};
    const selectedDate = this._selectedReportDate();
    const selectedDateIsToday = this._isTodaySelection(selectedDate);
    return JSON.stringify({
      settingsTarget: this._config?.settings_target || "",
      selectedTarget: selector?.state || "",
      selectedBattery: selection.sys_sn || selection.remark || selection.label || "",
      selectedAggregate: Boolean(selection.aggregate),
      pendingSelection: this._pendingSelection || "",
      selectedDate: this._historySelectedDate || "",
      reportingDate: selectedDateIsToday
        ? reporting.reporting_date || reportingMeta.reporting_date || powerDiagram.date || ""
        : selectedDate,
      historyUrl: this._historyUrl(),
      historyScope: history.current_scope || "all",
      view: this._view || "power",
      period: this._periodPreset || "24h",
      statisticalPeriod: this._statisticalPeriod || "24h",
      historyFocusTime: this._historyFocusTime || "12:00",
      chartAnchorTime: this._chartAnchorTime || "",
      activeSeries: this._activeSeries || {},
    });
  }

  _historicalDisplaySignature() {
    const selection = this._selectionMeta();
    return JSON.stringify({
      settingsTarget: this._config?.settings_target || "",
      selectedBattery: selection.sys_sn || selection.remark || selection.label || "",
      selectedAggregate: Boolean(selection.aggregate),
      pendingSelection: this._pendingSelection || "",
      selectedDate: this._selectedReportDate(),
      historyUrl: this._historyUrl(),
      historyScope: this._historyScopeKey(),
      view: this._view || "power",
      period: this._periodPreset || "24h",
      statisticalPeriod: this._statisticalPeriod || "24h",
      historyFocusTime: this._historyFocusTime || "12:00",
      chartAnchorTime: this._chartAnchorTime || "",
      activeSeries: this._activeSeries || {},
    });
  }

  _history() {
    return this._selectorState()?.attributes?.history || {};
  }

  _reporting() {
    return this._selectorState()?.attributes?.reporting || null;
  }

  _hasRenderedReport() {
    return Boolean(this.shadowRoot?.querySelector("ha-card"));
  }

  _reportingMatchesSelection() {
    const selectedKey = this._selectionKey();
    const reportingKey = this._reportingSelectionKey(this._reporting());
    return Boolean(selectedKey && reportingKey && selectedKey === reportingKey);
  }

  _pendingSelectionResolved(selector = this._selectorState()) {
    const pending = String(this._pendingSelection || "").trim();
    if (!pending || !selector) {
      return true;
    }
    const selectedOption = String(selector?.state || "").trim();
    if (!selectedOption || selectedOption !== pending) {
      return false;
    }
    const reporting = selector?.attributes?.reporting || {};
    const reportingSelection = reporting?.selection || {};
    const reportingKey = reporting?.aggregate
      ? "All systems"
      : String(
          reportingSelection.sys_sn
          || reportingSelection.system_id
          || reportingSelection.remark
          || reportingSelection.label
          || reporting?.label
          || ""
        ).trim();
    return pending === "All systems"
      ? Boolean(
          reporting?.aggregate
          || reportingSelection.label === "All systems"
          || reportingSelection.label === "All Batteries"
          || reporting.label === "All systems"
          || reporting.label === "All Batteries"
        )
      : Boolean(reportingKey && reportingKey === pending);
  }

  _shouldHoldSelectionRender() {
    if (!this._hasRenderedReport() || !this._selectionTransitionPending) {
      return false;
    }
    if (this._reportingMatchesSelection()) {
      this._selectionTransitionPending = false;
      return false;
    }
    return true;
  }

  _shouldFreezeWhileSelectorOpen() {
    return Boolean(
      this._selectorOpen
      && !String(this._pendingSelection || "").trim()
      && this._hasRenderedReport()
    );
  }

  _parseLocalDate(value) {
    if (!value) return null;
    const parsed = new Date(`${value}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  _formatLocalDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    const pad = (number) => String(number).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  _renderIsoDatePicker(dataAttribute, value, options = {}) {
    const inputType = options.inputType || "date";
    const max = options.max ? ` max="${this._escape(options.max)}"` : "";
    const label = options.label || "Choose report date";
    return `<span class="date-picker"><button type="button" class="date-picker__button" data-date-picker-open="${this._escape(dataAttribute)}" aria-label="${this._escape(label)}"><span>${this._escape(value)}</span><span class="date-picker__icon" aria-hidden="true">&#128197;</span></button><input class="date-picker__native" type="${this._escape(inputType)}" ${this._escape(dataAttribute)} value="${this._escape(value)}"${max} tabindex="-1" aria-hidden="true"></span>`;
  }

  _formatTimeLabel(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "now";
    const pad = (number) => String(number).padStart(2, "0");
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  _formatTimeLabelWithSeconds(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "now";
    const pad = (number) => String(number).padStart(2, "0");
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  _currentTimeSeriesPoint(now = new Date(), bucketSeconds = 10) {
    const sampled = new Date(now.getTime());
    const bucket = Math.max(1, Number(bucketSeconds) || 10);
    sampled.setMilliseconds(0);
    sampled.setSeconds(Math.floor(sampled.getSeconds() / bucket) * bucket);
    const hours = Number(sampled.getHours()) || 0;
    const minutes = Number(sampled.getMinutes()) || 0;
    const seconds = Number(sampled.getSeconds()) || 0;
    return {
      label: this._formatTimeLabelWithSeconds(sampled),
      minutesOfDay: hours * 60 + minutes + seconds / 60,
      secondsOfDay: hours * 3600 + minutes * 60 + seconds,
      savedAt: sampled.toISOString(),
    };
  }

  _timeLabelToMinutesOfDay(label) {
    const text = String(label || "").trim().toLowerCase();
    if (!text) return null;
    if (text === "now") {
      return this._currentTimeSeriesPoint().minutesOfDay;
    }
    const match = text.match(/(?:^|\s)(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s|$)/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3] || 0);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
      return null;
    }
    return hours * 60 + minutes + seconds / 60;
  }

  _timeLabelRatio(label) {
    const minutesOfDay = this._timeLabelToMinutesOfDay(label);
    if (!Number.isFinite(minutesOfDay)) {
      return null;
    }
    return Math.min(Math.max(minutesOfDay / (24 * 60), 0), 1);
  }

  _displayTimeLabel(label) {
    const text = String(label || "").trim();
    const match = text.match(/(?:^|\s)(\d{1,2}:\d{2})(?::\d{2})?(?:\s|$)/);
    return match ? match[1] : text;
  }

  _todayLocalDate() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  _todayDateString() {
    return this._formatLocalDate(this._todayLocalDate());
  }

  _selectedReportDate() {
    return String(
      this._historySelectedDate
      || this._todayDateString()
    ).trim();
  }

  _isFullDayPeriod() {
    return this._chartPeriodMinutes() >= 24 * 60;
  }

  _normalizedFocusTime(value) {
    const text = String(value || "").trim();
    const match = text.match(/^(\d{1,2}):(\d{2})/);
    if (!match) {
      return "12:00";
    }
    const hours = Math.min(Math.max(Number(match[1]) || 0, 0), 23);
    const minutes = Math.min(Math.max(Number(match[2]) || 0, 0), 59);
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  _historyFocusMinutes() {
    const minutes = this._timeLabelToMinutesOfDay(this._normalizedFocusTime(this._chartAnchorTime || this._historyFocusTime));
    return Number.isFinite(minutes) ? minutes : 12 * 60;
  }

  _resetHistoricalPeriodForDate(selectedDate = this._selectedReportDate()) {
    if (!this._isTodaySelection(selectedDate)) {
      this._periodPreset = "24h";
      this._historyFocusTime = "12:00";
      this._chartAnchorTime = "";
    }
  }

  _hasManualDateSelection() {
    return Boolean(String(this._historySelectedDate || "").trim());
  }

  _historyConfigured() {
    const history = this._history();
    return Boolean(history?.enabled || history?.base_url || history?.entry_id);
  }

  _historyUrl() {
    const history = this._history();
    const explicitBase = String(history?.base_url || "").trim();
    const entryId = String(history?.entry_id || "").trim();
    const base = explicitBase
      ? explicitBase.replace(/\/+$/, "")
      : entryId
        ? `/local/heros-history/${entryId}`
        : "";
    if (!base) return "";
    return `${base}/history.json`;
  }

  _historyScopes() {
    const remoteScopes = this._historyData?.scopes;
    return remoteScopes && typeof remoteScopes === "object" ? remoteScopes : {};
  }

  _historyCacheKey() {
    return this._historyUrl();
  }

  _historyScopeKey() {
    const selection = this._selectionMeta();
    if (selection.aggregate) {
      return "all";
    }
    return String(selection.sys_sn || selection.system_id || this._history().current_scope || "all").trim() || "all";
  }

  _historyScopeData() {
    const scopes = this._historyScopes();
    const requested = this._historyScopeKey();
    // Never replace All Batteries with a detailed individual-battery archive.
    // The selector label and the data scope must always describe the same data.
    return { requested, key: requested, scope: scopes?.[requested] || null };
  }
  _powerDiagramFromRecord(record) {
    if (!record || typeof record !== "object") return {};
    const nested = record.power_diagram;
    if (nested && typeof nested === "object" && !Array.isArray(nested) && Object.keys(nested).length) {
      return nested;
    }
    const bareKeys = ["time", "series", "summary", "date", "meta"];
    const hasBarePowerDiagram = bareKeys.some((key) => Object.prototype.hasOwnProperty.call(record, key));
    return hasBarePowerDiagram ? record : {};
  }

  _recordHasPowerDiagramData(record) {
    const powerDiagram = this._powerDiagramFromRecord(record);
    if (!powerDiagram || !Object.keys(powerDiagram).length) return false;
    if (Array.isArray(powerDiagram.time) && powerDiagram.time.length > 0) return true;
    const series = powerDiagram.series && typeof powerDiagram.series === "object" ? powerDiagram.series : {};
    return Object.values(series).some((value) => Array.isArray(value) && value.length > 0);
  }

  _recordHasRichPowerDiagramData(record) {
    if (!this._recordHasPowerDiagramData(record)) {
      return false;
    }
    const powerDiagram = this._powerDiagramFromRecord(record);
    const timeCount = Array.isArray(powerDiagram.time) ? powerDiagram.time.length : 0;
    const series = powerDiagram.series && typeof powerDiagram.series === "object" ? powerDiagram.series : {};
    const seriesCount = Math.max(
      0,
      ...Object.values(series).map((value) => Array.isArray(value) ? value.length : 0),
    );
    const pointCount = Math.max(timeCount, seriesCount);
    const sourceDetail = String(
      powerDiagram?.meta?.source_detail
      || record?.meta?.source_detail
      || ""
    ).trim();
    if (sourceDetail === "synthesized_from_backend_snapshot" && pointCount <= 2) {
      return false;
    }
    return pointCount > 2;
  }

  _chartValueAt(series, key, index) {
    const values = series && typeof series === "object" ? series[key] : null;
    if (!Array.isArray(values) || index < 0 || index >= values.length) {
      return null;
    }
    const numeric = Number(values[index]);
    return Number.isFinite(numeric) ? numeric : null;
  }

  _lastMeaningfulChartIndex(powerDiagram) {
    const time = Array.isArray(powerDiagram?.time) ? powerDiagram.time : [];
    const series = powerDiagram?.series && typeof powerDiagram.series === "object" ? powerDiagram.series : {};
    const count = Math.max(
      time.length,
      ...Object.values(series).map((value) => Array.isArray(value) ? value.length : 0),
    );
    for (let index = count - 1; index >= 0; index -= 1) {
      const values = ["bat", "load", "solar", "feed_in", "consumed"]
        .map((key) => this._chartValueAt(series, key, index))
        .filter((value) => value !== null);
      if (values.some((value) => Math.abs(value) > 0.0001)) {
        return index;
      }
    }
    return count > 0 ? count - 1 : -1;
  }

  _lastProviderFlowChartIndex(powerDiagram) {
    const time = Array.isArray(powerDiagram?.time) ? powerDiagram.time : [];
    const series = powerDiagram?.series && typeof powerDiagram.series === "object" ? powerDiagram.series : {};
    const count = Math.max(
      time.length,
      ...Object.values(series).map((value) => Array.isArray(value) ? value.length : 0),
    );
    // A current Bytewatt response can keep five-minute labels through 24:00
    // while zero-filling every future flow value. SoC is deliberately excluded:
    // it may be supplied independently and must not extend the flow cutoff.
    const flowKeys = ["load", "solar", "feed_in", "grid_import", "consumed", "battery_charge", "bat_discharge"];
    for (let index = count - 1; index >= 0; index -= 1) {
      if (flowKeys.some((key) => {
        const value = this._chartValueAt(series, key, index);
        return value !== null && Math.abs(value) > 0.0001;
      })) {
        return index;
      }
    }
    return -1;
  }

  _providerDataCutoffMinutes(powerDiagram, labels = []) {
    const explicit = this._timeLabelToMinutesOfDay(powerDiagram?.meta?.loaded_through || "");
    const lastFlowIndex = this._lastProviderFlowChartIndex(powerDiagram);
    const inferred = this._timeLabelToMinutesOfDay(labels[lastFlowIndex] || "");
    // The last actual provider sample is authoritative. loaded_through may be
    // the refresh clock rounded beyond the final five-minute dataset point.
    return Number.isFinite(inferred) ? inferred : (Number.isFinite(explicit) ? explicit : null);
  }
  _powerDiagramHasTrailingPlaceholderTail(powerDiagram) {
    const time = Array.isArray(powerDiagram?.time) ? powerDiagram.time : [];
    if (time.length < 12) {
      return false;
    }
    const lastMeaningful = this._lastMeaningfulChartIndex(powerDiagram);
    if (lastMeaningful < 0 || lastMeaningful >= time.length - 1) {
      return false;
    }
    const tail = time.slice(lastMeaningful + 1);
    const tailStartsLate = tail.some((label) => {
      const minutes = this._timeLabelToMinutesOfDay(label);
      return Number.isFinite(minutes) && minutes >= 23 * 60;
    });
    return tailStartsLate && tail.length >= 3;
  }

  _trimTrailingPlaceholderTail(powerDiagram) {
    if (!this._powerDiagramHasTrailingPlaceholderTail(powerDiagram)) {
      return powerDiagram;
    }
    const lastMeaningful = this._lastMeaningfulChartIndex(powerDiagram);
    const trimmed = this._clonePlain(powerDiagram || {});
    trimmed.time = Array.isArray(powerDiagram.time) ? powerDiagram.time.slice(0, lastMeaningful + 1) : [];
    const series = powerDiagram.series && typeof powerDiagram.series === "object" ? powerDiagram.series : {};
    trimmed.series = Object.fromEntries(
      Object.entries(series).map(([key, values]) => [
        key,
        Array.isArray(values) ? values.slice(0, lastMeaningful + 1) : values,
      ]),
    );
    trimmed.meta = {
      ...(trimmed.meta || {}),
      incomplete_tail: true,
      loaded_through: trimmed.time[trimmed.time.length - 1] || "",
    };
    return trimmed;
  }

  _powerDiagramHasMissingProviderSeries(powerDiagram) {
    const time = Array.isArray(powerDiagram?.time) ? powerDiagram.time : [];
    if (time.length < 2) return false;
    const series = powerDiagram?.series && typeof powerDiagram.series === "object" ? powerDiagram.series : {};
    // Bytewatt's provider chart supplies SoC, solar, load, and feed-in.
    // Charge/discharge traces are FoxESS-specific and must not make an
    // otherwise complete Bytewatt archive appear incomplete.
    const providerSource = String(powerDiagram?.meta?.source || "").trim().toLowerCase();
    const expected = providerSource === "provider"
      ? ["bat", "solar", "feed_in", "load"]
      : ["bat", "solar", "bat_discharge", "grid_import", "feed_in", "battery_charge", "load"];
    return expected.some((key) => !Array.isArray(series[key]) || series[key].length < time.length);
  }

  _historyRecordNeedsRefresh(record, selectedDate = this._selectedReportDate()) {
    if (!record || this._isTodaySelection(selectedDate)) {
      return false;
    }
    const powerDiagram = this._powerDiagramFromRecord(record);
    const times = Array.isArray(powerDiagram?.time) ? powerDiagram.time : [];
    const last = String(times[times.length - 1] || "");
    const match = last.match(/(\d{1,2}):(\d{2})/);
    const lastMinutes = match ? Number(match[1]) * 60 + Number(match[2]) : null;
    const hasEarlyCutoff = Number.isFinite(lastMinutes) && lastMinutes < (23 * 60 + 55);
    return hasEarlyCutoff
      || this._powerDiagramHasTrailingPlaceholderTail(powerDiagram)
      || this._powerDiagramHasMissingProviderSeries(powerDiagram);
  }

  _historyRecordForDate(dateKey) {
    const scopeInfo = this._historyScopeData();
    const records = scopeInfo.scope?.records || {};
    const record = records?.[dateKey] || null;
    if (!this._recordHasPowerDiagramData(record)) {
      return null;
    }
    const powerDiagramSource = String(
      record?.meta?.power_diagram_source
      || record?.power_diagram?.meta?.source_detail
      || ""
    ).trim();
    if (powerDiagramSource === "synthesized_from_backend_snapshot" && !this._recordHasRichPowerDiagramData(record)) {
      return null;
    }
    return record;
  }

  async _reloadHistory() {
    const url = this._historyUrl();
    if (!url) return;
    const historyKey = this._historyCacheKey();
    this._historyLoading = true;
    this._historyLoadingKey = historyKey;
    this._historyLoadError = "";
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`History fetch failed (${response.status})`);
      }
      const payload = await response.json();
      this._historyData = payload && typeof payload === "object" ? payload : null;
      if (this._historyData) {
        this._historyDataCacheBySource = this._historyDataCacheBySource || new Map();
        this._historyDataCacheBySource.set(historyKey, this._historyData);
      }
    } catch (error) {
      this._historyLoadError = String(error?.message || error || "History fetch failed");
    } finally {
      this._historyLoading = false;
      this._historyLoadingKey = "";
      this.render();
    }
  }

  async _ensureHistoryForSelectedDate() {
    if (!this._hass || !this._historyConfigured()) return;
    const selectedDate = this._selectedReportDate();
    if (!selectedDate) return;
    if (this._view === "tariff" && this._tariffPeriod !== "day") {
      // Grouped periods always use the local archive. Do not request FoxESS for
      // calendar days that predate installation or have not been archived.
      if (!this._historyData) {
        if (!this._historyLoading) await this._reloadHistory();
        return;
      }
      return;
    }
    const isToday = this._isTodaySelection(selectedDate);
    const scopeKey = this._historyScopeKey();
    const selectedRecord = this._historyRecordForDate(selectedDate);
    const hasRecord = Boolean(selectedRecord);
    const needsRefresh = this._historyRecordNeedsRefresh(selectedRecord, selectedDate);
    if (!isToday && hasRecord && !needsRefresh) return;
    const requestKey = `${scopeKey}|${selectedDate}|${isToday ? "today" : needsRefresh ? "incomplete" : "archive"}`;
    const now = Date.now();
    const lastRequestedAt = Number(this._historyRefreshRequestedAt?.get(requestKey) || 0);
    if (isToday && hasRecord && now - lastRequestedAt < TODAY_HISTORY_REFRESH_MS) return;
    if (!isToday && this._historyRefreshCompleted?.has(requestKey)) return;
    if (this._historyRefreshInFlight?.has(requestKey)) return;
    if (!isToday && this._historyRequestedKey === requestKey) return;
    if (this._historyLoading && this._historyLoadingKey === this._historyCacheKey()) return;
    this._historyRequestedKey = requestKey;
    this._historyRefreshInFlight = this._historyRefreshInFlight || new Set();
    this._historyRefreshInFlight.add(requestKey);
    this._historyRefreshRequestedAt = this._historyRefreshRequestedAt || new Map();
    this._historyRefreshRequestedAt.set(requestKey, now);
    const history = this._history();
    const payload = {
      scope_key: scopeKey,
      start_date: selectedDate,
      end_date: selectedDate,
      force: isToday || needsRefresh,
    };
    if (history?.entry_id) payload.entry_id = history.entry_id;
    try {
      await this._hass.callService("heros", "ensure_report_history", payload);
      await this._reloadHistory();
    } catch (error) {
      this._historyLoadError = String(error?.message || error || "History download failed");
      this.render();
    } finally {
      this._historyRefreshInFlight?.delete(requestKey);
      if (!isToday) {
        this._historyRefreshCompleted = this._historyRefreshCompleted || new Set();
        this._historyRefreshCompleted.add(requestKey);
      }
    }
  }

  _timeSeriesPointCount(reporting) {
    const powerDiagram = reporting?.power_diagram || {};
    const timeCount = Array.isArray(powerDiagram.time) ? powerDiagram.time.length : 0;
    const series = powerDiagram.series && typeof powerDiagram.series === "object" ? powerDiagram.series : {};
    const seriesCount = Math.max(
      0,
      ...Object.values(series).map((value) => Array.isArray(value) ? value.length : 0),
    );
    return Math.max(timeCount, seriesCount);
  }

  _lastDisplayedTimeSeriesReport(selectedDate) {
    const last = this._lastReportingForDisplay?.reporting;
    if (!last || this._timeSeriesPointCount(last) <= 2) {
      return null;
    }
    const requestedDate = String(selectedDate || "").trim();
    const lastDate = String(last?.power_diagram?.date || last?.reporting_date || "").trim();
    if (requestedDate && lastDate && requestedDate !== lastDate) {
      return null;
    }
    const snapshot = this._clonePlain(last);
    snapshot.reporting_date = selectedDate || snapshot.reporting_date || this._formatLocalDate(this._todayLocalDate());
    snapshot.meta = {
      ...(snapshot.meta || {}),
      source: "backend_reporting",
      source_detail: "previous_chart_refreshing",
      storage: "local_archive_memory",
      power_diagram_source: "previous_chart_snapshot",
      reporting_date: snapshot.reporting_date,
    };
    snapshot.power_diagram = {
      ...(snapshot.power_diagram || {}),
      date: snapshot.reporting_date,
    };
    return snapshot;
  }

  _lastDisplayedTimeSeriesReportForSelection(selection, selectedDate) {
    const selectionKey = this._selectionKey(selection);
    const lastKey = this._reportingSelectionKey(this._lastReportingForDisplay?.reporting);
    if (!selectionKey || !lastKey || selectionKey !== lastKey) {
      return null;
    }
    return this._lastDisplayedTimeSeriesReport(selectedDate);
  }

  _reportCacheKey(selection, selectedDate) {
    const selectionKey = this._selectionKey(selection);
    const dateKey = String(selectedDate || "").trim();
    if (!selectionKey || !dateKey) {
      return "";
    }
    return `${dateKey}|${selectionKey}`;
  }

  _cacheRenderedReport(selection, selectedDate, reporting) {
    const key = this._reportCacheKey(selection, selectedDate);
    if (!key || !reporting) {
      return;
    }
    if (
      String(reporting?.meta?.power_diagram_source || "").trim() === "synthesized_from_backend_snapshot"
      && this._timeSeriesPointCount(reporting) <= 2
    ) {
      return;
    }
    if (this._timeSeriesPointCount(reporting) <= 2 && !this._hasUsefulLiveValues(reporting)) {
      return;
    }
    this._renderedReportCacheBySelection = this._renderedReportCacheBySelection || new Map();
    this._renderedReportCacheBySelection.set(key, this._clonePlain(reporting));
  }

  _cachedRenderedReportForSelection(selection, selectedDate, sourceDetail = "cached_scope_refreshing") {
    const key = this._reportCacheKey(selection, selectedDate);
    const cached = this._renderedReportCacheBySelection?.get(key);
    if (!cached) {
      return null;
    }
    const snapshot = this._clonePlain(cached);
    const displaySelection = selection?.aggregate
      ? { label: "All Batteries", aggregate: true, system_id: "", sys_sn: "All", remark: "" }
      : selection;
    snapshot.aggregate = Boolean(selection?.aggregate);
    snapshot.label = selection?.aggregate
      ? "All Batteries"
      : selection?.remark || selection?.sys_sn || selection?.label || snapshot.label || "Selected battery";
    snapshot.selection = displaySelection;
    snapshot.reporting_date = selectedDate || snapshot.reporting_date || this._formatLocalDate(this._todayLocalDate());
    snapshot.meta = {
      ...(snapshot.meta || {}),
      source_detail: sourceDetail,
      storage: "selection_memory_cache",
      reporting_date: snapshot.reporting_date,
    };
    snapshot.power_diagram = {
      ...(snapshot.power_diagram || {}),
      date: snapshot.reporting_date,
      meta: {
        ...((snapshot.power_diagram || {}).meta || {}),
        source_detail: sourceDetail,
      },
    };
    return snapshot;
  }

  _normalizeReportingForSelection(reporting, selection = this._selectionMeta(), selectedDate = this._selectedReportDate()) {
    const snapshot = this._clonePlain(reporting || {});
    if (!snapshot || typeof snapshot !== "object") {
      return snapshot;
    }
    const displaySelection = selection?.aggregate
      ? { label: "All Batteries", aggregate: true, system_id: "", sys_sn: "All", remark: "" }
      : this._clonePlain(selection || snapshot.selection || {});
    const reportDate = selectedDate
      || snapshot.reporting_date
      || snapshot?.power_diagram?.date
      || this._todayDateString();
    snapshot.aggregate = Boolean(selection?.aggregate);
    snapshot.label = selection?.aggregate
      ? "All Batteries"
      : selection?.remark || selection?.sys_sn || selection?.label || snapshot.label || "Selected battery";
    snapshot.selection = displaySelection;
    snapshot.reporting_date = reportDate;
    snapshot.meta = {
      ...(snapshot.meta || {}),
      reporting_date: reportDate,
    };
    snapshot.power_diagram = {
      ...(snapshot.power_diagram || {}),
      date: reportDate,
    };
    return snapshot;
  }

  _overlayLiveSummaryOnReport(baseReporting, liveReporting, selection, selectedDate, sourceDetail = "live_scope_overlay") {
    const base = this._clonePlain(baseReporting || {});
    const liveSource = liveReporting?.live && typeof liveReporting.live === "object" ? liveReporting.live : {};
    const baseLive = base.live && typeof base.live === "object" ? base.live : {};
    const powerDiagram = base.power_diagram && typeof base.power_diagram === "object" ? base.power_diagram : {};
    const summary = powerDiagram.summary && typeof powerDiagram.summary === "object" ? powerDiagram.summary : {};
    const reportDate = selectedDate || base.reporting_date || powerDiagram.date || this._todayDateString();
    const live = {
      ...baseLive,
      ...liveSource,
    };
    base.label = selection.aggregate
      ? "All Batteries"
      : selection.remark || selection.sys_sn || selection.label || base.label || "Selected battery";
    base.aggregate = Boolean(selection.aggregate);
    base.selection = selection.aggregate
      ? { label: "All Batteries", aggregate: true, system_id: "", sys_sn: "All", remark: "" }
      : this._clonePlain(selection);
    base.reporting_date = reportDate;
    base.live = live;
    base.meta = {
      ...(base.meta || {}),
      source: "live_direct_api",
      source_detail: sourceDetail,
      storage: "live_scope_overlay",
      power_diagram_source: String(base.meta?.power_diagram_source || "").trim() || "provider_power_diagram",
      reporting_date: reportDate,
    };
    base.power_diagram = {
      ...powerDiagram,
      date: reportDate,
      meta: {
        ...(powerDiagram.meta || {}),
        loaded_through: liveReporting?.power_diagram?.meta?.loaded_through || powerDiagram.meta?.loaded_through || "",
      },
      summary: {
        ...summary,
        soc: live.soc ?? summary.soc ?? null,
        battery_power: live.battery_power ?? summary.battery_power ?? null,
        // These are cumulative kWh counters. Do not replace them with the
        // instantaneous W values used by the chart and live hero readings.
        load_consumption: summary.load_consumption ?? null,
        grid_consumption: summary.grid_consumption ?? null,
        solar_generation: summary.solar_generation ?? null,
        feed_in: summary.feed_in ?? null,
      },
    };
    return base;
  }

  _mergeTodayTotalsIntoLiveTimeSeriesReport(reporting, entry, selection) {
    const snapshot = this._clonePlain(reporting || {});
    if (!snapshot || !entry || !selection?.aggregate) {
      return snapshot;
    }
    const derivedToday = this._liveTimeSeriesTodaySummary(entry);
    snapshot.today = {
      ...((snapshot.today && typeof snapshot.today === "object") ? snapshot.today : {}),
      ...derivedToday,
    };
    snapshot.power_diagram = {
      ...(snapshot.power_diagram || {}),
      summary: {
        ...((snapshot.power_diagram || {}).summary || {}),
        solar_generation: derivedToday.solar_generation,
        load_consumption: derivedToday.load_consumption,
        feed_in: derivedToday.feed_in,
        grid_consumption: derivedToday.grid_consumption,
        battery_charge: derivedToday.battery_charge,
        battery_discharge: derivedToday.battery_discharge,
      },
    };
    return snapshot;
  }

  _reportingForDisplay() {
    const currentSelection = this._selectionMeta();
    const selectedKey = this._selectionKey(currentSelection);
    const rawReporting = this._reporting();
    const hasBackendReporting = rawReporting && typeof rawReporting === "object" && Object.keys(rawReporting).length > 0;
    const reporting = hasBackendReporting
      ? rawReporting
      : this._lastReportingForDisplay?.reporting || this._synthesizedReporting();
    const selectedDate = this._selectedReportDate();
    this._primeLiveReportCache(reporting, selectedDate);
    if (!hasBackendReporting && selectedKey && !currentSelection.aggregate) {
      const displayState = {
        reporting: this._normalizeReportingForSelection(
          this._selectedBatteryPendingReporting(reporting, currentSelection, selectedDate),
          currentSelection,
          selectedDate
        ),
        selectedDate,
        usingHistory: false,
        missingHistory: false,
        transient: true,
      };
      this._lastReportingForDisplay = displayState;
      return displayState;
    }
    const reportingKey = this._reportingSelectionKey(reporting);
    const selectedRecord = this._historyRecordForDate(selectedDate);
    const liveDate = String(reporting?.power_diagram?.date || reporting?.reporting_date || "").trim();
    const cachedReport = this._cachedRenderedReportForSelection(currentSelection, selectedDate);
    if (this._isTodaySelection(selectedDate)) {
      const usingDefaultTodayDate = !this._hasManualDateSelection();
      const richSelectedRecord = this._recordHasRichPowerDiagramData(selectedRecord) ? selectedRecord : null;
      const liveReporting = currentSelection.aggregate
        ? this._aggregatePendingReporting(reporting, currentSelection, selectedDate)
        : this._selectedBatteryPendingReporting(reporting, currentSelection, selectedDate);
      this._cacheLiveReport(liveReporting);
      const liveTimeSeriesReport = this._cachedLiveTimeSeriesReportForSelection(
        currentSelection,
        selectedDate,
        reporting,
        "today_live_timeseries"
      );
      const richArchiveReport = richSelectedRecord ? this._overlayLiveSummaryOnReport({
        ...this._clonePlain(reporting || {}),
        power_diagram: {
          ...((reporting?.power_diagram && typeof reporting.power_diagram === "object") ? reporting.power_diagram : {}),
          ...this._powerDiagramFromRecord(richSelectedRecord),
        },
        reporting_date: selectedDate,
      }, liveReporting, currentSelection, selectedDate, "today_archive_overlay") : null;
      const cachedRichReport = cachedReport && this._timeSeriesPointCount(cachedReport) > 2 ? cachedReport : null;
      const richTodayReport = this._timeSeriesPointCount(reporting) > 2
        && this._reportingSelectionKey(reporting) === selectedKey
        && (
          !selectedDate
          || !liveDate
          || selectedDate === liveDate
          || usingDefaultTodayDate
        )
        ? this._normalizeReportingForSelection(this._clonePlain(reporting), currentSelection, selectedDate)
        : richArchiveReport
          || cachedRichReport
          || this._lastDisplayedTimeSeriesReportForSelection(currentSelection, selectedDate)
          || cachedReport;
      const preferLiveTimeSeriesReport = Boolean(
        liveTimeSeriesReport
        && (
          !richTodayReport
          || this._timeSeriesPointCount(richTodayReport) <= 2
        )
      );
      const displayReporting = this._normalizeReportingForSelection((preferLiveTimeSeriesReport ? liveTimeSeriesReport : null)
        || (richTodayReport && this._hasUsefulLiveValues(liveReporting)
          ? this._overlayLiveSummaryOnReport(richTodayReport, liveReporting, currentSelection, selectedDate, "today_live_overlay")
          : this._hasUsefulLiveValues(liveReporting)
            ? liveReporting
            : richTodayReport || liveReporting), currentSelection, selectedDate);
      const displayState = {
        reporting: displayReporting,
        selectedDate,
        usingHistory: false,
        missingHistory: !richSelectedRecord,
      };
      this._lastReportingForDisplay = displayState;
      return displayState;
    }
    const selectionMismatch = Boolean(selectedKey && reportingKey && selectedKey !== reportingKey);
    if (!selectedRecord) {
      if (cachedReport) {
        const displayState = {
          reporting: this._normalizeReportingForSelection(cachedReport, currentSelection, selectedDate),
          selectedDate,
          usingHistory: true,
          missingHistory: true,
        };
        this._lastReportingForDisplay = displayState;
        return displayState;
      }
      if (selectedDate && selectedDate !== liveDate) {
        if (selectionMismatch) {
          const displayState = {
            reporting: this._normalizeReportingForSelection(currentSelection.aggregate
              ? this._aggregatePendingReporting(reporting, currentSelection, selectedDate)
              : this._selectedBatteryPendingReporting(reporting, currentSelection, selectedDate), currentSelection, selectedDate),
            selectedDate,
            usingHistory: false,
            missingHistory: true,
          };
          this._lastReportingForDisplay = displayState;
          return displayState;
        }
        const displayState = {
          reporting: this._normalizeReportingForSelection(currentSelection.aggregate
            ? this._archivePendingReporting(reporting, selectedDate)
            : this._selectedBatteryPendingReporting(reporting, currentSelection, selectedDate), currentSelection, selectedDate),
          selectedDate,
          usingHistory: false,
          missingHistory: true,
        };
        this._lastReportingForDisplay = displayState;
        return displayState;
      }
      if (selectionMismatch) {
        const displayState = {
          reporting: this._normalizeReportingForSelection(currentSelection.aggregate
            ? this._aggregatePendingReporting(reporting, currentSelection, selectedDate)
            : this._selectedBatteryPendingReporting(reporting, currentSelection, selectedDate), currentSelection, selectedDate),
          selectedDate,
          usingHistory: false,
          missingHistory: false,
        };
        this._lastReportingForDisplay = displayState;
        return displayState;
      }
      const displayState = {
        reporting: this._normalizeReportingForSelection(reporting, currentSelection, selectedDate),
        selectedDate,
        usingHistory: false,
        missingHistory: false,
      };
      this._lastReportingForDisplay = displayState;
      this._cacheRenderedReport(currentSelection, selectedDate, reporting);
      return displayState;
    }
    const snapshot = JSON.parse(JSON.stringify(reporting || {}));
    const historicalPowerDiagram = this._powerDiagramFromRecord(selectedRecord);
    const historicalNeedsRefresh = this._historyRecordNeedsRefresh(selectedRecord, selectedDate);
    const displayPowerDiagram = this._trimTrailingPlaceholderTail(historicalPowerDiagram);
    snapshot.aggregate = Boolean(currentSelection.aggregate);
    snapshot.label = currentSelection.aggregate
      ? "All Batteries"
      : currentSelection.remark || currentSelection.sys_sn || currentSelection.label || snapshot.label || "Selected battery";
    snapshot.selection = currentSelection.aggregate
      ? { label: "All Batteries", aggregate: true, system_id: "", sys_sn: "All", remark: "" }
      : currentSelection;
    snapshot.reporting_date = selectedDate;
    snapshot.power_diagram = {
      ...(snapshot.power_diagram || {}),
      ...displayPowerDiagram,
      date: selectedDate,
      meta: {
        ...((snapshot.power_diagram || {}).meta || {}),
        ...(displayPowerDiagram.meta || {}),
      },
      summary: {
        ...((snapshot.power_diagram || {}).summary || {}),
        ...(displayPowerDiagram.summary || {}),
      },
      time: Array.isArray(displayPowerDiagram.time) ? displayPowerDiagram.time : [],
      series: displayPowerDiagram.series && typeof displayPowerDiagram.series === "object"
        ? displayPowerDiagram.series
        : {},
    };
    snapshot.meta = {
      ...(snapshot.meta || {}),
      source: "backend_reporting",
      storage: "local_archive",
      power_diagram_source: "provider_power_diagram",
      reporting_date: selectedDate,
      archive_selected_date: selectedDate,
      archive_scope: this._historyScopeKey(),
      archive_incomplete_tail: historicalNeedsRefresh,
    };
    const displayState = {
      reporting: snapshot,
      selectedDate,
      usingHistory: true,
      missingHistory: historicalNeedsRefresh,
      incompleteHistory: historicalNeedsRefresh,
    };
    this._lastReportingForDisplay = displayState;
    this._cacheRenderedReport(currentSelection, selectedDate, snapshot);
    return displayState;
  }

  _clonePlain(value) {
    return value && typeof value === "object"
      ? JSON.parse(JSON.stringify(value))
      : value;
  }

  _hasUsefulLiveValues(reporting) {
    const live = reporting?.live || {};
    const summary = reporting?.power_diagram?.summary || {};
    return ["soc", "battery_power", "house_consumption", "grid_power", "pv_power"].some((key) => {
      const liveValue = live[key];
      const summaryValue = summary[key === "house_consumption" ? "load_consumption" : key];
      return liveValue !== undefined && liveValue !== null
        || summaryValue !== undefined && summaryValue !== null;
    });
  }

  _hasDirectApiSnapshot(value) {
    const source = value && typeof value === "object" ? value : {};
    return ["soc", "pbat", "pload", "pgrid", "ppv"].some((key) => source[key] !== undefined && source[key] !== null);
  }

  _normalizedLiveSnapshot(source) {
    const liveSource = source && typeof source === "object" ? source : {};
    return {
      soc: liveSource.soc ?? null,
      battery_power: liveSource.pbat ?? liveSource.battery_power ?? null,
      house_consumption: liveSource.pload ?? liveSource.load_w ?? liveSource.house_consumption ?? null,
      grid_power: liveSource.pgrid ?? liveSource.grid_w ?? liveSource.grid_power ?? null,
      pv_power: liveSource.ppv ?? liveSource.solar_w ?? liveSource.pv_power ?? null,
      power_source: liveSource.powerSource ?? liveSource.power_source ?? "Report Loading",
    };
  }

  _ensureLiveTimeSeriesCache(dateKey = this._todayDateString()) {
    if (this._liveTimeSeriesCacheDate !== dateKey) {
      this._liveTimeSeriesCacheDate = dateKey;
      this._liveTimeSeriesCacheByScope = new Map();
    }
    this._liveTimeSeriesCacheByScope = this._liveTimeSeriesCacheByScope || new Map();
    return this._liveTimeSeriesCacheByScope;
  }

  _captureLiveTimeSeriesSnapshots() {
    const attrs = this._selectorState()?.attributes || {};
    const directApi = attrs.direct_api || {};
    const reportDate = this._todayDateString();
    const point = this._currentTimeSeriesPoint(new Date(), this._liveRefreshBucketSeconds());
    let changed = false;
    if (this._hasDirectApiSnapshot(directApi.all_systems)) {
      changed = this._recordLiveTimeSeriesPoint({
        selection: {
          label: "All Batteries",
          aggregate: true,
          system_id: "",
          sys_sn: "All",
          remark: "",
        },
        liveSource: directApi.all_systems,
        reportDate,
        point,
      }) || changed;
    }
    const liveRows = Array.isArray(directApi.live_batteries) ? directApi.live_batteries : [];
    liveRows.forEach((battery) => {
      changed = this._recordLiveTimeSeriesPoint({
        selection: {
          label: String(battery?.label || battery?.sys_sn || battery?.system_id || "Selected battery"),
          aggregate: false,
          system_id: String(battery?.system_id || ""),
          sys_sn: String(battery?.sys_sn || ""),
          remark: String(battery?.label || battery?.sys_sn || ""),
        },
        liveSource: battery,
        reportDate,
        point,
      }) || changed;
    });
    return changed;
  }

  _recordLiveTimeSeriesPoint({ selection, liveSource, reportDate, point }) {
    const key = this._selectionKey(selection);
    if (!key) {
      return false;
    }
    const live = this._normalizedLiveSnapshot(liveSource);
    if (!this._hasUsefulLiveValues({ live })) {
      return false;
    }
    const cache = this._ensureLiveTimeSeriesCache(reportDate);
    const existing = cache.get(key);
    const entry = existing && existing.date === reportDate
      ? existing
      : {
        date: reportDate,
        selection: this._clonePlain(selection),
        saved_at: "",
        last_seconds_of_day: -1,
        live: {},
        power_diagram: {
          time: [],
          series: {
            bat: [],
            battery: [],
            battery_charge: [],
            bat_discharge: [],
            load: [],
            solar: [],
            feed_in: [],
            grid_import: [],
            consumed: [],
          },
        },
      };
    const time = Array.isArray(entry.power_diagram?.time) ? entry.power_diagram.time : [];
    const series = entry.power_diagram?.series && typeof entry.power_diagram.series === "object"
      ? entry.power_diagram.series
      : {
        bat: [],
        battery: [],
        battery_charge: [],
        bat_discharge: [],
        load: [],
        solar: [],
        feed_in: [],
        grid_import: [],
        consumed: [],
      };
    series.battery_charge = Array.isArray(series.battery_charge) ? series.battery_charge : [];
    series.bat_discharge = Array.isArray(series.bat_discharge) ? series.bat_discharge : [];
    series.grid_import = Array.isArray(series.grid_import) ? series.grid_import : [];
    const values = {
      bat: live.soc ?? 0,
      battery: live.battery_power ?? 0,
      battery_charge: Math.max(0, -(Number(live.battery_power) || 0)),
      bat_discharge: Math.max(0, Number(live.battery_power) || 0),
      load: live.house_consumption ?? 0,
      solar: live.pv_power ?? 0,
      feed_in: Math.max(0, -(Number(live.grid_power) || 0)),
      grid_import: Math.max(0, Number(live.grid_power) || 0),
      consumed: live.house_consumption ?? 0,
    };
    const index = time.length - 1;
    const sameTimestamp = index >= 0 && (
      entry.last_seconds_of_day === point.secondsOfDay
      || String(time[index] || "").trim() === point.label
    );
    const sameValues = ["soc", "battery_power", "house_consumption", "grid_power", "pv_power", "power_source"].every((name) => {
      const previous = entry.live?.[name];
      const next = live[name];
      if (typeof previous === "string" || typeof next === "string") {
        return String(previous || "") === String(next || "");
      }
      return Number(previous) === Number(next);
    });
    if (sameTimestamp && index >= 0) {
      if (sameValues) {
        return false;
      }
      time[index] = point.label;
      series.bat[index] = values.bat;
      series.battery[index] = values.battery;
      series.battery_charge[index] = values.battery_charge;
      series.bat_discharge[index] = values.bat_discharge;
      series.load[index] = values.load;
      series.solar[index] = values.solar;
      series.feed_in[index] = values.feed_in;
      series.grid_import[index] = values.grid_import;
      series.consumed[index] = values.consumed;
      entry.selection = this._clonePlain(selection);
      entry.saved_at = point.savedAt;
      entry.last_seconds_of_day = point.secondsOfDay;
      entry.live = live;
      entry.power_diagram = {
        time,
        series,
      };
      cache.set(key, entry);
      return false;
    } else {
      time.push(point.label);
      series.bat.push(values.bat);
      series.battery.push(values.battery);
      series.battery_charge.push(values.battery_charge);
      series.bat_discharge.push(values.bat_discharge);
      series.load.push(values.load);
      series.solar.push(values.solar);
      series.feed_in.push(values.feed_in);
      series.grid_import.push(values.grid_import);
      series.consumed.push(values.consumed);
    }
    entry.selection = this._clonePlain(selection);
    entry.saved_at = point.savedAt;
    entry.last_seconds_of_day = point.secondsOfDay;
    entry.live = live;
    entry.power_diagram = {
      time,
      series,
    };
    cache.set(key, entry);
    return true;
  }

  _liveRefreshBucketSeconds() {
    return this._periodPreset === "1h" ? 60 : 300;
  }

  _seedLiveTimeSeriesReport(selection, reportDate, reporting, liveSource) {
    if (!liveSource || typeof liveSource !== "object") {
      return null;
    }
    this._recordLiveTimeSeriesPoint({
      selection,
      liveSource,
      reportDate,
      point: this._currentTimeSeriesPoint(new Date(), this._liveRefreshBucketSeconds()),
    });
    return this._cachedLiveTimeSeriesReportForSelection(selection, reportDate, reporting);
  }

  _integrateSeriesEnergyKwh(values = [], timeLabels = []) {
    if (!Array.isArray(values) || !Array.isArray(timeLabels) || values.length < 2 || timeLabels.length < 2) {
      return 0;
    }
    let wattMinutes = 0;
    for (let index = 1; index < Math.min(values.length, timeLabels.length); index += 1) {
      const previousMinutes = this._timeLabelToMinutesOfDay(timeLabels[index - 1]);
      const currentMinutes = this._timeLabelToMinutesOfDay(timeLabels[index]);
      if (previousMinutes === null || currentMinutes === null) {
        continue;
      }
      const deltaMinutes = currentMinutes - previousMinutes;
      if (!Number.isFinite(deltaMinutes) || deltaMinutes <= 0) {
        continue;
      }
      const watts = Number(values[index - 1]) || 0;
      wattMinutes += watts * deltaMinutes;
    }
    return wattMinutes / 60000;
  }

  _liveTimeSeriesTodaySummary(entry) {
    const timeLabels = Array.isArray(entry?.power_diagram?.time) ? entry.power_diagram.time : [];
    const series = entry?.power_diagram?.series && typeof entry.power_diagram.series === "object"
      ? entry.power_diagram.series
      : {};
    const batteryValues = Array.isArray(series.battery) ? series.battery : [];
    const batteryCharge = batteryValues.map((value) => Math.max(0, -(Number(value) || 0)));
    const batteryDischarge = batteryValues.map((value) => Math.max(0, Number(value) || 0));
    return {
      solar_generation: this._integrateSeriesEnergyKwh(series.solar || [], timeLabels),
      load_consumption: this._integrateSeriesEnergyKwh(series.load || [], timeLabels),
      feed_in: this._integrateSeriesEnergyKwh(series.feed_in || [], timeLabels),
      grid_consumption: this._integrateSeriesEnergyKwh(series.grid_import || [], timeLabels),
      battery_charge: this._integrateSeriesEnergyKwh(batteryCharge, timeLabels),
      battery_discharge: this._integrateSeriesEnergyKwh(batteryDischarge, timeLabels),
    };
  }

  _baseReportingForLiveSelection(selection, selectedDate, reporting) {
    const requestedDate = String(selectedDate || "").trim();
    const reportingDate = String(reporting?.power_diagram?.date || reporting?.reporting_date || "").trim();
    const selectionKey = this._selectionKey(selection);
    const selectedReporting = reporting
      && this._reportingSelectionKey(reporting) === selectionKey
      && (!requestedDate || !reportingDate || requestedDate === reportingDate)
      ? this._clonePlain(reporting)
      : null;
    if (selectedReporting) {
      return selectedReporting;
    }
    return this._cachedRenderedReportForSelection(selection, selectedDate, "cached_live_timeseries_base")
      || this._lastDisplayedTimeSeriesReportForSelection(selection, selectedDate)
      || this._cachedLiveReportForSelection(selection, selectedDate, "cached_live_timeseries_base")
      || null;
  }

  _cachedLiveTimeSeriesReportForSelection(selection, selectedDate, reporting, sourceDetail = "today_live_timeseries") {
    if (!this._isTodaySelection(selectedDate)) {
      return null;
    }
    const key = this._selectionKey(selection);
    const entry = this._ensureLiveTimeSeriesCache(this._todayDateString()).get(key);
    if (!entry || !Array.isArray(entry.power_diagram?.time) || !entry.power_diagram.time.length) {
      return null;
    }
    const reportDate = selectedDate || entry.date || this._todayDateString();
    const baseReporting = this._baseReportingForLiveSelection(selection, reportDate, reporting);
    const base = this._clonePlain(baseReporting || {});
    const basePowerDiagram = base.power_diagram && typeof base.power_diagram === "object"
      ? base.power_diagram
      : {};
    const baseSummary = basePowerDiagram.summary && typeof basePowerDiagram.summary === "object"
      ? basePowerDiagram.summary
      : {};
    const live = {
      ...((base.live && typeof base.live === "object") ? base.live : {}),
      ...(entry.live || {}),
    };
    const derivedToday = selection.aggregate
      ? this._liveTimeSeriesTodaySummary(entry)
      : {};
    const today = selection.aggregate
      ? {
          ...((base.today && typeof base.today === "object") ? base.today : {}),
          ...derivedToday,
        }
      : {};
    const totals = selection.aggregate && base.totals && typeof base.totals === "object"
      ? { ...base.totals }
      : {};
    const snapshot = {
      label: selection.aggregate
        ? "All Batteries"
        : selection.remark || selection.sys_sn || selection.label || "Selected battery",
      aggregate: Boolean(selection.aggregate),
      reporting_date: reportDate,
      saved_at: entry.saved_at || base.saved_at || "",
      meta: {
        ...(base.meta || {}),
        source: "live_direct_api",
        source_detail: sourceDetail,
        storage: "live_timeseries_memory",
        power_diagram_source: "live_timeseries_memory",
        reporting_date: reportDate,
      },
      live,
      today,
      totals,
      power_diagram: {
        ...basePowerDiagram,
        date: reportDate,
        meta: {
          ...(basePowerDiagram.meta || {}),
          source: "live_timeseries_memory",
          loaded_through: entry.power_diagram.time[entry.power_diagram.time.length - 1] || "",
        },
        summary: {
          ...baseSummary,
          soc: live.soc ?? baseSummary.soc ?? null,
          battery_power: live.battery_power ?? baseSummary.battery_power ?? null,
          load_consumption: live.house_consumption ?? baseSummary.load_consumption ?? null,
          grid_consumption: selection.aggregate
            ? today.grid_consumption ?? baseSummary.grid_consumption ?? null
            : live.grid_power ?? baseSummary.grid_consumption ?? null,
          solar_generation: selection.aggregate
            ? today.solar_generation ?? baseSummary.solar_generation ?? null
            : live.pv_power ?? baseSummary.solar_generation ?? null,
          feed_in: selection.aggregate
            ? today.feed_in ?? baseSummary.feed_in ?? null
            : Math.max(0, -(Number(live.grid_power) || 0)),
          battery_charge: selection.aggregate
            ? today.battery_charge ?? baseSummary.battery_charge ?? null
            : baseSummary.battery_charge ?? null,
          battery_discharge: selection.aggregate
            ? today.battery_discharge ?? baseSummary.battery_discharge ?? null
            : baseSummary.battery_discharge ?? null,
        },
        time: [...entry.power_diagram.time],
        series: {
          bat: [...(entry.power_diagram.series?.bat || [])],
          battery_charge: [...(entry.power_diagram.series?.battery_charge || [])],
          bat_discharge: [...(entry.power_diagram.series?.bat_discharge || [])],
          grid_import: [...(entry.power_diagram.series?.grid_import || [])],
          load: [...(entry.power_diagram.series?.load || [])],
          solar: [...(entry.power_diagram.series?.solar || [])],
          feed_in: [...(entry.power_diagram.series?.feed_in || [])],
          consumed: [...(entry.power_diagram.series?.consumed || [])],
        },
      },
      selection: selection.aggregate
        ? { label: "All Batteries", aggregate: true, system_id: "", sys_sn: "All", remark: "" }
        : this._clonePlain(selection),
    };
    return this._mergeTodayTotalsIntoLiveTimeSeriesReport(snapshot, entry, selection);
  }

  _cacheLiveReport(reporting) {
    if (reporting?.meta?.source !== "live_direct_api" || !this._hasUsefulLiveValues(reporting)) {
      return;
    }
    this._liveReportCacheByScope = this._liveReportCacheByScope || new Map();
    const key = this._reportingSelectionKey(reporting);
    if (!key) return;
    this._liveReportCacheByScope.set(key, this._clonePlain(reporting));
  }

  _cachedLiveReportForSelection(selection, selectedDate, sourceDetail = "last_live_snapshot_refreshing") {
    const key = this._selectionKey(selection);
    const cached = this._liveReportCacheByScope?.get(key);
    if (!cached) return null;
    const snapshot = this._clonePlain(cached);
    snapshot.aggregate = Boolean(selection.aggregate);
    snapshot.label = selection.aggregate
      ? "All Batteries"
      : selection.remark || selection.sys_sn || selection.label || snapshot.label || "Selected battery";
    snapshot.selection = selection.aggregate
      ? { label: "All Batteries", aggregate: true, system_id: "", sys_sn: "All", remark: "" }
      : selection;
    snapshot.reporting_date = selectedDate || snapshot.reporting_date || this._formatLocalDate(this._todayLocalDate());
    snapshot.meta = {
      ...(snapshot.meta || {}),
      source: "live_direct_api",
      source_detail: sourceDetail,
      storage: "live_memory_snapshot",
      power_diagram_source: "last_live_snapshot",
      reporting_date: snapshot.reporting_date,
    };
    snapshot.power_diagram = {
      ...(snapshot.power_diagram || {}),
      date: snapshot.reporting_date,
      meta: {
        ...((snapshot.power_diagram || {}).meta || {}),
        source: "last_live_snapshot",
      },
    };
    return snapshot;
  }

  _lastDisplayedLiveReport(selectedDate) {
    const last = this._lastReportingForDisplay?.reporting;
    if (!last || last?.meta?.source !== "live_direct_api" || !this._hasUsefulLiveValues(last)) {
      return null;
    }
    const snapshot = this._clonePlain(last);
    snapshot.reporting_date = selectedDate || snapshot.reporting_date || this._formatLocalDate(this._todayLocalDate());
    snapshot.meta = {
      ...(snapshot.meta || {}),
      source: "live_direct_api",
      source_detail: "previous_live_snapshot_refreshing",
      storage: "live_memory_snapshot",
      power_diagram_source: "previous_live_snapshot",
      reporting_date: snapshot.reporting_date,
    };
    snapshot.power_diagram = {
      ...(snapshot.power_diagram || {}),
      date: snapshot.reporting_date,
      meta: {
        ...((snapshot.power_diagram || {}).meta || {}),
        source: "previous_live_snapshot",
      },
    };
    return snapshot;
  }

  _primeLiveReportCache(reporting, selectedDate) {
    const attrs = this._selectorState()?.attributes || {};
    const directApi = attrs.direct_api || {};
    if (directApi.all_systems && typeof directApi.all_systems === "object") {
      this._cacheLiveReport(this._aggregatePendingReporting(reporting, {
        label: "All Batteries",
        aggregate: true,
        system_id: "",
        sys_sn: "All",
        remark: "",
      }, selectedDate));
    }
    const liveRows = Array.isArray(directApi.live_batteries) ? directApi.live_batteries : [];
    liveRows.forEach((battery) => {
      const selection = {
        label: String(battery?.label || battery?.sys_sn || battery?.system_id || "Selected battery"),
        aggregate: false,
        system_id: String(battery?.system_id || ""),
        sys_sn: String(battery?.sys_sn || ""),
        remark: String(battery?.label || battery?.sys_sn || ""),
      };
      this._cacheLiveReport(this._selectedBatteryReportingFromLiveSource(reporting, selection, selectedDate, battery));
    });
  }

  _canInstantRenderPendingSelection() {
    const selection = this._selectionMeta();
    const selectedDate = this._selectedReportDate();
    if (this._cachedRenderedReportForSelection(selection, selectedDate)) {
      return true;
    }
    if (this._cachedLiveTimeSeriesReportForSelection(selection, selectedDate, this._reporting(), "instant_selection_live_cache")) {
      return true;
    }
    if (this._cachedLiveReportForSelection(selection, selectedDate, "instant_selection_cache")) {
      return true;
    }
    return false;
  }

  _archivePendingReporting(reporting, selectedDate) {
    const snapshot = JSON.parse(JSON.stringify(reporting || this._lastReportingForDisplay?.reporting || {}));
    snapshot.reporting_date = selectedDate;
    snapshot.meta = {
      ...(snapshot.meta || {}),
      source_detail: "synthesized_from_backend_snapshot",
      reporting_date: selectedDate,
      archive_selected_date: selectedDate,
      archive_scope: this._historyScopeKey(),
      source: "archive_pending",
    };
    snapshot.power_diagram = {
      ...((snapshot.power_diagram && typeof snapshot.power_diagram === "object") ? snapshot.power_diagram : {}),
      date: selectedDate,
    };
    return snapshot;
  }

  _aggregatePendingReporting(reporting, selection, selectedDate) {
    const cached = this._cachedLiveTimeSeriesReportForSelection(selection, selectedDate, reporting);
    if (cached) {
      return cached;
    }
    const attrs = this._selectorState()?.attributes || {};
    const allSystems = attrs.direct_api?.all_systems || {};
    const reportDate = selectedDate || this._formatLocalDate(this._todayLocalDate());
    const hasLiveValues = ["soc", "pbat", "pload", "pgrid", "ppv"].some((key) => allSystems[key] !== undefined && allSystems[key] !== null);
    const live = this._normalizedLiveSnapshot(allSystems);
    const cachedRendered = this._cachedRenderedReportForSelection(selection, reportDate, "instant_selection_cached_report");
    if (cachedRendered) {
      return this._overlayLiveSummaryOnReport(cachedRendered, {
        live,
        power_diagram: {
          meta: {
            loaded_through: this._formatTimeLabel(new Date()),
          },
        },
      }, selection, reportDate, "instant_selection_cached_report");
    }
    const cachedLive = this._cachedLiveReportForSelection(selection, reportDate, "instant_selection_cached_live");
    if (cachedLive) {
      return cachedLive;
    }
    const lastDisplayed = this._lastDisplayedTimeSeriesReportForSelection(selection, reportDate);
    if (lastDisplayed) {
      return this._overlayLiveSummaryOnReport(lastDisplayed, {
        live,
        power_diagram: {
          meta: {
            loaded_through: this._formatTimeLabel(new Date()),
          },
        },
      }, selection, reportDate, "instant_selection_previous_chart");
    }
    const seeded = this._seedLiveTimeSeriesReport(selection, reportDate, reporting, allSystems);
    if (seeded) {
      return seeded;
    }
    return {
      label: "All Batteries",
      aggregate: true,
      reporting_date: reportDate,
      saved_at: reporting?.saved_at || reporting?.meta?.saved_at || "",
      meta: {
        ...(reporting?.meta || {}),
        source: hasLiveValues ? "live_direct_api" : "selected_battery_pending",
        storage: "live_all_systems",
        power_diagram_source: "live_all_systems",
        reporting_date: reportDate,
      },
      live,
      today: {},
      totals: {},
      power_diagram: {
        date: reportDate,
        meta: { source: "selected_battery_pending" },
        summary: {
          soc: live.soc,
          battery_power: live.battery_power,
          load_consumption: live.house_consumption,
          grid_consumption: live.grid_power,
          solar_generation: live.pv_power,
          feed_in: Math.max(0, -(Number(live.grid_power) || 0)),
        },
        time: ["00:00", "now"],
        series: {
          bat: [live.soc ?? 0, live.soc ?? 0],
          battery_charge: [Math.max(0, -(Number(live.battery_power) || 0)), Math.max(0, -(Number(live.battery_power) || 0))],
          bat_discharge: [Math.max(0, Number(live.battery_power) || 0), Math.max(0, Number(live.battery_power) || 0)],
          grid_import: [Math.max(0, Number(live.grid_power) || 0), Math.max(0, Number(live.grid_power) || 0)],
          load: [live.house_consumption ?? 0, live.house_consumption ?? 0],
          solar: [live.pv_power ?? 0, live.pv_power ?? 0],
          feed_in: [Math.max(0, -(Number(live.grid_power) || 0)), Math.max(0, -(Number(live.grid_power) || 0))],
          consumed: [live.house_consumption ?? 0, live.house_consumption ?? 0],
        },
      },
      selection: {
        label: "All Batteries",
        aggregate: true,
        system_id: "",
        sys_sn: "All",
        remark: "",
      },
    };
  }

  _numericState(key, domain = "sensor") {
    const entity = this._entityByKey(key, domain);
    if (!entity) return null;
    const raw = String(entity.state ?? "").trim();
    if (!raw || raw === "unknown" || raw === "unavailable") return null;
    const parsed = Number(raw.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  _selectionLabel() {
    const selection = this._selectionMeta();
    if (selection.aggregate) {
      return "All Batteries";
    }
    return selection.remark || selection.sys_sn || selection.system_id || this._config.entity_prefix || "HEROS";
  }

  _synthesizedReporting() {
    const today = new Date();
    const reportDate = this._todayDateString();
    const savedAt = today.toISOString();
    const live = {
      soc: this._numericState("battery_percentage"),
      battery_power: this._numericState("battery_power"),
      house_consumption: this._numericState("house_consumption"),
      grid_power: this._numericState("grid_consumption") ?? this._numericState("grid_power"),
      pv_power: this._numericState("pv_power"),
      power_source: this._stateObj(this._entityByKey("battery_power")?.entity_id)?.state ? this._batteryDirection(this._numericState("battery_power")) : "Idle",
    };
    const todaySummary = {
      solar_generation: this._numericState("pv_generated_today"),
      load_consumption: this._numericState("consumed_today"),
      battery_charge: this._numericState("battery_charged_today"),
      battery_discharge: this._numericState("battery_discharged_today"),
      feed_in: this._numericState("feed_in_today"),
      grid_consumption: this._numericState("grid_import_today"),
      self_consumption: this._numericState("self_consumption"),
      self_sufficiency: this._numericState("self_sufficiency"),
      today_income: this._numericState("today_income"),
      total_income: this._numericState("total_income"),
      trees_planted: this._numericState("trees_planted"),
      co2_reduction_tons: this._numericState("co2_reduction"),
    };
    const totals = {
      solar_generation: this._numericState("total_solar_generation"),
      house_consumption: this._numericState("total_house_consumption"),
      battery_charge: this._numericState("total_battery_charge"),
      battery_discharge: this._numericState("total_battery_discharge"),
      feed_in: this._numericState("total_feed_in"),
      grid_consumption: this._numericState("total_grid_consumption"),
      pv_power_house: this._numericState("pv_power_to_house"),
      pv_charging_battery: this._numericState("pv_charging_battery"),
      grid_battery_charge: this._numericState("grid_based_battery_charge"),
    };
    const powerDiagram = {
      date: reportDate,
      meta: {
        generated_from: "live_entities",
      },
      summary: {
        soc: live.soc,
        solar_generation: todaySummary.solar_generation,
        load_consumption: todaySummary.load_consumption,
        feed_in: todaySummary.feed_in,
        grid_consumption: todaySummary.grid_consumption,
        battery_charge: todaySummary.battery_charge,
        battery_discharge: todaySummary.battery_discharge,
      },
      time: ["now"],
      series: {
        bat: [live.soc ?? 0],
        battery_charge: [Math.max(0, -(Number(live.battery_power) || 0))],
        bat_discharge: [Math.max(0, Number(live.battery_power) || 0)],
        grid_import: [Math.max(0, Number(live.grid_power) || 0)],
        load: [live.house_consumption ?? 0],
        solar: [live.pv_power ?? 0],
        feed_in: [todaySummary.feed_in ?? 0],
        consumed: [todaySummary.load_consumption ?? 0],
      },
    };
    const selection = this._selectionMeta();
    return {
      label: this._selectionLabel(),
      aggregate: Boolean(this._selectorState()?.state === "All systems"),
      reporting_date: reportDate,
      saved_at: savedAt,
      meta: {
        saved_at: savedAt,
        source: "synthesized_live_entities",
        storage: "ephemeral_live_state",
        power_diagram_source: "live_entity_synthesis",
        history: this._selectorState()?.attributes?.history || {},
      },
      live,
      today: todaySummary,
      totals,
      power_diagram: powerDiagram,
      selection,
    };
  }

  _systemSummaries() {
    return this._selectorState()?.attributes?.all_system_summaries || [];
  }

  _selectionMetaFromOption(option, attrs = this._selectorState()?.attributes || {}) {
    const label = String(option || "").trim();
    if (!label) {
      return null;
    }
    if (label === "All systems" || label === "All Batteries") {
      return {
        label: "All Batteries",
        aggregate: true,
        system_id: "",
        sys_sn: "All",
        remark: "",
      };
    }
    const liveRows = Array.isArray(attrs.direct_api?.live_batteries) ? attrs.direct_api.live_batteries : [];
    const matchedLive = liveRows.find((battery) => {
      const labels = [
        battery?.label,
        battery?.sys_sn,
        battery?.system_id,
      ].map((value) => String(value || "").trim()).filter(Boolean);
      return labels.includes(label);
    });
    if (matchedLive) {
      return {
        label,
        aggregate: false,
        system_id: String(matchedLive?.system_id || ""),
        sys_sn: String(matchedLive?.sys_sn || label),
        remark: String(matchedLive?.label || matchedLive?.sys_sn || label),
      };
    }
    const fallbackSelection = attrs.selection && typeof attrs.selection === "object" ? attrs.selection : {};
    const selectionLabels = [
      fallbackSelection?.label,
      fallbackSelection?.remark,
      fallbackSelection?.sys_sn,
      fallbackSelection?.system_id,
    ].map((value) => String(value || "").trim()).filter(Boolean);
    if (selectionLabels.includes(label)) {
      return {
        label,
        aggregate: false,
        system_id: String(fallbackSelection?.system_id || ""),
        sys_sn: String(fallbackSelection?.sys_sn || label),
        remark: String(fallbackSelection?.remark || fallbackSelection?.label || label),
      };
    }
    return {
      label,
      aggregate: false,
      system_id: "",
      sys_sn: label,
      remark: label,
    };
  }

  _selectionMeta() {
    const attrs = this._selectorState()?.attributes || {};
    const pendingSelection = String(this._pendingSelection || "").trim();
    if (pendingSelection) {
      const pendingMeta = this._selectionMetaFromOption(pendingSelection, attrs);
      if (pendingMeta) {
        return pendingMeta;
      }
    }
    const selectorState = String(this._selectorState()?.state || "").trim();
    if (selectorState) {
      const currentMeta = this._selectionMetaFromOption(selectorState, attrs);
      if (currentMeta) {
        return currentMeta;
      }
    }
    const selection = attrs.selection || {};
    const label = selection.label || selectorState || "";
    const aggregate = Boolean(selection.aggregate || label === "All systems" || selection.sys_sn === "All");
    const resolvedSelection = {
      label,
      aggregate,
      system_id: aggregate ? "" : selection.system_id || attrs.system_id || "",
      sys_sn: aggregate ? "All" : selection.sys_sn || attrs.sys_sn || "",
      remark: aggregate ? "" : selection.remark || attrs.remark || "",
    };
    if (resolvedSelection.label || resolvedSelection.sys_sn || resolvedSelection.system_id || resolvedSelection.aggregate) {
      return resolvedSelection;
    }
    if (this._selectorOpen && this._lastReportingForDisplay?.reporting) {
      const frozenSelection = this._lastReportingForDisplay.reporting.selection || {};
      const frozenAggregate = Boolean(
        this._lastReportingForDisplay.reporting.aggregate
        || frozenSelection.aggregate
        || frozenSelection.sys_sn === "All"
        || frozenSelection.label === "All Batteries"
        || frozenSelection.label === "All systems"
      );
      if (frozenAggregate) {
        return {
          label: "All Batteries",
          aggregate: true,
          system_id: "",
          sys_sn: "All",
          remark: "",
        };
      }
      return {
        label: String(frozenSelection.label || this._lastReportingForDisplay.reporting.label || ""),
        aggregate: false,
        system_id: String(frozenSelection.system_id || ""),
        sys_sn: String(frozenSelection.sys_sn || ""),
        remark: String(frozenSelection.remark || frozenSelection.label || this._lastReportingForDisplay.reporting.label || ""),
      };
    }
    return resolvedSelection;
  }

  _selectedBatteryLiveSnapshot(selection = this._selectionMeta()) {
    const attrs = this._selectorState()?.attributes || {};
    const directApi = attrs.direct_api || {};
    const selectedKey = this._selectionKey(selection);
    const liveRows = Array.isArray(directApi.live_batteries) ? directApi.live_batteries : [];
    const matched = liveRows.find((battery) => {
      const rowKeys = [battery?.sys_sn, battery?.system_id, battery?.label]
        .map((value) => String(value || "").trim())
        .filter(Boolean);
      return selectedKey && rowKeys.includes(selectedKey);
    });
    if (matched) {
      return matched;
    }
    const selectedScope = directApi.selected_scope || {};
    const selectedScopeKey = String(
      selectedScope?.sys_sn
      || selectedScope?.system_id
      || selectedScope?.label
      || ""
    ).trim();
    return selectedScopeKey && selectedScopeKey === selectedKey ? selectedScope : {};
  }

  _selectedBatteryReportingFromLiveSource(reporting, selection, selectedDate, liveSource) {
    const cached = this._cachedLiveTimeSeriesReportForSelection(selection, selectedDate, reporting);
    if (cached) {
      return cached;
    }
    const reportDate = selectedDate || this._formatLocalDate(this._todayLocalDate());
    const live = this._normalizedLiveSnapshot(liveSource);
    const cachedRendered = this._cachedRenderedReportForSelection(selection, reportDate, "instant_selection_cached_report");
    if (cachedRendered) {
      return this._overlayLiveSummaryOnReport(cachedRendered, {
        live,
        power_diagram: {
          meta: {
            loaded_through: this._formatTimeLabel(new Date()),
          },
        },
      }, selection, reportDate, "instant_selection_cached_report");
    }
    const cachedLive = this._cachedLiveReportForSelection(selection, reportDate, "instant_selection_cached_live");
    if (cachedLive) {
      return cachedLive;
    }
    const lastDisplayed = this._lastDisplayedTimeSeriesReportForSelection(selection, reportDate);
    if (lastDisplayed) {
      return this._overlayLiveSummaryOnReport(lastDisplayed, {
        live,
        power_diagram: {
          meta: {
            loaded_through: this._formatTimeLabel(new Date()),
          },
        },
      }, selection, reportDate, "instant_selection_previous_chart");
    }
    const seeded = this._seedLiveTimeSeriesReport(selection, reportDate, reporting, liveSource);
    if (seeded) {
      return seeded;
    }
    return {
      label: selection.remark || selection.sys_sn || selection.label || "Selected battery",
      aggregate: Boolean(selection.aggregate),
      reporting_date: reportDate,
      saved_at: reporting?.saved_at || reporting?.meta?.saved_at || "",
      meta: {
        ...(reporting?.meta || {}),
        source: "live_direct_api",
        storage: "live_selected_battery",
        power_diagram_source: "live_selected_battery",
        reporting_date: reportDate,
      },
      live,
      today: {},
      totals: {},
      power_diagram: {
        date: reportDate,
        meta: { source: "live_selected_battery" },
        summary: {
          soc: live.soc,
          battery_power: live.battery_power,
          load_consumption: live.house_consumption,
          grid_consumption: live.grid_power,
        },
        time: ["00:00", "now"],
        series: {
          bat: [live.soc ?? 0, live.soc ?? 0],
          battery_charge: [Math.max(0, -(Number(live.battery_power) || 0)), Math.max(0, -(Number(live.battery_power) || 0))],
          bat_discharge: [Math.max(0, Number(live.battery_power) || 0), Math.max(0, Number(live.battery_power) || 0)],
          grid_import: [Math.max(0, Number(live.grid_power) || 0), Math.max(0, Number(live.grid_power) || 0)],
          load: [live.house_consumption ?? 0, live.house_consumption ?? 0],
          solar: [live.pv_power ?? 0, live.pv_power ?? 0],
          feed_in: [Math.max(0, -(Number(live.grid_power) || 0)), Math.max(0, -(Number(live.grid_power) || 0))],
          consumed: [live.house_consumption ?? 0, live.house_consumption ?? 0],
        },
      },
      selection,
    };
  }

  _selectedBatteryPendingReporting(reporting, selection, selectedDate) {
    const liveSource = this._selectedBatteryLiveSnapshot(selection);
    const reportDate = selectedDate || this._formatLocalDate(this._todayLocalDate());
    const hasLiveMatch = Boolean(liveSource && (liveSource.sys_sn || liveSource.system_id || liveSource.label));
    if (!hasLiveMatch) {
      const cachedSeries = this._cachedLiveTimeSeriesReportForSelection(selection, reportDate, reporting);
      if (cachedSeries) {
        return cachedSeries;
      }
      const cached = this._cachedLiveReportForSelection(selection, reportDate);
      if (cached) {
        return cached;
      }
      const lastDisplayed = this._lastDisplayedLiveReport(reportDate);
      if (lastDisplayed) {
        return lastDisplayed;
      }
      return {
        label: selection.remark || selection.sys_sn || selection.label || "Selected battery",
        aggregate: Boolean(selection.aggregate),
        reporting_date: reportDate,
        saved_at: reporting?.saved_at || reporting?.meta?.saved_at || "",
        meta: {
          ...(reporting?.meta || {}),
          source: "selected_battery_pending",
          storage: "live_selected_battery",
          power_diagram_source: "live_selected_battery",
          reporting_date: reportDate,
        },
        live: {
          soc: null,
          battery_power: null,
          house_consumption: null,
          grid_power: null,
          pv_power: null,
          power_source: "Report Loading",
        },
        today: {},
        totals: {},
        power_diagram: {
          date: reportDate,
          meta: { source: "selected_battery_pending" },
          summary: {
            soc: null,
            load_consumption: null,
            grid_consumption: null,
          },
          time: [],
          series: {
            bat: [],
            load: [],
            solar: [],
            feed_in: [],
            consumed: [],
          },
        },
        selection,
      };
    }
    return this._selectedBatteryReportingFromLiveSource(reporting, selection, reportDate, liveSource);
  }

  _selectionKey(selection = this._selectionMeta()) {
    return selection.aggregate
      ? "all"
      : String(selection.sys_sn || selection.system_id || selection.remark || selection.label || "").trim();
  }

  _reportingSelectionKey(reporting = this._reporting()) {
    const selection = reporting?.selection || {};
    return reporting?.aggregate
      ? "all"
      : String(selection.sys_sn || selection.system_id || selection.remark || reporting?.label || "").trim();
  }

  _isTodaySelection(selectedDate = this._selectedReportDate()) {
    const date = String(selectedDate || "").trim();
    return !date || date === this._todayDateString();
  }

  _fmtNumber(value, digits = 1) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "Unavailable";
    return number
      .toFixed(digits)
      .replace(/\.0+$/, "")
      .replace(/(\.\d*[1-9])0+$/, "$1");
  }

  _fmtPower(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "Unavailable";
    return `${this._fmtNumber(number, 1)} W`;
  }

  _powerDiagramUsesKw(reporting) {
    const meta = reporting?.meta || {};
    const powerMeta = reporting?.power_diagram?.meta || {};
    const source = String(powerMeta.source || "").trim().toLowerCase();
    const diagramSource = String(meta.power_diagram_source || "").trim().toLowerCase();
    // HEROS normalizes FoxESS V2 history to watts before persisting it.
    if (source === "foxess_v2_history") return false;
    return source === "provider" || diagramSource === "provider_power_diagram";
  }

  _fmtChartPower(value, reporting) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "Unavailable";
    if (this._powerDiagramUsesKw(reporting)) {
      const absNumber = Math.abs(number);
      const digits = absNumber < 0.1 ? 2 : absNumber < 10 ? 1 : 0;
      return `${this._fmtNumber(number, digits)} kW`;
    }
    const kilowatts = number / 1000;
    const absKilowatts = Math.abs(kilowatts);
    const digits = absKilowatts < 0.1 ? 2 : absKilowatts < 10 ? 1 : 0;
    return `${this._fmtNumber(kilowatts, digits)} kW`;
  }

  _fmtLivePower(value, reporting) {
    const raw = Number(value);
    if (!Number.isFinite(raw)) return "Unavailable";
    const kilowatts = this._powerDiagramUsesKw(reporting) ? raw : raw / 1000;
    if (Math.abs(kilowatts) < 1) {
      const watts = kilowatts * 1000;
      return `${this._fmtNumber(watts, Math.abs(watts) < 10 ? 1 : 0)} W`;
    }
    return `${this._fmtNumber(kilowatts, 2)} kW`;
  }

  _fmtEnergy(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "Unavailable";
    return `${this._fmtNumber(number, 2)} kWh`;
  }

  _fmtPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "Unavailable";
    return `${this._fmtNumber(number, 2)} %`;
  }

  _batteryDirection(powerValue) {
    const power = Number(powerValue);
    if (!Number.isFinite(power) || power === 0) return "Idle";
    return power > 0 ? "Discharging" : "Charging";
  }

  _gridDirection(powerValue) {
    const power = Number(powerValue);
    if (!Number.isFinite(power) || power === 0) return "Balanced";
    return power > 0 ? "Importing" : "Exporting";
  }

  _csvSafe(value) {
    const text = String(value ?? "");
    if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
      return `"${text.replaceAll("\"", "\"\"")}"`;
    }
    return text;
  }

  _buildCsv(reporting) {
    const powerDiagram = reporting?.power_diagram || {};
    const summary = powerDiagram.summary || {};
    const live = reporting?.live || {};
    const today = reporting?.today || {};
    const totals = reporting?.totals || {};
    const series = powerDiagram.series || {};
    const times = powerDiagram.time || [];

    const rows = [
      ["Label", reporting?.label || "HEROS"],
      ["Date", powerDiagram.date || ""],
      ["Live SOC", live.soc ?? ""],
      ["Live Battery Power", live.battery_power ?? ""],
      ["Live Load Power", live.house_consumption ?? ""],
      ["Live Grid Power", live.grid_power ?? ""],
      ["Live PV Power", live.pv_power ?? ""],
      ["Power Source", live.power_source ?? ""],
      [],
      ["Today Summary"],
      ["Solar Generation", today.solar_generation ?? ""],
      ["Load Consumption", today.load_consumption ?? ""],
      ["Battery Charged", today.battery_charge ?? ""],
      ["Battery Discharged", today.battery_discharge ?? ""],
      ["Feed-in", today.feed_in ?? ""],
      ["Grid Consumption", today.grid_consumption ?? ""],
      ["Self Consumption", today.self_consumption ?? ""],
      ["Self Sufficiency", today.self_sufficiency ?? ""],
      ["Today Income", today.today_income ?? ""],
      ["Total Income", today.total_income ?? ""],
      [],
      ["Totals"],
      ["Solar Generation", totals.solar_generation ?? ""],
      ["House Consumption", totals.house_consumption ?? ""],
      ["Battery Charge", totals.battery_charge ?? ""],
      ["Battery Discharge", totals.battery_discharge ?? ""],
      ["Feed-in", totals.feed_in ?? ""],
      ["Grid Consumption", totals.grid_consumption ?? ""],
      ["PV to House", totals.pv_power_house ?? ""],
      ["PV to Battery", totals.pv_charging_battery ?? ""],
      ["Grid to Battery", totals.grid_battery_charge ?? ""],
      [],
      ["Power Diagram Summary"],
      ["SOC", summary.soc ?? ""],
      ["Solar Generation", summary.solar_generation ?? ""],
      ["Load Consumption", summary.load_consumption ?? ""],
      ["Feed-in", summary.feed_in ?? ""],
      ["Grid Consumption", summary.grid_consumption ?? ""],
      ["Battery Charge", summary.battery_charge ?? ""],
      ["Battery Discharge", summary.battery_discharge ?? ""],
      [],
      ["Time", "BAT", "Load", "Solar", "Feed-in", "Consumed"],
    ];

    times.forEach((time, index) => {
      rows.push([
        time,
        series.bat?.[index] ?? "",
        series.load?.[index] ?? "",
        series.solar?.[index] ?? "",
        series.feed_in?.[index] ?? "",
        series.consumed?.[index] ?? "",
      ]);
    });

    return rows
      .map((row) => row.map((value) => this._csvSafe(value)).join(","))
      .join("\r\n");
  }

  _downloadCsv() {
    const reporting = this._reporting();
    if (!reporting) return;
    const csv = this._buildCsv(reporting);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = (reporting?.power_diagram?.date || "today").replaceAll("/", "-");
    const label = (reporting?.label || "heros").replaceAll(/[^a-zA-Z0-9_-]+/g, "_");
    link.href = url;
    link.download = `heros-report-${label}-${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  _renderAggregateStrip(reporting) {
    if (!reporting?.aggregate) return "";
    const summaries = this._systemSummaries();
    if (!summaries.length) return "";
    return `
      <div class="aggregate-strip">
        ${summaries
          .map(
            (item) => `
              <div class="aggregate-card">
                <div class="aggregate-title">${this._escape(item.label || item.sys_sn || "Battery")}</div>
                <div class="aggregate-metric">SOC ${this._fmtPercent(item.soc)}</div>
                <div class="aggregate-metric">Battery ${this._fmtPower(item.battery_power)}</div>
                <div class="aggregate-metric">Load ${this._fmtPower(item.house_consumption)}</div>
                <div class="aggregate-metric">Grid ${this._fmtPower(item.grid_power)}</div>
              </div>
            `
          )
          .join("")}
      </div>
    `;
  }

  _renderAggregateTable(reporting) {
    if (!reporting?.aggregate) return "";
    const summaries = this._systemSummaries();
    if (!summaries.length) return "";
    return `
      <section class="aggregate-table-panel">
        <div class="aggregate-table-head">
          <div class="aggregate-table-title">System Comparison</div>
          <div class="aggregate-table-subtitle">Live per-battery snapshot</div>
        </div>
        <div class="aggregate-table">
          <div class="aggregate-row aggregate-header">
            <div>Battery</div>
            <div>SOC</div>
            <div>Battery</div>
            <div>Load</div>
            <div>Grid</div>
            <div>Mode</div>
          </div>
          ${summaries
            .map(
              (item) => `
                <div class="aggregate-row">
                  <div class="aggregate-cell-title">${this._escape(item.label || item.sys_sn || "Battery")}</div>
                  <div>${this._fmtPercent(item.soc)}</div>
                  <div>${this._fmtPower(item.battery_power)}</div>
                  <div>${this._fmtPower(item.house_consumption)}</div>
                  <div>${this._fmtPower(item.grid_power)}</div>
                  <div>${this._escape(item.power_source || "Idle")}</div>
                </div>
              `
            )
            .join("")}
        </div>
      </section>
    `;
  }

  _renderHeroBanner(reporting) {
    return "";
  }

  _renderDataSourceBanner(reporting) {
    const meta = reporting?.meta || {};
    const source = String(meta.source || "backend_reporting").replaceAll("_", " ");
    const storage = String(meta.storage || "local_archive").replaceAll("_", " ");
    const diagramSource = String(meta.power_diagram_source || "provider_power_diagram").replaceAll("_", " ");
    const metaSource = String(meta.source || "").trim();
    const sourceDetail = String(meta.source_detail || "").trim();
    const isLoading = metaSource === "synthesized_live_entities" || metaSource === "selected_battery_pending";
    const isLive = metaSource === "live_direct_api";
    const isRefreshingLive = isLive && sourceDetail.includes("refreshing");
    const isRefreshingChart = sourceDetail === "previous_chart_refreshing";
    const toneClass = isLoading ? "data-source-banner--fallback" : isLive ? "data-source-banner--live" : "data-source-banner--backend";
    const helper = isLoading
      ? "Report Loading"
      : isRefreshingChart
        ? "Refreshing today's chart history while keeping the last time-series graph visible."
      : isLive
        ? isRefreshingLive
          ? "Showing the last live snapshot while the selected scope refreshes."
          : "This view is using the current live provider values for the selected scope."
      : "This view is using the backend reporting payload stored through the HEROS report archive flow.";
    return `
      <section class="data-source-banner ${toneClass}">
        <div class="data-source-title">${isLoading ? "Report Loading" : isRefreshingChart ? "Refreshing Today's Report Data" : isRefreshingLive ? "Refreshing Live Data" : isLive ? "Live Reporting Active" : "Backend Reporting Active"}</div>
        <div class="data-source-copy">${helper}</div>
        <div class="data-source-meta">Source: ${this._escape(source)} | Storage: ${this._escape(storage)} | Diagram: ${this._escape(diagramSource)}</div>
      </section>
    `;
  }

  _heroChip(label, value) {
    return `
      <div class="hero-chip">
        <div class="hero-chip-label">${label}</div>
        <div class="hero-chip-value">${value}</div>
      </div>
    `;
  }

  _heroBreakdown(reporting, key, label, displayTotal = null) {
    const diagram = reporting?.power_diagram || {};
    const times = Array.isArray(diagram.time) ? diagram.time : [];
    const values = Array.isArray(diagram?.series?.[key]) ? diagram.series[key] : [];
    const windowConfig = this._chartWindowConfig(times, reporting);
    const included = new Set(windowConfig.indices || []);
    const points = times.map((time, index) => ({ index, minute: this._timeLabelToMinutesOfDay(time), value: Number(values[index]) })).filter((point) => included.has(point.index) && Number.isFinite(point.minute) && Number.isFinite(point.value));
    if (!points.length) return '';
    const periodMinutes = this._chartPeriodMinutes();
    const bucketMinutes = periodMinutes <= 60 ? 10 : periodMinutes <= 360 ? 30 : 60;
    const buckets = new Map();
    const labelFor = (minute) => { const rounded = Math.round(Number(minute)); const hours = Math.floor(rounded / 60); const minutes = rounded % 60; return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`; };
    const bucketFor = (minute) => Math.floor(minute / bucketMinutes) * bucketMinutes;
    const throughLabel = labelFor(points[points.length - 1].minute);
    if (key === 'bat') {
      const start = points[0].value;
      points.forEach((point) => buckets.set(bucketFor(point.minute), { value: point.value }));
      const rows = [...buckets.entries()].reverse().map(([minute, item]) => `<div class="hero-breakdown__row"><span>${labelFor(minute)}</span><strong>${this._fmtPercent(item.value)}</strong><em>${this._fmtNumber(item.value - start, 2)} pp</em></div>`).join('');
      return `<div class="hero-breakdown hero-breakdown--soc" role="tooltip"><div class="hero-breakdown__sticky"><div class="hero-breakdown__title">${this._escape(label)} by ${this._escape(this._periodPreset.toUpperCase())}</div><div class="hero-breakdown__head"><span>Time</span><span>SoC</span><span>Change</span></div></div>${rows}</div>`;
    }
    const multiplier = this._powerDiagramUsesKw(reporting) ? 1 : 1 / 1000;
    for (let index = 0; index < points.length - 1; index += 1) { const current = points[index]; const next = points[index + 1]; const duration = next.minute - current.minute; if (!Number.isFinite(duration) || duration <= 0 || duration > 10) continue; const bucket = bucketFor(current.minute); const item = buckets.get(bucket) || { total: 0, end: current.minute }; item.total += Math.abs(current.value) * multiplier * duration / 60; item.end = Math.max(item.end, next.minute); buckets.set(bucket, item); }
    let running = 0;
    const rowData = [...buckets.entries()].map(([minute, item]) => { running += item.total; const label = labelFor(minute); return { minute, label, total: item.total, running }; });
    if (rowData.length && Number.isFinite(Number(displayTotal))) {
      const providerTotal = Number(displayTotal);
      const calculatedTotal = rowData[rowData.length - 1].running;
      if (calculatedTotal > 0) {
        const scale = providerTotal / calculatedTotal;
        let alignedRunning = 0;
        rowData.forEach((item) => { item.total *= scale; alignedRunning += item.total; item.running = alignedRunning; });
      }
      const finalMinute = points[points.length - 1].minute;
      rowData.push({ minute: finalMinute, label: labelFor(finalMinute), total: null, running: providerTotal, endpoint: true });
    }
    const rows = rowData.reverse().map((item) => `<div class="hero-breakdown__row${item.endpoint ? ' hero-breakdown__row--endpoint' : ''}"><span>${item.label}</span><strong>${item.endpoint ? '—' : this._fmtEnergy(item.total)}</strong><em>${this._fmtEnergy(item.running)}</em></div>`).join('');
    return rows ? `<div class="hero-breakdown" role="tooltip"><div class="hero-breakdown__sticky"><div class="hero-breakdown__title">${this._escape(label)} by ${this._escape(this._periodPreset.toUpperCase())} · through ${this._escape(throughLabel)}</div><div class="hero-breakdown__head"><span>Time</span><span>Total</span><span>Running</span></div></div>${rows}</div>` : '';
  }
_statusHero(reporting) {
    const live = reporting?.live && typeof reporting.live === "object" ? reporting.live : {};
    const diagram = reporting?.power_diagram || {};
    const series = diagram.series && typeof diagram.series === "object" ? diagram.series : {};
    const last = (key) => { const values = Array.isArray(series[key]) ? series[key] : []; for (let index = values.length - 1; index >= 0; index -= 1) { const value = Number(values[index]); if (Number.isFinite(value)) return value; } return null; };
    const battery = Number.isFinite(Number(live.battery_power)) ? Number(live.battery_power) : last("battery") ?? last("bat_discharge");
    const solar = Number.isFinite(Number(live.pv_power)) ? Number(live.pv_power) : last("solar");
    const grid = Number.isFinite(Number(live.grid_power)) ? Number(live.grid_power) : last("grid_import");
    const source = String(live.power_source || "").trim().toLowerCase();
    const vpp = live.vpp_event ?? live.vpp_active ?? live.vpp_status;
    if (vpp === true || String(vpp || "").trim().toLowerCase() === "active") return { label: "VPP Event", detail: "Virtual power event" };
    if (source.includes("error") || source.includes("fault")) return { label: "Error", detail: "Provider error" };
    if (!Number.isFinite(battery) && !Number.isFinite(solar) && !Number.isFinite(grid)) return { label: "Offline", detail: "No current feed" };
    if (battery < -0.01) return { label: Number.isFinite(solar) && solar > 0.05 ? "Solar Charge" : Number.isFinite(grid) && grid > 0.05 ? "Grid Charge" : "Charge", detail: this._fmtLivePower(Math.abs(battery), reporting) };
    if (battery > 0.01) return { label: "Discharge", detail: this._fmtLivePower(battery, reporting) };
    if (Number.isFinite(grid) && grid < -0.05) return { label: "Solar Export", detail: this._fmtLivePower(Math.abs(grid), reporting) };
    if (Number.isFinite(grid) && grid > 0.05) return { label: "Grid Import", detail: this._fmtLivePower(grid, reporting) };
    const soc = Number(live.soc ?? last("bat"));
    if (Number.isFinite(soc) && soc >= 99) return { label: "Battery Full", detail: this._fmtPercent(soc) };
    if (Number.isFinite(soc) && soc <= 10) return { label: "Battery Low", detail: this._fmtPercent(soc) };
    return { label: source === "idle" || source === "balanced" ? "Idle" : "Normal", detail: Number.isFinite(soc) ? this._fmtPercent(soc) : "Monitoring" };
  }_summaryCards(reporting, options = {}) {
    // The FoxESS V2 cards intentionally mirror the rendered diagram: same
    // series, FoxESS labels, palette classes, and one latest chart timestamp.
    const powerDiagram = reporting?.power_diagram || {};
    const summary = powerDiagram.summary && typeof powerDiagram.summary === "object" ? powerDiagram.summary : {};
    const series = powerDiagram.series && typeof powerDiagram.series === "object" ? powerDiagram.series : {};
    const visibleKeys = this._visibleSeriesKeys(reporting);
    const length = Math.max(0, ...visibleKeys.map((key) => Array.isArray(series[key]) ? series[key].length : 0));
    let latestIndex = length - 1;
    while (latestIndex >= 0) {
      const hasMeaningfulFlow = visibleKeys
        .filter((key) => key !== "bat")
        .some((key) => Math.abs(Number((series[key] || [])[latestIndex])) > 0.0001);
      if (hasMeaningfulFlow) break;
      latestIndex -= 1;
    }
    if (latestIndex < 0) latestIndex = length - 1;
    const valueAtLatestPoint = (key) => (latestIndex >= 0 ? (series[key] || [])[latestIndex] : null);
    const isToday = this._isTodaySelection(reporting?.reporting_date || reporting?.power_diagram?.date || this._selectedReportDate());
    const live = reporting?.live && typeof reporting.live === "object" ? reporting.live : {};
    const liveValue = (key) => {
      if (!isToday) return null;
      if (key === "bat") return live.soc;
      if (key === "solar") return live.pv_power;
      if (key === "feed_in") return Math.max(0, -(Number(live.grid_power) || 0));
      if (key === "grid_import") return Math.max(0, Number(live.grid_power) || 0);
      if (key === "load" || key === "consumed") return live.house_consumption;
      if (key === "bat_discharge") return Math.max(0, Number(live.battery_power) || 0);
      if (key === "battery_charge") return Math.max(0, -(Number(live.battery_power) || 0));
      return null;
    };
    const finalHistoricalSeriesValue = (key) => {
      if (isToday) return null;
      const values = Array.isArray(series[key]) ? series[key] : [];
      for (let index = values.length - 1; index >= 0; index -= 1) {
        const value = Number(values[index]);
        if (Number.isFinite(value)) return value;
      }
      return null;
    };
    const archivedPowerDiagram = !isToday
      ? this._powerDiagramFromRecord(this._historyRecordForDate(this._selectedReportDate()))
      : {};
    const historicalSummaryValue = (key) => {
      if (isToday || key !== "bat") return null;
      if (this._selectionMeta().aggregate) {
        const archiveSoc = archivedPowerDiagram?.summary?.soc;
        return Number.isFinite(Number(archiveSoc)) ? archiveSoc : summary.soc;
      }
      // A single battery uses the final 24:00 point, or the last valid point
      // when the provider omitted 24:00, matching Daily Detail.
      const seriesSoc = finalHistoricalSeriesValue("bat");
      if (Number.isFinite(Number(seriesSoc))) return seriesSoc;
      const archiveSoc = archivedPowerDiagram?.summary?.soc;
      return Number.isFinite(Number(archiveSoc)) ? archiveSoc : summary.soc;
    };
    const valueForCard = (key) => {
      const liveValueForKey = liveValue(key);
      if (Number.isFinite(Number(liveValueForKey))) return liveValueForKey;
      const archivedValue = historicalSummaryValue(key);
      return Number.isFinite(Number(archivedValue)) ? archivedValue : valueAtLatestPoint(key);
    };
    const power = (key) => this._fmtChartPower(Math.abs(Number(valueForCard(key)) || 0), reporting);
    // Energy counters are cumulative through the provider data cutoff. They
    // remain distinct from the instantaneous power reading above them.
    const energyTotals = summary;
    const energyFields = {
      solar: "solar_generation",
      bat_discharge: "battery_discharge",
      grid_import: "grid_consumption",
      feed_in: "feed_in",
      battery_charge: "battery_charge",
      load: "load_consumption",
      consumed: "load_consumption",
    };
    const energyRawValue = (key) => {
      const value = Number(energyTotals[energyFields[key]]);
      if (key !== "solar" || (Number.isFinite(value) && value > 0)) return Number.isFinite(value) ? value : null;
      const solarValues = Array.isArray(series.solar) ? series.solar : [];
      const solarTimes = Array.isArray(powerDiagram.time) ? powerDiagram.time : [];
      const window = this._chartWindowConfig(solarTimes, reporting);
      const included = new Set(window.indices || []);
      const multiplier = this._powerDiagramUsesKw(reporting) ? 1 : 1 / 1000;
      let derived = 0;
      for (let index = 0; index < solarValues.length - 1 && index < solarTimes.length - 1; index += 1) {
        if (!included.has(index)) continue;
        const start = this._timeLabelToMinutesOfDay(solarTimes[index]);
        const end = this._timeLabelToMinutesOfDay(solarTimes[index + 1]);
        const duration = end - start;
        if (!Number.isFinite(duration) || duration <= 0 || duration > 10) continue;
        derived += Math.max(0, Number(solarValues[index]) || 0) * multiplier * duration / 60;
      }
      return derived > 0 ? derived : (Number.isFinite(value) ? value : null);
    };
    const energyValue = (key) => {
      const value = energyRawValue(key);
      return Number.isFinite(value) ? this._fmtEnergy(value) : power(key);
    };
const showLive = options.showLive !== false;
    const includeSoc = options.includeSoc !== false;
    const livePower = (key) => this._fmtLivePower(Math.abs(Number(valueForCard(key)) || 0), reporting);
    const cardValue = (key) => showLive ? livePower(key) : energyValue(key);
    const breakdown = (key, label) => showLive ? "" : this._heroBreakdown(reporting, key, label, energyRawValue(key));
    const status = this._statusHero(reporting);
    const statusHelp = {
      text: "Status explanations and priority",
      html: `<strong>Status priority</strong><div class="field-help__section"><strong>Error</strong><span>A provider fault is active.</span></div><div class="field-help__section"><strong>VPP Event</strong><span>A virtual power event is active.</span></div><div class="field-help__section"><strong>Solar Charge</strong><span>The battery is charging from solar.</span></div><div class="field-help__section"><strong>Grid Charge</strong><span>The battery is charging from the grid.</span></div><div class="field-help__section"><strong>Discharge</strong><span>Power is leaving the battery.</span></div><div class="field-help__section"><strong>Solar Export</strong><span>Surplus solar is being exported.</span></div><div class="field-help__section"><strong>Grid Import</strong><span>Power is being imported from the grid.</span></div><div class="field-help__section"><strong>Battery Full / Low</strong><span>The battery is at a configured threshold.</span></div><div class="field-help__section"><strong>Idle</strong><span>There is no meaningful energy flow.</span></div><div class="field-help__section"><strong>Normal</strong><span>Monitoring is healthy.</span></div><div class="field-help__section"><strong>Offline</strong><span>No current feed is available.</span></div>`,
    };
    const cards = {
      status: () => this._ring("Status", status.label, "status", "", status.detail, statusHelp),
      bat: () => includeSoc ? this._ring("SoC", this._fmtPercent(valueForCard("bat")), "bat") : "",
      solar: () => this._ring("Solar", cardValue("solar"), "solar", breakdown("solar", "Solar")),
      bat_discharge: () => this._ring("Battery discharge", cardValue("bat_discharge"), "discharge", breakdown("bat_discharge", "Battery discharge")),
      grid_import: () => this._ring("Grid import", cardValue("grid_import"), "import", breakdown("grid_import", "Grid import")),
      feed_in: () => this._ring("Feed-in", cardValue("feed_in"), "export", breakdown("feed_in", "Feed-in")),
      battery_charge: () => this._ring("Battery charge", cardValue("battery_charge"), "charge", breakdown("battery_charge", "Battery charge")),
      load: () => this._ring("Usage", cardValue("load"), "load", breakdown("load", "Usage")),
      consumed: () => this._ring("Usage", cardValue("consumed"), "load", breakdown("consumed", "Usage")),
    };
    return ["status", ...visibleKeys.filter((key) => includeSoc || key !== "bat")].map((key) => cards[key]?.()).filter(Boolean);
  }

  _visibleSeriesKeys(reporting) {
    const powerDiagram = reporting?.power_diagram || {};
    const summary = powerDiagram.summary || {};
    const series = powerDiagram.series || {};
    const hasUsefulValues = (values) => (Array.isArray(values) ? values : []).some((value) => Number.isFinite(Number(value)) && Number(value) !== 0);
    const hasRecordedEnergy = (field) => Number.isFinite(Number(summary[field])) && Number(summary[field]) > 0;
    const hasLoadSeries = hasUsefulValues(series.load) || hasRecordedEnergy("load_consumption");
    // FoxESS V2 order: SoC, Supply, then Usage. This drives both the legend
    // and the top cards so their labels, colours, and values remain aligned.
    return [
      ["bat", true],
      ["solar", reporting?.aggregate && hasUsefulValues(series.solar)],
      ["bat_discharge", hasUsefulValues(series.bat_discharge)],
      ["grid_import", hasUsefulValues(series.grid_import) || hasRecordedEnergy("grid_consumption")],
      ["feed_in", reporting?.aggregate && (hasUsefulValues(series.feed_in) || hasRecordedEnergy("feed_in"))],
      ["battery_charge", hasUsefulValues(series.battery_charge)],
      ["load", hasLoadSeries],
      ["consumed", reporting?.aggregate && !hasLoadSeries && hasUsefulValues(series.consumed)],
    ].filter(([, included]) => included).map(([key]) => key);
  }

  _powerAxisScale(maxValue) {
    const viewportWidth = Math.floor(Number(this._chartViewportWidth) || 900);
    const detailViewportWidth = viewportWidth * Math.max(Number(window.devicePixelRatio) || 1, 1);
    const intervalCount = detailViewportWidth >= 1800 ? 6 : detailViewportWidth >= 1300 ? 5 : 3;
    if (!Number.isFinite(maxValue) || maxValue <= 0) {
      return {
        max: 1,
        ticks: Array.from({ length: intervalCount + 1 }, (_, index) => index / intervalCount),
      };
    }
    // Add labelled intervals only when there is enough horizontal room. The
    // signed scale stays symmetric around zero at every viewport size.
    const magnitude = 10 ** Math.floor(Math.log10(maxValue));
    const candidates = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 9, 10]
      .map((multiple) => multiple * magnitude);
    const axisMax = candidates.find((candidate) => candidate >= maxValue) || 10 * magnitude;
    const step = axisMax / intervalCount;
    const precision = step < 0.01 ? 4 : step < 0.1 ? 3 : step < 1 ? 2 : 1;
    return {
      max: axisMax,
      ticks: Array.from({ length: intervalCount + 1 }, (_, index) => (
        Number((step * index).toFixed(precision))
      )),
    };
  }

  _chartTimeTicks(times) {
    const ticks = [];
    for (let hour = 0; hour <= 24; hour += 2) {
      const minutesOfDay = hour * 60;
      const ratio = Math.min(minutesOfDay / (24 * 60), 1);
      ticks.push({
        ratio,
        label: `${String(hour).padStart(2, "0")}:00`,
      });
    }
    const labels = Array.isArray(times) ? times : [];
    if (labels.length) {
      const latest = this._displayTimeLabel(labels[labels.length - 1]);
      if (latest && !ticks.some((tick) => tick.label === latest)) {
        const ratio = this._timeLabelRatio(labels[labels.length - 1]);
        if (ratio !== null) {
          ticks.push({ ratio, label: latest });
        }
      }
    }
    return ticks
      .sort((left, right) => left.ratio - right.ratio)
      .filter((tick, index, list) => index === 0 || tick.label !== list[index - 1].label);
  }

  _renderReportNavigation(kind) {
    const label = `${String(kind || "report").replace(/^./, (letter) => letter.toUpperCase())} timeline`;
    return `<div class="report-chart-nav" aria-label="${this._escape(label)}"><button type="button" data-${this._escape(kind)}-shift="-1" aria-label="Earlier period">&#8249;</button><button type="button" data-${this._escape(kind)}-shift="1" aria-label="Later period">&#8250;</button></div>`;
  }

  _chartPeriodMinutes() {
    return HEROS_REPORT_PERIODS.find((item) => item.value === this._periodPreset)?.minutes || 1440;
  }

  _chartWindowConfig(times, reporting) {
    const labels = Array.isArray(times) ? times : [];
    const minuteValues = labels.map((label) => this._timeLabelToMinutesOfDay(label));
    const validMinutes = minuteValues.filter((value) => Number.isFinite(value));
    const rangeMinutes = this._chartPeriodMinutes();
    const selectedDate = String(reporting?.reporting_date || reporting?.power_diagram?.date || this._selectedReportDate() || "").trim();
    const isToday = this._isTodaySelection(selectedDate);
    const currentMinutes = this._currentTimeSeriesPoint(new Date(), this._liveRefreshBucketSeconds()).minutesOfDay;
    const providerCutoffMinutes = this._providerDataCutoffMinutes(reporting?.power_diagram || {}, labels);
    // Provider report labels are local installation time. Do not compare them
    // to the browser clock: a browser in another time zone can move 1H, 6H,
    // and 12H into a future zero-filled section of the provider day array.
    const todayDataEndMinutes = Number.isFinite(providerCutoffMinutes)
      ? providerCutoffMinutes
      : currentMinutes;
    let startMinutes = 0;
    // A 24-hour chart always keeps a full-day 00:00&#8211;24:00 axis. Short
    // windows keep their requested width; future samples remain excluded.
    let endMinutes = isToday && rangeMinutes < 24 * 60
      ? todayDataEndMinutes
      : 24 * 60;
    if (rangeMinutes < 24 * 60) {
      if (isToday) {
        startMinutes = Math.max(0, endMinutes - rangeMinutes);
        endMinutes = todayDataEndMinutes;
      } else {
        const anchor = this._historyFocusMinutes();
        const maxStart = Math.max(0, 24 * 60 - rangeMinutes);
        startMinutes = Math.min(Math.max(anchor - rangeMinutes / 2, 0), maxStart);
        endMinutes = Math.min(24 * 60, startMinutes + rangeMinutes);
      }
    }
    if (this._view === "power" && rangeMinutes < 1440 && this._timelineNavigation?.key === selectedDate + "|" + this._periodPreset) {
      startMinutes = Math.min(Math.max(0, (isToday ? todayDataEndMinutes : 1440) - rangeMinutes), this._timelineNavigation.start);
      endMinutes = Math.min(isToday ? todayDataEndMinutes : 1440, startMinutes + rangeMinutes);
    }
    const indices = labels
      .map((_, index) => ({ index, minute: minuteValues[index] }))
      .filter(({ minute }) => !Number.isFinite(minute) || (
        minute >= startMinutes
        && minute <= endMinutes
        && (!isToday || minute <= todayDataEndMinutes)
      ));
    const fallbackIndices = indices.length
      ? indices.map((item) => item.index)
      : labels.map((_, index) => index);
    return {
      startMinutes,
      endMinutes: Math.max(endMinutes, startMinutes + 1),
      indices: fallbackIndices,
    };
  }

  _chartRatioFromMinutes(minutes, startMinutes, endMinutes) {
    const span = Math.max(endMinutes - startMinutes, 1);
    return Math.min(Math.max((minutes - startMinutes) / span, 0), 1);
  }

  _chartWindowTicks(startMinutes, endMinutes) {
    const span = Math.max(endMinutes - startMinutes, 1);
    const viewportWidth = Math.floor(Number(this._chartViewportWidth) || 900);
    const detailViewportWidth = viewportWidth * Math.max(Number(window.devicePixelRatio) || 1, 1);
    const isWide = detailViewportWidth >= 1800;
    const isMedium = detailViewportWidth >= 1300;
    const step = span <= 60
      ? (isWide ? 10 : 15)
      : span <= 360
        ? (isWide ? 30 : 60)
        : span <= 720
          ? (isWide ? 60 : isMedium ? 90 : 120)
          : (isWide ? 60 : isMedium ? 120 : 180);
    const ticks = [];
    const first = Math.ceil(startMinutes / step) * step;
    for (let minute = first; minute <= endMinutes; minute += step) {
      const hours = Math.floor(minute / 60);
      const mins = minute % 60;
      ticks.push({
        ratio: this._chartRatioFromMinutes(minute, startMinutes, endMinutes),
        label: `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`,
      });
    }
    if (!ticks.length || ticks[0].label !== this._displayTimeLabel(`${String(Math.floor(startMinutes / 60)).padStart(2, "0")}:${String(Math.floor(startMinutes % 60)).padStart(2, "0")}`)) {
      ticks.unshift({
        ratio: 0,
        label: `${String(Math.floor(startMinutes / 60)).padStart(2, "0")}:${String(Math.floor(startMinutes % 60)).padStart(2, "0")}`,
      });
    }
    const endLabel = `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(Math.floor(endMinutes % 60)).padStart(2, "0")}`;
    if (!ticks.some((tick) => tick.label === endLabel)) {
      ticks.push({ ratio: 1, label: endLabel });
    }
    // Keep the exact provider cutoff label, but remove a neighbouring regular
    // tick when the two would render on top of each other at the right edge.
    const compacted = [];
    ticks.forEach((tick) => {
      const previous = compacted[compacted.length - 1];
      if (previous && tick.ratio - previous.ratio < 0.06) {
        if (tick.ratio >= 0.999) {
          compacted[compacted.length - 1] = tick;
        }
        return;
      }
      compacted.push(tick);
    });
    return compacted;
  }

  _reportingChartDataSignature(reporting) {
    const powerDiagram = reporting?.power_diagram || {};
    return JSON.stringify({
      date: powerDiagram.date || "",
      loaded_through: powerDiagram.meta?.loaded_through || "",
      time: Array.isArray(powerDiagram.time) ? powerDiagram.time : [],
      series: powerDiagram.series && typeof powerDiagram.series === "object" ? powerDiagram.series : {},
      aggregate: Boolean(reporting?.aggregate),
      selection: this._selectionKey(reporting?.selection || this._selectionMeta()),
    });
  }

  _reportingChartAnimationSignature(reporting) {
    const powerDiagram = reporting?.power_diagram || {};
    const pointCount = this._timeSeriesPointCount(reporting);
    return JSON.stringify({
      date: powerDiagram.date || "",
      aggregate: Boolean(reporting?.aggregate),
      selection: this._selectionKey(reporting?.selection || this._selectionMeta()),
      period: this._periodPreset || "24h",
      statisticalPeriod: this._statisticalPeriod || "24h",
      historyFocusTime: this._historyFocusTime || "12:00",
      view: this._view || "power",
      richness: pointCount > 2 ? "rich" : pointCount > 0 ? "sparse" : "empty",
    });
  }

  _prepareChartRefresh(reporting) {
    const nextData = this._reportingChartDataSignature(reporting);
    const nextAnimation = this._reportingChartAnimationSignature(reporting);
    this._chartShouldAnimate = Boolean(
      this._chartAnimationSignature
      && nextAnimation
      && this._chartAnimationSignature !== nextAnimation
    );
    this._chartDataSignature = nextData;
    this._chartAnimationSignature = nextAnimation;
  }

  _seriesPointRatio(times, index, valueCount) {
    const labels = Array.isArray(times) ? times : [];
    const ratio = this._timeLabelRatio(labels[index]);
    if (ratio !== null) {
      return ratio;
    }
    if (valueCount <= 1) {
      return 0;
    }
    return index / Math.max(valueCount - 1, 1);
  }

  _seriesDisplayLabel(key) {
    return key === "bat"
      ? "SoC"
      : key === "bat_discharge"
        ? "Battery Discharge"
        : key === "battery_charge"
          ? "Battery Charge"
          : key === "grid_import"
            ? "Grid Import"
            : key === "load"
              ? "Total Load"
              : key === "solar"
                ? "Solar"
                : key === "feed_in"
                  ? "Feed-in"
                  : key === "consumed"
                    ? "Total Load"
                    : key;
  }
  _formatTooltipSeriesValue(key, value, reporting) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "Unavailable";
    if (key === "bat") return `${this._fmtNumber(numeric, 3)} %`;
    const kilowatts = this._powerDiagramUsesKw(reporting) ? Math.abs(numeric) : Math.abs(numeric) / 1000;
    return `${kilowatts.toFixed(3)} kW`;
  }

  _derivedBatteryInterruptionEvents(series, reporting) {
    const chartUsesKw = this._powerDiagramUsesKw(reporting);
    const watts = (key, index) => {
      const numeric = Number(series?.[key]?.[index]);
      if (!Number.isFinite(numeric)) return 0;
      return Math.abs(chartUsesKw ? numeric * 1000 : numeric);
    };
    const isInterrupted = (index) => {
      const discharge = watts("bat_discharge", index);
      const gridImport = watts("grid_import", index);
      const load = Math.max(watts("load", index), watts("consumed", index));
      const soc = Number(series?.bat?.[index]);
      return (
        discharge <= 25
        && gridImport >= 100
        && load >= 100
        && Number.isFinite(soc)
        && soc > 10
      );
    };
    const events = [];
    for (let index = 0; index < (series?.bat_discharge?.length || 0); index += 1) {
      // Mark the start of an interruption run once. A preceding discharge
      // reading is useful evidence but must not be required: FoxESS may omit
      // it at the exact five-minute transition that needs to be highlighted.
      if (isInterrupted(index) && (index === 0 || !isInterrupted(index - 1))) {
        events.push({ index });
      }
    }
    return events;
  }
  _renderChart(reporting) {
    const powerDiagram = reporting?.power_diagram || {};
    const series = powerDiagram.series || {};
    const selection = reporting?.selection || this._selectionMeta();
    const times = powerDiagram.time || [];
    const seriesKeys = this._visibleSeriesKeys(reporting);
    const powerKeys = seriesKeys.filter((key) => key !== "bat");
    const chartUsesKw = this._powerDiagramUsesKw(reporting);
    const chartPowerValue = (value) => {
      const numeric = Number(value) || 0;
      return chartUsesKw ? numeric : numeric / 1000;
    };
    const usageKeys = new Set(["feed_in", "battery_charge", "load", "consumed"]);
    const chartSeries = Object.fromEntries(
      seriesKeys.map((key) => [
        key,
        key === "bat"
          ? [...(series[key] || [])]
          : (series[key] || []).map((value) => Math.abs(chartPowerValue(value)) * (usageKeys.has(key) ? -1 : 1)),
      ]),
    );
    const windowConfig = this._chartWindowConfig(times, reporting);
    const filteredTimes = windowConfig.indices.map((index) => times[index]);
    const filteredRawSeries = Object.fromEntries(
      seriesKeys.map((key) => [key, windowConfig.indices.map((index) => (series[key] || [])[index])]),
    );
    const filteredSeries = Object.fromEntries(
      seriesKeys.map((key) => [key, windowConfig.indices.map((index) => (chartSeries[key] || [])[index])]),
    );
    const interruptionEvents = this._derivedBatteryInterruptionEvents(filteredRawSeries, reporting);
    const interruptionEventIndexes = new Set(interruptionEvents.map((event) => event.index));
    const allPowerValues = powerKeys.flatMap((key) => filteredSeries[key] || []);
    const powerMax = Math.max(...allPowerValues.map((value) => Math.abs(Number(value) || 0)), 0.1);
    const powerAxis = this._powerAxisScale(powerMax);
    const plotPowerMax = powerAxis.max;
    const plotPowerMin = -plotPowerMax;
    // Use the available viewport as the SVG coordinate width. This adds
    // horizontal detail on wide displays without scaling up labels or strokes.
    const width = Math.max(900, Math.floor(Number(this._chartViewportWidth) || 900));
    // Keep typography and chart height stable at every viewport size. Extra
    // width is used for additional axis labels, not larger visual elements.
    const height = 290;
    const left = 82;
    const rightPadding = 88;
    const plotWidth = Math.max(720, width - left - rightPadding);
    const plotHeight = 150;
    const top = 28;
    const bottom = top + plotHeight;
    const right = left + plotWidth;
    const zeroY = bottom - ((0 - plotPowerMin) / (plotPowerMax - plotPowerMin)) * plotHeight;
    const chartPowerY = (value) => bottom - (((Number(value) || 0) - plotPowerMin) / (plotPowerMax - plotPowerMin)) * plotHeight;
    const formatPowerAxis = (value) => {
      value = Math.abs(Number(value) || 0);
      if (!Number.isFinite(value)) return plotPowerMax < 1 ? "0 W" : "0 kW";
      const absValue = Math.abs(value);
      if (plotPowerMax < 1 || absValue < 1) {
        const watts = value * 1000;
        const absWatts = Math.abs(watts);
        const digits = absWatts < 10 ? 1 : 0;
        return `${this._fmtNumber(watts, digits)} W`;
      }
      const digits = absValue < 10 ? 1 : 0;
      return `${this._fmtNumber(value, digits)} kW`;
    };

    const pointCount = Math.max(
      Array.isArray(times) ? times.length : 0,
      ...seriesKeys.map((key) => Array.isArray(series[key]) ? series[key].length : 0),
    );
    this._chartInteractionModel = {
      times: [...filteredTimes],
      reporting,
      seriesKeys: [...seriesKeys],
      viewBox: { width, height },
      plot: { left, top, right, bottom, zeroY, plotWidth, plotHeight },
      points: Array.from({ length: filteredTimes.length }, (_, index) => {
        const minutes = this._timeLabelToMinutesOfDay(filteredTimes[index]);
        const ratio = Number.isFinite(minutes)
          ? this._chartRatioFromMinutes(minutes, windowConfig.startMinutes, windowConfig.endMinutes)
          : this._seriesPointRatio(filteredTimes, index, filteredTimes.length);
        const x = left + plotWidth * ratio;
        series.battery_charge = Array.isArray(series.battery_charge) ? series.battery_charge : [];
    series.bat_discharge = Array.isArray(series.bat_discharge) ? series.bat_discharge : [];
    series.grid_import = Array.isArray(series.grid_import) ? series.grid_import : [];
    const values = {};
        const markers = {};
        seriesKeys.forEach((key) => {
          const rawValues = Array.isArray(filteredRawSeries[key]) ? filteredRawSeries[key] : [];
          const rawValue = rawValues[index];
          values[key] = rawValue;
          const numeric = Number(rawValue);
          if (!Number.isFinite(numeric)) {
            return;
          }
          const plottedValue = key === "bat" ? numeric : Math.abs(chartPowerValue(rawValue)) * (usageKeys.has(key) ? -1 : 1);
          const y = key === "bat"
            ? bottom - (plottedValue / 100) * plotHeight
            : chartPowerY(plottedValue);
          markers[key] = { x, y, rawValue };
        });
        return {
          index,
          x,
          label: this._displayTimeLabel(filteredTimes[index] || this._formatTimeLabel(new Date())),
          values,
          markers,
          batteryDischargeInterrupted: interruptionEventIndexes.has(index),
        };
      }),
    };
    const animateClass = this._chartShouldAnimate ? " chart--refresh" : "";

    const area = (values, labels, maxValue, fill, stroke, options = {}) => {
      if (!values.length) return "";
      const fillOpacity = options.fillOpacity ?? 0.65;
      const strokeWidth = options.strokeWidth ?? 2.25;
      const points = values
        .map((value, index) => {
          const minutes = this._timeLabelToMinutesOfDay(labels[index]);
          const ratio = Number.isFinite(minutes)
            ? this._chartRatioFromMinutes(minutes, windowConfig.startMinutes, windowConfig.endMinutes)
            : this._seriesPointRatio(labels, index, values.length);
          const x = left + plotWidth * ratio;
          const y = maxValue === 100
            ? bottom - ((Number(value) || 0) / 100) * plotHeight
            : chartPowerY(value);
          return `${x},${y}`;
        })
        .join(" ");
      const firstMinutes = this._timeLabelToMinutesOfDay(labels[0]);
      const lastMinutes = this._timeLabelToMinutesOfDay(labels[Math.max(labels.length - 1, 0)]);
      const startRatio = Number.isFinite(firstMinutes)
        ? this._chartRatioFromMinutes(firstMinutes, windowConfig.startMinutes, windowConfig.endMinutes)
        : this._seriesPointRatio(labels, 0, values.length);
      const endRatio = Number.isFinite(lastMinutes)
        ? this._chartRatioFromMinutes(lastMinutes, windowConfig.startMinutes, windowConfig.endMinutes)
        : this._seriesPointRatio(labels, Math.max(values.length - 1, 0), values.length);
      const baselineY = maxValue === 100 ? bottom : zeroY;
      const start = `${left + plotWidth * startRatio},${baselineY}`;
      const end = `${left + plotWidth * endRatio},${baselineY}`;
      return `<polygon points="${start} ${points} ${end}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" fill-opacity="${fillOpacity}"></polygon>`;
    };

    const line = (values, labels, maxValue, stroke, options = {}) => {
      if (!values.length) return "";
      const strokeWidth = options.strokeWidth ?? 2.35;
      const strokeOpacity = options.strokeOpacity ?? 1;
      const points = values
        .map((value, index) => {
          const minutes = this._timeLabelToMinutesOfDay(labels[index]);
          const ratio = Number.isFinite(minutes)
            ? this._chartRatioFromMinutes(minutes, windowConfig.startMinutes, windowConfig.endMinutes)
            : this._seriesPointRatio(labels, index, values.length);
          const x = left + plotWidth * ratio;
          const y = maxValue === 100
            ? bottom - ((Number(value) || 0) / 100) * plotHeight
            : chartPowerY(value);
          return `${x},${y}`;
        })
        .join(" ");
      return `<polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-opacity="${strokeOpacity}" stroke-linejoin="round" stroke-linecap="round"></polyline>`;
    };

    const palette = {
      bat: ["#40c982", "#40c982"],
      solar: ["#ffd13c", "#ffd13c"],
      bat_discharge: ["#60a5fa", "#60a5fa"],
      grid_import: ["#b796f4", "#b796f4"],
      feed_in: ["#82127c", "#a824a1"],
      battery_charge: ["#e72898", "#ff4eb3"],
      load: ["#ff8f1f", "#ff9f35"],
      consumed: ["#ff8f1f", "#ff9f35"],
    };
    const batKeys = seriesKeys.filter((key) => key === "bat");
    const flowKeys = seriesKeys.filter((key) => key !== "bat");

    const timeTicks = this._chartWindowTicks(windowConfig.startMinutes, windowConfig.endMinutes);
    const powerTicks = powerAxis.ticks;
    const selectedDate = this._selectedReportDate();
    const todayValue = this._todayDateString();
    const selectedDateLabel = selectedDate || powerDiagram.date || "";
    const showHistoryFocusTime = this._view === "power"
      && !this._isTodaySelection(selectedDate)
      && !this._isFullDayPeriod();
    const selectedHistoryRecord = this._historyRecordForDate(selectedDate);
    const historyNeedsRefresh = this._historyRecordNeedsRefresh(selectedHistoryRecord, selectedDate);
    const historyLoadedThrough = this._displayTimeLabel(powerDiagram.meta?.loaded_through || "");
    const finalValueTime = this._displayTimeLabel(powerDiagram.meta?.loaded_through || times[times.length - 1] || "");
    const selectionLabel = selection?.aggregate
      ? "All Batteries"
      : String(selection?.remark || selection?.sys_sn || selection?.label || "Selected battery");
    const groupedTariffPeriod = this._view === "tariff" && (this._tariffPeriod || "day") !== "day";
    const groupedTariffRecords = groupedTariffPeriod
      ? this._tariffRecordsForPeriod(this._selectedReportDate(), this._tariffPeriod)
      : [];
    const historyNotice = groupedTariffPeriod
      ? `<div class="chart-history-note">Tariff Impact will aggregate ${groupedTariffRecords.length} saved day${groupedTariffRecords.length === 1 ? "" : "s"} for ${this._escape(this._tariffPeriodLabel(this._selectedReportDate(), this._tariffPeriod))}; missing calendar dates are not requested.</div>`
      : this._historyConfigured() && selectedDate
      ? selectedHistoryRecord
        ? this._isTodaySelection(selectedDate)
          ? `<div class="chart-history-note">Live as at ${this._escape(finalValueTime || "latest feed sample")}.</div>`
          : historyNeedsRefresh && this._view !== "power"
            ? `<div class="chart-history-note chart-history-note--info">Archived report for ${this._escape(selectedDate)} is available through ${this._escape(historyLoadedThrough || "the last valid point")}; the remaining interval is still being refreshed.</div>`
            : `<div class="chart-history-note">Final value as at ${this._escape(finalValueTime || selectedDate)}.</div>`
        : this._historyLoading
          ? `<div class="chart-history-note">Loading report history for ${this._escape(selectedDate)}...</div>`
          : `<div class="chart-history-note chart-history-note--warn">No stored report history found yet for ${this._escape(selectedDate)}. HEROS has requested it.</div>`
      : "";

    return `
      <section class="panel">
          <div class="panel-header chart-header">
            <div class="chart-header__row chart-header__row--primary">
              <div class="chart-toolbar chart-toolbar--main">
                <div class="panel-tabs">
                  <button type="button" class="${this._view === "power" ? "active" : ""}" data-view="power">Power Diagram</button>
                  <button type="button" class="${this._view === "statistical" ? "active" : ""}" data-view="statistical">Statistical Diagram</button>
                  <button type="button" class="${this._view === "mode" ? "active" : ""}" data-view="mode">Mode Timeline</button>
                  <button type="button" class="${this._view === "operational" ? "active" : ""}" data-view="operational">Operational</button>
                  <button type="button" class="${this._view === "detail" ? "active" : ""}" data-view="detail">Daily Detail</button>
                  <button type="button" class="${this._view === "tariff" ? "active" : ""}" data-view="tariff">Tariff Impact</button><button type="button" class="${this._view === "trend" ? "active" : ""}" data-view="trend">Trend</button><button type="button" class="${this._view === "energy-flow" ? "active" : ""}" data-view="energy-flow">Energy Flow</button><button type="button" class="${this._view === "self-sufficiency" ? "active" : ""}" data-view="self-sufficiency">Self-Sufficiency</button><button type="button" class="${this._view === "battery-compare" ? "active" : ""}" data-view="battery-compare">Battery Compare</button><button type="button" class="${this._view === "battery-balance" ? "active" : ""}" data-view="battery-balance">Battery Balance</button><button type="button" class="${this._view === "battery-flow" ? "active" : ""}" data-view="battery-flow">Battery Flow</button><button type="button" class="${this._view === "peak-demand" ? "active" : ""}" data-view="peak-demand">Peak Demand</button><button type="button" class="${this._view === "solar-capture" ? "active" : ""}" data-view="solar-capture">Solar Capture</button><button type="button" class="${this._view === "forecast-accuracy" ? "active" : ""}" data-view="forecast-accuracy">Forecast Accuracy</button><button type="button" class="${this._view === "predicted-actual" ? "active" : ""}" data-view="predicted-actual">Predicted vs Actual</button><button type="button" class="${this._view === "solar-compare" ? "active" : ""}" data-view="solar-compare">Solar Compare</button><button type="button" class="${this._view === "scope-health" ? "active" : ""}" data-view="scope-health">Scope Health</button><button type="button" class="${this._view === "export-data" ? "active" : ""}" data-view="export-data">Export / Data</button><button type="button" class="${this._view === "day-compare" ? "active" : ""}" data-view="day-compare">Period Compare</button><button type="button" class="${this._view === "seasonal-trend" ? "active" : ""}" data-view="seasonal-trend">Seasonal Trend</button><button type="button" class="${this._view === "anomaly" ? "active" : ""}" data-view="anomaly">Anomaly</button><button type="button" class="${this._view === "exception" ? "active" : ""}" data-view="exception">Exception</button>
                </div>
              </div>
              <div class="chart-toolbar chart-toolbar--meta">
                <span class="chart-selection-pill" title="Chart follows the selected battery">${this._escape(selectionLabel)}</span>
                ${this._config?.overview_toggle_available ? `<button type="button" class="chart-overview-toggle ${this._config?.overview_report_enabled ? "is-active" : ""}" data-overview-report-toggle role="switch" aria-checked="${Boolean(this._config?.overview_report_enabled)}">Show on Overview</button>` : ""}
              </div>
            </div>
            <div class="chart-header__row chart-header__row--secondary">
              ${this._view === "tariff" ? `<div class="chart-tools chart-tools--date">${this._renderTariffPeriodControls(selectedDateLabel)}</div>` : `
              <div class="chart-tools chart-tools--date">
              <div class="parameter-group parameter-group--date control-group">
              <button class="date-nav" type="button" data-shift-date="-1" aria-label="Previous day">&#8249;</button>
              ${this._renderIsoDatePicker("data-report-date", selectedDateLabel, { max: todayValue, label: "Choose report date" })}
              <button class="date-nav" type="button" data-shift-date="1" aria-label="Next day">&#8250;</button>
              </div>
              ${showHistoryFocusTime ? `
                <label class="focus-time-control">
                  <span>Focus</span>
                  <input type="time" data-chart-focus-time value="${this._escape(this._normalizedFocusTime(this._historyFocusTime))}" step="900">
                </label>
              ` : ""}
              ${this._view === "power" || this._view === "operational" || this._view === "statistical" || HEROS_ANALYSIS_VIEWS.has(this._view) ? `
                <div class="period-tabs control-group">
                  <strong class="period-tabs__label">Period</strong>
                  ${this._view === "power" ? HEROS_REPORT_PERIODS.map((period) => `<button type="button" class="${this._periodPreset === period.value ? "active" : ""}" data-period="${period.value}">${period.label}</button>`).join("") : this._view === "statistical" ? HEROS_STATISTICAL_PERIODS.map((period) => `<button type="button" class="period-button ${this._statisticalPeriod === period.value ? "active" : ""}" data-statistical-period="${period.value}">${period.label}</button>`).join("") : HEROS_ANALYSIS_VIEWS.has(this._view) ? HEROS_REPORT_PERIODS.map((period) => `<button type="button" class="period-button ${(this._analysisPeriod || "day") === period.value ? "active" : ""}" data-analysis-period="${period.value}">${period.label}</button>`).join("") : ["1h","6h","12h","24h","day","week","month","quarter","year"].map((item) => `<button type="button" class="period-button ${this._operationalPeriod === item ? "active" : ""}" data-operational-period="${item}">${({"1h":"1H","6h":"6H","12h":"12H","24h":"24H"}[item] || item[0].toUpperCase()+item.slice(1))}</button>`).join("")}
                </div>
              ` : ""}
            </div>
            `}
            ${this._view === "detail" ? `
              <div class="chart-tools chart-tools--action">
                <button type="button" class="download-btn" data-download-report>Download CSV</button>
              </div>
            ` : ""}
          </div>
        </div>
        <div class="report-controls-divider" role="separator" aria-label="Report results"></div>${historyNotice}
        ${
          this._view === "power"
            ? `
          <div class="ring-grid">
            ${this._summaryCards(reporting).join("")}
          </div>
          <div class="chart-layout">
            <div class="report-chart-nav-row">${this._renderReportNavigation("power")}</div><div class="chart-stage" data-chart-stage>
            <svg class="chart${animateClass}" viewBox="0 0 ${width} ${height}" role="img" aria-label="HEROS power diagram chart">
              <line x1="${left}" y1="${zeroY}" x2="${right}" y2="${zeroY}" class="axis"></line>
              <line x1="${left}" y1="${top}" x2="${left}" y2="${bottom}" class="axis"></line>
              <line x1="${right}" y1="${top}" x2="${right}" y2="${bottom}" class="axis axis-soc"></line>
              ${[...powerTicks.slice(1).reverse().map((point) => -point), ...powerTicks]
                .map((point) => {
                  const y = chartPowerY(point);
                  const socRatio = (bottom - y) / plotHeight;
                  return `
                    <line x1="${left}" y1="${y}" x2="${right}" y2="${y}" class="grid"></line>
                    <text x="${left - 10}" y="${y + 4}" class="tick tick-left" text-anchor="end">${this._escape(formatPowerAxis(point))}</text>
                    <text x="${right + 10}" y="${y + 4}" class="tick tick-right" text-anchor="start">${Math.round(socRatio * 100)}%</text>
                  `;
                })
                .join("")}
              ${batKeys
                .map((key) => {
                  const values = filteredSeries[key] || [];
                  return `<g class="chart-series-layer chart-series-layer--soc" data-chart-series="${key}">${area(values, filteredTimes, 100, palette[key][0], palette[key][1], { fillOpacity: 0.52, strokeWidth: 2.25 })}${line(values, filteredTimes, 100, palette[key][1], { strokeWidth: 1.4, strokeOpacity: 0.72 })}</g>`;
                })
                .join("")}
              ${flowKeys
                .map((key) => {
                  const values = filteredSeries[key] || [];
                  return `<g class="chart-series-layer chart-series-layer--flow" data-chart-series="${key}">${area(values, filteredTimes, plotPowerMax, palette[key][0], palette[key][1])}${line(values, filteredTimes, plotPowerMax, palette[key][1])}</g>`;
                })
                .join("")}
              ${interruptionEvents.map(({ index }) => {
                const point = this._chartInteractionModel.points[index];
                return point
                  ? `<line x1="${point.x}" y1="${top}" x2="${point.x}" y2="${bottom}" class="chart-error-event" aria-label="Error occurred"></line>`
                  : "";
              }).join("")}
              <rect x="${left}" y="${top}" width="${plotWidth}" height="${plotHeight}" class="chart-hit-target" data-chart-hit-target></rect>
              ${timeTicks
                .map(({ label, ratio }) => {
                  const x = left + plotWidth * ratio;
                  return `<text x="${x}" y="${bottom + 24}" class="tick" text-anchor="middle">${this._escape(this._displayTimeLabel(label))}</text>`;
                })
                .join("")}
              <text x="${left + plotWidth / 2}" y="${bottom + 54}" class="axis-title" text-anchor="middle">Time of day</text>
              <text x="18" y="${top + plotHeight / 2}" class="axis-title" text-anchor="middle" transform="rotate(-90 18 ${top + plotHeight / 2})">Power (kW)</text>
              <text x="${width - 18}" y="${top + plotHeight / 2}" class="axis-title axis-title-soc" text-anchor="middle" transform="rotate(90 ${width - 18} ${top + plotHeight / 2})">Battery SOC (%)</text>
            </svg>
            <div class="chart-hover-line" data-chart-hover-line hidden></div>
            <div class="chart-hover-markers" data-chart-hover-markers hidden></div>
            <div class="chart-tooltip" data-chart-tooltip hidden></div>
            </div>
            <aside class="chart-legend" aria-label="Chart legend">
              <div class="legend-row">
            <div class="legend-group">
              <span class="legend-group-label">SOC</span>
              ${seriesKeys.filter((key) => key === "bat").map((key) => this._legendButton("SoC", key)).join("")}
            </div>
            <div class="legend-group">
              <span class="legend-group-label">Supply</span>
              ${seriesKeys.filter((key) => ["solar", "bat_discharge", "grid_import"].includes(key)).map((key) => this._legendButton(this._seriesDisplayLabel(key), key)).join("")}
            </div>
            <div class="legend-group">
              <span class="legend-group-label">Usage</span>
              ${seriesKeys.filter((key) => ["feed_in", "battery_charge", "load", "consumed"].includes(key)).map((key) => this._legendButton(this._seriesDisplayLabel(key), key)).join("")}
            </div>
              </div>
            </aside>
          </div>
          <div class="chart-explainer">
            Left axis shows power in kW, with sub-1kW values labelled in W. Right axis shows SOC percent. Tooltip values share one timestamp.
          </div>
        `
            : this._view === "mode"
              ? this._renderModeTimeline(reporting)
              : this._view === "detail"
                ? this._renderDailyDetail(reporting)
                : this._view === "operational"
                  ? this._renderOperationalReport()
                : this._view === "tariff"
                  ? this._renderTariffImpact(reporting)
                  : HEROS_ANALYSIS_VIEWS.has(this._view)
                    ? this._renderAnalysisReport(reporting, this._view)
                    : this._renderStatsDiagram(reporting)
        }
      </section>
    `;
  }

  _renderAnalysisReport(reporting, kind) {
    const definitions = {
      trend: ["Trend", "Daily solar and household demand across the selected period."],
      "energy-flow": ["Energy Flow", "Energy entering, stored by, used by, and leaving the system."],
      "self-sufficiency": ["Self-Sufficiency", "The share of household demand supplied without grid imports."],
      "battery-compare": ["Battery Compare", "Side-by-side live state and power for the available battery units."],
      "battery-balance": ["Battery Balance", "State-of-charge spread and power sharing across battery units."],
      "battery-flow": ["Battery Flow", "Charge, discharge, throughput, and net movement for the selected period."],
      "peak-demand": ["Peak Demand", "The highest household demand samples in the selected period."],
      "solar-capture": ["Solar Capture", "How much generated solar stayed on site rather than being exported."],
      "forecast-accuracy": ["Forecast Accuracy", "Forecast comparison is shown when provider forecast history is available."],
      "predicted-actual": ["Predicted vs Actual", "Actual solar generation compared with the recent daily baseline."],
      "solar-compare": ["Solar Compare", "Daily solar generation, local use, and grid export side by side."],
      "scope-health": ["Scope Health", "Archive coverage and data completeness for the selected scope."],
      "export-data": ["Export / Data", "Available reporting records and export readiness for the selected scope."],
      "day-compare": ["Period Compare", "The selected period compared with the preceding period of the same length."],
      "seasonal-trend": ["Seasonal Trend", "Monthly solar and household-demand direction across the archive."],
      "anomaly": ["Anomaly", "Days that differ materially from the selected-period average."],
      "exception": ["Exception", "Incomplete records and provider-status exceptions in the selected period."],
    };
    const [title, description] = definitions[kind] || ["Analysis", "Selected energy analysis."];
    const period = this._analysisPeriod || "day";
    const periodLabels = { "1h":"1H", "6h":"6H", "12h":"12H", "24h":"24H", day:"Day", week:"Week", month:"Month", quarter:"Quarter", year:"Year" };
    const periodDays = { "1h":1, "6h":1, "12h":1, "24h":1, day:1, week:7, month:31, quarter:92, year:366 }[period] || 1;
    const fields = ["solar_generation", "load_consumption", "battery_charge", "battery_discharge", "grid_consumption", "feed_in"];
    const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
    const anchorText = this._selectedReportDate();
    const anchor = this._parseLocalDate(anchorText) || this._todayLocalDate();
    const expectedPeriodDays = period === "month" ? new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate() : period === "quarter" ? 92 : period === "year" ? 366 : periodDays;
    const start = new Date(anchor);
    if (period === "month") start.setDate(1);
    else if (period === "quarter") start.setMonth(Math.floor(start.getMonth() / 3) * 3, 1);
    else if (period === "year") start.setMonth(0, 1);
    else start.setDate(start.getDate() - periodDays + 1);
    const records = this._historyScopeData()?.scope?.records || {};
    let rows = Object.entries(records)
      .map(([date, record]) => ({ date, record }))
      .filter(({ date }) => {
        const parsed = this._parseLocalDate(date);
        return parsed && parsed >= start && parsed <= anchor;
      })
      .sort((a, b) => a.date.localeCompare(b.date));
    const reportingDate = String(reporting?.reporting_date || reporting?.power_diagram?.date || anchorText || "");
    if (reporting?.today && reportingDate && reportingDate >= this._formatLocalDate(start) && reportingDate <= anchorText) {
      rows = rows.filter((item) => item.date !== reportingDate);
      rows.push({ date: reportingDate, record: reporting });
      rows.sort((a, b) => a.date.localeCompare(b.date));
    }
    if (!rows.length && reporting?.today) rows = [{ date: anchorText, record: reporting }];
    const totals = Object.fromEntries(fields.map((field) => [field, rows.reduce((sum, item) => sum + number(item.record?.today?.[field]), 0)]));
    const intradayMinutes = { "1h":60, "6h":360, "12h":720 }[period];
    if (intradayMinutes) {
      const diagram = reporting?.power_diagram || {};
      const times = Array.isArray(diagram.time) ? diagram.time : [];
      const series = diagram.series && typeof diagram.series === "object" ? diagram.series : {};
      const minutes = times.map((value) => this._timeLabelToMinutesOfDay(value));
      const end = Math.max(...minutes.filter(Number.isFinite), 0);
      const begin = Math.max(0, end - intradayMinutes);
      const multiplier = this._powerDiagramUsesKw(reporting) ? 1 : 1 / 1000;
      const energy = (keys) => {
        for (const key of keys) {
          const values = Array.isArray(series[key]) ? series[key] : [];
          if (!values.length) continue;
          let result = 0;
          for (let index = 0; index < Math.min(values.length, minutes.length) - 1; index += 1) {
            const left = minutes[index];
            const right = minutes[index + 1];
            if (!Number.isFinite(left) || !Number.isFinite(right) || right <= begin || left >= end) continue;
            const duration = Math.min(right, end) - Math.max(left, begin);
            if (duration <= 0 || duration > 10) continue;
            result += Math.abs(number(values[index])) * multiplier * duration / 60;
          }
          return result;
        }
        return 0;
      };
      totals.solar_generation = energy(["solar"]);
      totals.load_consumption = energy(["load", "consumed"]);
      totals.battery_charge = energy(["battery_charge"]);
      totals.battery_discharge = energy(["bat_discharge"]);
      totals.grid_consumption = energy(["grid_import"]);
      totals.feed_in = energy(["feed_in"]);
    }
    const coverage = rows.length ? `${rows.length} of ${expectedPeriodDays} expected archive days represented.` : `No archived days are available for this ${periodLabels[period] || "selected"} period.`;
    const metric = (label, value, tone = "") => `<div class="analysis-metric ${tone}"><span>${this._escape(label)}</span><strong>${value}</strong></div>`;
    const metrics = (items) => `<div class="analysis-metrics">${items.map(([label, value, tone]) => metric(label, value, tone)).join("")}</div>`;
    const energy = (field) => this._fmtEnergy(totals[field]);
    const maxFlow = Math.max(...fields.map((field) => totals[field]), 0.01);
    const batteryRows = (() => {
      const attrs = this._selectorState()?.attributes || {};
      const liveRows = Array.isArray(attrs?.direct_api?.live_batteries) ? attrs.direct_api.live_batteries : [];
      const valueFrom = (row, keys) => {
        for (const key of keys) {
          const value = Number(row?.[key]);
          if (Number.isFinite(value)) return value;
        }
        return null;
      };
      const mapped = liveRows.map((row, index) => {
        const power = valueFrom(row, ["battery_power", "pbat", "bat_power", "power"]);
        return {
          label: String(row?.remark || row?.label || row?.name || `Battery ${index + 1}`),
          soc: valueFrom(row, ["soc", "battery_soc"]),
          power,
        };
      });
      if (mapped.length) return mapped;
      const options = Array.isArray(attrs.options) ? attrs.options.filter((item) => !/^all systems$/i.test(String(item))) : [];
      const live = reporting?.live || {};
      const selected = reporting?.selection || attrs.selection || {};
      const label = String(selected.remark || selected.label || options[0] || "Current battery").replace(/^[^(]+\((.+)\)$/, "$1");
      return [{ label, soc: Number.isFinite(Number(live.soc)) ? Number(live.soc) : null, power: Number.isFinite(Number(live.battery_power)) ? Number(live.battery_power) : null, aggregateFallback: true }];
    })();
    const dailyEnergy = rows.map(({ date, record }) => ({ date, solar:number(record?.today?.solar_generation), load:number(record?.today?.load_consumption), grid:number(record?.today?.grid_consumption), feed:number(record?.today?.feed_in), charge:number(record?.today?.battery_charge), discharge:number(record?.today?.battery_discharge) }));
    const average = (key) => dailyEnergy.length ? dailyEnergy.reduce((sum, item) => sum + number(item[key]), 0) / dailyEnergy.length : 0;
    let content = "";
    if (kind === "trend") {
      const daily = rows.map(({ date, record }) => ({ date, solar:number(record?.today?.solar_generation), load:number(record?.today?.load_consumption), grid:number(record?.today?.grid_consumption), feed:number(record?.today?.feed_in), charge:number(record?.today?.battery_charge), discharge:number(record?.today?.battery_discharge) }));
      const max = Math.max(...daily.flatMap((item) => [item.solar, item.load]), 0.01);
      const average = (key) => daily.length ? daily.reduce((sum, item) => sum + item[key], 0) / daily.length : 0;
      content = `${metrics([["Days shown", String(daily.length)], ["Average solar", this._fmtEnergy(average("solar"))], ["Average load", this._fmtEnergy(average("load"))], ["Net grid", this._fmtEnergy(totals.grid_consumption - totals.feed_in)]])}<div class="analysis-trend"><div class="analysis-trend__legend"><span><i class="is-solar"></i>Solar generation (kWh)</span><span><i class="is-load"></i>Household load (kWh)</span></div><div class="analysis-trend__plot"><span class="analysis-trend__y-title">Energy (kWh)</span><span class="analysis-trend__x-title">Date</span><div class="analysis-trend__axis" aria-label="Energy axis in kilowatt-hours"><span>${this._fmtNumber(max, 1)} kWh</span><span>${this._fmtNumber(max * .75, 1)}</span><span>${this._fmtNumber(max * .5, 1)}</span><span>${this._fmtNumber(max * .25, 1)}</span><span>0</span></div>${daily.map((item) => { const aria = `${item.date}: Solar ${this._fmtEnergy(item.solar)}, household load ${this._fmtEnergy(item.load)}, grid import ${this._fmtEnergy(item.grid)}, feed-in ${this._fmtEnergy(item.feed)}, battery charge ${this._fmtEnergy(item.charge)}, battery discharge ${this._fmtEnergy(item.discharge)}`; return `<div class="analysis-trend__day" tabindex="0" aria-label="${this._escape(aria)}"><div class="analysis-trend__tooltip" role="tooltip"><strong>${this._escape(item.date)}</strong><dl><div><dt>Solar</dt><dd>${this._fmtEnergy(item.solar)}</dd></div><div><dt>Household load</dt><dd>${this._fmtEnergy(item.load)}</dd></div><div><dt>Grid import</dt><dd>${this._fmtEnergy(item.grid)}</dd></div><div><dt>Feed-in</dt><dd>${this._fmtEnergy(item.feed)}</dd></div><div><dt>Battery charge</dt><dd>${this._fmtEnergy(item.charge)}</dd></div><div><dt>Battery discharge</dt><dd>${this._fmtEnergy(item.discharge)}</dd></div></dl></div><div class="analysis-trend__bars"><i class="is-solar" style="height:${Math.max(3, item.solar / max * 100)}%"></i><i class="is-load" style="height:${Math.max(3, item.load / max * 100)}%"></i></div><strong>${this._escape(item.date)}</strong></div>`; }).join("") || `<div class="analysis-empty">No daily archive values in this period.</div>`}</div><p>${coverage} X-axis shows Date; Y-axis shows energy in kWh. Hover or focus a date to see its energy values.</p></div>`;
    } else if (kind === "energy-flow") {
      const localUse = Math.max(0, totals.load_consumption - totals.grid_consumption);
      content = `${metrics([["Generated", energy("solar_generation")], ["Household demand", energy("load_consumption")], ["Battery throughput", this._fmtEnergy(totals.battery_charge + totals.battery_discharge)], ["Net grid", this._fmtEnergy(totals.grid_consumption - totals.feed_in)]])}<div class="analysis-energy-flow"><div class="analysis-flow-column"><h3>Sources</h3><div class="analysis-flow-node is-solar"><span>Solar generation</span><strong>${energy("solar_generation")}</strong></div><div class="analysis-flow-node is-grid"><span>Grid import</span><strong>${energy("grid_consumption")}</strong></div><div class="analysis-flow-node is-battery"><span>Battery discharge</span><strong>${energy("battery_discharge")}</strong></div></div><div class="analysis-flow-hub"><span>Energy balance</span><strong>${this._fmtEnergy(totals.solar_generation + totals.grid_consumption + totals.battery_discharge)}</strong><small>available supply</small></div><div class="analysis-flow-column"><h3>Destinations</h3><div class="analysis-flow-node is-load"><span>Household demand</span><strong>${energy("load_consumption")}</strong></div><div class="analysis-flow-node is-battery"><span>Battery charge</span><strong>${energy("battery_charge")}</strong></div><div class="analysis-flow-node is-export"><span>Grid export</span><strong>${energy("feed_in")}</strong></div></div></div><p class="analysis-note">${coverage} Local household supply was ${this._fmtEnergy(localUse)}. Totals are energy balances; exact source-to-destination routing is not inferred.</p>`;
    } else if (kind === "self-sufficiency") {
      const demand = totals.load_consumption;
      const local = Math.max(0, demand - totals.grid_consumption);
      const selfSufficiency = demand > 0 ? Math.max(0, Math.min(100, local / demand * 100)) : 0;
      const solarUsed = Math.max(0, totals.solar_generation - totals.feed_in);
      const selfConsumption = totals.solar_generation > 0 ? Math.max(0, Math.min(100, solarUsed / totals.solar_generation * 100)) : 0;
      content = `<div class="analysis-self"><div class="analysis-gauge" style="--analysis-percent:${selfSufficiency.toFixed(2)}"><div><strong>${this._fmtPercent(selfSufficiency)}</strong><span>self-sufficient</span></div></div>${metrics([["Demand supplied locally", this._fmtEnergy(local), "is-positive"], ["Grid reliance", this._fmtEnergy(totals.grid_consumption)], ["Solar used locally", this._fmtEnergy(solarUsed)], ["Solar self-consumption", this._fmtPercent(selfConsumption)]])}</div><div class="analysis-self__scale"><i style="width:${selfSufficiency}%"></i></div><p class="analysis-note">${coverage} Self-sufficiency is calculated as household demand minus grid imports, divided by household demand.</p>`;
    } else if (kind === "battery-compare") {
      content = `${metrics([["Batteries available", String(batteryRows.length)], ["Fleet average SOC", this._fmtPercent(batteryRows.reduce((sum, row) => sum + number(row.soc), 0) / Math.max(1, batteryRows.filter((row) => Number.isFinite(row.soc)).length))], ["Charging now", String(batteryRows.filter((row) => Number(row.power) < 0).length)], ["Discharging now", String(batteryRows.filter((row) => Number(row.power) > 0).length)]])}<div class="analysis-table" role="table" aria-label="Battery comparison"><div class="analysis-table__row is-head" role="row"><span>Battery</span><span>SOC</span><span>Direction</span><span>Power</span></div>${batteryRows.map((row) => { const power = Number(row.power); const direction = !Number.isFinite(power) || Math.abs(power) < 1 ? "Idle" : power > 0 ? "Discharging" : "Charging"; return `<div class="analysis-table__row" role="row"><strong>${this._escape(row.label)}</strong><span>${this._fmtPercent(row.soc)}</span><span>${direction}</span><span>${this._fmtLivePower(Math.abs(power || 0), reporting)}</span></div>`; }).join("")}</div><p class="analysis-note">${batteryRows.some((row) => row.aggregateFallback) ? "The provider currently supplies one aggregate battery row, so an individual comparison is unavailable." : "Values are current provider readings for each available battery."}</p>`;
    } else if (kind === "battery-balance") {
      const validSoc = batteryRows.map((row) => Number(row.soc)).filter(Number.isFinite);
      const average = validSoc.length ? validSoc.reduce((sum, value) => sum + value, 0) / validSoc.length : 0;
      const spread = validSoc.length ? Math.max(...validSoc) - Math.min(...validSoc) : 0;
      content = `${metrics([["Fleet average SOC", this._fmtPercent(average)], ["SOC spread", this._fmtPercent(spread)], ["Highest SOC", this._fmtPercent(validSoc.length ? Math.max(...validSoc) : null)], ["Lowest SOC", this._fmtPercent(validSoc.length ? Math.min(...validSoc) : null)]])}<div class="analysis-chart-label">Battery state of charge (%) · marker shows fleet average</div><div class="analysis-balance">${batteryRows.map((row) => { const soc = Math.max(0, Math.min(100, number(row.soc))); return `<div class="analysis-balance__row"><strong>${this._escape(row.label)}</strong><div><i style="width:${soc}%"></i><em style="left:${average}%" title="Fleet average"></em></div><span>${this._fmtPercent(row.soc)}</span></div>`; }).join("")}</div><p class="analysis-note">${batteryRows.length > 1 ? "The marker shows fleet average SOC; shorter bars indicate batteries below the fleet level." : "Balance needs two or more provider battery rows. The current aggregate SOC is shown for reference."}</p>`;
    } else if (kind === "peak-demand") {
      const ranked = [...dailyEnergy].sort((a, b) => b.load - a.load);
      const ordered = [...dailyEnergy].sort((a, b) => b.date.localeCompare(a.date));
      const scale = Math.max(...ordered.map((row) => row.load), .01);
      content = `${metrics([["Highest demand", this._fmtEnergy(ranked[0]?.load)], ["Peak date", ranked[0]?.date || "—"], ["Average demand", this._fmtEnergy(average("load"))], ["Period coverage", `${dailyEnergy.length}/${expectedPeriodDays} days`]])}<div class="analysis-ranking"><div class="analysis-ranking__label">Household load (kWh) · dates shown newest first</div>${ordered.map((row, index) => `<div><b>${index + 1}</b><span>${this._escape(row.date)}</span><i style="width:${row.load / scale * 100}%"></i><strong>${this._fmtEnergy(row.load)}</strong></div>`).join("") || `<div class="analysis-empty">No demand records are available.</div>`}</div><p class="analysis-note">Peak demand is the largest household-load total within the selected period. Dates are shown newest first; coverage shows available archive days against the expected period.</p>`;
    } else if (kind === "solar-capture") {
      const local = Math.max(0, totals.solar_generation - totals.feed_in);
      const capture = totals.solar_generation ? Math.max(0, Math.min(100, local / totals.solar_generation * 100)) : 0;
      content = `<div class="analysis-self"><div class="analysis-gauge" style="--analysis-percent:${capture.toFixed(2)}"><div><strong>${this._fmtPercent(capture)}</strong><span>captured on site</span></div></div>${metrics([["Solar generated", energy("solar_generation")], ["Used or stored locally", this._fmtEnergy(local), "is-positive"], ["Exported", energy("feed_in")], ["Battery charge", energy("battery_charge")]])}</div><p class="analysis-note">Solar capture is generation minus feed-in, divided by generation.</p>`;
    } else if (kind === "forecast-accuracy") {
      const forecastRows = dailyEnergy.filter((row) => Number.isFinite(Number(row.forecast)));
      content = `${metrics([["Forecast records", String(forecastRows.length)], ["Actual solar", energy("solar_generation")], ["Forecast source", forecastRows.length ? "Available" : "Not recorded"], ["Days in period", String(dailyEnergy.length)]])}<div class="analysis-empty analysis-report__frame">${forecastRows.length ? "Forecast history is available for comparison." : "No provider forecast history has been stored for this period yet. Actual solar history remains available above."}</div>`;
    } else if (kind === "predicted-actual") {
      const baseline = average("solar"); const latest = dailyEnergy[dailyEnergy.length - 1]; const difference = number(latest?.solar) - baseline;
      content = `${metrics([["Selected-day actual", this._fmtEnergy(latest?.solar)], ["Recent baseline", this._fmtEnergy(baseline)], [difference >= 0 ? "Above baseline" : "Below baseline", this._fmtEnergy(Math.abs(difference))], ["Days in period", String(dailyEnergy.length)]])}<div class="analysis-compare-line"><i style="width:${Math.min(100, number(latest?.solar) / Math.max(baseline, .01) * 50)}%"></i><b>Actual</b><em style="left:50%" title="Recent daily baseline"></em><span>Baseline</span></div><p class="analysis-note">The comparison baseline is the average actual solar generation in the selected period.</p>`;
    } else if (kind === "solar-compare") {
      const scale = Math.max(...dailyEnergy.flatMap((row) => [row.solar, Math.max(0, row.solar-row.feed), row.feed]), .01);
      content = `<div class="analysis-solar-compare"><span class="analysis-solar-compare__y-title">Energy (kWh)</span><span class="analysis-solar-compare__x-title">Date</span><div class="analysis-solar-compare__axis" aria-label="Solar energy axis in kilowatt-hours"><span>${this._fmtNumber(scale, 1)} kWh</span><span>${this._fmtNumber(scale * .75, 1)}</span><span>${this._fmtNumber(scale * .5, 1)}</span><span>${this._fmtNumber(scale * .25, 1)}</span><span>0</span></div>${dailyEnergy.map((row) => { const local = Math.max(0, row.solar - row.feed); const aria = `${row.date}: solar generation ${this._fmtEnergy(row.solar)}, estimated local use ${this._fmtEnergy(local)}, feed-in ${this._fmtEnergy(row.feed)}`; return `<div class="analysis-solar-compare__day" tabindex="0" aria-label="${this._escape(aria)}"><div class="analysis-solar-compare__tooltip" role="tooltip"><strong>${this._escape(row.date)}</strong><dl><div><dt>Solar generation</dt><dd>${this._fmtEnergy(row.solar)}</dd></div><div><dt>Estimated local use</dt><dd>${this._fmtEnergy(local)}</dd></div><div><dt>Feed-in</dt><dd>${this._fmtEnergy(row.feed)}</dd></div></dl></div><strong>${this._escape(row.date)}</strong><span><i class="is-solar" style="height:${row.solar / scale * 100}%"></i><i class="is-local" style="height:${local / scale * 100}%"></i><i class="is-export" style="height:${row.feed / scale * 100}%"></i></span></div>`; }).join("")}</div><div class="analysis-chart-legend"><div class="analysis-chart-legend__group"><strong>SUPPLY</strong><span><i class="is-solar"></i>Solar generation (kWh)</span></div><div class="analysis-chart-legend__group"><strong>USAGE</strong><span><i class="is-local"></i>Estimated local use (kWh)</span><span><i class="is-export"></i>Feed-in (kWh)</span></div></div><p class="analysis-note">X-axis shows Date; Y-axis shows daily energy in kWh using the shared scale at left. Yellow is generation, green is estimated local solar use, and magenta is feed-in. Hover or focus a date for exact values.</p>`;
    } else if (kind === "scope-health" || kind === "export-data" || kind === "exception") {
      const missing = rows.filter((row) => !row.record?.today).length; const complete = Math.max(0, rows.length - missing); const label = kind === "scope-health" ? "Records with totals" : kind === "export-data" ? "Records ready for export" : "Complete records";
      content = `${metrics([[label, String(complete)], ["Missing totals", String(missing)], ["Archive days", String(rows.length)], ["Selected scope", this._historyScopeKey()]])}<div class="analysis-report__frame"><h3>${kind === "exception" ? "Provider exceptions" : kind === "export-data" ? "Data availability" : "Archive coverage"}</h3><p>${missing ? `${missing} archived day${missing === 1 ? " is" : "s are"} incomplete and should be treated cautiously.` : "All archived days in this selected period contain report totals."}</p></div>`;
    } else if (kind === "day-compare") {
      const selectedStart = new Date(start);
      const selectedEnd = new Date(anchor);
      const selectedLength = Math.max(1, Math.round((selectedEnd - selectedStart) / 86400000) + 1);
      const previousEnd = new Date(selectedStart);
      previousEnd.setDate(previousEnd.getDate() - 1);
      const previousStart = new Date(previousEnd);
      previousStart.setDate(previousStart.getDate() - selectedLength + 1);
      const rowsForRange = (begin, end) => Object.entries(records)
        .map(([date, record]) => ({ date, record }))
        .filter(({ date }) => { const parsed = this._parseLocalDate(date); return parsed && parsed >= begin && parsed <= end; })
        .sort((a, b) => a.date.localeCompare(b.date));
      const aggregate = (items) => Object.fromEntries(fields.map((field) => [field, items.reduce((sum, item) => sum + number(item.record?.today?.[field]), 0)]));
      const selectedTotals = aggregate(rows);
      const previousTotals = aggregate(rowsForRange(previousStart, previousEnd));
      const periodName = periodLabels[period] || "Day";
      const rangeLabel = (begin, end) => selectedLength === 1 ? this._formatLocalDate(begin) : `${this._formatLocalDate(begin)} – ${this._formatLocalDate(end)}`;
      const selectedRangeLabel = rangeLabel(selectedStart, selectedEnd);
      const previousRangeLabel = rangeLabel(previousStart, previousEnd);
      const delta = (key) => selectedTotals[key] - previousTotals[key];
      content = `${metrics([[`Selected ${periodName.toLowerCase()}`, selectedRangeLabel], [`Previous ${periodName.toLowerCase()}`, previousRangeLabel], ["Solar change", this._fmtEnergy(Math.abs(delta("solar_generation")))], ["Load change", this._fmtEnergy(Math.abs(delta("load_consumption")))]])}<div class="analysis-table"><div class="analysis-table__row is-head"><span>Measure</span><span>Selected ${this._escape(periodName)}</span><span>Previous ${this._escape(periodName)}</span><span>Change</span></div>${[["Solar", "solar_generation"], ["Household load", "load_consumption"], ["Grid import", "grid_consumption"], ["Feed-in", "feed_in"]].map(([label,key]) => `<div class="analysis-table__row"><strong>${label}</strong><span>${this._fmtEnergy(selectedTotals[key])}</span><span>${this._fmtEnergy(previousTotals[key])}</span><span>${delta(key) >= 0 ? "+" : "−"}${this._fmtEnergy(Math.abs(delta(key)))}</span></div>`).join("")}</div><p class="analysis-note">The selected ${periodName.toLowerCase()} is compared with the immediately preceding ${periodName.toLowerCase()} of the same length. Date ranges are shown above.</p>`;
    } else if (kind === "seasonal-trend" || kind === "anomaly") {
      const averageSolar = average("solar"); const selected = kind === "anomaly" ? dailyEnergy.filter((row) => Math.abs(row.solar - averageSolar) > Math.max(1, averageSolar * .35)) : dailyEnergy;
      const ordered = [...selected].sort((a, b) => b.date.localeCompare(a.date));
      const scale = Math.max(...ordered.map((row) => row.solar), .01);
      const rankingLabel = kind === "anomaly" ? "Solar generation (kWh) · deviation from selected-period average" : "Solar generation (kWh)";
      content = `${metrics([[kind === "anomaly" ? "Flagged days" : "Days shown", String(selected.length)], ["Average solar", this._fmtEnergy(averageSolar)], ["Average load", this._fmtEnergy(average("load"))], ["Solar range", this._fmtEnergy(Math.max(...dailyEnergy.map((row)=>row.solar),0) - Math.min(...dailyEnergy.map((row)=>row.solar),0))]])}<div class="analysis-ranking"><div class="analysis-ranking__label">${rankingLabel}</div>${ordered.map((row, index) => `<div><b>${index + 1}</b><span>${kind === "anomaly" ? (row.solar >= averageSolar ? "Above average" : "Below average") : this._escape(row.date)}</span>${kind === "anomaly" ? `<small>${this._escape(row.date)}</small>` : ""}<i style="width:${row.solar / scale * 100}%"></i><strong>${this._fmtEnergy(row.solar)}</strong></div>`).join("") || `<div class="analysis-empty">No solar anomalies meet the current threshold.</div>`}</div><p class="analysis-note">${kind === "anomaly" ? "An anomaly is a solar day more than 35% from the selected-period average; it is a review signal, not a fault diagnosis. Dates are shown newest first." : "Values are shown newest first for the selected period. Coverage is reported against the expected period length."}</p>`;
    } else {
      const charge = totals.battery_charge;
      const discharge = totals.battery_discharge;
      const throughput = charge + discharge;
      const net = charge - discharge;
      const scale = Math.max(charge, discharge, 0.01);
      content = `${metrics([["Charged", this._fmtEnergy(charge), "is-charge"], ["Discharged", this._fmtEnergy(discharge), "is-discharge"], ["Total throughput", this._fmtEnergy(throughput)], [net >= 0 ? "Net stored" : "Net supplied", this._fmtEnergy(Math.abs(net))]])}<div class="analysis-chart-label">Energy flow (kWh) · charge, battery balance, and discharge</div><div class="analysis-battery-flow"><div class="analysis-battery-flow__side is-charge"><span>Energy into battery</span><div><i style="width:${charge / scale * 100}%"></i></div><strong>${this._fmtEnergy(charge)}</strong></div><div class="analysis-battery-flow__battery"><span>Battery</span><strong>${net > 0 ? "+" : net < 0 ? "−" : ""}${this._fmtEnergy(Math.abs(net))}</strong><small>${net > 0 ? "net stored" : net < 0 ? "net supplied" : "balanced"}</small></div><div class="analysis-battery-flow__side is-discharge"><span>Energy out of battery</span><div><i style="width:${discharge / scale * 100}%"></i></div><strong>${this._fmtEnergy(discharge)}</strong></div></div><p class="analysis-note">${coverage} Throughput is charge plus discharge; net flow is charge minus discharge.</p>`;
    }
    return `<section class="analysis-report analysis-report--${kind}" aria-label="${this._escape(title)}"><div class="analysis-report__heading"><div><h2>${this._escape(title)}</h2><p>${this._escape(description)}</p><span class="analysis-report__period">${periodLabels[period] || "Day"} · ${this._escape(anchorText)}</span></div>${this._renderReportNavigation(kind)}</div>${content}</section>`;
  }
  _renderOperationalReport() {
    const records = this._historyScopeData()?.scope?.records || {};
    const range = this._operationalPeriod || "month";
    const rows = [];
    const anchor = new Date(`${this._selectedReportDate()}T00:00:00`);
    const start = new Date(anchor);
    if (range === "week") start.setDate(start.getDate() - 6);
    else if (range === "month") start.setDate(start.getDate() - 30);
    else if (range === "quarter") start.setDate(start.getDate() - 91);
    else if (range === "year") start.setDate(start.getDate() - 365);
    for (const [date, record] of Object.entries(records)) {
      const day = new Date(`${date}T00:00:00`);
      if (Number.isFinite(start.getTime()) && Number.isFinite(anchor.getTime()) && (day < start || day > anchor)) continue;
      const diagram = record?.power_diagram || record?.reporting?.power_diagram || {};
      const series = diagram.series && typeof diagram.series === "object" ? diagram.series : {};
      const events = this._derivedBatteryInterruptionEvents(series, record?.reporting || record);
      for (const event of events) {
        const label = Array.isArray(diagram.time) ? diagram.time[event.index] : "";
        const span = {"1h":60,"6h":360,"12h":720}[range];
        const minute = this._timeLabelToMinutesOfDay(label);
        const windowStart = this._timelineNavigation?.key === this._selectedReportDate() + "|" + range ? this._timelineNavigation.start : Math.max(0, this._historyFocusMinutes() - (span || 1440) / 2);
        if (span && (!Number.isFinite(minute) || minute < windowStart || minute > windowStart + span)) continue;
        rows.push({ date, time: this._displayTimeLabel(label || "Unknown"), reason: event.reason || "Provider interruption" });
      }
    }
    rows.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    const byTime = new Map();
    rows.forEach((row) => byTime.set(row.time, (byTime.get(row.time) || 0) + 1));
    const recurring = [...byTime.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    const dateCounts = [...new Set(rows.map((row) => row.date))].sort().map((date) => [date, rows.filter((row) => row.date === date).length]);
    const maxDateCount = Math.max(1, ...dateCounts.map(([, count]) => count));
    const maxTimeCount = Math.max(1, ...recurring.map(([, count]) => count));
    const axisLabels = (max) => [...new Set([max, Math.ceil(max / 2), 0])].map((value) => `<span>${value}</span>`).join("");
    const chartBar = (label, count, max, axisName, detail) => `<div class="operational-report__bar" tabindex="0" aria-label="${this._escape(axisName)} ${this._escape(label)}: ${count} error events"><i style="--bar-height:${Math.max(8, Math.round(count / max * 100))}%"></i><span>${this._escape(label)}</span><em class="operational-report__tooltip">${this._escape(detail)}</em></div>`;
    const dateChart = dateCounts.map(([date, count]) => chartBar(date, count, maxDateCount, "Date", `${date}: ${count} error${count === 1 ? "" : "s"}`)).join("");
    const timeChart = recurring.map(([time, count]) => chartBar(time, count, maxTimeCount, "Time", `${time}: ${count} error${count === 1 ? "" : "s"}`)).join("");
    const chart = (title, axisName, bars, labels, emptyText) => `<div class="operational-report__trend${bars ? "" : " operational-report__trend--empty"}"><h3>${title}</h3>${bars ? `<div class="operational-chart" role="img" aria-label="${title} chart"><span class="operational-chart__y-title">Error events</span><div class="operational-chart__plot"><div class="operational-chart__y-axis">${labels}</div><div class="operational-report__bars">${bars}</div><span class="operational-chart__x-title">${axisName}</span></div></div>` : `<div class="operational-report__empty-state">${emptyText}</div>`}</div>`;
    return `<section class="operational-report" aria-label="Operational Report"><div class="operational-report__heading"><div><h2>Operational Report</h2><div class="operational-report__controls"><strong>Period</strong>${["day","week","month","quarter","year"].map((item) => `<button type="button" class="period-button ${range === item ? "active" : ""}" data-operational-period="${item}">${item[0].toUpperCase()+item.slice(1)}</button>`).join("")}</div><p>Battery error timing across the selected period.</p></div><div class="operational-report__count">${this._renderReportNavigation("operational")}<strong>${rows.length}</strong><span>Error events</span></div></div>${rows.length ? `${chart("Errors by date", "Date", dateChart, axisLabels(maxDateCount), "No error events recorded for this period.")}${chart("Recurring times", "Time", timeChart, axisLabels(maxTimeCount), "No recurring error times recorded.")}<div class="operational-report__table"><div class="operational-report__row operational-report__row--head"><span>Date</span><span>Time</span><span>Event</span></div>${rows.map((row) => `<div class="operational-report__row"><span>${this._escape(row.date)}</span><span>${this._escape(row.time)}</span><span>${this._escape(row.reason)}</span></div>`).join("")}</div>` : `${chart("Errors by date", "Date", "", "", "No error events recorded for this period.")}${chart("Recurring times", "Time", "", "", "No recurring error times recorded.")}`}<div class="operational-report__legend"><span><i></i>Error event detected</span><span>Times are grouped to five-minute samples.</span></div></section>`;
  }

  _renderModeTimeline(reporting) {
    const powerDiagram = reporting?.power_diagram || {};
    const series = powerDiagram.series && typeof powerDiagram.series === "object" ? powerDiagram.series : {};
    const times = Array.isArray(powerDiagram.time) ? powerDiagram.time : [];
    const pointCount = Math.max(times.length, ...Object.values(series).map((values) => Array.isArray(values) ? values.length : 0), 0);
    if (!pointCount) return `<div class="empty">Five-minute mode data is not available for this date yet.</div>`;
    const chartUsesKw = this._powerDiagramUsesKw(reporting);
    const watts = (key, index) => {
      const numeric = Number(series?.[key]?.[index]);
      return Number.isFinite(numeric) ? Math.abs(chartUsesKw ? numeric * 1000 : numeric) : 0;
    };
    const interruptionIndexes = new Set(this._derivedBatteryInterruptionEvents(series, reporting).map((event) => event.index));
    const modeForPoint = (index) => {
      if (interruptionIndexes.has(index)) return { key: "error", label: "Error occurred", tone: "error" };
      if (watts("battery_charge", index) > 25) return { key: "battery-charge", label: "Battery charging", tone: "battery-charge" };
      if (watts("bat_discharge", index) > 25) return { key: "battery-discharge", label: "Battery discharging", tone: "battery-discharge" };
      if (watts("grid_import", index) >= 100) return { key: "grid-import", label: "Grid importing", tone: "grid-import" };
      if (watts("feed_in", index) >= 100) return { key: "feed-in", label: "Grid exporting", tone: "feed-in" };
      if (watts("solar", index) >= 100) return { key: "solar", label: "Solar supplying", tone: "solar" };
      return { key: "idle", label: "Balanced / idle", tone: "idle" };
    };
    const minutesForPoint = (index) => {
      const minutes = this._timeLabelToMinutesOfDay(times[index]);
      return Number.isFinite(minutes) ? minutes : index * 5;
    };
    const points = Array.from({ length: pointCount }, (_, index) => ({
      index, minutes: minutesForPoint(index), label: this._displayTimeLabel(times[index] || ""), mode: modeForPoint(index),
    }));
    const selectedDate = this._selectedReportDate();
    const isToday = this._isTodaySelection(selectedDate);
    const lastMinutes = points[points.length - 1].minutes;
    const finalMinutes = isToday
      ? Math.max(lastMinutes + 5, this._currentTimeSeriesPoint(new Date(), this._liveRefreshBucketSeconds()).minutesOfDay)
      : 24 * 60;
    const segments = [];
    points.forEach((point, index) => {
      const endMinutes = index < points.length - 1 ? points[index + 1].minutes : finalMinutes;
      const previous = segments[segments.length - 1];
      if (previous && previous.key === point.mode.key && point.mode.key !== "error") {
        previous.endMinutes = Math.max(previous.endMinutes, endMinutes);
      } else {
        segments.push({ ...point.mode, startMinutes: point.minutes, endMinutes: Math.max(endMinutes, point.minutes + 1) });
      }
    });
    const errorSegments = segments.filter((segment) => segment.key === "error");
    const formatRange = (segment) => {
      const format = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(Math.floor(minutes % 60)).padStart(2, "0")}`;
      return `${format(segment.startMinutes)}-${format(Math.min(segment.endMinutes, 24 * 60))}`;
    };
    const legend = [
      { key: "solar", label: "Solar supplying" }, { key: "battery-discharge", label: "Battery discharging" },
      { key: "battery-charge", label: "Battery charging" }, { key: "grid-import", label: "Grid importing" },
      { key: "feed-in", label: "Grid exporting" }, { key: "idle", label: "Balanced / idle" }, { key: "error", label: "Error occurred" },
    ];
    return `
      <section class="mode-report" aria-label="Mode timeline">
        <div class="mode-summary">
          <div class="mode-summary__item"><strong>${pointCount}</strong><span>Five-minute points</span></div>
          <div class="mode-summary__item"><strong>${segments.length}</strong><span>Mode periods</span></div>
          <div class="mode-summary__item mode-summary__item--error"><strong>${errorSegments.length}</strong><span>Error events</span></div>
        </div>
        <div class="mode-timeline" role="list" aria-label="Operating mode timeline">
          ${segments.map((segment) => {
            const duration = Math.max(segment.endMinutes - segment.startMinutes, 1);
            const label = duration >= 30 || segment.key === "error" ? `<span>${this._escape(segment.label)}</span>` : "";
            const title = `${segment.label}: ${formatRange(segment)}`;
            return `<div class="mode-timeline__segment mode-timeline__segment--${segment.tone}" role="listitem" tabindex="0" style="flex:${duration} 1 0" title="${this._escape(title)}" aria-label="${this._escape(title)}">${label}</div>`;
          }).join("")}
        </div>
        <div class="mode-timeline__axis"><span>${this._escape(points[0].label || "00:00")}</span><span>${isToday ? this._escape(this._displayTimeLabel(times[points.length - 1] || "")) : "24:00"}</span></div>
        <div class="mode-legend">${legend.map((item) => `<span class="mode-legend__item mode-legend__item--${item.key}"><i></i>${this._escape(item.label)}</span>`).join("")}</div>
        <div class="mode-explainer">Modes use every available five-minute provider point. Hover a period to see its exact time range.${errorSegments.length ? ` Error occurred at ${errorSegments.map((segment) => this._escape(formatRange(segment).split("-")[0])).join(", ")}.` : ""}</div>
      </section>
    `;
  }
  _pricingScheduleForReport() {
    const prefix = String(this._config?.entity_prefix || "heros").trim() || "heros";
    const configured = String(this._config?.pricing_schedule_entity || "").trim();
    const candidates = [configured, `sensor.${prefix}_pricing_schedule`].filter(Boolean);
    const state = candidates.map((entityId) => this._hass?.states?.[entityId]).find(Boolean)
      || Object.values(this._hass?.states || {}).find((item) => String(item?.entity_id || "").endsWith("_pricing_schedule"));
    const attributes = state?.attributes && typeof state.attributes === "object" ? state.attributes : {};
    return {
      available: Boolean(state),
      groups: Array.isArray(attributes.groups) ? attributes.groups : [],
      holidayDates: new Set(Array.isArray(attributes.holiday_dates) ? attributes.holiday_dates.map((value) => String(value)) : []),
    };
  }

  _tariffAnchorDate(value, period = this._tariffPeriod || "day") {
    const date = value instanceof Date && Number.isFinite(value.getTime())
      ? new Date(value.getFullYear(), value.getMonth(), value.getDate())
      : this._parseLocalDate(value) || this._todayLocalDate();
    if (period === "month") return new Date(date.getFullYear(), date.getMonth(), 1);
    if (period === "quarter") return new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1);
    if (period === "year") return new Date(date.getFullYear(), 0, 1);
    if (period === "week") { const mondayOffset = (date.getDay() + 6) % 7; return new Date(date.getFullYear(), date.getMonth(), date.getDate() - mondayOffset); }
    return date;
  }
  _tariffNavigationAnchor() {
    return this._parseLocalDate(this._tariffNavigationDate)
      || this._parseLocalDate(this._selectedReportDate())
      || this._todayLocalDate();
  }
  _setTariffNavigationDate(value, period = this._tariffPeriod || "day") {
    const date = value instanceof Date && Number.isFinite(value.getTime())
      ? new Date(value.getFullYear(), value.getMonth(), value.getDate())
      : this._parseLocalDate(value) || this._todayLocalDate();
    const today = this._todayLocalDate();
    const clamped = date > today ? today : date;
    this._tariffNavigationDate = this._formatLocalDate(clamped);
    this._historySelectedDate = this._formatLocalDate(this._tariffAnchorDate(clamped, period));
  }  _tariffPeriodLabel(anchor, period = this._tariffPeriod || "day") {
    const date = this._tariffAnchorDate(anchor, period);
    if (period === "month") return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    if (period === "quarter") return `Q${Math.floor(date.getMonth() / 3) + 1} ${date.getFullYear()}`;
    if (period === "year") return String(date.getFullYear());
    if (period === "week") { const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 6); return `${this._formatLocalDate(date)} &#8211; ${this._formatLocalDate(end)}`; }
    return this._formatLocalDate(date);
  }
  _renderTariffPeriodControls(anchor) {
    const period = this._tariffPeriod || "day";
    const date = this._tariffAnchorDate(anchor, period);
    const value = period === "month" ? `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}` : this._formatLocalDate(date);
    const input = period === "year" ? `<input class="date-input" type="number" min="2000" max="2100" data-tariff-date value="${date.getFullYear()}">` : period === "quarter" ? `<select class="date-input" data-tariff-date>${[1,2,3,4].map(q => `<option value="${date.getFullYear()}-${q}" ${Math.floor(date.getMonth()/3)+1===q?"selected":""}>Q${q} ${date.getFullYear()}</option>`).join("")}</select>` : this._renderIsoDatePicker("data-tariff-date", value, { inputType: period === "month" ? "month" : "date", label: "Choose tariff period date" });
    return `<button type="button" class="date-nav" data-tariff-shift="-1" aria-label="Previous period">&#8249;</button>${input}<button type="button" class="date-nav" data-tariff-shift="1" aria-label="Next period">&#8250;</button><strong class="tariff-period-controls__label">Period</strong>${["day","week","month","quarter","year"].map(item => `<button type="button" class="period-button ${period===item?"active":""}" data-tariff-period="${item}">${item[0].toUpperCase()+item.slice(1)}</button>`).join("")}`;
  }
  _tariffPeriodRange(anchor, period = this._tariffPeriod || "day") {
    const start = this._tariffAnchorDate(anchor, period);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    if (period === "week") end.setDate(end.getDate() + 6);
    else if (period === "month") end.setMonth(end.getMonth() + 1, 0);
    else if (period === "quarter") end.setMonth(end.getMonth() + 3, 0);
    else if (period === "year") end.setFullYear(end.getFullYear() + 1, 0, 0);
    const today = this._todayLocalDate();
    return { start, end: end > today ? today : end };
  }
  _tariffRecordsForPeriod(anchor, period = this._tariffPeriod || "day") {
    const { start, end } = this._tariffPeriodRange(anchor, period);
    const records = this._historyScopeData()?.scope?.records || {};
    return Object.entries(records)
      .filter(([key, record]) => {
        const date = this._parseLocalDate(key);
        return date && date >= start && date <= end && this._recordHasPowerDiagramData(record);
      })
      .sort(([left], [right]) => left.localeCompare(right));
  }  _tariffAvailableDate(anchor, period = this._tariffPeriod || "day") {
    const start = this._tariffAnchorDate(anchor, period);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + (period === "week" ? 6 : period === "month" ? 31 : period === "quarter" ? 92 : period === "year" ? 366 : 0));
    const records = this._historyScopeData()?.scope?.records || {};
    const dates = Object.keys(records).filter((key) => {
      const date = this._parseLocalDate(key);
      return date && date >= start && date <= end && this._recordHasPowerDiagramData(records[key]);
    }).sort();
    return dates[0] || this._formatLocalDate(start);
  }
  _tariffGroupForDate(schedule, dateKey) {
    return schedule.groups.filter((group) => String(group?.effective_start_date || "") <= dateKey)
      .sort((a, b) => String(a?.effective_start_date || "").localeCompare(String(b?.effective_start_date || ""))).pop() || null;
  }
  _tariffDatesForPeriod(anchor, period = this._tariffPeriod || "day") {
    const { start, end } = this._tariffPeriodRange(anchor, period);
    const dates = [];
    for (const date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) dates.push(this._formatLocalDate(date));
    return dates;
  }
  _tariffCostForDate(reporting, dateKey, schedule) {
    const group = this._tariffGroupForDate(schedule, dateKey);
    const charge = Number(group?.daily_connection_charge);
    const result = { date: dateKey, group, supply: Number.isFinite(charge) && charge >= 0 ? charge : 0, data: false, import: 0, credit: 0, gridOnly: 0, source: 0, priced: 0, missing: 0 };
    if (!group) return result;
    const diagram = reporting?.power_diagram || {};
    const series = diagram.series && typeof diagram.series === "object" ? diagram.series : {};
    const times = Array.isArray(diagram.time) ? diagram.time : [];
    const count = Math.max(times.length, ...Object.values(series).map((values) => Array.isArray(values) ? values.length : 0), 0);
    if (count < 2) return result;
    result.data = true;
    const inKw = this._powerDiagramUsesKw(reporting);
    const watts = (key, index) => { const value = Number(series?.[key]?.[index]); return Number.isFinite(value) ? Math.abs(inKw ? value * 1000 : value) : 0; };
    const day = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(`${dateKey}T12:00:00`).getDay()];
    const holiday = schedule.holidayDates.has(dateKey);
    const minutes = (value) => { const m = String(value || "").match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
    const active = (minute) => {
      const applies = (record, holidayOnly) => {
        const days = Array.isArray(record?.day_types) ? record.day_types.map((value) => String(value).toLowerCase()) : [];
        if (holidayOnly ? !days.includes("public_holiday") : !days.includes(day)) return false;
        const start = minutes(record?.start_time || "00:00"), end = minutes(record?.end_time || "23:59");
        return Number.isFinite(start) && Number.isFinite(end) && start !== end && (start < end ? minute >= start && minute < end : minute >= start || minute < end);
      };
      const records = Array.isArray(group.records) ? group.records : [];
      const holidayRecords = holiday ? records.filter((record) => applies(record, true)) : [];
      return holidayRecords.length ? holidayRecords : records.filter((record) => applies(record, false));
    };
    const rate = (records, type, field) => { const record = records.filter((item) => String(item?.record_type || "buy").toLowerCase() === type).pop(); const value = Number(record?.[field]); return Number.isFinite(value) && value >= 0 ? value : null; };
    for (let index = 0; index < count - 1; index += 1) {
      const start = this._timeLabelToMinutesOfDay(times[index]), end = this._timeLabelToMinutesOfDay(times[index + 1]);
      const raw = Number(end) - Number(start); if (!Number.isFinite(raw) || raw <= 0) continue;
      const duration = raw > 7.5 ? 5 : raw; if (raw > 7.5) result.missing += Math.max(Math.round(raw / 5) - 1, 1);
      result.source += 1;
      const records = active(start), buy = rate(records, "buy", "import_rate"), sell = rate(records, "sell", "export_rate");
      if (buy !== null) { result.import += watts("grid_import", index) * duration / 60000 * buy / 100; result.gridOnly += watts("load", index) * duration / 60000 * buy / 100; }
      if (sell !== null) result.credit += watts("feed_in", index) * duration / 60000 * sell / 100;
      if (buy !== null || sell !== null) result.priced += 1;
    }
    return result;
  }
  _tariffTimelineBuckets(days, period) {
    const labelForDay = (date) => this._parseLocalDate(date)?.toLocaleDateString(undefined, { weekday: "short", day: "numeric" }) || date;
    if (period === "week") return days.map((item) => ({ ...item, label: labelForDay(item.date), title: `${labelForDay(item.date)} - ${item.data ? "saved source data" : "missing source data"}` }));
    const buckets = new Map();
    for (const item of days) {
      const date = this._parseLocalDate(item.date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const week = Math.floor((date.getDate() - 1) / 7);
      const key = period === "month" ? `${monthKey}-w${week}` : monthKey;
      if (!buckets.has(key)) buckets.set(key, { label: period === "month" ? `Week ${week + 1}` : date.toLocaleDateString(undefined, { month: "short" }), import: 0, credit: 0, data: false, sourceDays: 0, totalDays: 0, missing: 0 });
      const bucket = buckets.get(key);
      bucket.import += item.import; bucket.credit += item.credit; bucket.data = bucket.data || item.data; bucket.sourceDays += item.data ? 1 : 0; bucket.totalDays += 1; bucket.missing += item.missing;
    }
    return [...buckets.values()].map((item) => ({ ...item, title: `${item.label} - ${item.sourceDays} of ${item.totalDays} saved data day${item.totalDays === 1 ? "" : "s"}` }));
  }
  _tariffTimelineAxis(period, segments = []) {
    if (period === "day") return `<div class="tariff-impact__axis" aria-label="Time of day"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>`;
    return `<div class="tariff-impact__axis tariff-impact__axis--segments" aria-label="${period === "week" ? "Day" : period === "month" ? "Week" : "Month"} segments">${segments.map((item) => `<span title="${this._escape(item.title || item.label)}">${this._escape(item.label)}</span>`).join("")}</div>`;
  }
  _renderTariffAggregate(anchor, schedule) {
    const period = this._tariffPeriod || "day";
    const records = new Map(this._tariffRecordsForPeriod(anchor, period));
    const days = this._tariffDatesForPeriod(anchor, period).map((date) => this._tariffCostForDate((records.get(date)?.reporting || records.get(date) || null), date, schedule)).filter((item) => item.group);
    if (!days.length) return `<div class="empty">No tariff group is effective for ${this._escape(this._tariffPeriodLabel(anchor, period))}. Set an earlier effective start date on the Pricing page.</div>`;
    const total = days.reduce((sum, item) => ({ import: sum.import + item.import, credit: sum.credit + item.credit, supply: sum.supply + item.supply, gridOnly: sum.gridOnly + item.gridOnly, source: sum.source + item.source, priced: sum.priced + item.priced, missing: sum.missing + item.missing }), { import: 0, credit: 0, supply: 0, gridOnly: 0, source: 0, priced: 0, missing: 0 });
    const data = days.filter((item) => item.data), net = total.import + total.supply / 100 - total.credit, avoided = Math.max(0, total.gridOnly + total.supply / 100 - net), money = (value) => `$${Number(value || 0).toFixed(2)}`, supplyLabel = period === "day" ? "Supply charge (cents)" : "Supply charge", supplyValue = period === "day" ? `${total.supply.toFixed(3)} cents` : money(total.supply / 100);
    const names = [...new Set(days.map((item) => String(item.group.plan_name || item.group.label || "Active tariff")))];
    const timelineSegments = this._tariffTimelineBuckets(days, period);
    const timelineAxis = this._tariffTimelineAxis(period, timelineSegments);
    return `<section class="tariff-impact" aria-label="Tariff Impact"><div class="tariff-impact__heading"><strong>${this._escape(names.join(" / "))}</strong><span>${this._escape(this._tariffPeriodLabel(anchor, period))}</span>${this._renderReportNavigation("tariff")}</div><div class="tariff-impact__summary"><div><span>Days in period</span><strong>${data.length} / ${days.length} data</strong></div><div><span>Import cost</span><strong>${money(total.import)}</strong></div><div><span>Feed-in credit</span><strong class="tariff-impact__credit">-${money(total.credit)}</strong></div><div><span>${supplyLabel}</span><strong>${supplyValue}</strong></div><div class="tariff-impact__summary--net"><span>Net ${period} cost</span><strong>${money(net)}</strong></div><div class="tariff-impact__summary--saving"><span>Avoided grid-only cost</span><strong>${money(avoided)}</strong></div></div><div class="tariff-impact__timeline" role="list" aria-label="Daily tariff cost timeline">${days.map((item) => { const type = item.credit > item.import ? "credit" : item.import > 0 ? "import" : "neutral"; const title = `${item.date} - ${item.data ? `import ${money(item.import)} - supply ${item.supply.toFixed(3)} cents` : "missing source data"}`; return `<span class="tariff-impact__segment tariff-impact__segment--${type}${item.data ? "" : " tariff-impact__segment--gap"}" role="listitem" style="flex:1 1 0" title="${this._escape(title)}"></span>`; }).join("")}</div>${timelineAxis}<div class="tariff-impact__legend"><span><i class="tariff-impact__key tariff-impact__key--import"></i>Import cost</span><span><i class="tariff-impact__key tariff-impact__key--credit"></i>Feed-in credit</span><span><i class="tariff-impact__key tariff-impact__key--neutral"></i>No import cost</span><span><i class="tariff-impact__key tariff-impact__key--gap"></i>Missing source interval</span>${this._isTodaySelection(this._selectedReportDate()) ? `<span><i class="tariff-impact__key tariff-impact__key--future"></i>Awaiting today data</span>` : ""}</div><div class="tariff-impact__note">Aggregated ${data.length} saved day${data.length === 1 ? "" : "s"} and charged supply for ${days.length} day${days.length === 1 ? "" : "s"} in the selected period. ${total.source} saved five-minute source intervals were available; ${total.priced} matched an active tariff rate. A sell record is optional; without one, feed-in credit is $0.00.${total.missing ? ` ${total.missing} missing five-minute intervals were excluded from the calculation.` : ""}</div></section>`;
  }
  _renderTariffImpact(reporting) {
    const schedule = this._pricingScheduleForReport();
    if (!schedule.available || !schedule.groups.length) {
      return `<div class="empty">Tariff Impact needs a pricing schedule. Add date-effective import and export rates on the Pricing page, then return here.</div>`;
    }
    if ((this._tariffPeriod || "day") !== "day") return this._renderTariffAggregate(this._selectedReportDate(), schedule);
    const selectedDate = this._tariffAvailableDate(this._selectedReportDate(), this._tariffPeriod);
    const availableRecord = this._historyRecordForDate(selectedDate);
    if (availableRecord) {
      reporting = availableRecord.reporting || availableRecord;
    }
    const groups = schedule.groups
      .filter((group) => String(group?.effective_start_date || "") <= selectedDate)
      .sort((left, right) => String(left?.effective_start_date || "").localeCompare(String(right?.effective_start_date || "")));
    let group = groups[groups.length - 1];
    if (!group && this._tariffPeriod !== "day") {
      const periodGroups = schedule.groups.filter((candidate) => String(candidate?.effective_start_date || "") >= selectedDate).sort((left, right) => String(left?.effective_start_date || "").localeCompare(String(right?.effective_start_date || "")));
      group = periodGroups[0];
    }
    if (!group) {
      return `<div class="empty">No tariff group is effective for ${this._escape(selectedDate)}. Set an earlier effective start date on the Pricing page.</div>`;
    }
    const powerDiagram = reporting?.power_diagram || {};
    const series = powerDiagram.series && typeof powerDiagram.series === "object" ? powerDiagram.series : {};
    const times = Array.isArray(powerDiagram.time) ? powerDiagram.time : [];
    const pointCount = Math.max(times.length, ...Object.values(series).map((values) => Array.isArray(values) ? values.length : 0), 0);
    if (pointCount < 2) return `<div class="empty">Five-minute energy data is needed before Tariff Impact can calculate a cost.</div>`;
    const chartUsesKw = this._powerDiagramUsesKw(reporting);
    const watts = (key, index) => {
      const value = Number(series?.[key]?.[index]);
      return Number.isFinite(value) ? Math.abs(chartUsesKw ? value * 1000 : value) : 0;
    };
    const minuteForTime = (value) => this._timeLabelToMinutesOfDay(value);
    const day = new Date(`${selectedDate}T12:00:00`);
    const dayKey = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][day.getDay()];
    const isHoliday = schedule.holidayDates.has(selectedDate);
    const timeMinutes = (value) => {
      const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
      return match ? Number(match[1]) * 60 + Number(match[2]) : null;
    };
    const applies = (record, minute, holidayOnly) => {
      const days = Array.isArray(record?.day_types) ? record.day_types.map((value) => String(value).toLowerCase()) : [];
      if (holidayOnly ? !days.includes("public_holiday") : !days.includes(dayKey)) return false;
      const start = timeMinutes(record?.start_time || "00:00");
      const end = timeMinutes(record?.end_time || "23:59");
      if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return false;
      return start < end ? minute >= start && minute < end : minute >= start || minute < end;
    };
    const activeRecords = (minute) => {
      const records = Array.isArray(group.records) ? group.records : [];
      const holiday = isHoliday ? records.filter((record) => applies(record, minute, true)) : [];
      return holiday.length ? holiday : records.filter((record) => applies(record, minute, false));
    };
    const rateFor = (records, type, field) => {
      const record = records.filter((item) => String(item?.record_type || "buy").toLowerCase() === type).pop();
      const value = Number(record?.[field]);
      return Number.isFinite(value) && value >= 0 ? { rate: value, label: String(record?.label || type) } : { rate: null, label: "" };
    };
    const intervals = [];
    let importCost = 0;
    let feedInCredit = 0;
    let gridOnlyCost = 0;
    let sourceIntervals = 0;
    let pricedIntervals = 0;
    let missingIntervals = 0;
    for (let index = 0; index < pointCount - 1; index += 1) {
      const start = minuteForTime(times[index]);
      const end = minuteForTime(times[index + 1]);
      const rawDuration = Number(end) - Number(start);
      if (!Number.isFinite(start) || !Number.isFinite(end) || rawDuration <= 0) continue;
      const missing = rawDuration > 7.5;
      const duration = missing ? 5 : rawDuration;
      if (missing) missingIntervals += Math.max(Math.round(rawDuration / 5) - 1, 1);
      sourceIntervals += 1;
      const records = activeRecords(start);
      const buy = rateFor(records, "buy", "import_rate");
      const sell = rateFor(records, "sell", "export_rate");
      const importKwh = watts("grid_import", index) * duration / 60000;
      const exportKwh = watts("feed_in", index) * duration / 60000;
      const loadKwh = watts("load", index) * duration / 60000;
      const intervalImportCost = buy.rate === null ? 0 : importKwh * (buy.rate / 100);
      const intervalCredit = sell.rate === null ? 0 : exportKwh * (sell.rate / 100);
      importCost += intervalImportCost;
      feedInCredit += intervalCredit;
      if (buy.rate !== null) gridOnlyCost += loadKwh * (buy.rate / 100);
      if (buy.rate !== null || sell.rate !== null) pricedIntervals += 1;
      intervals.push({ duration, timelineDuration: rawDuration, label: this._displayTimeLabel(times[index] || ""), importRate: buy.rate, exportRate: sell.rate, importCost: intervalImportCost, credit: intervalCredit, missing, buyLabel: buy.label, sellLabel: sell.label });
    }
    if (this._isTodaySelection(this._selectedReportDate())) {
      const elapsedMinutes = intervals.reduce((sum, item) => sum + (Number(item.timelineDuration) || 0), 0);
      const futureMinutes = Math.max(0, 24 * 60 - elapsedMinutes);
      if (futureMinutes) intervals.push({ future: true, timelineDuration: futureMinutes, label: "Awaiting today data" });
    }
    const connectionCharge = Number(group.daily_connection_charge);
    const dailyConnectionChargeCents = Number.isFinite(connectionCharge) && connectionCharge >= 0 ? connectionCharge : 0;
    const dailyConnectionCharge = dailyConnectionChargeCents / 100;
    const netCost = importCost + dailyConnectionCharge - feedInCredit;
    const avoidedGridCost = Math.max(0, gridOnlyCost + dailyConnectionCharge - netCost);
    const currency = (value) => `$${Number(value || 0).toFixed(2)}`;
    const rateScale = Math.max(...intervals.map((item) => Math.max(item.importRate || 0, item.exportRate || 0)), 0.01);
    return `
      <section class="tariff-impact" aria-label="Tariff Impact">
        <div class="tariff-impact__heading"><strong>${this._escape(group.plan_name || group.label || "Active tariff")}</strong><span>Effective ${this._escape(String(group.effective_start_date || ""))}${isHoliday ? "  - Public holiday" : ""}</span>${this._renderReportNavigation("tariff")}</div>
        <div class="tariff-impact__summary">
          <div><span>Import cost</span><strong>${currency(importCost)}</strong></div>
          <div><span>Feed-in credit</span><strong class="tariff-impact__credit">-${currency(feedInCredit)}</strong></div>
          <div><span>Supply charge (cents)</span><strong>${dailyConnectionChargeCents.toFixed(3)} cents</strong></div>
          <div class="tariff-impact__summary--net"><span>Net daily cost</span><strong>${currency(netCost)}</strong></div>
          <div class="tariff-impact__summary--saving"><span>Avoided grid-only cost</span><strong>${currency(avoidedGridCost)}</strong></div>
        </div>
        <div class="tariff-impact__timeline" role="list" aria-label="Five-minute tariff cost timeline">
          ${intervals.map((item) => {
            const rate = Math.max(item.importRate || 0, item.exportRate || 0);
            const opacity = Math.max(0.2, Math.min(1, rate / rateScale)).toFixed(2);
            const type = item.future ? "future" : item.credit > item.importCost ? "credit" : item.importCost > 0 ? "import" : "neutral";
            const title = item.future ? "Awaiting today's source data" : `${item.label}  - import ${item.importRate === null ? "not set" : `${item.importRate.toFixed(3)} cents/kWh`}  - export ${item.exportRate === null ? "not set" : `${item.exportRate.toFixed(3)} cents/kWh`}  - cost ${currency(item.importCost - item.credit)}${item.missing ? "  - missing source interval" : ""}`;
            return `<span class="tariff-impact__segment tariff-impact__segment--${type}${item.missing ? " tariff-impact__segment--gap" : ""}" role="listitem" style="flex:${item.timelineDuration || item.duration} 1 0;opacity:${opacity}" title="${this._escape(title)}"></span>`;
          }).join("")}
        </div>
        ${this._tariffTimelineAxis("day")}
        <div class="tariff-impact__legend"><span><i class="tariff-impact__key tariff-impact__key--import"></i>Import cost</span><span><i class="tariff-impact__key tariff-impact__key--credit"></i>Feed-in credit</span><span><i class="tariff-impact__key tariff-impact__key--neutral"></i>No import cost</span><span><i class="tariff-impact__key tariff-impact__key--gap"></i>Missing source interval</span>${this._isTodaySelection(this._selectedReportDate()) ? `<span><i class="tariff-impact__key tariff-impact__key--future"></i>Awaiting today data</span>` : ""}</div>
        <div class="tariff-impact__note">Calculated from ${sourceIntervals} saved five-minute source intervals; ${pricedIntervals} matched an active tariff rate. A sell record is optional; without one, feed-in credit is $0.00.${missingIntervals ? ` ${missingIntervals} missing five-minute interval${missingIntervals === 1 ? " was" : "s were"} excluded from the calculation.` : ""}</div>
      </section>
    `;
  }
  _renderDailyDetail(reporting) {
    const powerDiagram = reporting?.power_diagram || {};
    const series = powerDiagram.series && typeof powerDiagram.series === "object" ? powerDiagram.series : {};
    const times = Array.isArray(powerDiagram.time) ? powerDiagram.time : [];
    const pointCount = Math.max(times.length, ...Object.values(series).map((values) => Array.isArray(values) ? values.length : 0), 0);
    if (!pointCount) return `<div class="empty">Five-minute detail data is not available for this date yet.</div>`;
    const chartUsesKw = this._powerDiagramUsesKw(reporting);
    const rawValue = (key, index) => {
      const direct = Number(series?.[key]?.[index]);
      if (Number.isFinite(direct)) return direct;
      if (key === "grid_import") {
        const load = Number(series?.load?.[index]);
        const solar = Number(series?.solar?.[index]);
        const feed = Number(series?.feed_in?.[index]);
        if ([load, solar, feed].every(Number.isFinite)) return Math.max(load - solar + feed, 0);
      }
      return Number.NaN;
    };
    const hasValue = (key, index) => Number.isFinite(rawValue(key, index));
    const watts = (key, index) => {
      const numeric = rawValue(key, index);
      return Number.isFinite(numeric) ? Math.abs(chartUsesKw ? numeric * 1000 : numeric) : 0;
    };
    const interruptionIndexes = new Set(this._derivedBatteryInterruptionEvents(series, reporting).map((event) => event.index));
    const statusForPoint = (index) => {
      if (watts("battery_charge", index) > 25) return "Battery charging";
      if (watts("bat_discharge", index) > 25) return "Battery discharging";
      if (watts("grid_import", index) >= 100) return "Grid importing";
      if (watts("feed_in", index) >= 100) return "Grid exporting";
      if (watts("solar", index) >= 100) return "Solar supplying";
      return "Balanced / idle";
    };
    const minutesForPoint = (index) => {
      const minutes = this._timeLabelToMinutesOfDay(times[index]);
      return Number.isFinite(minutes) ? minutes : index * 5;
    };
    let gapCount = 0;
    let missingValueRows = 0;
    const columns = ["solar", "bat_discharge", "battery_charge", "grid_import", "feed_in", "load"];
    const requiredColumns = columns.filter((key) => Array.from({ length: pointCount }, (_, index) => rawValue(key, index)).some(Number.isFinite));
    const rows = Array.from({ length: pointCount }, (_, index) => {
      const minutes = minutesForPoint(index);
      const previousMinutes = index ? minutesForPoint(index - 1) : null;
      const missingIntervals = previousMinutes === null ? 0 : Math.max(Math.round((minutes - previousMinutes) / 5) - 1, 0);
      if (missingIntervals) gapCount += missingIntervals;
      const missingValues = requiredColumns.filter((key) => !hasValue(key, index));
      if (missingValues.length) missingValueRows += 1;
      const status = statusForPoint(index);
      const error = interruptionIndexes.has(index);
      const badges = [];
      if (error) badges.push(`<span class="daily-detail-status daily-detail-status--error">Error occurred</span>`);
      if (missingIntervals) badges.push(`<span class="daily-detail-status daily-detail-status--gap">Missing ${missingIntervals} five-minute point${missingIntervals === 1 ? "" : "s"}</span>`);
      if (missingValues.length) badges.push(`<span class="daily-detail-status daily-detail-status--missing">Missing value${missingValues.length === 1 ? "" : "s"}</span>`);
      badges.push(`<span class="daily-detail-status">${this._escape(status)}</span>`);
      const rowClass = `${error ? " daily-detail-row--error" : ""}${missingIntervals || missingValues.length ? " daily-detail-row--gap" : ""}`;
      return `
        <tr class="daily-detail-row${rowClass}">
          <td class="daily-detail-time" title="${this._escape(times[index] || "")}">${this._escape(this._displayTimeLabel(times[index] || ""))}</td>
          <td>${this._escape(this._formatTooltipSeriesValue("bat", series?.bat?.[index], reporting))}</td>
          <td>${this._escape(this._formatTooltipSeriesValue("solar", series?.solar?.[index], reporting))}</td>
          <td>${this._escape(this._formatTooltipSeriesValue("bat_discharge", series?.bat_discharge?.[index], reporting))}</td>
          <td>${this._escape(this._formatTooltipSeriesValue("battery_charge", series?.battery_charge?.[index], reporting))}</td>
          <td>${this._escape(this._formatTooltipSeriesValue("grid_import", series?.grid_import?.[index], reporting))}</td>
          <td>${this._escape(this._formatTooltipSeriesValue("feed_in", series?.feed_in?.[index], reporting))}</td>
          <td>${this._escape(this._formatTooltipSeriesValue("load", series?.load?.[index], reporting))}</td>
          <td class="daily-detail-statuses">${badges.join("")}</td>
        </tr>`;
    }).join("");
    const errorCount = interruptionIndexes.size;
    return `
      <section class="daily-detail" aria-label="Daily Detail">
        <div class="daily-detail-summary">
          <div><strong>${pointCount}</strong><span>Five-minute points</span></div>
          <div><strong>${gapCount}</strong><span>Missing intervals</span></div>
          <div class="daily-detail-summary--error"><strong>${errorCount}</strong><span>Error events</span></div>
        </div>
        <div class="daily-detail-table-wrap" tabindex="0" aria-label="Daily detail table; scroll for all five-minute provider values">
          <table class="daily-detail-table">
            <thead><tr><th>Time</th><th>SoC</th><th>Solar</th><th>Battery discharge</th><th>Battery charge</th><th>Grid import</th><th>Feed-in</th><th>Total load</th><th>Status</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="daily-detail-note">Every available five-minute provider value is shown. Power values are positive magnitudes; charging and discharging are distinguished by their own columns.${missingValueRows ? ` ${missingValueRows} row${missingValueRows === 1 ? " has" : "s have"} missing values.` : ""}</div>
      </section>
    `;
  }
  _renderStatsDiagram(reporting) {
    const period = this._statisticalPeriod || "24h";
    const definition = HEROS_STATISTICAL_PERIODS.find((item) => item.value === period) || HEROS_STATISTICAL_PERIODS[3];
    const selectedDate = this._selectedReportDate() || this._todayDateString();
    const anchor = this._parseLocalDate(selectedDate) || this._todayLocalDate();
    const flowKeys = ["solar", "bat_discharge", "grid_import", "feed_in", "battery_charge", "load", "consumed"];
    const selectedPowerDiagram = reporting?.power_diagram || {};
    const selectedUsesKw = this._powerDiagramUsesKw(reporting);
    const normalizeValue = (value, sourceUsesKw) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return null;
      return sourceUsesKw ? numeric : numeric / 1000;
    };
    const sourceForDate = (date) => {
      if (date === selectedDate && this._timeSeriesPointCount(reporting) > 2) return reporting;
      const record = this._historyRecordForDate(date);
      if (!record) return null;
      const diagram = this._powerDiagramFromRecord(record);
      return { ...record, power_diagram: diagram };
    };
    const dateKey = (date) => this._formatLocalDate(date);
    const dateDiff = (left, right) => Math.round((left.getTime() - right.getTime()) / 86400000);
    const isMultiDay = ["week", "month", "quarter", "year"].includes(period);
    const start = new Date(anchor);
    if (isMultiDay) start.setDate(start.getDate() - ((definition.days || 1) - 1));
    const sources = [];
    for (const day = new Date(start); day <= anchor; day.setDate(day.getDate() + 1)) {
      const key = dateKey(day);
      const source = sourceForDate(key);
      if (source) sources.push({ date: key, source });
    }
    if (!sources.length) sources.push({ date: selectedDate, source: reporting });

    const points = [];
    const buckets = new Map();
    const addDirectPoint = (date, diagram, index, absoluteMinutes, values) => {
      const label = `${date} ${this._displayTimeLabel(diagram.time?.[index] || "")}`;
      points.push({ offset: absoluteMinutes, label, values });
    };
    const rangeMinutes = definition.minutes || 1440;
    const todaySelected = this._isTodaySelection(selectedDate);
    const currentDiagramEnd = todaySelected
      ? this._providerDataCutoffMinutes(selectedPowerDiagram, selectedPowerDiagram.time || [])
      : 1440;
    const availableEnd = Math.min(1440, Math.max(0, Number.isFinite(currentDiagramEnd) ? currentDiagramEnd : 1440));
    const maxStart = Math.max(0, availableEnd - rangeMinutes);
    const navigationKey = selectedDate + "|" + period;
    const savedStart = this._statisticalNavigation?.key === navigationKey ? this._statisticalNavigation.start : null;
    const startMinutes = isMultiDay || period === "day" ? 0 : Math.min(maxStart, Math.max(0, savedStart ?? maxStart));
    const endMinutes = isMultiDay ? availableEnd : Math.min(availableEnd, startMinutes + rangeMinutes);
    const windowFocusMinutes = startMinutes + rangeMinutes / 2;
    for (const { date, source } of sources) {
      const diagram = source?.power_diagram || {};
      const times = Array.isArray(diagram.time) ? diagram.time : [];
      const series = diagram.series && typeof diagram.series === "object" ? diagram.series : {};
      const sourceUsesKw = this._powerDiagramUsesKw(source);
      const day = this._parseLocalDate(date) || anchor;
      const dayOffset = dateDiff(day, start);
      const pointTotal = Math.max(times.length, ...flowKeys.map((key) => Array.isArray(series[key]) ? series[key].length : 0), 0);
      for (let index = 0; index < pointTotal; index += 1) {
        const minute = this._timeLabelToMinutesOfDay(times[index]);
        if (!Number.isFinite(minute)) continue;
        if (!isMultiDay && (minute < startMinutes || minute > endMinutes)) continue;
        const values = {};
        for (const key of flowKeys) {
          const value = normalizeValue(series?.[key]?.[index], sourceUsesKw);
          if (value !== null) values[key] = value;
        }
        if (!Object.keys(values).length) continue;
        const absoluteMinutes = isMultiDay ? dayOffset * 1440 + minute : minute - startMinutes;
        if (!isMultiDay) addDirectPoint(date, diagram, index, absoluteMinutes, values);
        else {
          const bucketMinutes = period === "week" ? 60 : period === "month" ? 180 : period === "quarter" ? 360 : 1440;
          const bucket = Math.floor(absoluteMinutes / bucketMinutes);
          const current = buckets.get(bucket) || { offset: bucket * bucketMinutes, sums: {}, counts: {} };
          for (const [key, value] of Object.entries(values)) {
            current.sums[key] = (current.sums[key] || 0) + value;
            current.counts[key] = (current.counts[key] || 0) + 1;
          }
          buckets.set(bucket, current);
        }
      }
    }
    if (isMultiDay) {
      for (const bucket of [...buckets.values()].sort((left, right) => left.offset - right.offset)) {
        const values = Object.fromEntries(Object.keys(bucket.sums).map((key) => [key, bucket.sums[key] / bucket.counts[key]]));
        const pointDate = new Date(start.getTime() + bucket.offset * 60000);
        const label = period === "year" ? this._formatLocalDate(pointDate) : `${this._formatLocalDate(pointDate)} ${String(pointDate.getHours()).padStart(2, "0")}:00`;
        points.push({ offset: bucket.offset, label, values });
      }
    }
    points.sort((left, right) => left.offset - right.offset);
    const seriesKeys = flowKeys.filter((key) => !(key === "consumed" && points.some(p => Number.isFinite(p.values.load))) && points.some((point) => Number.isFinite(point.values[key])));
    if (!points.length || !seriesKeys.length) return `<div class="empty">Statistical time-series data is not available for this period yet.</div>`;
    const width = Math.max(900, Math.floor(Number(this._chartViewportWidth) || 900));
    const height = 290;
    const left = 82;
    const rightPadding = 88;
    const top = 28;
    const plotHeight = 150;
    const bottom = top + plotHeight;
    const plotWidth = Math.max(720, width - left - rightPadding);
    const right = left + plotWidth;
    const plottedValues = points.flatMap((point) => seriesKeys.map((key) => {
      const raw = Number(point.values[key]);
      return (key === "feed_in" || key === "battery_charge" || key === "load" || key === "consumed") ? -Math.abs(raw) : Math.abs(raw);
    }));
    const powerAxis = this._powerAxisScale(Math.max(...plottedValues.map((value) => Math.abs(value)), 0.1));
    const powerMax = powerAxis.max;
    const powerMin = -powerMax;
    const yFor = (value) => bottom - ((Number(value || 0) - powerMin) / (powerMax - powerMin)) * plotHeight;
    const xDomainMinutes = period === "24h" || period === "day" ? 1440 : (isMultiDay ? rangeMinutes : Math.max(points[points.length - 1].offset, 1));
    const xFor = (offset) => left + (plotWidth * (points.length > 1 ? Math.min(Math.max(offset / xDomainMinutes, 0), 1) : 0.5));
    const usageKeys = new Set(["feed_in", "battery_charge", "load", "consumed"]);
    const palette = { solar: "#ffd13c", bat_discharge: "#60a5fa", grid_import: "#b796f4", feed_in: "#a824a1", battery_charge: "#ff4eb3", load: "#ff9f35", consumed: "#ff9f35" };
    const plotted = (key, point) => usageKeys.has(key) ? -Math.abs(Number(point.values[key]) || 0) : Math.abs(Number(point.values[key]) || 0);
    const formatPowerAxis = (value) => {
      const absolute = Math.abs(Number(value) || 0);
      if (powerMax < 1 || absolute < 1) return `${this._fmtNumber(absolute * 1000, absolute * 1000 < 10 ? 1 : 0)} W`;
      return `${this._fmtNumber(absolute, absolute < 10 ? 1 : 0)} kW`;
    };
    const ticks = [...powerAxis.ticks.slice(1).reverse().map((value) => -value), ...powerAxis.ticks].map((value) => {
      const y = yFor(value);
      return `<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" class="grid"></line><text x="${left - 10}" y="${y + 4}" class="tick tick-left" text-anchor="end">${this._escape(formatPowerAxis(value))}</text>`;
    }).join("");
    const line = (key) => {
      const path = points.filter((point) => Number.isFinite(Number(point.values[key]))).map((point) => `${xFor(point.offset)},${yFor(plotted(key, point))}`).join(" ");
      return path ? `<g data-chart-series="${key}"><polyline points="${path}" fill="none" stroke="${palette[key]}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"></polyline></g>` : "";
    };
    this._chartInteractionModel = {
      times: points.map((point) => point.label), reporting: { ...reporting, power_diagram: { meta: { source: "provider" } } },
      seriesKeys: [...seriesKeys], viewBox: { width, height },
      plot: { left, top, right, bottom, plotWidth, plotHeight, zeroY: yFor(0) },
      statisticalWindow: { period, rangeMinutes, startMinutes, maxStart, navigationKey, focusMinutes: windowFocusMinutes, endMinutes, todaySelected },
      points: points.map((point, index) => ({ index, x: xFor(point.offset), label: point.label, values: point.values, markers: {} })),
    };
    const axisLabel = (label) => {
      const match = String(label || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}:\d{2}))?/);
      if (!match) return String(label || "");
      if (period === "year") return `${match[2]}/${match[1]}`;
      if (isMultiDay) return `${match[2]}/${match[3]}`;
      return match[4] || `${match[2]}/${match[3]}`;
    };    const tickCount = Math.min(8, points.length);
    const labels = period === "24h" || period === "day"
      ? this._chartWindowTicks(0, 1440).map(({ ratio, label }) => `<text x="${left + plotWidth * ratio}" y="${bottom + 24}" class="tick" text-anchor="middle">${this._escape(this._displayTimeLabel(label))}</text>`).join("")
      : Array.from({ length: tickCount }, (_, index) => {
        const point = points[Math.round(index * (points.length - 1) / Math.max(tickCount - 1, 1))];
        return `<text x="${xFor(point.offset)}" y="${bottom + 24}" class="tick" text-anchor="middle">${this._escape(axisLabel(point.label))}</text>`;
      }).join("");
    return `<div class="ring-grid ring-grid--statistical">${this._summaryCards(reporting, { includeSoc:false, showLive:false }).join("")}</div><section class="stats-diagram stats-diagram--chart" aria-label="Statistical Diagram"><div class="report-chart-nav-row">${this._renderReportNavigation("statistical")}</div><div class="chart-layout"><div class="chart-stage" data-chart-stage data-statistical-chart><svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="HEROS statistical power line chart"><line x1="${left}" y1="${yFor(0)}" x2="${right}" y2="${yFor(0)}" class="axis"></line><line x1="${left}" y1="${top}" x2="${left}" y2="${bottom}" class="axis"></line>${ticks}${seriesKeys.map(line).join("")}<rect x="${left}" y="${top}" width="${plotWidth}" height="${plotHeight}" class="chart-hit-target" data-chart-hit-target></rect>${labels}<text x="${left + plotWidth / 2}" y="${bottom + 54}" class="axis-title" text-anchor="middle">Date and time</text><text x="18" y="${top + plotHeight / 2}" class="axis-title" text-anchor="middle" transform="rotate(-90 18 ${top + plotHeight / 2})">Power (kW)</text></svg><div class="chart-hover-line" data-chart-hover-line hidden></div><div class="chart-hover-markers" data-chart-hover-markers hidden></div><div class="chart-tooltip" data-chart-tooltip hidden></div></div><aside class="chart-legend" aria-label="Statistical chart legend"><div class="legend-row"><div class="legend-group"><span class="legend-group-label">Supply</span>${seriesKeys.filter((key) => ["solar", "bat_discharge", "grid_import"].includes(key)).map((key) => this._legendButton(this._seriesDisplayLabel(key), key)).join("")}</div><div class="legend-group"><span class="legend-group-label">Usage</span>${seriesKeys.filter((key) => ["feed_in", "battery_charge", "load", "consumed"].includes(key)).map((key) => this._legendButton(this._seriesDisplayLabel(key), key)).join("")}</div></div></aside></div><div class="chart-explainer">Lines show power over the selected date and time range. Supply is plotted above zero and usage below zero, matching the Power Diagram scale; hover a point for its values.</div></section>`;
  }
  _statsBar(row, maxValue) {
    const width = `${Math.max((row.value / maxValue) * 100, row.value > 0 ? 6 : 0)}%`;
    return `
      <div class="stats-row">
        <div class="stats-row-head">
          <div class="stats-row-label">${row.label}</div>
          <div class="stats-row-value">${row.display}</div>
        </div>
        <div class="stats-bar-track">
          <div class="stats-bar-fill tone-${row.tone}" style="width:${width}"></div>
        </div>
      </div>
    `;
  }

  _ring(label, value, kind, detail = "", meta = "", helpText = "") {
    const richHelp = helpText && typeof helpText === "object" && helpText.html;
    const helpTextValue = richHelp ? String(helpText.text || "More information") : String(helpText || "");
    const helpControl = helpTextValue
      ? richHelp
        ? `<span class="field-help field-help--rich" tabindex="0" aria-label="${this._escape(helpTextValue)}">i<span class="field-help__panel">${helpText.html}</span></span>`
        : `<span class="field-help" data-help="${this._escape(helpTextValue)}" aria-label="${this._escape(helpTextValue)}">i</span>`
      : "";
    return `
      <div class="ring-card ring-card--${kind}" tabindex="${detail ? '0' : '-1'}">
        <div class="ring-value">${value}</div>
        <div class="ring-label-row"><div class="ring-label">${label}</div>${helpControl}</div>
        ${meta ? `<div class="ring-meta">${this._escape(meta)}</div>` : ""}
        ${detail}
      </div>
    `;
  }

  _legendButton(label, key) {
    const active = this._activeSeries[key] !== false;
    const swatchClass = `legend-chip__swatch legend-chip__swatch--${key}`;
    return `
      <button type="button" class="legend-chip ${active ? "active" : ""}" data-series="${key}" aria-pressed="${active ? "true" : "false"}">
        <span class="${swatchClass}" aria-hidden="true"></span>
        ${label}
      </button>
    `;
  }

  _applySeriesVisibility() {
    if (!this.shadowRoot) return;
    this.shadowRoot.querySelectorAll("[data-chart-series]").forEach((layer) => {
      const key = layer.dataset.chartSeries;
      const hidden = this._activeSeries[key] === false;
      layer.style.display = hidden ? "none" : "";
      layer.setAttribute("aria-hidden", hidden ? "true" : "false");
    });
    this.shadowRoot.querySelectorAll("[data-series]").forEach((button) => {
      const key = button.dataset.series;
      const active = this._activeSeries[key] !== false;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  _hideChartTooltip() {
    if (!this.shadowRoot) return;
    this.shadowRoot.querySelector("[data-chart-tooltip]")?.setAttribute("hidden", "");
    this.shadowRoot.querySelector("[data-chart-hover-line]")?.setAttribute("hidden", "");
    this.shadowRoot.querySelector("[data-chart-hover-markers]")?.setAttribute("hidden", "");
  }

  _resetChartHoverState({ keepAnchor = true } = {}) {
    if (this._chartHoverRaf) {
      window.cancelAnimationFrame(this._chartHoverRaf);
      this._chartHoverRaf = 0;
    }
    this._chartHoverQueuedEvent = null;
    this._chartLastHoverEvent = null;
    this._chartHoverPointKey = "";
    if (!keepAnchor) {
      this._lastChartHoverTime = "";
    }
    const markers = this.shadowRoot?.querySelector("[data-chart-hover-markers]");
    if (markers) {
      markers.innerHTML = "";
      delete markers.dataset.renderedPointKey;
    }
    this._hideChartTooltip();
  }

  _nearestChartPoint(localX) {
    const model = this._chartInteractionModel;
    if (!model?.points?.length) {
      return null;
    }
    let nearest = model.points[0];
    let bestDistance = Math.abs(localX - nearest.x);
    model.points.forEach((point) => {
      const distance = Math.abs(localX - point.x);
      if (distance < bestDistance) {
        nearest = point;
        bestDistance = distance;
      }
    });
    return nearest;
  }

  _renderChartTooltip(point) {
    const model = this._chartInteractionModel;
    if (!model || !point) return "";
    const rows = model.seriesKeys
      .filter((key) => this._activeSeries[key] !== false)
      .map((key) => {
        const value = point.values[key];
        return `
          <div class="chart-tooltip__row">
            <span class="chart-tooltip__label">
              <span class="legend-chip__swatch legend-chip__swatch--${key}" aria-hidden="true"></span>
              ${this._escape(this._seriesDisplayLabel(key))}:
            </span>
            <strong>${this._escape(this._formatTooltipSeriesValue(key, value, model.reporting))}</strong>
          </div>
        `;
      })
      .join("");
    const interruptionNotice = point.batteryDischargeInterrupted
      ? `<div class="chart-tooltip__event">Error occurred</div>`
      : "";
    return `
      <div class="chart-tooltip__time">${this._escape(point.label)}</div>
      ${interruptionNotice}
      ${rows}
    `;
  }

  _showChartTooltip(event) {
    if (!this.shadowRoot || !this._chartInteractionModel) return;
    const stage = this.shadowRoot.querySelector("[data-chart-stage]");
    const svg = stage?.querySelector("svg.chart");
    const tooltip = this.shadowRoot.querySelector("[data-chart-tooltip]");
    const hoverLine = this.shadowRoot.querySelector("[data-chart-hover-line]");
    const markers = this.shadowRoot.querySelector("[data-chart-hover-markers]");
    if (!stage || !svg || !tooltip || !hoverLine || !markers) return;
    const stageRect = stage.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    const model = this._chartInteractionModel;
    const viewBox = model.viewBox || { width: 900, height: 290 };
    const plot = model.plot || { left: 0, top: 0, right: viewBox.width, bottom: viewBox.height };
    const svgScaleX = svgRect.width > 0 ? svgRect.width / viewBox.width : 1;
    const svgScaleY = svgRect.height > 0 ? svgRect.height / viewBox.height : 1;
    const localSvgX = (event.clientX - svgRect.left) / svgScaleX;
    const localSvgY = (event.clientY - svgRect.top) / svgScaleY;
    const point = this._nearestChartPoint(localSvgX);
    if (!point) {
      this._hideChartTooltip();
      return;
    }
    this._lastChartHoverTime = this._normalizedFocusTime(point.label);
    const cssPointX = (svgRect.left - stageRect.left) + point.x * svgScaleX;
    const cssPointerY = (svgRect.top - stageRect.top) + localSvgY * svgScaleY;
    const activeSeriesKey = this._chartInteractionModel.seriesKeys
      .filter((key) => this._activeSeries[key] !== false)
      .join("|");
    const pointKey = `${point.index}|${activeSeriesKey}`;
    const pointChanged = pointKey !== this._chartHoverPointKey;
    if (pointChanged) {
      tooltip.innerHTML = this._renderChartTooltip(point);
      this._chartHoverPointKey = pointKey;
    }
    tooltip.hidden = false;
    hoverLine.hidden = false;
    markers.hidden = false;
    hoverLine.style.left = `${cssPointX}px`;
    hoverLine.style.top = `${(svgRect.top - stageRect.top) + plot.top * svgScaleY}px`;
    hoverLine.style.height = `${Math.max(0, (plot.bottom - plot.top) * svgScaleY)}px`;
    hoverLine.style.bottom = "auto";
    if (pointChanged || markers.dataset.renderedPointKey !== pointKey) {
      const markerMarkup = this._chartInteractionModel.seriesKeys
        .filter((key) => this._activeSeries[key] !== false)
        .map((key) => {
          const marker = point.markers[key];
          if (!marker) return "";
          const markerX = (svgRect.left - stageRect.left) + marker.x * svgScaleX;
          const markerY = (svgRect.top - stageRect.top) + marker.y * svgScaleY;
          return `<span class="chart-hover-marker chart-hover-marker--${key}" style="left:${markerX}px; top:${markerY}px;"></span>`;
        })
        .join("");
      markers.innerHTML = markerMarkup;
      markers.dataset.renderedPointKey = pointKey;
    }
    const tooltipWidth = tooltip.offsetWidth || 180;
    const tooltipHeight = tooltip.offsetHeight || 120;
    let tooltipLeft = cssPointX + 18;
    if (tooltipLeft + tooltipWidth > stageRect.width - 8) {
      tooltipLeft = cssPointX - tooltipWidth - 18;
    }
    tooltipLeft = Math.max(8, tooltipLeft);
    let tooltipTop = cssPointerY - tooltipHeight - 18;
    if (tooltipTop < 8) {
      tooltipTop = cssPointerY + 18;
    }
    tooltipTop = Math.min(Math.max(8, tooltipTop), stageRect.height - tooltipHeight - 8);
    tooltip.style.left = `${tooltipLeft}px`;
    tooltip.style.top = `${tooltipTop}px`;
  }

  _queueChartTooltip(event) {
    if (!event || !this._eventInsideChartStage(event)) {
      return;
    }
    this._chartHoverQueuedEvent = event;
    if (this._chartHoverRaf) {
      return;
    }
    this._chartHoverRaf = window.requestAnimationFrame(() => {
      this._chartHoverRaf = 0;
      const queuedEvent = this._chartHoverQueuedEvent;
      this._chartHoverQueuedEvent = null;
      if (queuedEvent) {
        this._showChartTooltip(queuedEvent);
      }
    });
  }

  _commitChartAnchorFromEvent(event) {
    if (!event || this._isTodaySelection(this._selectedReportDate())) {
      return;
    }
    const stage = this.shadowRoot?.querySelector("[data-chart-stage]");
    const svg = stage?.querySelector("svg.chart");
    if (!stage || !svg || !this._chartInteractionModel) {
      return;
    }
    const svgRect = svg.getBoundingClientRect();
    const viewBox = this._chartInteractionModel.viewBox || { width: 900, height: 290 };
    const svgScaleX = svgRect.width > 0 ? svgRect.width / viewBox.width : 1;
    const localSvgX = (event.clientX - svgRect.left) / svgScaleX;
    const point = this._nearestChartPoint(localSvgX);
    const nextAnchor = this._normalizedFocusTime(point?.label || this._lastChartHoverTime || this._historyFocusTime);
    if (!nextAnchor || nextAnchor === this._chartAnchorTime) {
      return;
    }
    this._chartAnchorTime = nextAnchor;
    this._historyFocusTime = nextAnchor;
    const statisticalFullDay = this._view === "statistical" && !["1h", "6h", "12h"].includes(this._statisticalPeriod);
    const canMoveChartWindow = this._view === "statistical" ? !statisticalFullDay : !this._isFullDayPeriod();
    if (canMoveChartWindow) {
      this._hassRenderSignature = this._renderSignature();
      this.render();
    }
  }

  _eventInsideChartStage(event) {
    if (this._eventWithinChartStageBounds(event)) {
      return true;
    }
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    return path.some((target) => {
      if (!target || typeof target !== "object") {
        return false;
      }
      if (target?.dataset?.chartStage !== undefined || target?.dataset?.chartHitTarget !== undefined) {
        return true;
      }
      return typeof target.matches === "function" && target.matches("svg.chart");
    });
  }

  _eventWithinChartStageBounds(event) {
    const stage = this.shadowRoot?.querySelector("[data-chart-stage]");
    if (!stage || typeof event?.clientX !== "number" || typeof event?.clientY !== "number") {
      return false;
    }
    const rect = stage.getBoundingClientRect();
    return event.clientX >= rect.left
      && event.clientX <= rect.right
      && event.clientY >= rect.top
      && event.clientY <= rect.bottom;
  }

  _statCard(label, value) {
    return `
      <div class="stat-card">
        <div class="stat-label">${label}</div>
        <div class="stat-value">${value}</div>
      </div>
    `;
  }

  _renderReportBody(reporting) {
    return reporting || this._lastReportingForDisplay?.reporting
      ? `
          ${this._renderDataSourceBanner(reporting)}
          ${this._renderHeroBanner(reporting)}
          ${this._renderAggregateStrip(reporting)}
          ${this._renderAggregateTable(reporting)}
          ${this._renderChart(reporting)}
        `
      : `<div class="empty">Reporting data is not available yet. Select a battery target and wait for the next coordinator refresh.</div>`;
  }

  _refreshReportBodyInPlace() {
    if (!this.shadowRoot || !this._hass || !this._config) {
      return false;
    }
    const body = this.shadowRoot.querySelector("[data-report-body]");
    if (!body) {
      return false;
    }
    const displayState = this._reportingForDisplay();
    const reporting = displayState.reporting;
    this._prepareChartRefresh(reporting);
    body.innerHTML = this._renderReportBody(reporting);
    this._bindEvents();
    return true;
  }

  render() {
    if (!this._hass || !this._config) return;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    if (this._shouldFreezeWhileSelectorOpen()) {
      this._renderDeferredWhileSelectorOpen = true;
      return;
    }
    this._renderDeferredWhileSelectorOpen = false;
    const historyKey = this._historyCacheKey();
    if (historyKey !== this._historySourceKey) {
      this._historySourceKey = historyKey;
      this._historyData = this._historyDataCacheBySource?.get(historyKey) || null;
      this._historyLoadError = "";
    }
    if (this._historyConfigured() && !this._historyData && !this._historyLoading) {
      this._reloadHistory();
    }
    const displayState = this._reportingForDisplay();
    const reporting = displayState.reporting;
    this._prepareChartRefresh(reporting);
    const periodInteractionActive = Number(this._periodInteractionAt || 0) > Date.now() - 5000;
    const skipHistoryRefresh = periodInteractionActive || Boolean(this._skipHistoryRefreshOnce);
    this._skipHistoryRefreshOnce = false;
    const shouldRefreshTodayHistory = !skipHistoryRefresh && this._historyConfigured()
      && this._isTodaySelection(displayState.selectedDate)
      && !this._historyLoading;
    const shouldRefreshIncompleteArchive = !skipHistoryRefresh && this._historyConfigured()
      && !this._isTodaySelection(displayState.selectedDate)
      && this._historyRecordNeedsRefresh(this._historyRecordForDate(displayState.selectedDate), displayState.selectedDate)
      && !this._historyLoading;
    if (!skipHistoryRefresh && (displayState.missingHistory || shouldRefreshTodayHistory || shouldRefreshIncompleteArchive) && !this._historyLoading) {
      this._ensureHistoryForSelectedDate();
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; width:100%; }

        ha-card {
          background:
            radial-gradient(circle at top right, color-mix(in srgb, var(--primary-color, #4ba4ff) 18%, transparent), transparent 28%),
            linear-gradient(180deg, color-mix(in srgb, var(--card-background-color, #f8fbff) 96%, white) 0%, var(--card-background-color, #eef4fb) 100%);
          border-radius: 24px;
          border: 1px solid color-mix(in srgb, var(--divider-color, rgba(51, 92, 140, 0.12)) 70%, transparent);
          color: var(--primary-text-color, #162334);
          box-shadow: 0 24px 48px color-mix(in srgb, var(--primary-color, #4ba4ff) 10%, transparent);
          overflow: hidden;
        }
        .shell { display:grid; gap:12px; padding:14px; }
        .title-row { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
        .title-icon {
          width:34px; height:34px; border-radius:12px; display:flex; align-items:center; justify-content:center;
          background:linear-gradient(180deg, var(--primary-color, #4ba4ff), color-mix(in srgb, var(--primary-color, #2f75d8) 72%, black)); color:var(--text-primary-color, #fff); font-weight:800;
          box-shadow:0 12px 24px color-mix(in srgb, var(--primary-color, #2f75d8) 22%, transparent);
        }
        .title { font-size:1.4rem; font-weight:800; }
        .version-badge {
          display:inline-flex; align-items:center; justify-content:center; padding:2px 8px;
          border-radius:999px; background:color-mix(in srgb, var(--primary-color, #e5f1ff) 12%, var(--card-background-color, #fff)); color:color-mix(in srgb, var(--primary-color, #205ca8) 88%, var(--primary-text-color, #162334)); font-size:0.78rem; font-weight:800;
          border:1px solid color-mix(in srgb, var(--primary-color, #205ca8) 22%, transparent);
        }
        .selector-row {
          display:grid; grid-template-columns: 160px minmax(0, 1fr); gap:16px; align-items:center;
        }
        .label { font-size:0.95rem; font-weight:700; color:var(--secondary-text-color, #31435d); }
        select {
          width:min(360px, 100%);
          padding:12px 14px;
          border-radius:14px;
          border:1px solid color-mix(in srgb, var(--divider-color, rgba(51, 92, 140, 0.18)) 80%, transparent);
          background:var(--card-background-color, #fff);
          color:var(--primary-text-color, #17263a);
          font-size:0.95rem;
        }
        .aggregate-strip {
          display:grid;
          grid-template-columns: repeat(auto-fit, minmax(118px, 1fr));
          gap:10px;
        }
        .aggregate-card,
        .stat-card,
        .hero-banner {
          background:var(--card-background-color, #fff);
          border-radius:18px;
          border:1px solid color-mix(in srgb, var(--divider-color, rgba(51, 92, 140, 0.12)) 72%, transparent);
          padding:7px 10px;
          box-shadow: 0 10px 20px color-mix(in srgb, var(--primary-color, #4ba4ff) 7%, transparent);
        }
        .hero-banner {
          display:grid;
          grid-template-columns: 1.1fr 1fr;
          gap:16px;
          align-items:center;
          background:
            linear-gradient(135deg, color-mix(in srgb, var(--primary-color, #2f75d8) 8%, transparent), color-mix(in srgb, var(--primary-color, #74b2ff) 4%, transparent)),
            var(--card-background-color, #fff);
        }
        .data-source-banner {
          border-radius:18px;
          padding:14px 16px;
          border:1px solid color-mix(in srgb, var(--divider-color, rgba(51, 92, 140, 0.14)) 72%, transparent);
          background:var(--card-background-color, #fff);
          box-shadow: 0 10px 20px color-mix(in srgb, var(--primary-color, #4ba4ff) 7%, transparent);
          display:grid;
          gap:6px;
        }
        .data-source-banner--backend {
          background:linear-gradient(180deg, color-mix(in srgb, #53cba2 12%, transparent), color-mix(in srgb, var(--card-background-color, #fff) 96%, white));
          border-color:color-mix(in srgb, #53cba2 22%, transparent);
        }
        .data-source-banner--live {
          background:linear-gradient(180deg, color-mix(in srgb, #18d3c5 16%, transparent), color-mix(in srgb, var(--card-background-color, #fff) 96%, white));
          border-color:color-mix(in srgb, #18d3c5 32%, transparent);
        }
        .data-source-banner--fallback {
          background:linear-gradient(180deg, color-mix(in srgb, #ffc85d 18%, transparent), color-mix(in srgb, var(--card-background-color, #fff) 96%, white));
          border-color:color-mix(in srgb, #bf8614 28%, transparent);
        }
        .data-source-title {
          font-size:0.9rem;
          font-weight:800;
          color:var(--primary-text-color, #17314e);
          text-transform:uppercase;
          letter-spacing:0.04em;
        }
        .data-source-copy,
        .data-source-meta {
          font-size:0.92rem;
          color:var(--secondary-text-color, #31435d);
        }
        .hero-main {
          display:grid;
          gap:8px;
        }
        .hero-kicker {
          font-size:0.76rem;
          font-weight:800;
          letter-spacing:0.08em;
          text-transform:uppercase;
          color:var(--secondary-text-color, #5c7897);
        }
        .hero-title {
          font-size:1.35rem;
          font-weight:900;
          color:var(--primary-text-color, #14243a);
        }
        .hero-subtitle {
          color:var(--secondary-text-color, #486782);
          font-size:0.96rem;
          font-weight:700;
        }
        .hero-metrics {
          display:grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap:8px;
        }
        .hero-chip {
          background:color-mix(in srgb, var(--card-background-color, #f8fbff) 94%, var(--primary-color, #4ba4ff) 6%);
          border:1px solid color-mix(in srgb, var(--divider-color, rgba(51, 92, 140, 0.1)) 72%, transparent);
          border-radius:14px;
          padding:8px 10px;
          display:grid;
          gap:1px;
          min-height:48px;
        }
        .hero-chip-label {
          font-size:0.72rem;
          font-weight:800;
          letter-spacing:0.05em;
          text-transform:uppercase;
          color:var(--secondary-text-color, #5a7592);
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis;
        }
        .hero-chip-value {
          font-size:0.9rem;
          font-weight:900;
          color:var(--primary-text-color, #17263a);
          line-height:1.05;
        }
        .aggregate-table-panel {
          background:var(--card-background-color, #fff);
          border-radius:18px;
          border:1px solid color-mix(in srgb, var(--divider-color, rgba(51, 92, 140, 0.12)) 72%, transparent);
          padding:12px 14px;
          box-shadow: 0 10px 20px color-mix(in srgb, var(--primary-color, #4ba4ff) 7%, transparent);
          display:grid;
          gap:10px;
        }
        .aggregate-table-head {
          display:flex;
          align-items:end;
          justify-content:space-between;
          gap:12px;
          flex-wrap:wrap;
        }
        .aggregate-table-title {
          font-size:1rem;
          font-weight:900;
          color:var(--primary-text-color, #16253a);
        }
        .aggregate-table-subtitle {
          font-size:0.84rem;
          color:var(--secondary-text-color, #587491);
          font-weight:700;
        }
        .aggregate-table {
          display:grid;
          gap:8px;
        }
        .aggregate-row {
          display:grid;
          grid-template-columns: minmax(160px, 1.4fr) repeat(5, minmax(0, 1fr));
          gap:10px;
          align-items:center;
          padding:12px 14px;
          border-radius:14px;
          background:color-mix(in srgb, var(--card-background-color, #f8fbff) 94%, var(--primary-color, #4ba4ff) 6%);
          border:1px solid color-mix(in srgb, var(--divider-color, rgba(51, 92, 140, 0.08)) 72%, transparent);
          color:var(--primary-text-color, #22354d);
          font-size:0.92rem;
          font-weight:700;
        }
        .aggregate-header {
          background:color-mix(in srgb, var(--primary-color, #edf4fc) 10%, var(--card-background-color, #fff));
          color:var(--secondary-text-color, #55718f);
          font-size:0.78rem;
          letter-spacing:0.05em;
          text-transform:uppercase;
        }
        .aggregate-cell-title {
          font-weight:900;
          color:var(--primary-text-color, #17263a);
        }
        .aggregate-title,
        .stat-label {
          font-size:0.82rem;
          font-weight:700;
          letter-spacing:0.04em;
          text-transform:uppercase;
          color:var(--secondary-text-color, #597291);
        }
        .aggregate-metric {
          margin-top:6px;
          color:var(--secondary-text-color, #31435d);
          font-size:0.9rem;
        }
        .stat-value {
          font-size:1.2rem;
          font-weight:800;
          color:var(--primary-text-color, #14243a);
        }
        .stats-grid {
          display:grid;
          gap:14px;
        }
        .stats-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        .panel {
          background:var(--card-background-color, #fff);
          border-radius:22px;
          border:1px solid color-mix(in srgb, var(--divider-color, rgba(51, 92, 140, 0.12)) 72%, transparent);
          padding:14px;
          box-shadow: 0 12px 24px color-mix(in srgb, var(--primary-color, #4ba4ff) 8%, transparent);
        }
        .panel-header {
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:8px;
          margin-bottom:10px;
        }
        .panel-title {
          font-size:1.1rem;
          font-weight:800;
          color:var(--primary-text-color, #17263a);
        }
        .panel-date {
          padding:8px 12px;
          border-radius:999px;
          background:color-mix(in srgb, var(--primary-color, #eef5ff) 10%, var(--card-background-color, #fff));
          color:var(--secondary-text-color, #36567b);
          font-size:0.9rem;
          font-weight:700;
        }
        .chart-tools {
          display:flex;
          align-items:center;
          gap:8px;
          flex-wrap:wrap;
        }
        .chart-toolbar {
          display:flex;
          align-items:center;
          gap:8px;
          flex-wrap:wrap;
        }
        .chart-selection-pill {
          display:inline-flex;
          align-items:center;
          padding:6px 10px;
          border-radius:999px;
          border:1px solid color-mix(in srgb, var(--primary-color, #205ca8) 22%, transparent);
          background:color-mix(in srgb, var(--primary-color, #e8f3ff) 12%, var(--card-background-color, #fff));
          color:color-mix(in srgb, var(--primary-color, #205ca8) 88%, var(--primary-text-color, #17263a));
          font-size:0.76rem;
          font-weight:800;
        }
        .date-nav {
          width:34px;
          height:34px;
          border-radius:999px;
          border:1px solid color-mix(in srgb, var(--divider-color, rgba(51, 92, 140, 0.16)) 72%, transparent);
          background:color-mix(in srgb, var(--primary-color, #eef5ff) 10%, var(--card-background-color, #fff));
          color:var(--secondary-text-color, #36567b);
          font-size:1.1rem;
          font-weight:900;
          cursor:pointer;
        }
        .date-input {
          min-width:140px;
          padding:7px 11px;
          border-radius:999px;
          border:1px solid color-mix(in srgb, var(--divider-color, rgba(51, 92, 140, 0.16)) 72%, transparent);
          background:color-mix(in srgb, var(--primary-color, #eef5ff) 10%, var(--card-background-color, #fff));
          color:var(--secondary-text-color, #36567b);
          font-size:0.9rem;
          font-weight:700;
        }
        .focus-time-control {
          display:inline-flex;
          align-items:center;
          gap:6px;
          padding:4px 8px;
          border-radius:999px;
          border:1px solid color-mix(in srgb, var(--divider-color, rgba(51, 92, 140, 0.16)) 72%, transparent);
          background:color-mix(in srgb, var(--primary-color, #eef5ff) 8%, var(--card-background-color, #fff));
          color:var(--secondary-text-color, #36567b);
          font-size:0.76rem;
          font-weight:800;
        }
        .focus-time-control input {
          width:82px;
          border:none;
          background:transparent;
          color:inherit;
          font:inherit;
          outline:none;
        }
        .analysis-report { display:grid; gap:10px; padding:14px; color:var(--heros-panel-text,#f4fbff); }
        .analysis-report__heading { display:flex; justify-content:space-between; gap:16px; align-items:flex-start; }
        .analysis-report__heading h2 { margin:0 0 4px; } .analysis-report__heading p { margin:0; color:var(--secondary-text-color,#9ab2c7); }
        .analysis-report__period { display:inline-block; margin-top:4px; color:var(--heros-panel-accent,#00e5ff); font-size:.82rem; font-weight:800; }
        .analysis-report__cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; }
        .analysis-report__card { display:grid; gap:5px; padding:10px; border:1px solid rgba(0,229,255,.3); border-radius:12px; background:rgba(7,20,35,.55); } .analysis-report__card span { color:var(--secondary-text-color,#9ab2c7); font-size:.8rem; font-weight:700; } .analysis-report__card strong { font-size:1.2rem; }
        .analysis-report__bars { display:flex; align-items:flex-end; gap:14px; min-height:150px; padding:18px 8px 8px; border-bottom:1px solid rgba(255,255,255,.25); }
        .analysis-report__bar { display:flex; flex:1 1 0; min-width:70px; flex-direction:column; align-items:center; justify-content:flex-end; gap:6px; } .analysis-report__bar span { color:var(--secondary-text-color,#9ab2c7); font-size:.76rem; text-align:center; } .analysis-report__bar i { display:block; width:34px; min-height:12px; border-radius:6px 6px 2px 2px; background:linear-gradient(180deg,#ff4de8,#00d9ff); } .analysis-report__bar b { font-size:.9rem; text-align:center; }
        .analysis-report__frame { min-height:190px; padding:18px; border:1px solid rgba(0,229,255,.3); border-radius:14px; background:rgba(7,20,35,.55); } .analysis-report__frame h3 { margin:0 0 10px; } .analysis-report__frame p { color:var(--secondary-text-color,#9ab2c7); }
        .analysis-metrics { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:8px; }
        .analysis-metric { display:grid; gap:5px; padding:10px; border:1px solid rgba(0,229,255,.3); border-radius:12px; background:rgba(7,20,35,.55); }
        .analysis-metric span { color:var(--secondary-text-color,#9ab2c7); font-size:.78rem; font-weight:700; }
        .analysis-metric strong { font-size:1.15rem; }
        .analysis-metric.is-positive { border-color:rgba(64,201,130,.65); }
        .analysis-metric.is-charge { border-color:rgba(255,78,179,.65); }
        .analysis-metric.is-discharge { border-color:rgba(96,165,250,.65); }
        .analysis-note,.analysis-trend p { margin:0; color:var(--secondary-text-color,#9ab2c7); font-size:.82rem; font-weight:650; }
        .analysis-trend { display:grid; gap:14px; padding:18px; border:1px solid rgba(0,229,255,.3); border-radius:14px; background:rgba(7,20,35,.55); }
        .analysis-chart-legend,.analysis-chart-label { display:flex; flex-wrap:wrap; align-items:center; gap:12px; color:var(--secondary-text-color,#9ab2c7); font-size:.78rem; font-weight:800; } .analysis-chart-label { margin:0 0 8px; } .analysis-chart-legend__group { display:flex; align-items:center; flex-wrap:wrap; gap:8px; } .analysis-chart-legend__group strong { color:var(--secondary-text-color,#9ab2c7); font-size:.68rem; letter-spacing:.04em; } .analysis-chart-legend span { display:inline-flex; align-items:center; gap:6px; } .analysis-chart-legend i { width:10px; height:10px; border-radius:99px; display:inline-block; } .analysis-chart-legend .is-solar { background:#ffd13c; } .analysis-chart-legend .is-local { background:#40c982; } .analysis-chart-legend .is-export { background:#d72ab9; } .analysis-trend__legend { display:flex; flex-wrap:wrap; gap:14px; color:var(--secondary-text-color,#9ab2c7); font-size:.78rem; font-weight:800; }
        .analysis-trend__legend span { display:inline-flex; align-items:center; gap:6px; }
        .analysis-trend__legend i { width:10px; height:10px; border-radius:99px; }
        .analysis-trend__legend .is-solar,.analysis-trend__bars .is-solar { background:#ffd13c; }
        .analysis-trend__legend .is-load,.analysis-trend__bars .is-load { background:#ff8f1f; }
        .analysis-trend__plot { position:relative; display:flex; align-items:flex-end; gap:10px; min-height:230px; padding:12px 4px 18px 58px; overflow-x:auto; border-bottom:1px solid rgba(255,255,255,.2); }
        .analysis-trend__axis { position:absolute; left:4px; bottom:44px; width:48px; height:150px; display:flex; flex-direction:column; justify-content:space-between; color:var(--secondary-text-color,#9ab2c7); font-size:.65rem; font-weight:800; text-align:right; pointer-events:none; }
        .analysis-trend__day { display:grid; grid-template-rows:minmax(150px,1fr) auto auto; gap:5px; flex:1 0 90px; min-width:90px; text-align:center; }
        .analysis-trend__bars { display:flex; align-items:flex-end; justify-content:center; gap:5px; height:150px; }
        .analysis-trend__bars i { width:min(18px,38%); min-height:3px; border-radius:5px 5px 1px 1px; }
        .analysis-trend__day strong { font-size:.72rem; } .analysis-trend__day span { color:var(--secondary-text-color,#9ab2c7); font-size:.66rem; }
        .analysis-trend__day { position:relative; border-radius:8px 8px 0 0; outline:none; }
        .analysis-trend__day:focus-visible { box-shadow:inset 0 0 0 2px var(--heros-panel-accent,#00e5ff); }
        .analysis-trend__tooltip { position:absolute; z-index:12; top:-12px; left:50%; width:190px; max-width:min(190px,calc(100vw - 46px)); padding:10px 11px; border:1px solid rgba(0,229,255,.55); border-radius:10px; background:#071321; box-shadow:0 12px 28px rgba(0,0,0,.46); color:var(--primary-text-color,#fff); text-align:left; opacity:0; visibility:hidden; pointer-events:none; transform:translate(-50%,-5px); transition:opacity .14s ease,transform .14s ease; }
        .analysis-trend__day:first-child .analysis-trend__tooltip { left:0; transform:translate(0,-5px); }
        .analysis-trend__day:last-child .analysis-trend__tooltip { right:0; left:auto; transform:translate(0,-5px); }
        .analysis-trend__day:hover .analysis-trend__tooltip,.analysis-trend__day:focus .analysis-trend__tooltip,.analysis-trend__day:focus-within .analysis-trend__tooltip { opacity:1; visibility:visible; transform:translate(-50%,0); }
        .analysis-trend__plot:has(.analysis-trend__day:hover) .analysis-trend__day:not(:hover) .analysis-trend__tooltip { opacity:0; visibility:hidden; }
        .analysis-trend__day:first-child:hover .analysis-trend__tooltip,.analysis-trend__day:first-child:focus .analysis-trend__tooltip { transform:translate(0,0); }
        .analysis-trend__day:last-child:hover .analysis-trend__tooltip,.analysis-trend__day:last-child:focus .analysis-trend__tooltip { transform:translate(0,0); }        /* Trend uses the same fixed plot geometry as the other energy charts. */
        .analysis-trend__legend { gap:8px; font-size:.875rem; }
        .analysis-trend__plot { position:relative; isolation:isolate; display:flex; align-items:flex-start; gap:8px; min-height:180px; padding:24px 8px 22px 74px; overflow-x:auto; overflow-y:hidden; border:1px solid rgba(0,229,255,.3); border-radius:14px; }
        .analysis-trend__plot::before { content:""; position:absolute; z-index:0; left:74px; right:8px; top:24px; height:150px; box-sizing:border-box; border-bottom:1px solid rgba(0,229,255,.26); background:repeating-linear-gradient(to bottom,rgba(0,229,255,.16) 0,rgba(0,229,255,.16) 1px,transparent 1px,transparent 37.5px); pointer-events:none; }
        .analysis-trend__y-title { position:absolute; z-index:2; left:8px; top:24px; width:12px; height:150px; display:flex; align-items:center; justify-content:center; writing-mode:vertical-rl; transform:rotate(180deg); color:var(--secondary-text-color,#9ab2c7); font-size:.66rem; font-weight:800; white-space:nowrap; }
        .analysis-trend__x-title { position:absolute; z-index:2; left:74px; right:8px; top:210px; color:var(--secondary-text-color,#9ab2c7); font-size:.75rem; font-weight:800; line-height:1; text-align:center; }
        .analysis-trend__axis { position:absolute; z-index:2; left:28px; top:24px; bottom:auto; width:38px; height:150px; display:flex; flex-direction:column; justify-content:space-between; color:var(--secondary-text-color,#9ab2c7); font-size:.66rem; font-weight:800; text-align:right; pointer-events:none; }
        .analysis-trend__plot > .analysis-trend__day { position:relative; z-index:1; display:grid; grid-template-rows:150px auto; min-width:90px; flex:1; gap:7px; text-align:center; outline:none; }
        .analysis-trend__day > .analysis-trend__bars { grid-row:1; height:150px; display:flex; align-items:flex-end; justify-content:center; gap:5px; }
        .analysis-trend__day > strong { grid-row:2; font-size:.8rem; white-space:nowrap; }
        .chart-layout + .chart-explainer { margin-top:12px !important; transform:none !important; }
        .analysis-trend__tooltip > strong { display:block; margin-bottom:6px; color:var(--heros-panel-accent,#00e5ff); font-size:.76rem; }
        .analysis-trend__tooltip dl { display:grid; gap:4px; margin:0; }
        .analysis-trend__tooltip dl > div { display:flex; justify-content:space-between; gap:12px; }
        .analysis-trend__tooltip dt { color:var(--secondary-text-color,#9ab2c7); font-size:.68rem; }
        .analysis-trend__tooltip dd { margin:0; font-size:.68rem; font-weight:800; white-space:nowrap; }

        .analysis-energy-flow { display:grid; grid-template-columns:minmax(180px,1fr) minmax(150px,.7fr) minmax(180px,1fr); gap:18px; align-items:center; padding:18px; border:1px solid rgba(0,229,255,.3); border-radius:14px; background:rgba(7,20,35,.55); }
        .analysis-flow-column { display:grid; gap:9px; } .analysis-flow-column h3 { margin:0 0 4px; font-size:.9rem; }
        .analysis-flow-node { position:relative; display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:48px; padding:10px 12px; border:1px solid rgba(255,255,255,.18); border-radius:10px; background:rgba(255,255,255,.04); }
        .analysis-flow-node span { color:var(--secondary-text-color,#9ab2c7); font-size:.76rem; font-weight:750; } .analysis-flow-node strong { white-space:nowrap; }
        .analysis-flow-node.is-solar { border-color:#ffd13c; } .analysis-flow-node.is-grid { border-color:#b796f4; } .analysis-flow-node.is-battery { border-color:#60a5fa; } .analysis-flow-node.is-load { border-color:#ff8f1f; } .analysis-flow-node.is-export { border-color:#a824a1; }
        .analysis-flow-hub { display:grid; place-items:center; gap:5px; min-height:145px; padding:16px; border:2px solid var(--heros-panel-accent,#00e5ff); border-radius:50%; text-align:center; background:radial-gradient(circle,rgba(0,229,255,.14),rgba(7,20,35,.72)); }
        .analysis-flow-hub span,.analysis-flow-hub small { color:var(--secondary-text-color,#9ab2c7); font-size:.72rem; font-weight:750; } .analysis-flow-hub strong { font-size:1.15rem; }
        .analysis-self { display:grid; grid-template-columns:minmax(190px,.55fr) minmax(0,1.45fr); gap:22px; align-items:center; }
        .analysis-gauge { display:grid; place-items:center; width:190px; height:190px; margin:auto; border-radius:50%; background:conic-gradient(#40c982 calc(var(--analysis-percent) * 1%),rgba(255,255,255,.1) 0); }
        .analysis-gauge::before { content:""; grid-area:1/1; width:142px; height:142px; border-radius:50%; background:#071423; }
        .analysis-gauge > div { z-index:1; grid-area:1/1; display:grid; gap:4px; text-align:center; }
        .analysis-gauge strong { font-size:1.65rem; } .analysis-gauge span { color:var(--secondary-text-color,#9ab2c7); font-size:.74rem; font-weight:750; }
        .analysis-self__scale { height:10px; overflow:hidden; border-radius:99px; background:rgba(255,255,255,.1); } .analysis-self__scale i { display:block; height:100%; border-radius:inherit; background:linear-gradient(90deg,#00d9ff,#40c982); }
        .analysis-table { overflow:hidden; border:1px solid rgba(0,229,255,.3); border-radius:14px; background:rgba(7,20,35,.55); }
        .analysis-table__row { display:grid; grid-template-columns:minmax(180px,1.5fr) repeat(3,minmax(100px,1fr)); gap:12px; align-items:center; padding:12px 14px; border-top:1px solid rgba(0,229,255,.13); }
        .analysis-table__row:first-child { border-top:0; } .analysis-table__row.is-head { color:var(--secondary-text-color,#9ab2c7); background:rgba(0,229,255,.08); font-size:.72rem; font-weight:850; text-transform:uppercase; }
        .analysis-balance { display:grid; gap:14px; padding:18px; border:1px solid rgba(0,229,255,.3); border-radius:14px; background:rgba(7,20,35,.55); }
        .analysis-balance__row { display:grid; grid-template-columns:minmax(130px,.7fr) minmax(180px,2fr) 80px; gap:14px; align-items:center; }
        .analysis-balance__row > div { position:relative; height:18px; overflow:visible; border-radius:99px; background:rgba(255,255,255,.1); }
        .analysis-balance__row i { display:block; height:100%; border-radius:inherit; background:linear-gradient(90deg,#00d9ff,#40c982); }
        .analysis-balance__row em { position:absolute; top:-4px; width:2px; height:26px; background:#fff; box-shadow:0 0 5px rgba(255,255,255,.8); }
        .analysis-balance__row span { text-align:right; font-weight:850; }
        .analysis-battery-flow { display:grid; grid-template-columns:minmax(180px,1fr) minmax(150px,.55fr) minmax(180px,1fr); gap:20px; align-items:center; padding:22px; border:1px solid rgba(0,229,255,.3); border-radius:14px; background:rgba(7,20,35,.55); }
        .analysis-battery-flow__side { display:grid; gap:8px; } .analysis-battery-flow__side span { color:var(--secondary-text-color,#9ab2c7); font-size:.78rem; font-weight:750; }
        .analysis-battery-flow__side > div { height:18px; overflow:hidden; border-radius:99px; background:rgba(255,255,255,.1); } .analysis-battery-flow__side i { display:block; height:100%; border-radius:inherit; }
        .analysis-battery-flow__side.is-charge i { margin-left:auto; background:linear-gradient(90deg,#ff4eb3,#b796f4); } .analysis-battery-flow__side.is-discharge i { background:linear-gradient(90deg,#60a5fa,#00d9ff); }
        .analysis-battery-flow__battery { display:grid; place-items:center; gap:4px; min-height:130px; padding:14px; border:2px solid #60a5fa; border-radius:18px; background:linear-gradient(180deg,rgba(96,165,250,.18),rgba(7,20,35,.7)); text-align:center; }
        .analysis-battery-flow__battery span,.analysis-battery-flow__battery small { color:var(--secondary-text-color,#9ab2c7); font-size:.72rem; font-weight:750; } .analysis-battery-flow__battery strong { font-size:1.2rem; }
        .analysis-ranking { display:grid; gap:3px; padding:8px 10px; border:1px solid rgba(0,229,255,.3); border-radius:14px; background:rgba(7,20,35,.55); } .analysis-ranking__label { display:block; grid-column:1 / -1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--secondary-text-color,#9ab2c7); font-size:.82rem; font-weight:600; padding-bottom:3px; } .analysis-ranking > div { display:grid; grid-template-columns:32px 94px minmax(110px,2fr) 90px; gap:8px; align-items:center; min-height:20px; } .analysis-ranking > div:has(small) { grid-template-columns:32px minmax(100px,.8fr) 94px minmax(110px,2fr) 90px; } .analysis-ranking b { color:var(--heros-panel-accent,#00e5ff); white-space:nowrap; font-size:.82rem; } .analysis-ranking span, .analysis-ranking small { font-size:.88rem; white-space:nowrap; color:var(--secondary-text-color,#9ab2c7); } .analysis-ranking small { text-align:left; } .analysis-ranking i { display:block; height:12px; border-radius:99px; background:linear-gradient(90deg,#00d9ff,#ff4de8); } .analysis-ranking strong { text-align:right; } .analysis-compare-line { position:relative; height:54px; margin:12px 0; border-radius:99px; background:rgba(255,255,255,.09); overflow:visible; } .analysis-compare-line i { display:block; height:100%; border-radius:inherit; background:linear-gradient(90deg,#ffd13c,#ff8f1f); } .analysis-compare-line b,.analysis-compare-line span { position:absolute; top:62px; font-size:.75rem; } .analysis-compare-line b { left:0; } .analysis-compare-line span { left:calc(50% - 22px); } .analysis-compare-line em { position:absolute; top:-7px; width:3px; height:68px; background:#fff; } .analysis-solar-compare { display:flex; align-items:flex-end; gap:10px; min-height:220px; padding:18px 8px; border:1px solid rgba(0,229,255,.3); border-radius:14px; background:rgba(7,20,35,.55); overflow-x:auto; } .analysis-solar-compare > div { display:grid; min-width:52px; flex:1; gap:8px; text-align:center; } .analysis-solar-compare strong { font-size:.67rem; } .analysis-solar-compare span { height:160px; display:flex; align-items:flex-end; justify-content:center; gap:4px; } .analysis-solar-compare i { width:13px; min-height:3px; border-radius:4px 4px 0 0; } .analysis-solar-compare .is-solar { background:#ffd13c; } .analysis-solar-compare .is-local { background:#40c982; } .analysis-solar-compare .is-export { background:#d72ab9; }
        .analysis-solar-compare { position:relative; isolation:isolate; display:flex; align-items:flex-start; gap:8px; min-height:180px; padding:24px 8px 22px 74px; border:1px solid rgba(0,229,255,.3); border-radius:14px; background:rgba(7,20,35,.55); overflow-x:auto; overflow-y:hidden; }
        .analysis-solar-compare::before { content:""; position:absolute; z-index:0; left:74px; right:8px; top:24px; height:150px; box-sizing:border-box; border-bottom:1px solid rgba(0,229,255,.26); background:repeating-linear-gradient(to bottom,rgba(0,229,255,.16) 0,rgba(0,229,255,.16) 1px,transparent 1px,transparent 37.5px); pointer-events:none; } .analysis-solar-compare__y-title { position:absolute; z-index:2; left:8px; top:24px; width:12px; height:150px; display:flex; align-items:center; justify-content:center; writing-mode:vertical-rl; transform:rotate(180deg); color:var(--secondary-text-color,#9ab2c7); font-size:.66rem; font-weight:800; white-space:nowrap; } .analysis-solar-compare__x-title { position:absolute; z-index:2; left:74px; right:8px; top:210px; bottom:auto; color:var(--secondary-text-color,#9ab2c7); font-size:.75rem; font-weight:800; line-height:1; text-align:center; } .analysis-solar-compare__axis { position:absolute; z-index:2; left:28px; top:24px; bottom:auto; width:38px; height:150px; display:flex; flex-direction:column; justify-content:space-between; color:var(--secondary-text-color,#9ab2c7); font-size:.66rem; font-weight:800; text-align:right; pointer-events:none; }
        .analysis-solar-compare > .analysis-solar-compare__day { position:relative; z-index:1; display:grid; grid-template-rows:150px auto; min-width:90px; flex:1; gap:7px; text-align:center; outline:none; }
        .analysis-solar-compare__day > strong { grid-row:2; font-size:.8rem; white-space:nowrap; }
        .analysis-solar-compare__day > span { grid-row:1; height:150px; display:flex; align-items:flex-end; justify-content:center; gap:3px; }
        .analysis-solar-compare__day i { width:12px; min-height:3px; border-radius:4px 4px 0 0; }
        .analysis-solar-compare__day:focus-visible { box-shadow:inset 0 0 0 2px var(--heros-panel-accent,#00e5ff); }
        .analysis-solar-compare__day .is-solar { background:#ffd13c; } .analysis-solar-compare__day .is-local { background:#40c982; } .analysis-solar-compare__day .is-export { background:#d72ab9; }
        .analysis-solar-compare__tooltip { position:absolute; z-index:12; top:-30px; left:50%; width:210px; max-width:min(210px,calc(100vw - 46px)); padding:10px 11px; border:1px solid rgba(0,229,255,.55); border-radius:10px; background:#071321; box-shadow:0 12px 28px rgba(0,0,0,.46); color:var(--primary-text-color,#fff); text-align:left; opacity:0; visibility:hidden; pointer-events:none; transform:translate(-50%,-5px); transition:opacity .14s ease,transform .14s ease; }
        .analysis-solar-compare__day:first-of-type .analysis-solar-compare__tooltip { left:0; transform:translate(0,-5px); } .analysis-solar-compare__day:last-child .analysis-solar-compare__tooltip { right:0; left:auto; transform:translate(0,-5px); }
        .analysis-solar-compare__day:hover .analysis-solar-compare__tooltip,.analysis-solar-compare__day:focus .analysis-solar-compare__tooltip { opacity:1; visibility:visible; transform:translate(-50%,0); }
        .analysis-solar-compare__day:first-of-type:hover .analysis-solar-compare__tooltip,.analysis-solar-compare__day:first-of-type:focus .analysis-solar-compare__tooltip,.analysis-solar-compare__day:last-child:hover .analysis-solar-compare__tooltip,.analysis-solar-compare__day:last-child:focus .analysis-solar-compare__tooltip { transform:translate(0,0); }
        .analysis-solar-compare__tooltip > strong { display:block; margin-bottom:6px; color:var(--heros-panel-accent,#00e5ff); font-size:.78rem; } .analysis-solar-compare__tooltip dl { display:grid; gap:4px; margin:0; } .analysis-solar-compare__tooltip dl > div { display:flex; justify-content:space-between; gap:12px; } .analysis-solar-compare__tooltip dt { color:var(--secondary-text-color,#9ab2c7); font-size:.72rem; } .analysis-solar-compare__tooltip dd { margin:0; font-size:.72rem; font-weight:800; white-space:nowrap; }
        .analysis-empty { display:grid; place-items:center; width:100%; color:var(--secondary-text-color,#9ab2c7); }
        @media (max-width:720px) { .analysis-energy-flow,.analysis-self,.analysis-battery-flow { grid-template-columns:1fr; } .analysis-flow-hub,.analysis-battery-flow__battery { width:min(180px,70vw); margin:auto; } .analysis-table { overflow-x:auto; } .analysis-table__row { min-width:620px; } .analysis-balance__row { grid-template-columns:110px minmax(120px,1fr) 65px; } }

        .operational-report { padding:20px; color:var(--heros-panel-text,#f4fbff); }
        .operational-report__heading { display:flex; justify-content:space-between; gap:20px; align-items:flex-start; }
        .operational-report__heading h2,.operational-report h3 { margin:0 0 10px; }
        .operational-report__count { text-align:right; }
        .operational-report__count strong { display:block; font-size:2rem; }
        .operational-report__trend--empty { min-height:184px; }
        .operational-report__empty-state { min-height:150px; display:flex; align-items:center; justify-content:center; border-bottom:1px solid rgba(255,255,255,.25); color:var(--secondary-text-color,#9ab2c7); font-size:.95rem; }
        .operational-report__trend { margin-top:22px; padding:16px; border:1px solid var(--heros-panel-border,rgba(0,229,255,.3)); border-radius:14px; background:rgba(7,20,35,.55); }
        .operational-report__bars { display:flex; align-items:flex-end; gap:14px; min-height:150px; padding:20px 8px 8px; border-bottom:1px solid rgba(255,255,255,.25); }
        .operational-report__bar { display:flex; flex:1 1 0; min-width:70px; flex-direction:column; align-items:center; justify-content:flex-end; gap:6px; }
        .operational-report__bar i { display:block; width:34px; min-height:8px; border-radius:6px 6px 2px 2px; background:linear-gradient(180deg,#ff4de8,#00d9ff); }
        .operational-report__bar span { font-size:.78rem; white-space:nowrap; }
        .operational-report__bar b { font-size:1rem; }
        .operational-report__table { margin-top:22px; border:1px solid rgba(0,229,255,.25); border-radius:12px; overflow:hidden; }
        .operational-report__row { display:grid; grid-template-columns:1.2fr .8fr 2fr; gap:14px; padding:10px 14px; border-top:1px solid rgba(255,255,255,.1); }
        .operational-report__row--head { border-top:0; font-weight:800; background:rgba(0,229,255,.12); }
        .operational-report__controls { display:none; align-items:center; gap:6px; flex-wrap:wrap; margin-top:10px; }
        .operational-report__controls > strong { margin-right:4px; }
        .operational-report [data-operational-period] { box-sizing:border-box; border:1px solid var(--heros-panel-border, rgba(0,229,255,.35)); border-radius:999px; padding:7px 11px; background:var(--heros-panel-surface, rgba(7,14,26,.9)); color:var(--heros-panel-text, #f4fbff); font:inherit; font-weight:700; cursor:pointer; }
        .operational-report [data-operational-period].active { background:linear-gradient(135deg, var(--heros-panel-accent, #00e5ff), var(--heros-panel-accent-strong, #ff4de8)); color:#06111f; border-color:transparent; }
        .chart-history-note {
          margin:-2px 0 8px;
          color:var(--secondary-text-color, #486782);
          font-size:0.9rem;
          font-weight:700;
        }
        .analysis-report { display:grid; gap:10px; padding:14px; color:var(--heros-panel-text,#f4fbff); }
        .analysis-report__heading { display:flex; justify-content:space-between; gap:16px; align-items:flex-start; }
        .analysis-report__heading h2 { margin:0 0 4px; } .analysis-report__heading p { margin:0; color:var(--secondary-text-color,#9ab2c7); }
        .analysis-report__period { display:inline-block; margin-top:4px; color:var(--heros-panel-accent,#00e5ff); font-size:.82rem; font-weight:800; }
        .analysis-report__cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; }
        .analysis-report__card { display:grid; gap:5px; padding:10px; border:1px solid rgba(0,229,255,.3); border-radius:12px; background:rgba(7,20,35,.55); } .analysis-report__card span { color:var(--secondary-text-color,#9ab2c7); font-size:.8rem; font-weight:700; } .analysis-report__card strong { font-size:1.2rem; }
        .analysis-report__bars { display:flex; align-items:flex-end; gap:14px; min-height:150px; padding:18px 8px 8px; border-bottom:1px solid rgba(255,255,255,.25); }
        .analysis-report__bar { display:flex; flex:1 1 0; min-width:70px; flex-direction:column; align-items:center; justify-content:flex-end; gap:6px; } .analysis-report__bar span { color:var(--secondary-text-color,#9ab2c7); font-size:.76rem; text-align:center; } .analysis-report__bar i { display:block; width:34px; min-height:12px; border-radius:6px 6px 2px 2px; background:linear-gradient(180deg,#ff4de8,#00d9ff); } .analysis-report__bar b { font-size:.9rem; text-align:center; }
        .analysis-report__frame { min-height:190px; padding:18px; border:1px solid rgba(0,229,255,.3); border-radius:14px; background:rgba(7,20,35,.55); } .analysis-report__frame h3 { margin:0 0 10px; } .analysis-report__frame p { color:var(--secondary-text-color,#9ab2c7); }
        .operational-report { padding:20px; color:var(--heros-panel-text,#f4fbff); }
        .operational-report__heading { display:flex; justify-content:space-between; gap:20px; align-items:flex-start; }
        .operational-report__heading h2,.operational-report h3 { margin:0 0 10px; }
        .operational-report__count { text-align:right; }
        .operational-report__count strong { display:block; font-size:2rem; }
        .operational-report__trend--empty { min-height:184px; }
        .operational-report__empty-state { min-height:150px; display:flex; align-items:center; justify-content:center; border-bottom:1px solid rgba(255,255,255,.25); color:var(--secondary-text-color,#9ab2c7); font-size:.95rem; }
        .operational-report__trend { margin-top:22px; padding:16px; border:1px solid var(--heros-panel-border,rgba(0,229,255,.3)); border-radius:14px; background:rgba(7,20,35,.55); }
        .operational-report__bars { display:flex; align-items:flex-end; gap:14px; min-height:150px; padding:20px 8px 8px; border-bottom:1px solid rgba(255,255,255,.25); }
        .operational-report__bar { display:flex; flex:1 1 0; min-width:70px; flex-direction:column; align-items:center; justify-content:flex-end; gap:6px; }
        .operational-report__bar i { display:block; width:34px; min-height:8px; border-radius:6px 6px 2px 2px; background:linear-gradient(180deg,#ff4de8,#00d9ff); }
        .operational-report__bar span { font-size:.78rem; white-space:nowrap; }
        .operational-report__bar b { font-size:1rem; }
        .operational-report__table { margin-top:22px; border:1px solid rgba(0,229,255,.25); border-radius:12px; overflow:hidden; }
        .operational-report__row { display:grid; grid-template-columns:1.2fr .8fr 2fr; gap:14px; padding:10px 14px; border-top:1px solid rgba(255,255,255,.1); }
        .operational-report__row--head { border-top:0; font-weight:800; background:rgba(0,229,255,.12); }
        .operational-report__controls { display:none; align-items:center; gap:6px; flex-wrap:wrap; margin-top:10px; }
        .operational-report__controls > strong { margin-right:4px; }
        .operational-report [data-operational-period] { box-sizing:border-box; border:1px solid var(--heros-panel-border, rgba(0,229,255,.35)); border-radius:999px; padding:7px 11px; background:var(--heros-panel-surface, rgba(7,14,26,.9)); color:var(--heros-panel-text, #f4fbff); font:inherit; font-weight:700; cursor:pointer; }
        .operational-report [data-operational-period].active { background:linear-gradient(135deg, var(--heros-panel-accent, #00e5ff), var(--heros-panel-accent-strong, #ff4de8)); color:#06111f; border-color:transparent; }
        .operational-chart { display:grid; grid-template-columns:auto minmax(0,1fr); gap:8px; align-items:stretch; }
        .operational-chart__y-title { writing-mode:vertical-rl; transform:rotate(180deg); align-self:center; color:var(--secondary-text-color,#9ab2c7); font-size:.78rem; font-weight:800; letter-spacing:.02em; }
        .operational-chart__plot { position:relative; display:grid; grid-template-columns:38px minmax(0,1fr); grid-template-rows:163px auto; min-width:0; padding:12px 8px; overflow-x:auto; }
        .operational-chart__plot::before { content:""; position:absolute; z-index:0; left:38px; right:8px; top:12px; height:163px; background:repeating-linear-gradient(to bottom, rgba(113,190,220,.24) 0, rgba(113,190,220,.24) 1px, transparent 1px, transparent 25%); pointer-events:none; }
        .operational-chart__y-axis { position:relative; z-index:1; grid-column:1; grid-row:1; width:auto; height:163px; display:flex; flex-direction:column; justify-content:space-between; color:var(--secondary-text-color,#9ab2c7); font-size:.7rem; font-weight:700; text-align:right; }
        .operational-report__bars { position:relative; z-index:1; grid-column:2; grid-row:1; display:flex; align-items:flex-end; gap:14px; min-height:163px; min-width:max-content; padding:0 8px; border-bottom:1px solid rgba(255,255,255,.25); }
        .operational-report__bar { position:relative; display:flex; flex:1 1 70px; width:70px; min-width:70px; height:163px; flex-direction:column; align-items:center; justify-content:flex-end; gap:5px; outline:none; }
        .operational-report__bar i { display:block; width:34px; height:var(--bar-height); min-height:8px; border-radius:6px 6px 2px 2px; background:linear-gradient(180deg,#ff4de8,#00d9ff); }
        .operational-report__bar span { order:3; color:var(--secondary-text-color,#9ab2c7); font-size:.76rem; white-space:nowrap; }
        .operational-report__bar b { order:2; font-size:.9rem; }
        .operational-report__bar .operational-report__tooltip { position:absolute; z-index:4; left:50%; bottom:calc(var(--bar-height) + 34px); transform:translateX(-50%); width:max-content; max-width:180px; padding:7px 9px; border:1px solid rgba(0,229,255,.35); border-radius:8px; background:rgba(7,20,35,.98); color:var(--heros-panel-text,#f4fbff); font-size:.75rem; font-style:normal; opacity:0; pointer-events:none; transition:opacity .12s ease; }
        .operational-report__bar:hover .operational-report__tooltip, .operational-report__bar:focus-visible .operational-report__tooltip { opacity:1; }
        .operational-report__bar:focus-visible { box-shadow:0 0 0 2px var(--heros-panel-accent,#00e5ff); border-radius:6px; }
        .operational-chart__x-title { display:block; position:relative; z-index:1; grid-column:2; grid-row:2; margin-top:8px; color:var(--secondary-text-color,#9ab2c7); font-size:.78rem; font-weight:800; text-align:center; }
        .operational-report__legend { display:flex; flex-wrap:wrap; gap:12px 20px; margin-top:12px; color:var(--secondary-text-color,#9ab2c7); font-size:.8rem; font-weight:700; }
        .operational-report__legend i { display:inline-block; width:9px; height:9px; margin-right:6px; border-radius:50%; background:#ff4de8; }
        @media (max-width:720px) { .operational-report__plot { min-width:560px; } .operational-report__heading { flex-direction:column; } .operational-report__count { text-align:left; } }
        .chart-history-note--info {
          color:color-mix(in srgb, #6bb9d6 88%, var(--secondary-text-color, #6bb9d6));
        }
        .chart-history-note--warn {
          color:color-mix(in srgb, #916000 85%, var(--secondary-text-color, #916000));
        }
        .chart-overview-toggle { border:1px solid var(--heros-panel-border, rgba(0, 229, 255, 0.22)); border-radius:999px; padding:7px 11px; background:var(--heros-panel-surface, rgba(7, 14, 26, 0.9)); color:var(--heros-panel-text, #f4fbff); cursor:pointer; font:inherit; font-weight:800; }
        .chart-overview-toggle.is-active { border-color:transparent; background:linear-gradient(135deg, var(--heros-panel-accent, #00e5ff), var(--heros-panel-accent-strong, #ff4de8)); color:#06111f; }        .chart-header { margin-bottom:10px; display:grid; gap:6px; }
        .chart-header__row { display:flex; align-items:center; gap:8px; justify-content:space-between; flex-wrap:wrap; }
        .panel-tabs,
        .period-tabs { display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
        .period-tabs button { box-sizing:border-box; }
        .period-tabs__label { margin-left:8px; margin-right:4px; color:var(--heros-panel-text, #f4fbff); }
        .chart-tools { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
        .chart-tools--date { justify-content:flex-start; min-width:560px; }
        .date-picker { position:relative; display:inline-flex; width:158px; min-width:158px; flex:0 0 158px; }
        .date-picker__button { box-sizing:border-box; display:inline-flex; align-items:center; justify-content:space-between; gap:8px; width:100%; min-height:34px; padding:7px 9px; border:1px solid color-mix(in srgb, var(--divider-color, rgba(51, 92, 140, 0.16)) 72%, transparent); border-radius:999px; background:color-mix(in srgb, var(--primary-color, #eef5ff) 10%, var(--card-background-color, #fff)); color:var(--secondary-text-color, #36567b); font:inherit; font-size:0.9rem; font-weight:700; cursor:pointer; }
        .date-picker__button:focus-visible { outline:2px solid var(--heros-panel-accent, #00e5ff); outline-offset:2px; }
        .date-picker__icon { font-size:0.9rem; line-height:1; }
        .date-picker__native { position:absolute; width:1px; height:1px; opacity:0; pointer-events:none; }
        .chart-tools--date > .date-input,
        .chart-tools--date > .date-picker,
        .chart-tools--date [data-tariff-date] {
          box-sizing:border-box;
          width:158px !important;
          min-width:158px !important;
          flex:0 0 158px;
          padding-left:8px;
          padding-right:8px;
        }
        .chart-tools--date > .date-nav,
        .chart-tools--date [data-tariff-shift] { width:34px; min-width:34px; padding-left:0; padding-right:0; }
        .chart-tools--date [data-tariff-period], .operational-report [data-operational-period] { box-sizing:border-box; border:1px solid var(--heros-panel-border, rgba(0,229,255,.35)); border-radius:999px; padding:7px 11px; background:var(--heros-panel-surface, rgba(7,14,26,.9)); color:var(--heros-panel-text, #f4fbff); font:inherit; font-weight:700; cursor:pointer; }
        .chart-tools--date [data-tariff-period].active, .operational-report [data-operational-period].active { background:linear-gradient(135deg, var(--heros-panel-accent, #00e5ff), var(--heros-panel-accent-strong, #ff4de8)); color:#06111f; border-color:transparent; }
        .tariff-period-controls__label { margin-left:8px; margin-right:4px; }
        .chart-tools--action { justify-content:flex-end; margin-left:auto; }
        .panel-tabs button,
        .period-tabs button,
        .legend-chip,
        .download-btn {
          border:none;
          border-radius:999px;
          padding:7px 11px;
          font-weight:700;
          cursor:pointer;
          transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease, color 0.15s ease;
        }
        .panel-tabs button,
        .period-tabs button {
          background:color-mix(in srgb, var(--primary-color, #e8eff8) 10%, var(--card-background-color, #fff));
          color:var(--secondary-text-color, #476687);
        }
        .panel-tabs button.active,
        .period-tabs button.active {
          background:var(--primary-color, #2f75d8);
          color:var(--text-primary-color, #fff);
        }
        .panel-tabs button:hover,
        .panel-tabs button:focus-visible,
        .period-tabs button:hover,
        .period-tabs button:focus-visible,
        .legend-chip:hover,
        .legend-chip:focus-visible,
        .download-btn:hover,
        .download-btn:focus-visible {
          transform: translateY(-1px);
          box-shadow: 0 12px 24px color-mix(in srgb, var(--primary-color, #2f75d8) 18%, transparent);
          outline: none;
        }
        .download-btn {
          background:var(--primary-color, #2f75d8);
          color:var(--text-primary-color, #fff);
          box-shadow:0 8px 16px color-mix(in srgb, var(--primary-color, #2f75d8) 20%, transparent);
        }
        .shell, .ring-grid { overflow:visible !important; }
        .ring-grid {
          display:grid;
          grid-template-columns: repeat(auto-fit, minmax(118px, 1fr));
          gap:12px;
          margin-bottom:14px;
        }
        .ring-card {
          display:flex;
          flex-direction:column;
          justify-content:center;
          align-items:center;
          border-radius:20px;
          padding:12px 14px;
          text-align:center;
          border:2px solid transparent;
          background:linear-gradient(180deg, color-mix(in srgb, var(--card-background-color, #fbfdff) 96%, var(--primary-color, #2f75d8) 4%), var(--card-background-color, #fbfdff));
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.08), 0 8px 18px rgba(0,0,0,0.18);
          min-height:104px;
          height:104px;
        }
        .ring-card--solar { border-color:#ffd13c; }
        .ring-card--load { border-color:#ff9f35; }
        .ring-card--bat { border-color:#40c982; }
        .ring-card--feed { border-color:#a824a1; }
        .ring-card--grid { border-color:#b796f4; }
        .ring-card--discharge { border-color:#60a5fa; }
        .ring-card--import { border-color:#b796f4; }
        .ring-card--charge { border-color:#ff4eb3; }
        .ring-card--export { border-color:#a824a1; } .ring-card--status { grid-column:span 2; border-color:#00e5ff; background:linear-gradient(135deg, color-mix(in srgb, var(--heros-panel-accent, #00e5ff) 24%, var(--card-background-color, #0a1222)), color-mix(in srgb, var(--heros-panel-accent-strong, #ff4de8) 18%, var(--card-background-color, #0a1222))); box-shadow:0 0 0 1px color-mix(in srgb, var(--heros-panel-accent, #00e5ff) 45%, transparent), 0 10px 24px rgba(0,229,255,.2); }
        .ring-value {
          font-size:1.65rem;
          font-weight:800;
          color:var(--primary-text-color, #17263a);
          line-height:1.15;
        }
        .ring-label-row { display:flex; align-items:center; justify-content:center; gap:6px; max-width:100%; } .field-help { position:relative; display:inline-flex; align-items:center; justify-content:center; width:16px; height:16px; flex:0 0 auto; border-radius:50%; border:1px solid rgba(146,193,255,.55); color:rgba(200,228,255,.98); font-size:11px; font-weight:800; line-height:1; cursor:help; background:rgba(33,57,88,.98); box-shadow:0 0 0 1px rgba(0,0,0,.14) inset; } .field-help::after { content:attr(data-help); position:absolute; z-index:30; left:50%; top:calc(100% + 9px); width:290px; max-width:min(290px,calc(100vw - 32px)); padding:10px 12px; border:1px solid rgba(0,229,255,.62); border-radius:10px; background:rgba(7,18,34,.98); color:rgba(225,241,255,.98); box-shadow:0 10px 28px rgba(0,0,0,.38),0 0 18px rgba(0,229,255,.12); font-size:12px; font-weight:500; line-height:1.4; letter-spacing:.01em; text-align:left; white-space:normal; opacity:0; visibility:hidden; pointer-events:auto; transform:translate(-50%, -4px); transition:opacity .15s ease, transform .15s ease, visibility .15s ease; } .field-help:hover::after, .field-help:focus-visible::after { opacity:1; visibility:visible; transform:translate(-50%, 0); }
        .ring-label {
          margin-top:3px;
          color:var(--primary-text-color, #17263a);
          font-size:1.08rem;
          font-weight:800;
          letter-spacing:0.01em;
          line-height:1.1;
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis;
        }
        .ring-meta { margin-top:5px; color:var(--primary-color, #00e5ff); font-size:0.76rem; font-weight:800; line-height:1.1; white-space:nowrap; }
        .ring-detail {
          margin-top:3px;
          color:var(--secondary-text-color, #506884);
          font-size:0.63rem;
          line-height:1.1;
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis;
        }
        .chart {
          width:100%;
          height:auto;
          display:block;
          background:
            linear-gradient(180deg, color-mix(in srgb, var(--card-background-color, #fff) 96%, var(--primary-color, #2f75d8) 4%), var(--card-background-color, #fff));
          border-radius:18px;
        }
        .chart-layout {
          display:grid;
          grid-template-columns:minmax(0, 1fr) 210px;
          gap:12px;
          align-items:stretch;
        }
        .chart-stage {
          position:relative;
          min-width:0;
        }
        .chart-legend {
          display:flex;
          align-items:flex-end;
          min-width:0;
        }
        .chart-hit-target {
          fill:transparent;
          pointer-events:all;
        }
        .chart-series-layer {
          pointer-events:none;
        }
        .chart-series-layer--soc {
          opacity:0.78;
        }
        .chart-series-layer--flow {
          mix-blend-mode:normal;
        }
        .chart--refresh {
          clip-path: inset(0 100% 0 0);
          animation: heros-chart-reveal 720ms ease-out forwards;
        }
        .axis,
        .grid {
          stroke:color-mix(in srgb, var(--divider-color, #d8e3ef) 82%, transparent);
          stroke-width:1;
        }
        .axis-soc {
          stroke:var(--success-color, #98d35b);
        }
        .tick,
        .axis-label,
        .axis-title {
          fill:var(--secondary-text-color, #6280a2);
          font-size:12px;
          font-weight:700;
        }
        .tick-right,
        .axis-title-soc {
          fill:color-mix(in srgb, var(--success-color, #6d9e36) 88%, var(--secondary-text-color, #6d9e36));
        }
        .axis-title {
          font-size:13px;
          letter-spacing:0;
        }
        .legend-row {
          display:flex;
          flex-direction:column;
          align-items:stretch;
          gap:8px;
          width:100%;
          margin:0 0 26px;
        }
        .legend-group {
          display:flex;
          align-items:center;
          flex-wrap:wrap;
          gap:6px;
          padding:7px 8px;
          border-radius:12px;
          background:color-mix(in srgb, var(--card-background-color, #fff) 88%, var(--primary-color, #16d8e2) 12%);
          border:1px solid color-mix(in srgb, var(--divider-color, rgba(51, 92, 140, 0.16)) 82%, transparent);
        }
        .chart-hover-line {
          position:absolute;
          top:9.65%;
          bottom:19.3%;
          width:1px;
          background:color-mix(in srgb, var(--primary-color, #9db7d8) 48%, transparent);
          pointer-events:none;
          z-index:2;
        }
        .chart-hover-markers {
          position:absolute;
          inset:0;
          pointer-events:none;
          z-index:3;
        }
        .chart-hover-marker {
          position:absolute;
          width:10px;
          height:10px;
          border-radius:999px;
          border:2px solid var(--card-background-color, #fff);
          box-shadow:0 0 0 2px color-mix(in srgb, rgba(12, 21, 32, 0.55) 76%, transparent);
          transform:translate(-50%, -50%);
        }
        .chart-hover-marker--bat { background:#40c982; }
        .chart-hover-marker--load { background:#ff8f1f; }
        .chart-hover-marker--solar { background:#ffd13c; }
        .chart-hover-marker--feed_in { background:#82127c; }
        .chart-hover-marker--consumed { background:#ff8f1f; }
        .chart-tooltip {
          position:absolute;
          min-width:160px;
          max-width:min(240px, calc(100% - 16px));
          padding:12px 14px;
          border-radius:14px;
          border:1px solid color-mix(in srgb, var(--divider-color, rgba(51, 92, 140, 0.14)) 80%, transparent);
          background:color-mix(in srgb, var(--card-background-color, #fff) 94%, white);
          color:var(--primary-text-color, #17263a);
          box-shadow:0 16px 30px color-mix(in srgb, rgba(8, 15, 28, 0.22) 82%, transparent);
          pointer-events:none;
          z-index:4;
        }
        .mode-report { display:grid; gap:14px; padding:4px 0 2px; }
        .mode-summary { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:10px; }
        .mode-summary__item { display:grid; gap:3px; padding:12px 14px; border:1px solid var(--divider-color, rgba(51, 92, 140, 0.14)); border-radius:12px; background:color-mix(in srgb, var(--card-background-color, #fff) 92%, var(--primary-color, #2f75d8) 8%); }
        .mode-summary__item strong { font-size:1.25rem; }
        .mode-summary__item span { color:var(--secondary-text-color, #4a6787); font-size:0.78rem; font-weight:700; }
        .mode-summary__item--error { border-color:rgba(255, 59, 48, 0.8); }
        .mode-timeline { display:flex; min-height:82px; overflow:hidden; border:1px solid var(--divider-color, rgba(51, 92, 140, 0.14)); border-radius:14px; background:var(--card-background-color, #fff); }
        .mode-timeline__segment { display:flex; align-items:center; justify-content:center; min-width:2px; padding:8px 5px; color:#07121f; font-size:0.76rem; font-weight:900; text-align:center; box-shadow:inset -1px 0 0 rgba(255,255,255,0.38); cursor:default; outline:none; }
        .mode-timeline__segment:focus-visible { box-shadow:inset 0 0 0 3px #fff, inset -1px 0 0 rgba(255,255,255,0.38); }
        .mode-timeline__segment--solar { background:#ffd13c; }
        .mode-timeline__segment--battery-discharge { background:#60a5fa; }
        .mode-timeline__segment--battery-charge { background:#ff4eb3; }
        .mode-timeline__segment--grid-import { background:#b796f4; }
        .mode-timeline__segment--feed-in { background:#a824a1; color:#fff; }
        .mode-timeline__segment--idle { background:#6e829b; color:#fff; }
        .mode-timeline__segment--error { background:#ff3b30; color:#fff; min-width:8px; }
        .mode-timeline__axis { display:flex; justify-content:space-between; color:var(--secondary-text-color, #4a6787); font-size:0.76rem; font-weight:800; }
        .mode-legend { display:flex; flex-wrap:wrap; gap:8px 12px; }
        .mode-legend__item { display:inline-flex; align-items:center; gap:6px; color:var(--secondary-text-color, #4a6787); font-size:0.78rem; font-weight:800; }
        .mode-legend__item i { width:10px; height:10px; border-radius:99px; background:#6e829b; }
        .mode-legend__item--solar i { background:#ffd13c; }
        .mode-legend__item--battery-discharge i { background:#60a5fa; }
        .mode-legend__item--battery-charge i { background:#ff4eb3; }
        .mode-legend__item--grid-import i { background:#b796f4; }
        .mode-legend__item--feed-in i { background:#a824a1; }
        .mode-legend__item--error i { background:#ff3b30; }
        .mode-explainer { color:var(--secondary-text-color, #4a6787); font-size:0.82rem; font-weight:700; }        .tariff-impact { display:grid; gap:12px; }
        .tariff-impact__heading { display:flex; align-items:baseline; justify-content:space-between; gap:12px; flex-wrap:wrap; }
        .tariff-impact__heading strong { font-size:1rem; }
        .tariff-impact__heading span, .tariff-impact__note, .tariff-impact__legend { color:var(--secondary-text-color, #4a6787); font-size:0.78rem; font-weight:700; }
        .tariff-impact__summary { display:grid; grid-template-columns:repeat(6, minmax(0, 1fr)); gap:10px; }
        .tariff-impact__summary > div { display:grid; gap:4px; padding:11px 12px; border:1px solid var(--divider-color, rgba(51, 92, 140, 0.14)); border-radius:12px; background:color-mix(in srgb, var(--card-background-color, #fff) 92%, var(--primary-color, #2f75d8) 8%); }
        .tariff-impact__summary span { color:var(--secondary-text-color, #4a6787); font-size:0.72rem; font-weight:800; }
        .tariff-impact__summary strong { font-size:1.1rem; font-variant-numeric:tabular-nums; }
        .tariff-impact__summary--net { border-color:var(--heros-panel-accent, #00e5ff) !important; }
        .tariff-impact__summary--saving { border-color:#40c982 !important; }
        .tariff-impact__credit { color:#40c982; }
        .tariff-impact__timeline { display:flex; min-height:58px; overflow:hidden; border:1px solid var(--divider-color, rgba(51, 92, 140, 0.14)); border-radius:12px; background:var(--card-background-color, #fff); }
        .tariff-impact__segment { min-width:2px; background:#6e829b; box-shadow:inset -1px 0 0 rgba(255,255,255,0.14); }
        .tariff-impact__segment--import { background:#ff9f1c; }
        .tariff-impact__segment--credit { background:#40c982; }
        .tariff-impact__segment--future { background:#26364b; opacity:1 !important; }
        .tariff-impact__segment--gap { background:repeating-linear-gradient(135deg,#ff1744 0,#ff1744 3px,#7f1028 3px,#7f1028 6px); box-shadow:inset 0 0 0 1px #ffb3c1; }
        .tariff-impact__axis { display:flex; justify-content:space-between; gap:8px; padding:0 2px; color:var(--secondary-text-color, #4a6787); font-size:0.72rem; font-weight:800; }
        .tariff-impact__axis--segments span { flex:1 1 0; min-width:0; overflow:hidden; text-overflow:ellipsis; text-align:center; white-space:nowrap; }
        .tariff-impact__legend { display:flex; flex-wrap:wrap; gap:8px 14px; }
        .tariff-impact__legend span { display:inline-flex; align-items:center; gap:6px; }
        .tariff-impact__key { width:10px; height:10px; border-radius:99px; background:#6e829b; }
        .tariff-impact__key--import { background:#ff9f1c; }
        .tariff-impact__key--credit { background:#40c982; }
        .tariff-impact__key--future { background:#26364b; }
        .tariff-impact__key--neutral { background:#6e829b; }
        .tariff-impact__key--gap { background:#ff1744; }        .daily-detail { display:grid; gap:12px; }
        .daily-detail-summary { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:10px; }
        .daily-detail-summary > div { display:grid; gap:3px; padding:11px 13px; border:1px solid var(--divider-color, rgba(51, 92, 140, 0.14)); border-radius:12px; background:color-mix(in srgb, var(--card-background-color, #fff) 92%, var(--primary-color, #2f75d8) 8%); }
        .daily-detail-summary strong { font-size:1.15rem; }
        .daily-detail-summary span, .daily-detail-note { color:var(--secondary-text-color, #4a6787); font-size:0.78rem; font-weight:700; }
        .daily-detail-summary--error { border-color:rgba(255, 59, 48, 0.8) !important; }
        .daily-detail-table-wrap { overflow:auto; max-height:min(62vh, 680px); border:1px solid var(--divider-color, rgba(51, 92, 140, 0.14)); border-radius:14px; background:var(--card-background-color, #fff); }
        .daily-detail-table { width:100%; min-width:1040px; border-collapse:separate; border-spacing:0; font-size:0.82rem; }
        .daily-detail-table th { position:sticky; top:0; z-index:1; padding:10px 12px; text-align:right; color:var(--secondary-text-color, #4a6787); background:color-mix(in srgb, var(--card-background-color, #fff) 92%, var(--primary-color, #2f75d8) 8%); border-bottom:1px solid var(--divider-color, rgba(51, 92, 140, 0.14)); font-size:0.72rem; letter-spacing:0.02em; text-transform:uppercase; white-space:nowrap; }
        .daily-detail-table th:first-child, .daily-detail-table th:last-child { text-align:left; }
        .daily-detail-table td { padding:8px 12px; text-align:right; border-bottom:1px solid color-mix(in srgb, var(--divider-color, rgba(51, 92, 140, 0.14)) 66%, transparent); font-variant-numeric:tabular-nums; white-space:nowrap; }
        .daily-detail-table tbody tr:last-child td { border-bottom:0; }
        .daily-detail-table tbody tr:hover { background:color-mix(in srgb, var(--primary-color, #2f75d8) 10%, transparent); }
        .daily-detail-row--error { background:color-mix(in srgb, #ff3b30 15%, transparent); }
        .daily-detail-row--gap { background:color-mix(in srgb, #ffbd2e 10%, transparent); }
        .daily-detail-time { text-align:left !important; font-weight:900; }
        .daily-detail-statuses { display:flex; flex-wrap:wrap; justify-content:flex-start; gap:5px; text-align:left !important; min-width:220px; white-space:normal !important; }
        .daily-detail-status { display:inline-flex; align-items:center; min-height:20px; padding:1px 7px; border-radius:999px; color:var(--secondary-text-color, #4a6787); background:color-mix(in srgb, var(--primary-color, #2f75d8) 12%, transparent); font-size:0.7rem; font-weight:800; }
        .daily-detail-status--error { color:#fff; background:#d82c25; }
        .daily-detail-status--gap { color:#251a00; background:#ffbd2e; }
        .daily-detail-status--missing { color:#fff; background:#6e829b; }        .chart-error-event {
          stroke:#ff3b30;
          stroke-width:2.5;
          stroke-dasharray:5 4;
          pointer-events:none;
          filter:drop-shadow(0 0 4px rgba(255, 59, 48, 0.9));
        }
        .chart-tooltip__event {
          margin:0 0 8px;
          color:#ff6b63;
          font-size:0.92rem;
          font-weight:900;
          letter-spacing:0.02em;
          text-transform:uppercase;
        }
        .chart-tooltip__time {
          font-size:0.96rem;
          font-weight:800;
          margin-bottom:8px;
        }
        .chart-tooltip__row {
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:14px;
          font-size:0.92rem;
          margin-top:6px;
        }
        .chart-tooltip__label {
          display:inline-flex;
          align-items:center;
          gap:8px;
          color:var(--secondary-text-color, #4a6787);
        }
        .legend-group-label {
          align-self:center;
          color:var(--secondary-text-color, #526d8b);
          font-size:0.68rem;
          font-weight:800;
          letter-spacing:0.04em;
          text-transform:uppercase;
          margin-left:6px;
        }
        .legend-chip {
          display:inline-flex;
          align-items:center;
          gap:8px;
          background:color-mix(in srgb, var(--primary-color, #eef4fb) 10%, var(--card-background-color, #fff));
          color:var(--secondary-text-color, #4a6787);
        }
        .legend-chip__swatch {
          width:10px;
          height:10px;
          border-radius:999px;
          flex:0 0 10px;
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.18);
        }
        .legend-chip.active {
          background:var(--primary-text-color, #1f2e43);
          color:var(--text-primary-color, #fff);
        }
        .legend-chip__swatch--bat { background:#40c982; }
        .legend-chip__swatch--load { background:#ff8f1f; }
        .legend-chip__swatch--solar { background:#ffd13c; }
        .legend-chip__swatch--bat_discharge { background:#60a5fa; }
        .legend-chip__swatch--grid_import { background:#a78bfa; }
        .legend-chip__swatch--battery_charge { background:#ec4899; }
        .legend-chip__swatch--feed_in { background:#82127c; }
        .legend-chip__swatch--consumed { background:#d39d6c; }
        .legend-chip.active[data-series="bat"] { background:color-mix(in srgb, #40c982 18%, var(--card-background-color, #fff)); }
        .legend-chip.active[data-series="load"] { background:color-mix(in srgb, #ff8f1f 18%, var(--card-background-color, #fff)); }
        .legend-chip.active[data-series="solar"] { background:color-mix(in srgb, #ffd13c 20%, var(--card-background-color, #fff)); }
        .legend-chip.active[data-series="bat_discharge"] { background:color-mix(in srgb, #60a5fa 18%, var(--card-background-color, #fff)); }
        .legend-chip.active[data-series="grid_import"] { background:color-mix(in srgb, #a78bfa 18%, var(--card-background-color, #fff)); }
        .legend-chip.active[data-series="battery_charge"] { background:color-mix(in srgb, #ec4899 18%, var(--card-background-color, #fff)); }
        .legend-chip.active[data-series="feed_in"] { background:color-mix(in srgb, #82127c 18%, var(--card-background-color, #fff)); }
        .legend-chip.active[data-series="consumed"] { background:color-mix(in srgb, #d39d6c 18%, var(--card-background-color, #fff)); }
        .chart-explainer {
          margin-top:6px;
          color:var(--secondary-text-color, #526d8b);
          font-size:0.78rem;
          font-weight:700;
        }
        @keyframes heros-chart-reveal {
          from { clip-path: inset(0 100% 0 0); }
          to { clip-path: inset(0 0 0 0); }
        }
        .stats-diagram {
          display:grid;
          gap:10px;
        }
        .stats-diagram--chart { display:grid; gap:12px; }
        .stats-chart-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:4px 2px; color:var(--secondary-text-color, #526d8b); font-size:0.82rem; font-weight:700; }
        .stats-chart-heading strong { color:var(--primary-text-color, #16253a); font-size:1rem; }
        .stats-chart-heading span { text-align:right; }
        .stats-chart-nav button:disabled { opacity:0.35; cursor:default; } [data-statistical-chart] { cursor:grab; touch-action:pan-y; user-select:none; } .stats-chart-nav, .report-chart-nav { display:inline-flex; gap:6px; margin-left:8px; } .report-chart-nav-row { position:relative; z-index:10; display:flex; justify-content:flex-end; margin:0 8px 8px; pointer-events:auto; } .operational-report__count > .report-chart-nav, .tariff-impact__heading > .report-chart-nav { margin-left:auto; }
        .stats-chart-nav button, .report-chart-nav button { width:32px; height:30px; padding:0; border-radius:10px; border:1px solid color-mix(in srgb, var(--primary-color, #4ba4ff) 55%, transparent); background:color-mix(in srgb, var(--card-background-color, #fff) 82%, var(--primary-color, #4ba4ff)); color:var(--primary-text-color, #16253a); font-size:1.2rem; font-weight:800; cursor:pointer; }
        .stats-chart-nav button:hover { background:color-mix(in srgb, var(--primary-color, #4ba4ff) 22%, var(--card-background-color, #fff)); }
        .stats-row {
          display:grid;
          gap:8px;
          padding:10px 0;
          border-bottom:1px solid color-mix(in srgb, var(--divider-color, #e1eaf4) 82%, transparent);
        }
        .stats-row:hover {
          background:color-mix(in srgb, var(--primary-color, #eef4fb) 6%, transparent);
          border-radius:14px;
          padding-left:10px;
          padding-right:10px;
          margin-left:-10px;
          margin-right:-10px;
        }
        .stats-row:last-child {
          border-bottom:none;
        }
        .stats-row-head {
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:8px;
        }
        .stats-row-label {
          font-size:0.9rem;
          font-weight:700;
          color:var(--primary-text-color, #30445e);
        }
        .stats-row-value {
          font-size:0.9rem;
          font-weight:800;
          color:var(--primary-text-color, #16253a);
          text-align:right;
        }
        .stats-bar-track {
          position:relative;
          overflow:hidden;
          height:12px;
          border-radius:999px;
          background:color-mix(in srgb, var(--primary-color, #edf3fa) 10%, var(--card-background-color, #fff));
        }
        .stats-bar-fill {
          height:100%;
          border-radius:999px;
        }
        .tone-solar { background:linear-gradient(90deg, #f0b343, #ffd552); }
        .tone-load { background:linear-gradient(90deg, #64cfe0, #83e6f2); }
        .tone-battery { background:linear-gradient(90deg, #9ecf57, #b8e078); }
        .tone-feed { background:linear-gradient(90deg, #ff8f3e, #ffb066); }
        .tone-grid { background:linear-gradient(90deg, #d7a16c, #e8bc92); }
        .tone-info { background:linear-gradient(90deg, #4b8fff, #6ca7ff); }
        .empty {
          padding:18px;
          border-radius:18px;
          background:var(--card-background-color, #fff);
          border:1px dashed color-mix(in srgb, var(--divider-color, rgba(51, 92, 140, 0.24)) 72%, transparent);
          color:var(--secondary-text-color, #496681);
        }
        @media (max-width: 1260px) {
          .hero-banner {
            grid-template-columns: 1fr;
          }
          .aggregate-strip {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
          .chart-tools--action {
            margin-left:0;
          }
          .aggregate-row {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
          .aggregate-header {
            display:none;
          }
        }
        @media (max-width: 860px) {
          .shell, .ring-grid { overflow:visible !important; }
        .ring-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .selector-row {
            grid-template-columns: 1fr;
          }
          .aggregate-strip {
            grid-template-columns: 1fr;
          }
          .stats-grid {
            grid-template-columns: 1fr;
          }
          .hero-metrics {
            grid-template-columns: 1fr;
          }
          .chart-header__row {
            flex-direction:column;
            align-items:stretch;
          }
          .chart-tools--action {
            margin-left:0;
          }
          .chart-tools--date,
          .chart-tools--action,
          .panel-tabs,
          .period-tabs,
          .chart-toolbar {
            justify-content:center;
          }
          .aggregate-row {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        /* Keep the graph full width; the grouped legend belongs beneath it. */
        .chart-layout { display:block; }
        .chart-legend { display:block; margin-top:10px; }
        .legend-row { flex-direction:row; flex-wrap:wrap; margin:0; }        /* The report is nested inside the themed HEROS shell. Bridge its
           inherited theme tokens into the card variables used by controls. */
        ha-card.report-card {
          overflow:visible !important;
          color-scheme:dark;
          --card-background-color:var(--heros-panel-surface-strong, #0a1222);
          --primary-text-color:var(--heros-panel-text, #f4fbff);
          --secondary-text-color:var(--heros-panel-muted, rgba(222, 246, 255, 0.74));
          --text-primary-color:var(--heros-panel-text, #f4fbff);
          --divider-color:var(--heros-panel-border, rgba(0, 229, 255, 0.22));
          --primary-color:var(--heros-panel-accent, #00e5ff);
          --success-color:#9dff57;
          background:
            radial-gradient(circle at 82% 12%, color-mix(in srgb, var(--heros-panel-accent-strong, #ff4de8) 20%, transparent), transparent 26%),
            radial-gradient(circle at 18% 16%, color-mix(in srgb, var(--heros-panel-accent, #00e5ff) 18%, transparent), transparent 28%),
            linear-gradient(180deg, color-mix(in srgb, var(--heros-panel-surface-strong, #0a1222) 96%, black) 0%, var(--heros-panel-surface, #070e1a) 100%);
          box-shadow:0 24px 48px rgba(0, 0, 0, 0.42);
        }
        /* Match the standard HEROS panel controls. */
        .panel-tabs button,
        .period-tabs button,
        .date-nav,
        .date-input,
        .focus-time-control {
          border:1px solid var(--heros-panel-border, rgba(0, 229, 255, 0.22));
          background:var(--heros-panel-surface, rgba(7, 14, 26, 0.9));
          color:var(--heros-panel-text, #f4fbff);
        }
        .panel-tabs button.active,
        .period-tabs button.active,
        .download-btn {
          border-color:transparent;
          background:linear-gradient(135deg, var(--heros-panel-accent, #00e5ff), var(--heros-panel-accent-strong, #ff4de8));
          color:#06111f;
          box-shadow:0 10px 24px color-mix(in srgb, var(--heros-panel-accent, #00e5ff) 22%, transparent);
        }
        .panel-tabs button:hover,
        .panel-tabs button:focus-visible,
        .period-tabs button:hover,
        .period-tabs button:focus-visible,
        .date-nav:hover,
        .date-nav:focus-visible,
        .download-btn:hover,
        .download-btn:focus-visible {
          border-color:var(--heros-panel-accent, #00e5ff);
          box-shadow:0 0 0 1px color-mix(in srgb, var(--heros-panel-accent, #00e5ff) 24%, transparent), 0 10px 24px color-mix(in srgb, var(--heros-panel-accent, #00e5ff) 22%, transparent);
        }        @media (max-width: 760px) {
          .tariff-impact__summary { grid-template-columns:repeat(auto-fit, minmax(155px, 1fr)); }
          .chart-layout { grid-template-columns:1fr; }
          .chart-legend { align-items:stretch; }
          .legend-row { flex-direction:row; flex-wrap:wrap; margin:0; }
        }
        /* Final compact report geometry overrides */
        .ring-card { height:54px !important; min-height:54px !important; padding:4px 8px !important; }
        .ring-value { font-size:1.2rem !important; line-height:1 !important; }
        .ring-label-row { display:flex; align-items:center; justify-content:center; gap:6px; max-width:100%; } .field-help { position:relative; display:inline-flex; align-items:center; justify-content:center; width:16px; height:16px; flex:0 0 auto; border-radius:50%; border:1px solid rgba(146,193,255,.55); color:rgba(200,228,255,.98); font-size:11px; font-weight:800; line-height:1; cursor:help; background:rgba(33,57,88,.98); box-shadow:0 0 0 1px rgba(0,0,0,.14) inset; } .field-help::after { content:attr(data-help); position:absolute; z-index:30; left:50%; top:calc(100% + 9px); width:290px; max-width:min(290px,calc(100vw - 32px)); padding:10px 12px; border:1px solid rgba(0,229,255,.62); border-radius:10px; background:rgba(7,18,34,.98); color:rgba(225,241,255,.98); box-shadow:0 10px 28px rgba(0,0,0,.38),0 0 18px rgba(0,229,255,.12); font-size:12px; font-weight:500; line-height:1.4; letter-spacing:.01em; text-align:left; white-space:normal; opacity:0; visibility:hidden; pointer-events:auto; transform:translate(-50%, -4px); transition:opacity .15s ease, transform .15s ease, visibility .15s ease; } .field-help:hover::after, .field-help:focus-visible::after { opacity:1; visibility:visible; transform:translate(-50%, 0); }
        .ring-label { font-size:0.92rem !important; line-height:1 !important; margin-top:1px !important; }
        .chart-legend { margin-top:-12px !important; transform:translateY(-12px); }
        .chart-explainer { margin-top:-8px !important; transform:translateY(-12px); }
        .ring-card { height:auto !important; min-height:0 !important; padding:5px 8px !important; justify-content:center; }
        .ring-card { box-sizing:border-box; height:58px !important; min-height:58px !important; padding:4px 8px !important; justify-content:center; }
        .parameter-group { display:flex; align-items:center; gap:6px; padding:4px 6px; border:1px solid rgba(0,229,255,.35); border-radius:12px; background:rgba(7,14,26,.55); }
        .parameter-group--date, .parameter-group--period { flex:0 0 auto; }
        .report-controls-divider { width:100%; height:2px; margin:2px 0 8px; border-radius:999px; background:rgba(0,229,255,.55); }
        .ring-card { box-sizing:border-box; height:58px !important; min-height:58px !important; padding:4px 8px !important; }
        .chart-tools--date { border:1px solid rgba(0,229,255,.35); border-radius:12px; padding:4px 6px; gap:6px; }
        .period-tabs { border:1px solid rgba(0,229,255,.35); border-radius:12px; padding:4px 6px; gap:6px; }
        .panel-tabs button.active { transform:none !important; overflow:hidden; background-clip:padding-box; border-right:0; }
        .chart-tools--date { box-sizing:border-box; border:1px solid rgba(0,229,255,.48) !important; border-radius:12px !important; padding:4px 6px !important; background:color-mix(in srgb, var(--card-background-color, #fff) 88%, var(--primary-color, #00e5ff) 12%) !important; }
        .chart-tools--date > .date-nav, .chart-tools--date > .date-picker, .chart-tools--date > .date-input { margin:0 !important; }
        .period-tabs { box-sizing:border-box; border:1px solid rgba(0,229,255,.48) !important; border-radius:12px !important; padding:4px 6px !important; background:color-mix(in srgb, var(--card-background-color, #fff) 88%, var(--primary-color, #00e5ff) 12%) !important; }
        .parameter-group--date { display:flex; align-items:center; gap:6px; padding:4px 6px; border:1px solid rgba(0,229,255,.48); border-radius:12px; background:color-mix(in srgb, var(--card-background-color, #fff) 88%, var(--primary-color, #00e5ff) 12%); }
        .parameter-group--date > .date-nav { margin:0 !important; }
        .parameter-group--date > .date-picker, .parameter-group--date > .date-input { margin:0 !important; }
        .chart-tools--date { gap:6px !important; }
        .parameter-group--date, .period-tabs { background:linear-gradient(180deg, rgba(0,229,255,.14), rgba(0,229,255,.06)) !important; box-shadow:inset 0 1px 0 rgba(255,255,255,.04), 0 6px 14px rgba(0,0,0,.16); }
        .parameter-group--date { background:linear-gradient(180deg, rgba(0,229,255,.14), rgba(0,229,255,.06)) !important; border-color:rgba(0,229,255,.48) !important; }
        .parameter-group--date .date-picker__button, .parameter-group--date .date-input { background:transparent !important; box-shadow:none !important; }
        .parameter-group--date { background:#173b50 !important; border:1px solid rgba(0,229,255,.62) !important; box-shadow:inset 0 1px 0 rgba(255,255,255,.06), 0 6px 14px rgba(0,0,0,.18) !important; }
        .parameter-group--date { background:color-mix(in srgb, var(--card-background-color, #fff) 88%, var(--primary-color, #00e5ff) 12%) !important; }
        .panel-tabs button.active, .period-tabs button.active { background-position:1px 0 !important; background-size:calc(100% - 1px) 100% !important; background-repeat:no-repeat !important; }
        .parameter-group--date, .period-tabs { box-sizing:border-box !important; background:rgba(15,49,69,.92) !important; border:1px solid rgba(0,229,255,.48) !important; border-radius:12px !important; box-shadow:none !important; }
        .parameter-group--date .date-picker__button { background:transparent !important; }
        .panel-tabs button.active, .period-tabs button.active { border:0 !important; outline:0 !important; box-shadow:none !important; background:linear-gradient(135deg, var(--heros-panel-accent, #00e5ff) 0%, var(--heros-panel-accent-strong, #ff4de8) 100%) !important; background-position:0 0 !important; background-size:100% 100% !important; background-clip:border-box !important; }
        /* Keep button overlays on the exact control pixel grid; hover lift would shift the color by one pixel. */
        .panel-tabs button:hover, .panel-tabs button:focus-visible, .period-tabs button:hover, .period-tabs button:focus-visible, .chart-tools button:hover, .chart-tools button:focus-visible, .operational-report button:hover, .operational-report button:focus-visible, .chart-overview-toggle:hover, .chart-overview-toggle:focus-visible {
          transform:none !important;
        }
        /* Keep active button overlays inside the rounded button edge; this prevents the one-pixel gradient bleed seen across controls. */
        .panel-tabs button, .period-tabs button, .chart-tools button, .operational-report button, .chart-overview-toggle {
          overflow:hidden !important;
          background-clip:padding-box !important;
        }
        .panel-tabs button.active, .period-tabs button.active, .chart-tools button.active, .operational-report button.active {
          background-position:0 0 !important;
          background-size:100% 100% !important;
        }
        /* Date and period controls deliberately share one container treatment. */
        .parameter-group--date.control-group, .period-tabs.control-group {
          box-sizing:border-box !important;
          background:linear-gradient(180deg, rgba(0,229,255,.14) 0%, rgba(0,229,255,.06) 100%) !important;
          background-color:rgba(0,229,255,.08) !important;
          border:1px solid rgba(0,229,255,.48) !important;
          border-radius:12px !important;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.04), 0 6px 14px rgba(0,0,0,.16) !important;
        }
        .parameter-group--date.control-group .date-picker__button,
        .parameter-group--date.control-group .date-input {
          background:transparent !important;
          background-image:none !important;
          box-shadow:none !important;
        }
        /* The group carries the fill; the date value itself remains unfilled. */
        .chart-tools--date {
          border:0 !important;
          padding:0 !important;
          background:transparent !important;
          box-shadow:none !important;
        }
        .parameter-group--date.control-group .date-picker__button,
        .parameter-group--date.control-group .date-input {
          background:rgba(5,15,27,.9) !important;
          background-image:none !important;
          border-color:rgba(0,229,255,.24) !important;
          box-shadow:none !important;
        }
        .ring-card { position:relative; overflow:visible !important; cursor:default; }
        .ring-card:has(.hero-breakdown) { cursor:help; }
        .hero-breakdown { position:absolute; z-index:30; top:100%; left:50%; width:min(230px, calc(100vw - 40px)); max-height:230px; overflow:auto; transform:translate(-50%, -1px); padding:7px; border:1px solid rgba(0,229,255,.48); border-radius:10px; background:#071321; box-shadow:0 12px 28px rgba(0,0,0,.42); color:var(--primary-text-color,#fff); text-align:left; opacity:0; visibility:hidden; pointer-events:auto; transition:opacity .14s ease, transform .14s ease; }
        .ring-card:hover .hero-breakdown, .ring-card:focus-visible .hero-breakdown { opacity:1; visibility:visible; transform:translate(-50%, 0); }
        .hero-breakdown__sticky { position:sticky; z-index:1; top:-7px; margin:-7px -7px 4px; padding:7px 7px 4px; background:#071321; border-bottom:1px solid rgba(0,229,255,.2); }
        .hero-breakdown__title { margin-bottom:4px; font-size:.72rem; font-weight:800; }
        .hero-breakdown__head, .hero-breakdown__row { display:grid; grid-template-columns:44px minmax(0,1fr) minmax(0,1fr); gap:4px; align-items:baseline; }
        .hero-breakdown__head { margin-bottom:0; color:var(--secondary-text-color,#b9c7d8); font-size:.56rem; font-weight:800; text-transform:uppercase; }
        .hero-breakdown__row { padding:2px 0; border-top:1px solid rgba(0,229,255,.11); font-size:.66rem; }
        .hero-breakdown__row strong, .hero-breakdown__row em { text-align:right; font-style:normal; font-weight:700; }
        .hero-breakdown__row em { color:var(--secondary-text-color,#b9c7d8); }
        .hero-breakdown__head > :nth-child(n+2), .hero-breakdown__row > :nth-child(n+2) { border-left:1px solid rgba(0,229,255,.18); padding-left:5px; }
        .hero-breakdown__head > :nth-child(n+2) { text-align:right; }
        .hero-breakdown__row--endpoint { border-top-color:rgba(0,229,255,.46); background:rgba(0,229,255,.08); }
        .hero-breakdown__row--endpoint em { color:var(--primary-text-color,#fff); } .hero-breakdown--soc { left:0; width:min(185px, calc(100vw - 28px)); transform:translate(0, -1px); } .ring-card:hover .hero-breakdown--soc, .ring-card:focus-visible .hero-breakdown--soc { transform:translate(0, 0); } .hero-breakdown--soc .hero-breakdown__head, .hero-breakdown--soc .hero-breakdown__row { grid-template-columns:36px minmax(0,1fr) minmax(0,1fr); gap:3px; } .hero-breakdown--soc .hero-breakdown__head > :nth-child(n+2), .hero-breakdown--soc .hero-breakdown__row > :nth-child(n+2) { padding-left:4px; } .ring-card:nth-last-child(-n+2) .hero-breakdown:not(.hero-breakdown--soc) { left:auto; right:0; transform:translate(0, -1px); } .ring-card:nth-last-child(-n+2):hover .hero-breakdown:not(.hero-breakdown--soc), .ring-card:nth-last-child(-n+2):focus-visible .hero-breakdown:not(.hero-breakdown--soc) { transform:translate(0, 0); }        /* Operational chart standard: explicit units, aligned guides, and dedicated axes. */
        .operational-chart { display:grid; grid-template-columns:auto minmax(0,1fr); gap:8px; align-items:stretch; }
        .operational-chart__y-title { writing-mode:vertical-rl; transform:rotate(180deg); align-self:center; color:var(--secondary-text-color,#9ab2c7); font-size:.78rem; font-weight:800; letter-spacing:.02em; }
        .operational-chart__plot { position:relative; display:grid; grid-template-columns:38px minmax(0,1fr); grid-template-rows:163px auto; min-width:0; padding:12px 8px; overflow-x:auto; }
        .operational-chart__plot::before { content:""; position:absolute; z-index:0; left:38px; right:8px; top:12px; height:163px; background:repeating-linear-gradient(to bottom, rgba(113,190,220,.24) 0, rgba(113,190,220,.24) 1px, transparent 1px, transparent 25%); pointer-events:none; }
        .operational-chart__y-axis { position:relative; z-index:1; grid-column:1; grid-row:1; width:auto; height:163px; display:flex; flex-direction:column; justify-content:space-between; color:var(--secondary-text-color,#9ab2c7); font-size:.7rem; font-weight:700; text-align:right; }
        .operational-report__bars { position:relative; z-index:1; grid-column:2; grid-row:1; display:flex; align-items:flex-end; gap:14px; min-height:163px; min-width:max-content; padding:0 8px; border-bottom:1px solid rgba(255,255,255,.25); }
        .operational-report__bar { position:relative; display:flex; flex:1 1 70px; width:70px; min-width:70px; height:163px; flex-direction:column; align-items:center; justify-content:flex-end; gap:5px; outline:none; }
        .operational-report__bar i { display:block; width:34px; height:var(--bar-height); min-height:8px; border-radius:6px 6px 2px 2px; background:linear-gradient(180deg,#ff4de8,#00d9ff); }
        .operational-report__bar span { order:3; color:var(--secondary-text-color,#9ab2c7); font-size:.76rem; white-space:nowrap; }
        .operational-report__bar b { order:2; font-size:.9rem; }
        .operational-report__bar .operational-report__tooltip { position:absolute; z-index:4; left:50%; bottom:calc(var(--bar-height) + 34px); transform:translateX(-50%); width:max-content; max-width:180px; padding:7px 9px; border:1px solid rgba(0,229,255,.35); border-radius:8px; background:rgba(7,20,35,.98); color:var(--heros-panel-text,#f4fbff); font-size:.75rem; font-style:normal; opacity:0; pointer-events:none; transition:opacity .12s ease; }
        .operational-report__bar:hover .operational-report__tooltip, .operational-report__bar:focus-visible .operational-report__tooltip { opacity:1; }
        .operational-report__bar:focus-visible { box-shadow:0 0 0 2px var(--heros-panel-accent,#00e5ff); border-radius:6px; }
        .operational-chart__x-title { display:block; position:relative; z-index:1; grid-column:2; grid-row:2; margin-top:8px; color:var(--secondary-text-color,#9ab2c7); font-size:.78rem; font-weight:800; text-align:center; }
        .operational-report__legend { display:flex; flex-wrap:wrap; gap:12px 20px; margin-top:12px; color:var(--secondary-text-color,#9ab2c7); font-size:.8rem; font-weight:700; }
        .operational-report__legend i { display:inline-block; width:9px; height:9px; margin-right:6px; border-radius:50%; background:#ff4de8; }
        @media (max-width:720px) { .operational-report__plot { min-width:560px; } .operational-report__heading { flex-direction:column; } .operational-report__count { text-align:left; } }
        .field-help--rich { cursor:help; } .field-help--rich::after { display:none; } .field-help__panel { position:absolute; z-index:31; left:50%; top:100%; width:min(340px,calc(100vw - 32px)); max-height:360px; overflow:auto; padding:12px 14px; border:1px solid rgba(0,229,255,.62); border-radius:10px; background:rgba(7,18,34,.98); color:rgba(225,241,255,.98); box-shadow:0 10px 28px rgba(0,0,0,.42),0 0 18px rgba(0,229,255,.12); font-size:12px; font-weight:500; line-height:1.35; text-align:left; opacity:0; visibility:hidden; pointer-events:auto; transform:translate(-50%, -4px); transition:opacity .15s ease, transform .15s ease, visibility .15s ease; } .field-help--rich:hover .field-help__panel, .field-help--rich:focus-visible .field-help__panel { opacity:1; visibility:visible; transform:translate(-50%, 0); } .field-help__panel > strong { display:block; margin-bottom:4px; font-weight:800; } .field-help__section { display:grid; grid-template-columns:minmax(92px,.8fr) minmax(0,1.4fr); gap:8px; margin-top:14px; padding-top:12px; border-top:1px solid rgba(0,229,255,.18); } .field-help__section strong { font-weight:800; color:#fff; } .field-help__section span { color:rgba(225,241,255,.92); }
        /* Solar Compare axis labels stay in their dedicated rows and never inherit bar sizing. */
        .analysis-solar-compare > .analysis-solar-compare__y-title { display:flex; height:150px; align-items:center; justify-content:center; gap:initial; }
        .analysis-solar-compare > .analysis-solar-compare__x-title { display:block; height:auto; align-items:initial; justify-content:initial; gap:initial; }        .analysis-solar-compare__axis > span { display:block; height:auto; align-items:initial; justify-content:initial; gap:initial; line-height:1; white-space:nowrap; }
        /* Shared report-chart standard: Solar legend matches Power Diagram typography and explainers have clear separation. */
        .analysis-chart-legend { gap:8px; font-size:.875rem; } .analysis-chart-legend__group { gap:6px; } .analysis-chart-legend span { gap:8px; }
        .chart-layout + .chart-explainer { margin-top:12px !important; transform:none !important; }
        /* Operational chart labels occupy the zero-line position; event counts remain available through hover text. */
        .operational-report__bar { gap:0; } .operational-report__bars { overflow:visible; } .operational-report__bar span { position:absolute; top:calc(100% + 7px); order:2; margin:0; } .operational-chart__x-title { margin-top:32px; }
        /* The Power and Statistical Diagram use one visible frame, axis domain, and legend text scale. */
        .legend-chip,.analysis-chart-legend { font-size:.875rem; }
        .stats-diagram--chart { margin-left:0; margin-right:0; }
</style>
      <ha-card class="report-card">
        <div class="shell">
          <div class="title-row">
            <div class="title-icon">&#9889;</div>
            <div class="title">HEROS Report</div>
                ${this._config?.show_version_numbers !== false ? `<div class="version-badge">v${HEROS_REPORT_CARD_BUILD}</div>` : ""}
          </div>
          <div data-report-body>
            ${this._renderReportBody(reporting)}
          </div>
        </div>
      </ha-card>
    `;
    this._bindEvents();
    this._scheduleChartViewportMeasurement();
  }

  _bindEvents() {
    this.shadowRoot.querySelector("[data-overview-report-toggle]")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.onOverviewReportToggle?.();
    });
    this.shadowRoot.querySelectorAll("[data-view]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this._view = button.dataset.view;
        this._hassRenderSignature = this._renderSignature();
        this.render();
      });
    });
    this.shadowRoot.querySelectorAll("[data-operational-period]").forEach((button) => button.addEventListener("click", (event) => { event.preventDefault(); this._operationalPeriod = button.dataset.operationalPeriod || "month"; this.render(); }));
    this.shadowRoot.querySelectorAll("[data-analysis-period]").forEach((button) => button.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); this._analysisPeriod = button.dataset.analysisPeriod || "day"; this._historySelectedDate = this._selectedReportDate(); this._historyRequestedKey = ""; this.render(); }));
    this.shadowRoot.querySelectorAll("[data-statistical-period]").forEach((button) => button.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); this._statisticalPeriod = button.dataset.statisticalPeriod || "24h"; this._skipHistoryRefreshOnce = true; this._hassRenderSignature = this._renderSignature(); this.render(); }));
    this.shadowRoot.querySelectorAll("[data-statistical-shift]").forEach((button) => button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const direction = Number(button.dataset.statisticalShift);
      const period = this._statisticalPeriod || "24h";
      const span = { "1h": 60, "6h": 360, "12h": 720 }[period];
      const date = this._parseLocalDate(this._selectedReportDate());
      if (!date || !Number.isFinite(direction)) return;
      if (span) {
        const model = this._chartInteractionModel?.statisticalWindow;
        let start = model?.startMinutes ?? Math.max(0, this._historyFocusMinutes() - span / 2);
        start += direction * span;
        while (start < 0) { date.setDate(date.getDate() - 1); start += 1440; }
        while (start >= 1440) { date.setDate(date.getDate() + 1); start -= 1440; }
        if (date > this._todayLocalDate()) return;
        const nextDate = this._formatLocalDate(date);
        this._statisticalNavigation = { key: nextDate + "|" + period, start: Math.min(1440 - span, start) };
      } else {
        date.setDate(date.getDate() + direction * ({ "24h": 1, day: 1, week: 7, month: 31, quarter: 92, year: 366 }[period] || 1));
        if (date > this._todayLocalDate()) date.setTime(this._todayLocalDate().getTime());
        this._statisticalNavigation = null;
      }
      this._historySelectedDate = this._formatLocalDate(date);
      this._historyRequestedKey = "";
      this._resetChartHoverState();
      this.render();
      if (this._historyConfigured()) this._ensureHistoryForSelectedDate();
    }));
    this.shadowRoot.querySelectorAll("[data-power-shift]").forEach((button) => button.addEventListener("click", (event) => {
      event.preventDefault(); event.stopPropagation();
      const direction = Number(button.dataset.powerShift); const span = this._chartPeriodMinutes(); const date = this._parseLocalDate(this._selectedReportDate());
      if (!date || !Number.isFinite(direction)) return;
      if (span < 1440) {
        const window = this._chartWindowConfig(this._chartInteractionModel?.reporting?.power_diagram?.time || [], this._chartInteractionModel?.reporting || {});
        let start = window.startMinutes + direction * span;
        while (start < 0) { date.setDate(date.getDate() - 1); start += 1440; }
        while (start >= 1440) { date.setDate(date.getDate() + 1); start -= 1440; }
        if (date > this._todayLocalDate()) return;
        this._timelineNavigation = { key: this._formatLocalDate(date) + "|" + this._periodPreset, start: Math.min(1440 - span, start) };
      } else { const days = { day:1, "24h":1, week:7, month:31, quarter:92, year:366 }[this._periodPreset] || 1; date.setDate(date.getDate() + direction * days); if (date > this._todayLocalDate()) date.setTime(this._todayLocalDate().getTime()); }
      this._historySelectedDate = this._formatLocalDate(date); this._historyRequestedKey = ""; this._resetChartHoverState(); this.render(); if (this._historyConfigured()) this._ensureHistoryForSelectedDate();
    }));
    this.shadowRoot.querySelectorAll("[data-operational-shift]").forEach((button) => button.addEventListener("click", (event) => {
      event.preventDefault(); event.stopPropagation(); const date = this._parseLocalDate(this._selectedReportDate()); const direction = Number(button.dataset.operationalShift); if (!date || !Number.isFinite(direction)) return;
      const days = { "1h": 1, "6h": 1, "12h": 1, "24h": 1, day: 1, week: 7, month: 31, quarter: 92, year: 366 }[this._operationalPeriod || "month"] || 1;
      date.setDate(date.getDate() + direction * days); if (date > this._todayLocalDate()) date.setTime(this._todayLocalDate().getTime());
      this._historySelectedDate = this._formatLocalDate(date); this._historyRequestedKey = ""; this.render(); if (this._historyConfigured()) this._ensureHistoryForSelectedDate();
    }));
    if (HEROS_ANALYSIS_VIEWS.has(this._view)) {
      const analysisKind = this._view;
      this.shadowRoot.querySelectorAll(`[data-${analysisKind}-shift]`).forEach((button) => button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const date = this._parseLocalDate(this._selectedReportDate());
        const direction = Number(button.getAttribute(`data-${analysisKind}-shift`));
        if (!date || !Number.isFinite(direction)) return;
        const days = { "1h": 1, "6h": 1, "12h": 1, "24h": 1, day: 1, week: 7, month: 31, quarter: 92, year: 366 }[this._analysisPeriod || "day"] || 1;
        date.setDate(date.getDate() + direction * days);
        if (date > this._todayLocalDate()) date.setTime(this._todayLocalDate().getTime());
        this._historySelectedDate = this._formatLocalDate(date);
        this._historyRequestedKey = "";
        this.render();
        if (this._historyConfigured()) this._ensureHistoryForSelectedDate();
      }));
    }
    this.shadowRoot.querySelectorAll("[data-period]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const next = String(button.dataset.period || "24h").trim().toLowerCase();
        if (!next || next === this._periodPreset) {
          return;
        }
        this._periodPreset = next;
        this._periodInteractionAt = Date.now();
        // Period changes only need a local chart redraw. Keep the history
        // service refresh off this interaction path so the new axis appears
        // immediately.
        this._skipHistoryRefreshOnce = true;
        if (!this._isTodaySelection(this._selectedReportDate())) {
          const anchor = this._normalizedFocusTime(this._chartAnchorTime || this._lastChartHoverTime || this._historyFocusTime);
          this._chartAnchorTime = anchor;
          this._historyFocusTime = anchor;
        }
        this._hassRenderSignature = this._renderSignature();
        this.render();
      });
    });
    this.shadowRoot.querySelectorAll("[data-series]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const key = button.dataset.series;
        this._activeSeries[key] = !(this._activeSeries[key] !== false);
        this._applySeriesVisibility();
        if (this._chartLastHoverEvent) {
          this._showChartTooltip(this._chartLastHoverEvent);
        }
      });
    });
    this.shadowRoot.querySelectorAll("[data-chart-stage], svg.chart, [data-chart-hit-target]").forEach((target) => {
      target.addEventListener("pointerenter", (event) => {
        this._resetChartHoverState();
        this._chartLastHoverEvent = event;
        this._queueChartTooltip(event);
      });
      target.addEventListener("pointerover", (event) => {
        this._chartLastHoverEvent = event;
        this._queueChartTooltip(event);
      });
      target.addEventListener("pointermove", (event) => {
        this._chartLastHoverEvent = event;
        this._queueChartTooltip(event);
      });
      target.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof target.releasePointerCapture === "function" && target.hasPointerCapture?.(event.pointerId)) {
          target.releasePointerCapture(event.pointerId);
        }
      });
      target.addEventListener("mousemove", (event) => {
        this._chartLastHoverEvent = event;
        this._queueChartTooltip(event);
      });
      target.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this._commitChartAnchorFromEvent(event);
      });
    });
    this.shadowRoot.querySelector("[data-chart-stage]")?.addEventListener("pointerleave", () => {
      this._resetChartHoverState();
    });
    this.shadowRoot.onmousemove = (event) => {
      if (this._eventInsideChartStage(event)) {
        this._chartLastHoverEvent = event;
        this._queueChartTooltip(event);
      }
    };
    this.shadowRoot.onpointerdown = (event) => {
      if (!this._eventWithinChartStageBounds(event)) {
        this._resetChartHoverState();
      }
    };
    this.shadowRoot.querySelector("[data-download-report]")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this._downloadCsv();
    });
    this.shadowRoot.querySelectorAll("[data-tariff-period]").forEach((button) => button.addEventListener("click", (event) => {
      event.preventDefault(); event.stopPropagation();
      const navigationAnchor = this._tariffNavigationAnchor();
      this._tariffPeriod = String(button.dataset.tariffPeriod || "day");
      this._setTariffNavigationDate(navigationAnchor, this._tariffPeriod);
      this.render(); if (this._historyConfigured()) this._ensureHistoryForSelectedDate();
    }));
    this.shadowRoot.querySelectorAll("[data-date-picker-open]").forEach((button) => button.addEventListener("click", (event) => {
      event.preventDefault(); event.stopPropagation();
      const attribute = String(button.dataset.datePickerOpen || "");
      const input = attribute ? this.shadowRoot.querySelector(`[${attribute}]`) : null;
      if (!input) return;
      try { if (typeof input.showPicker === "function") input.showPicker(); else { input.focus(); input.click(); } } catch (_) { input.focus(); input.click(); }
    }));
    this.shadowRoot.querySelector("[data-tariff-date]")?.addEventListener("change", (event) => {
      event.preventDefault(); event.stopPropagation(); const value = String(event.target?.value || "");
      let date = this._parseLocalDate(value) || this._todayLocalDate();
      if (this._tariffPeriod === "quarter") { const parts=value.split("-"); date = new Date(Number(parts[0]), (Number(parts[1])-1)*3, 1); }
      if (this._tariffPeriod === "year") date = new Date(Number(value), 0, 1);
      this._setTariffNavigationDate(date, this._tariffPeriod); this.render(); if (this._historyConfigured()) this._ensureHistoryForSelectedDate();
    });
    this.shadowRoot.querySelectorAll("[data-tariff-shift]").forEach((button) => button.addEventListener("click", (event) => {
      event.preventDefault(); event.stopPropagation(); const date=this._tariffNavigationAnchor(); const step=Number(button.dataset.tariffShift||0);
      if(this._tariffPeriod === "week") date.setDate(date.getDate()+step*7); else if(this._tariffPeriod === "month") date.setMonth(date.getMonth()+step); else if(this._tariffPeriod === "quarter") date.setMonth(date.getMonth()+step*3); else if(this._tariffPeriod === "year") date.setFullYear(date.getFullYear()+step); else date.setDate(date.getDate()+step);
      this._setTariffNavigationDate(date, this._tariffPeriod); this.render(); if (this._historyConfigured()) this._ensureHistoryForSelectedDate();
    }));    this.shadowRoot.querySelector("[data-report-date]")?.addEventListener("change", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const value = String(event.target?.value || "").trim();
      const parsed = this._parseLocalDate(value) || this._todayLocalDate();
      const clamped = parsed > this._todayLocalDate() ? this._todayLocalDate() : parsed;
      this._historySelectedDate = this._formatLocalDate(clamped);
      this._resetHistoricalPeriodForDate(this._historySelectedDate);
      this._historyRequestedKey = "";
      this._hassRenderSignature = this._renderSignature();
      this.render();
      if (this._historyConfigured()) {
        await this._ensureHistoryForSelectedDate();
      }
    });
    this.shadowRoot.querySelectorAll("[data-shift-date]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const step = Number(button.dataset.shiftDate || 0);
        const current = this._parseLocalDate(this._selectedReportDate()) || this._todayLocalDate();
        const shifted = new Date(current.getFullYear(), current.getMonth(), current.getDate());
        shifted.setDate(shifted.getDate() + step);
        const clamped = shifted > this._todayLocalDate() ? this._todayLocalDate() : shifted;
        this._historySelectedDate = this._formatLocalDate(clamped);
        this._resetHistoricalPeriodForDate(this._historySelectedDate);
        this._historyRequestedKey = "";
        this._hassRenderSignature = this._renderSignature();
        this.render();
        if (this._historyConfigured()) {
          await this._ensureHistoryForSelectedDate();
        }
      });
    });
    this.shadowRoot.querySelector("[data-chart-focus-time]")?.addEventListener("change", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this._historyFocusTime = this._normalizedFocusTime(event.target?.value || this._historyFocusTime);
      this._chartAnchorTime = this._historyFocusTime;
      this._hassRenderSignature = this._renderSignature();
      this.render();
    });
    this._applySeriesVisibility();
  }

  _escape(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
}

if (typeof customElements !== "undefined") {
  if (!customElements.get("heros-report-card")) {
    customElements.define("heros-report-card", ByteWattReportCard);
  }
  if (!customElements.get(HEROS_REPORT_CARD_TAG)) {
    customElements.define(
      HEROS_REPORT_CARD_TAG,
      class extends ByteWattReportCard {},
    );
  }
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "heros-report-card",
  name: "HEROS Report Card",
  description: `HEROS reporting card build ${HEROS_REPORT_CARD_BUILD}.`,
});

window.herosReportCardBuild = HEROS_REPORT_CARD_BUILD;
window.herosReportCardTag = HEROS_REPORT_CARD_TAG;




