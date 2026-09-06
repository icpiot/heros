const HEROS_REPORT_CARD_BUILD = "086";
const TODAY_HISTORY_REFRESH_MS = 60_000;
const HEROS_REPORT_CARD_TAG = `heros-report-card-${HEROS_REPORT_CARD_BUILD}`;
const HEROS_REPORT_PERIODS = [
  { value: "1h", label: "1H", minutes: 60 },
  { value: "6h", label: "6H", minutes: 360 },
  { value: "12h", label: "12H", minutes: 720 },
  { value: "24h", label: "24H", minutes: 1440 },
];

class ByteWattReportCard extends HTMLElement {
  setConfig(config) {
    const prefix = config?.entity_prefix || "heros";
    this._config = {
      entity_prefix: prefix,
      settings_target: config?.settings_target || `select.house_${prefix}_settings_target`,
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
    const match = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
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
    const match = text.match(/^(\d{1,2}:\d{2})(?::\d{2})?$/);
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
    return {
      requested,
      key: requested,
      scope: scopes?.[requested] || null,
    };
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

  _historyRecordNeedsRefresh(record, selectedDate = this._selectedReportDate()) {
    if (!record || this._isTodaySelection(selectedDate)) {
      return false;
    }
    return this._powerDiagramHasTrailingPlaceholderTail(this._powerDiagramFromRecord(record));
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
        load_consumption: live.house_consumption ?? summary.load_consumption ?? null,
        grid_consumption: selection.aggregate
          ? summary.grid_consumption ?? null
          : live.grid_power ?? summary.grid_consumption ?? null,
        solar_generation: selection.aggregate
          ? summary.solar_generation ?? null
          : live.pv_power ?? summary.solar_generation ?? null,
        feed_in: selection.aggregate
          ? summary.feed_in ?? null
          : Math.max(0, -(Number(live.grid_power) || 0)),
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
        load: [],
        solar: [],
        feed_in: [],
        grid_import: [],
        consumed: [],
      };
    const values = {
      bat: live.soc ?? 0,
      battery: live.battery_power ?? 0,
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
        bat: [live.battery_power ?? 0],
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
    const live = reporting?.live || {};
    const meta = this._selectionMeta();
    const direction = this._batteryDirection(live.battery_power);
    const gridDirection = this._gridDirection(live.grid_power);
    const systemCount = this._systemSummaries().length;
    const scopeLabel = reporting?.aggregate
      ? `All Batteries${systemCount ? ` (${systemCount})` : ""}`
      : reporting?.label || meta.sys_sn || "Battery";
    return `
      <section class="hero-banner">
        <div class="hero-main">
          <div class="hero-kicker">At A Glance</div>
          <div class="hero-title">${this._escape(scopeLabel)}</div>
          <div class="hero-subtitle">${this._escape(live.power_source || "Idle")} | ${direction} | ${gridDirection}</div>
        </div>
        <div class="hero-metrics">
          ${this._heroChip("SOC", this._fmtPercent(live.soc))}
          ${this._heroChip("Battery", this._fmtPower(live.battery_power))}
          ${this._heroChip("Load", this._fmtPower(live.house_consumption))}
          ${this._heroChip("Grid", this._fmtPower(live.grid_power))}
        </div>
      </section>
    `;
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
          : "This view is using the current live ByteWatt API values for the selected scope."
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

  _summaryCards(reporting) {
    const powerSummary = reporting?.power_diagram?.summary || {};
    const today = reporting?.today || {};
    const live = reporting?.live || {};
    const isToday = this._isTodaySelection(reporting?.reporting_date || reporting?.power_diagram?.date || this._selectedReportDate());
    if (!reporting?.aggregate) {
      return [
        this._ring("BAT SOC", this._fmtPercent(isToday ? (live.soc ?? powerSummary.soc) : powerSummary.soc), "bat"),
        this._ring("Battery Power", this._fmtChartPower(powerSummary.battery_power ?? powerSummary.load_consumption, reporting), "load"),
        this._ring("Load", this._fmtChartPower(powerSummary.load_consumption, reporting), "feed"),
      ];
    }
    return [
      this._ring("Generation", this._fmtEnergy(isToday ? (today.solar_generation ?? powerSummary.solar_generation) : powerSummary.solar_generation), "solar"),
      this._ring("Consumption", this._fmtEnergy(isToday ? (today.load_consumption ?? powerSummary.load_consumption) : powerSummary.load_consumption), "load"),
      this._ring("BAT SOC", this._fmtPercent(isToday ? (live.soc ?? powerSummary.soc) : powerSummary.soc), "bat"),
      this._ring("Feed-in", this._fmtEnergy(isToday ? (today.feed_in ?? powerSummary.feed_in) : powerSummary.feed_in), "feed"),
      this._ring("Grid Consumption", this._fmtEnergy(isToday ? (today.grid_consumption ?? powerSummary.grid_consumption) : powerSummary.grid_consumption), "grid"),
    ];
  }

  _visibleSeriesKeys(reporting) {
    const powerDiagram = reporting?.power_diagram || {};
    const summary = powerDiagram.summary || {};
    const series = powerDiagram.series || {};
    const hasUsefulValues = (values) => (Array.isArray(values) ? values : []).some((value) => Number.isFinite(Number(value)) && Number(value) !== 0);
    const keys = ["bat"];
    if (hasUsefulValues(series.load) || Number.isFinite(Number(summary.load_consumption))) keys.push("load");
    if (reporting?.aggregate && hasUsefulValues(series.solar)) keys.push("solar");
    if (reporting?.aggregate && hasUsefulValues(series.feed_in)) keys.push("feed_in");
    if (reporting?.aggregate && hasUsefulValues(series.consumed)) keys.push("consumed");
    return keys;
  }

  _powerAxisScale(maxValue) {
    if (!Number.isFinite(maxValue) || maxValue <= 0) {
      return { max: 1, ticks: [0, 0.25, 0.5, 0.75, 1] };
    }
    const rawStep = maxValue / 4;
    const exponent = Math.floor(Math.log10(rawStep));
    const magnitude = 10 ** exponent;
    const candidates = [1, 2, 5, 10].map((multiple) => multiple * magnitude);
    const step = candidates.find((candidate) => candidate >= rawStep) || candidates[candidates.length - 1];
    const axisMax = Math.max(step * 4, step);
    const precision = step < 0.01 ? 4 : step < 0.1 ? 3 : step < 1 ? 2 : 1;
    const ticks = [];
    for (let value = 0; value <= axisMax; value += step) {
      ticks.push(Number(value.toFixed(precision)));
    }
    return {
      max: axisMax,
      ticks: Array.from(new Set(ticks)),
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
    let startMinutes = 0;
    let endMinutes = 24 * 60;
    if (rangeMinutes < 24 * 60) {
      if (isToday) {
        const defaultEnd = this._currentTimeSeriesPoint(new Date(), this._liveRefreshBucketSeconds()).minutesOfDay;
        endMinutes = validMinutes.length ? Math.max(...validMinutes, defaultEnd) : defaultEnd;
        startMinutes = Math.max(0, endMinutes - rangeMinutes);
      } else {
        const anchor = this._historyFocusMinutes();
        const maxStart = Math.max(0, 24 * 60 - rangeMinutes);
        startMinutes = Math.min(Math.max(anchor - rangeMinutes / 2, 0), maxStart);
        endMinutes = Math.min(24 * 60, startMinutes + rangeMinutes);
      }
    }
    const indices = labels
      .map((_, index) => ({ index, minute: minuteValues[index] }))
      .filter(({ minute }) => !Number.isFinite(minute) || (minute >= startMinutes && minute <= endMinutes));
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
    const step = span <= 60 ? 15 : span <= 360 ? 60 : span <= 720 ? 120 : 180;
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
    return ticks;
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
      ? "BAT SOC"
      : key === "load"
        ? "Load"
        : key === "solar"
          ? "Solar"
          : key === "feed_in"
            ? "Feed-in"
            : key === "consumed"
              ? "Consumed"
              : key;
  }

  _formatTooltipSeriesValue(key, value, reporting) {
    if (key === "bat") {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? `${this._fmtNumber(numeric, 2)} %` : "Unavailable";
    }
    return this._fmtChartPower(value, reporting);
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
    const chartSeries = Object.fromEntries(
      seriesKeys.map((key) => [
        key,
        key === "bat"
          ? [...(series[key] || [])]
          : (series[key] || []).map((value) => chartPowerValue(value)),
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
    const allPowerValues = powerKeys.flatMap((key) => filteredSeries[key] || []);
    const powerMax = Math.max(...allPowerValues, 0.1);
    const powerAxis = this._powerAxisScale(powerMax);
    const plotPowerMax = powerAxis.max;
    const width = 900;
    const height = 290;
    const plotWidth = 720;
    const plotHeight = 165;
    const left = 82;
    const top = 28;
    const bottom = top + plotHeight;
    const right = left + plotWidth;
    const formatPowerAxis = (value) => {
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
      plot: { left, top, right, bottom, plotWidth, plotHeight },
      points: Array.from({ length: filteredTimes.length }, (_, index) => {
        const minutes = this._timeLabelToMinutesOfDay(filteredTimes[index]);
        const ratio = Number.isFinite(minutes)
          ? this._chartRatioFromMinutes(minutes, windowConfig.startMinutes, windowConfig.endMinutes)
          : this._seriesPointRatio(filteredTimes, index, filteredTimes.length);
        const x = left + plotWidth * ratio;
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
          const plottedValue = key === "bat" ? numeric : chartPowerValue(rawValue);
          const maxValue = key === "bat" ? 100 : plotPowerMax;
          const y = bottom - (plottedValue / Math.max(maxValue, 1)) * plotHeight;
          markers[key] = { x, y, rawValue };
        });
        return {
          index,
          x,
          label: this._displayTimeLabel(filteredTimes[index] || this._formatTimeLabel(new Date())),
          values,
          markers,
        };
      }),
    };
    const animateClass = this._chartShouldAnimate ? " chart--refresh" : "";

    const area = (values, labels, maxValue, fill, stroke, options = {}) => {
      if (!values.length) return "";
      const fillOpacity = options.fillOpacity ?? 0.24;
      const strokeWidth = options.strokeWidth ?? 1.7;
      const points = values
        .map((value, index) => {
          const minutes = this._timeLabelToMinutesOfDay(labels[index]);
          const ratio = Number.isFinite(minutes)
            ? this._chartRatioFromMinutes(minutes, windowConfig.startMinutes, windowConfig.endMinutes)
            : this._seriesPointRatio(labels, index, values.length);
          const x = left + plotWidth * ratio;
          const y = bottom - ((Number(value) || 0) / Math.max(maxValue, 1)) * plotHeight;
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
      const start = `${left + plotWidth * startRatio},${bottom}`;
      const end = `${left + plotWidth * endRatio},${bottom}`;
      return `<polygon points="${start} ${points} ${end}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" fill-opacity="${fillOpacity}"></polygon>`;
    };

    const line = (values, labels, maxValue, stroke, options = {}) => {
      if (!values.length) return "";
      const strokeWidth = options.strokeWidth ?? 1.8;
      const strokeOpacity = options.strokeOpacity ?? 0.92;
      const points = values
        .map((value, index) => {
          const minutes = this._timeLabelToMinutesOfDay(labels[index]);
          const ratio = Number.isFinite(minutes)
            ? this._chartRatioFromMinutes(minutes, windowConfig.startMinutes, windowConfig.endMinutes)
            : this._seriesPointRatio(labels, index, values.length);
          const x = left + plotWidth * ratio;
          const y = bottom - ((Number(value) || 0) / Math.max(maxValue, 1)) * plotHeight;
          return `${x},${y}`;
        })
        .join(" ");
      return `<polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-opacity="${strokeOpacity}" stroke-linejoin="round" stroke-linecap="round"></polyline>`;
    };

    const palette = {
      bat: ["rgba(152, 211, 91, 0.5)", "#98d35b"],
      load: ["rgba(111, 214, 235, 0.4)", "#6fd6eb"],
      solar: ["rgba(255, 209, 60, 0.46)", "#ffd13c"],
      feed_in: ["rgba(255, 143, 62, 0.36)", "#ff8f3e"],
      consumed: ["rgba(211, 157, 108, 0.32)", "#d39d6c"],
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
    const selectionLabel = selection?.aggregate
      ? "All Batteries"
      : String(selection?.remark || selection?.sys_sn || selection?.label || "Selected battery");
    const historyNotice = this._historyConfigured() && selectedDate
      ? selectedHistoryRecord
        ? this._isTodaySelection(selectedDate)
          ? `<div class="chart-history-note">Today's time-series report loaded through ${this._escape(this._displayTimeLabel(powerDiagram.meta?.loaded_through || this._formatTimeLabel(new Date())))}.</div>`
          : historyNeedsRefresh
            ? `<div class="chart-history-note chart-history-note--warn">Archived report for ${this._escape(selectedDate)} is incomplete after ${this._escape(historyLoadedThrough || "the last valid point")}; HEROS has requested a forced refresh.</div>`
            : `<div class="chart-history-note">Archived report loaded for ${this._escape(selectedDate)}.</div>`
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
                </div>
                ${this._view === "power" ? `
                  <div class="period-tabs">
                    ${HEROS_REPORT_PERIODS.map((period) => `
                      <button type="button" class="${this._periodPreset === period.value ? "active" : ""}" data-period="${period.value}">${period.label}</button>
                    `).join("")}
                  </div>
                ` : ""}
              </div>
              <div class="chart-toolbar chart-toolbar--meta">
                <span class="chart-selection-pill" title="Chart follows the selected battery">${this._escape(selectionLabel)}</span>
              </div>
            </div>
            <div class="chart-header__row chart-header__row--secondary">
              <div class="chart-tools chart-tools--date">
              <button class="date-nav" type="button" data-shift-date="-1" aria-label="Previous day">&#8249;</button>
              <input class="date-input" type="date" data-report-date value="${this._escape(selectedDateLabel)}" max="${this._escape(todayValue)}">
              <button class="date-nav" type="button" data-shift-date="1" aria-label="Next day">&#8250;</button>
              ${showHistoryFocusTime ? `
                <label class="focus-time-control">
                  <span>Focus</span>
                  <input type="time" data-chart-focus-time value="${this._escape(this._normalizedFocusTime(this._historyFocusTime))}" step="900">
                </label>
              ` : ""}
            </div>
            <div class="chart-tools chart-tools--action">
              <button type="button" class="download-btn" data-download-report>Download CSV</button>
            </div>
          </div>
        </div>
        ${historyNotice}
        ${
          this._view === "power"
            ? `
          <div class="ring-grid">
            ${this._summaryCards(reporting).join("")}
          </div>
          <div class="chart-stage" data-chart-stage>
            <svg class="chart${animateClass}" viewBox="0 0 ${width} ${height}" role="img" aria-label="HEROS power diagram chart">
              <line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" class="axis"></line>
              <line x1="${left}" y1="${top}" x2="${left}" y2="${bottom}" class="axis"></line>
              <line x1="${right}" y1="${top}" x2="${right}" y2="${bottom}" class="axis axis-soc"></line>
              ${powerTicks
                .map((point) => {
                  const ratio = plotPowerMax > 0 ? point / plotPowerMax : 0;
                  const y = bottom - ratio * plotHeight;
                  return `
                    <line x1="${left}" y1="${y}" x2="${right}" y2="${y}" class="grid"></line>
                    <text x="${left - 10}" y="${y + 4}" class="tick tick-left" text-anchor="end">${this._escape(formatPowerAxis(point))}</text>
                    <text x="${right + 10}" y="${y + 4}" class="tick tick-right" text-anchor="start">${Math.round(ratio * 100)}%</text>
                  `;
                })
                .join("")}
              ${batKeys
                .map((key) => {
                  const values = filteredSeries[key] || [];
                  return `<g class="chart-series-layer chart-series-layer--soc" data-chart-series="${key}">${area(values, filteredTimes, 100, palette[key][0], palette[key][1], { fillOpacity: 0.3, strokeWidth: 1 })}${line(values, filteredTimes, 100, palette[key][1], { strokeWidth: 1.4, strokeOpacity: 0.72 })}</g>`;
                })
                .join("")}
              ${flowKeys
                .map((key) => {
                  const values = filteredSeries[key] || [];
                  return `<g class="chart-series-layer chart-series-layer--flow" data-chart-series="${key}">${area(values, filteredTimes, plotPowerMax, palette[key][0], palette[key][1])}${line(values, filteredTimes, plotPowerMax, palette[key][1])}</g>`;
                })
                .join("")}
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
          <div class="legend-row">
            ${seriesKeys
              .map((key) => this._legendButton(this._seriesDisplayLabel(key), key))
              .join("")}
          </div>
          <div class="chart-explainer">
            Left axis shows power in kW, with sub-1kW values labelled in W. Right axis shows BAT SOC percent.
          </div>
        `
            : this._renderStatsDiagram(reporting)
        }
      </section>
    `;
  }

  _renderStatsDiagram(reporting) {
    const today = reporting?.today || {};
    const rows = [
      { label: "Solar Generation", value: Number(today.solar_generation) || 0, display: this._fmtEnergy(today.solar_generation), tone: "solar" },
      { label: "Load Consumption", value: Number(today.load_consumption) || 0, display: this._fmtEnergy(today.load_consumption), tone: "load" },
      { label: "Battery Charged", value: Number(today.battery_charge) || 0, display: this._fmtEnergy(today.battery_charge), tone: "battery" },
      { label: "Battery Discharge", value: Number(today.battery_discharge) || 0, display: this._fmtEnergy(today.battery_discharge), tone: "battery" },
      { label: "Feed-in", value: Number(today.feed_in) || 0, display: this._fmtEnergy(today.feed_in), tone: "feed" },
      { label: "Grid Consumption", value: Number(today.grid_consumption) || 0, display: this._fmtEnergy(today.grid_consumption), tone: "grid" },
      { label: "Self Consumption", value: Number(today.self_consumption) || 0, display: this._fmtPercent(today.self_consumption), tone: "info", scaleLabel: "%" },
      { label: "Self Sufficiency", value: Number(today.self_sufficiency) || 0, display: this._fmtPercent(today.self_sufficiency), tone: "info", scaleLabel: "%" },
    ];
    const maxValue = Math.max(...rows.map((row) => row.value), 1);
    return `
      <div class="stats-diagram">
        ${rows.map((row) => this._statsBar(row, maxValue)).join("")}
      </div>
    `;
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

  _ring(label, value, kind) {
    return `
      <div class="ring-card ring-card--${kind}">
        <div class="ring-value">${value}</div>
        <div class="ring-label">${label}</div>
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
    return `
      <div class="chart-tooltip__time">${this._escape(point.label)}</div>
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
    const viewBox = this._chartInteractionModel.viewBox || { width: 900, height: 290 };
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
    if (!this._isFullDayPeriod()) {
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
    const shouldRefreshTodayHistory = this._historyConfigured()
      && this._isTodaySelection(displayState.selectedDate)
      && !this._historyLoading;
    if ((displayState.missingHistory || shouldRefreshTodayHistory) && !this._historyLoading) {
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
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap:10px;
        }
        .aggregate-card,
        .stat-card,
        .hero-banner {
          background:var(--card-background-color, #fff);
          border-radius:18px;
          border:1px solid color-mix(in srgb, var(--divider-color, rgba(51, 92, 140, 0.12)) 72%, transparent);
          padding:10px 12px;
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
          gap:12px;
          margin-bottom:14px;
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
        .chart-history-note {
          margin:-2px 0 8px;
          color:var(--secondary-text-color, #486782);
          font-size:0.82rem;
          font-weight:700;
        }
        .chart-history-note--warn {
          color:color-mix(in srgb, #916000 85%, var(--secondary-text-color, #916000));
        }
        .chart-header { margin-bottom:10px; display:grid; gap:6px; }
        .chart-header__row { display:flex; align-items:center; gap:8px; justify-content:space-between; flex-wrap:wrap; }
        .panel-tabs,
        .period-tabs { display:flex; gap:6px; flex-wrap:wrap; }
        .chart-tools { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
        .chart-tools--date { justify-content:flex-start; }
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
        .ring-grid {
          display:grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap:8px;
          margin-bottom:10px;
        }
        .ring-card {
          display:flex;
          flex-direction:column;
          justify-content:center;
          align-items:center;
          border-radius:20px;
          padding:6px 8px;
          text-align:center;
          border:2px solid transparent;
          background:linear-gradient(180deg, color-mix(in srgb, var(--card-background-color, #fbfdff) 96%, var(--primary-color, #2f75d8) 4%), var(--card-background-color, #fbfdff));
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
          min-height:60px;
          height:60px;
        }
        .ring-card--solar { border-color:#f2a63a; }
        .ring-card--load { border-color:#7ad0df; }
        .ring-card--bat { border-color:#9acc54; }
        .ring-card--feed { border-color:#ef8d3a; }
        .ring-card--grid { border-color:#d9a26d; }
        .ring-value {
          font-size:0.92rem;
          font-weight:800;
          color:var(--primary-text-color, #17263a);
          line-height:1.15;
        }
        .ring-label {
          margin-top:3px;
          color:var(--secondary-text-color, #506884);
          font-size:0.68rem;
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
        .chart-stage {
          position:relative;
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
          flex-wrap:wrap;
          gap:8px;
          margin-top:8px;
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
        .chart-hover-marker--bat { background:#98d35b; }
        .chart-hover-marker--load { background:#6fd6eb; }
        .chart-hover-marker--solar { background:#ffd13c; }
        .chart-hover-marker--feed_in { background:#ff8f3e; }
        .chart-hover-marker--consumed { background:#d39d6c; }
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
        .legend-chip__swatch--bat { background:#98d35b; }
        .legend-chip__swatch--load { background:#7ad0df; }
        .legend-chip__swatch--solar { background:#ffd13c; }
        .legend-chip__swatch--feed_in { background:#ff8f3e; }
        .legend-chip__swatch--consumed { background:#d39d6c; }
        .legend-chip.active[data-series="bat"] { background:color-mix(in srgb, #98d35b 18%, var(--card-background-color, #fff)); }
        .legend-chip.active[data-series="load"] { background:color-mix(in srgb, #7ad0df 18%, var(--card-background-color, #fff)); }
        .legend-chip.active[data-series="solar"] { background:color-mix(in srgb, #ffd13c 20%, var(--card-background-color, #fff)); }
        .legend-chip.active[data-series="feed_in"] { background:color-mix(in srgb, #ff8f3e 18%, var(--card-background-color, #fff)); }
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
      </style>
      <ha-card>
        <div class="shell">
          <div class="title-row">
            <div class="title-icon">&#9889;</div>
            <div class="title">HEROS Report</div>
                <div class="version-badge">v${HEROS_REPORT_CARD_BUILD}</div>
          </div>
          <div data-report-body>
            ${this._renderReportBody(reporting)}
          </div>
        </div>
      </ha-card>
    `;
    this._bindEvents();
  }

  _bindEvents() {
    this.shadowRoot.querySelectorAll("[data-view]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this._view = button.dataset.view;
        this._hassRenderSignature = this._renderSignature();
        this.render();
      });
    });
    this.shadowRoot.querySelectorAll("[data-period]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const next = String(button.dataset.period || "24h").trim().toLowerCase();
        if (!next || next === this._periodPreset) {
          return;
        }
        this._periodPreset = next;
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
    this.shadowRoot.querySelector("[data-report-date]")?.addEventListener("change", async (event) => {
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
