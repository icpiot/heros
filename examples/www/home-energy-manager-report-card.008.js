const HOME_ENERGY_MANAGER_REPORT_CARD_BUILD = "046";
const TODAY_HISTORY_REFRESH_MS = 60_000;
const HOME_ENERGY_MANAGER_REPORT_CARD_TAG = `home-energy-manager-report-card-${HOME_ENERGY_MANAGER_REPORT_CARD_BUILD}`;

class ByteWattReportCard extends HTMLElement {
  setConfig(config) {
    const prefix = config?.entity_prefix || "home_energy_manager";
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
    this._historyDataCacheBySource = this._historyDataCacheBySource || new Map();
    this._historyRefreshRequestedAt = this._historyRefreshRequestedAt || new Map();
  }

  set pendingSelection(option) {
    const next = String(option || "").trim();
    if (next === String(this._pendingSelection || "")) {
      return;
    }
    const previousSignature = this._hassRenderSignature || "";
    this._pendingSelection = next;
    const nextSignature = this._renderSignature();
    if (this._hass && nextSignature !== previousSignature) {
      this._hassRenderSignature = nextSignature;
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
    const pendingSelection = String(this._pendingSelection || "").trim();
    const selectorState = String(incomingSelector?.state || "").trim();
    if (pendingSelection && selectorState === pendingSelection) {
      this._pendingSelection = "";
    }
    const nextSignature = this._renderSignature();
    if (nextSignature !== previousSignature) {
      const selectedKey = this._selectionKey();
      if (this._lastSelectedKey && selectedKey && selectedKey !== this._lastSelectedKey) {
        this._selectionTransitionPending = true;
      }
      this._lastSelectedKey = selectedKey || this._lastSelectedKey || "";
      if (this._shouldHoldSelectionRender()) {
        return;
      }
      this._hassRenderSignature = nextSignature;
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
    const keySuffix = `home_energy_manager_${key}`;
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
    return JSON.stringify({
      settingsTarget: this._config?.settings_target || "",
      selectedTarget: selector?.state || "",
      selectedBattery: selection.sys_sn || selection.remark || selection.label || "",
      selectedAggregate: Boolean(selection.aggregate),
      pendingSelection: this._pendingSelection || "",
      selectedDate: this._historySelectedDate || "",
      reportingDate: reporting.reporting_date || reportingMeta.reporting_date || powerDiagram.date || "",
      historyUrl: this._historyUrl(),
      historyScope: history.current_scope || "all",
      view: this._view || "power",
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

  _todayLocalDate() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  _selectedReportDate() {
    const currentReporting = this._reporting();
    return String(
      this._historySelectedDate
      || currentReporting?.power_diagram?.date
      || currentReporting?.reporting_date
      || currentReporting?.meta?.reporting_date
      || this._formatLocalDate(this._todayLocalDate())
    ).trim();
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
        ? `/local/home-energy-manager-history/${entryId}`
        : "";
    if (!base) return "";
    return `${base}/history.json`;
  }

  _historyScopes() {
    const remoteScopes = this._historyData?.scopes;
    return remoteScopes && typeof remoteScopes === "object" ? remoteScopes : {};
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

  _historyRecordForDate(dateKey) {
    const scopeInfo = this._historyScopeData();
    const records = scopeInfo.scope?.records || {};
    const record = records?.[dateKey] || null;
    return this._recordHasPowerDiagramData(record) ? record : null;
  }

  async _reloadHistory() {
    const url = this._historyUrl();
    if (!url) return;
    const historyKey = `${url}|${this._historyScopeKey()}`;
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
    const hasRecord = Boolean(this._historyRecordForDate(selectedDate));
    if (!isToday && hasRecord) return;
    const requestKey = `${scopeKey}|${selectedDate}|${isToday ? "today" : "archive"}`;
    const now = Date.now();
    const lastRequestedAt = Number(this._historyRefreshRequestedAt?.get(requestKey) || 0);
    if (isToday && hasRecord && now - lastRequestedAt < TODAY_HISTORY_REFRESH_MS) return;
    if (!isToday && this._historyRequestedKey === requestKey) return;
    if (this._historyLoading && this._historyLoadingKey === `${this._historyUrl()}|${scopeKey}`) return;
    this._historyRequestedKey = requestKey;
    this._historyRefreshRequestedAt = this._historyRefreshRequestedAt || new Map();
    this._historyRefreshRequestedAt.set(requestKey, now);
    const history = this._history();
    const payload = {
      scope_key: scopeKey,
      start_date: selectedDate,
      end_date: selectedDate,
      force: isToday,
    };
    if (history?.entry_id) payload.entry_id = history.entry_id;
    try {
      await this._hass.callService("home_energy_manager", "ensure_report_history", payload);
      await this._reloadHistory();
    } catch (error) {
      this._historyLoadError = String(error?.message || error || "History download failed");
      this.render();
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
        reporting: this._selectedBatteryPendingReporting(reporting, currentSelection, selectedDate),
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
    if (this._isTodaySelection(selectedDate) && !selectedRecord) {
      const liveReporting = currentSelection.aggregate
        ? this._aggregatePendingReporting(reporting, currentSelection, selectedDate)
        : this._selectedBatteryPendingReporting(reporting, currentSelection, selectedDate);
      this._cacheLiveReport(liveReporting);
      const displayReporting = this._lastDisplayedTimeSeriesReport(selectedDate) || liveReporting;
      const displayState = {
        reporting: displayReporting,
        selectedDate,
        usingHistory: false,
        missingHistory: true,
      };
      this._lastReportingForDisplay = displayState;
      return displayState;
    }
    const selectionMismatch = Boolean(selectedKey && reportingKey && selectedKey !== reportingKey);
    if (!selectedRecord) {
      if (selectedDate && selectedDate !== liveDate) {
        if (selectionMismatch) {
          const displayState = {
            reporting: currentSelection.aggregate
              ? this._aggregatePendingReporting(reporting, currentSelection, selectedDate)
              : this._selectedBatteryPendingReporting(reporting, currentSelection, selectedDate),
            selectedDate,
            usingHistory: false,
            missingHistory: true,
          };
          this._lastReportingForDisplay = displayState;
          return displayState;
        }
        const displayState = {
          reporting: currentSelection.aggregate
            ? this._archivePendingReporting(reporting, selectedDate)
            : this._selectedBatteryPendingReporting(reporting, currentSelection, selectedDate),
          selectedDate,
          usingHistory: false,
          missingHistory: true,
        };
        this._lastReportingForDisplay = displayState;
        return displayState;
      }
      if (selectionMismatch) {
        const displayState = {
          reporting: currentSelection.aggregate
            ? this._aggregatePendingReporting(reporting, currentSelection, selectedDate)
            : this._selectedBatteryPendingReporting(reporting, currentSelection, selectedDate),
          selectedDate,
          usingHistory: false,
          missingHistory: false,
        };
        this._lastReportingForDisplay = displayState;
        return displayState;
      }
      const displayState = {
        reporting,
        selectedDate,
        usingHistory: false,
        missingHistory: false,
      };
      this._lastReportingForDisplay = displayState;
      return displayState;
    }
    const snapshot = JSON.parse(JSON.stringify(reporting || {}));
    const historicalPowerDiagram = this._powerDiagramFromRecord(selectedRecord);
    snapshot.aggregate = Boolean(currentSelection.aggregate);
    snapshot.label = currentSelection.aggregate
      ? "All systems"
      : currentSelection.remark || currentSelection.sys_sn || currentSelection.label || snapshot.label || "Selected battery";
    snapshot.selection = currentSelection.aggregate
      ? { label: "All systems", aggregate: true, system_id: "", sys_sn: "All", remark: "" }
      : currentSelection;
    snapshot.reporting_date = selectedDate;
    snapshot.power_diagram = {
      ...(snapshot.power_diagram || {}),
      ...historicalPowerDiagram,
      date: selectedDate,
      meta: {
        ...((snapshot.power_diagram || {}).meta || {}),
        ...(historicalPowerDiagram.meta || {}),
      },
      summary: {
        ...((snapshot.power_diagram || {}).summary || {}),
        ...(historicalPowerDiagram.summary || {}),
      },
      time: Array.isArray(historicalPowerDiagram.time) ? historicalPowerDiagram.time : [],
      series: historicalPowerDiagram.series && typeof historicalPowerDiagram.series === "object"
        ? historicalPowerDiagram.series
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
    };
    const displayState = {
      reporting: snapshot,
      selectedDate,
      usingHistory: true,
      missingHistory: false,
    };
    this._lastReportingForDisplay = displayState;
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
    const attrs = this._selectorState()?.attributes || {};
    const allSystems = attrs.direct_api?.all_systems || {};
    const reportDate = selectedDate || this._formatLocalDate(this._todayLocalDate());
    const hasLiveValues = ["soc", "pbat", "pload", "pgrid", "ppv"].some((key) => allSystems[key] !== undefined && allSystems[key] !== null);
    const live = {
      soc: allSystems.soc ?? null,
      battery_power: allSystems.pbat ?? null,
      house_consumption: allSystems.pload ?? null,
      grid_power: allSystems.pgrid ?? null,
      pv_power: allSystems.ppv ?? null,
      power_source: allSystems.powerSource ?? "Report Loading",
    };
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
    return selection.remark || selection.sys_sn || selection.system_id || this._config.entity_prefix || "Home Energy Manager";
  }

  _synthesizedReporting() {
    const today = new Date();
    const reportDate = today.toISOString().slice(0, 10);
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

  _selectionMeta() {
    const attrs = this._selectorState()?.attributes || {};
    const pendingSelection = String(this._pendingSelection || "").trim();
    if (pendingSelection) {
      if (pendingSelection === "All systems") {
        return {
          label: "All systems",
          aggregate: true,
          system_id: "",
          sys_sn: "All",
          remark: "",
        };
      }
      const liveRows = Array.isArray(attrs.direct_api?.live_batteries) ? attrs.direct_api.live_batteries : [];
      const matched = liveRows.find((battery) => {
        const labels = [
          battery?.label,
          battery?.sys_sn,
          battery?.system_id,
        ].map((value) => String(value || "").trim()).filter(Boolean);
        return labels.includes(pendingSelection);
      });
      return {
        label: pendingSelection,
        aggregate: false,
        system_id: String(matched?.system_id || ""),
        sys_sn: String(matched?.sys_sn || pendingSelection),
        remark: String(matched?.label || pendingSelection),
      };
    }
    const selectorState = String(this._selectorState()?.state || "").trim();
    if (selectorState === "All systems") {
      return {
        label: "All systems",
        aggregate: true,
        system_id: "",
        sys_sn: "All",
        remark: "",
      };
    }
    const selection = attrs.selection || {};
    const label = selection.label || selectorState || "";
    const aggregate = Boolean(selection.aggregate || label === "All systems" || selection.sys_sn === "All");
    return {
      label,
      aggregate,
      system_id: aggregate ? "" : selection.system_id || attrs.system_id || "",
      sys_sn: aggregate ? "All" : selection.sys_sn || attrs.sys_sn || "",
      remark: aggregate ? "" : selection.remark || attrs.remark || "",
    };
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
    const reportDate = selectedDate || this._formatLocalDate(this._todayLocalDate());
    const live = {
      soc: liveSource.soc ?? null,
      battery_power: liveSource.pbat ?? liveSource.battery_power ?? null,
      house_consumption: liveSource.pload ?? liveSource.load_w ?? liveSource.house_consumption ?? null,
      grid_power: liveSource.pgrid ?? liveSource.grid_w ?? liveSource.grid_power ?? null,
      pv_power: liveSource.ppv ?? liveSource.solar_w ?? liveSource.pv_power ?? null,
      power_source: liveSource.powerSource ?? liveSource.power_source ?? "Report Loading",
    };
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
    return !date || date === this._formatLocalDate(this._todayLocalDate());
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
      ["Label", reporting?.label || "Home Energy Manager"],
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
    const label = (reporting?.label || "home-energy-manager").replaceAll(/[^a-zA-Z0-9_-]+/g, "_");
    link.href = url;
    link.download = `home-energy-manager-report-${label}-${stamp}.csv`;
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
      : "This view is using the backend reporting payload stored through the HEM report archive flow.";
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
    if (!reporting?.aggregate) {
      return [
        this._ring("BAT SOC", this._fmtPercent(powerSummary.soc), "bat"),
        this._ring("Battery Power", this._fmtPower(powerSummary.battery_power ?? powerSummary.load_consumption), "load"),
        this._ring("Load", this._fmtPower(powerSummary.load_consumption), "feed"),
      ];
    }
    return [
      this._ring("Generation", this._fmtEnergy(powerSummary.solar_generation), "solar"),
      this._ring("Consumption", this._fmtEnergy(powerSummary.load_consumption), "load"),
      this._ring("BAT SOC", this._fmtPercent(powerSummary.soc), "bat"),
      this._ring("Feed-in", this._fmtEnergy(powerSummary.feed_in), "feed"),
      this._ring("Grid Consumption", this._fmtEnergy(powerSummary.grid_consumption), "grid"),
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

  _powerTickValues(maxValue) {
    if (!Number.isFinite(maxValue) || maxValue <= 0) return [0, 0.25, 0.5, 0.75, 1];
    const rawStep = maxValue / 4;
    const exponent = Math.floor(Math.log10(rawStep));
    const magnitude = 10 ** exponent;
    const candidates = [1, 2, 5, 10].map((multiple) => multiple * magnitude);
    const step = candidates.find((candidate) => candidate >= rawStep) || candidates[candidates.length - 1];
    const ticks = [];
    for (let value = 0; value < maxValue; value += step) {
      ticks.push(Number(value.toFixed(step < 1 ? 2 : 1)));
    }
    ticks.push(Number(maxValue.toFixed(step < 1 ? 2 : 1)));
    return Array.from(new Set(ticks));
  }

  _renderChart(reporting) {
    const powerDiagram = reporting?.power_diagram || {};
    const series = powerDiagram.series || {};
    const selection = reporting?.selection || this._selectionMeta();
    const times = powerDiagram.time || [];
    const seriesKeys = this._visibleSeriesKeys(reporting);
    const powerKeys = seriesKeys.filter((key) => key !== "bat");
    const allPowerValues = powerKeys.flatMap((key) => (series[key] || []).map((value) => Number(value) || 0));
    const powerMax = Math.max(...allPowerValues, 1);
    const width = 900;
    const height = 290;
    const plotWidth = 720;
    const plotHeight = 165;
    const left = 82;
    const top = 28;
    const bottom = top + plotHeight;
    const right = left + plotWidth;
    const formatPowerAxis = (value) => {
      if (!Number.isFinite(value)) return "0 W";
      const absValue = Math.abs(value);
      if (absValue >= 1000) return `${(value / 1000).toFixed(1)} kW`;
      if (absValue < 10) return `${value.toFixed(1)} W`;
      return `${Math.round(value)} W`;
    };

    const area = (values, maxValue, fill, stroke) => {
      if (!values.length) return "";
      const points = values
        .map((value, index) => {
          const x = left + (plotWidth * index) / Math.max(values.length - 1, 1);
          const y = bottom - ((Number(value) || 0) / Math.max(maxValue, 1)) * plotHeight;
          return `${x},${y}`;
        })
        .join(" ");
      const start = `${left},${bottom}`;
      const end = `${right},${bottom}`;
      return `<polygon points="${start} ${points} ${end}" fill="${fill}" stroke="${stroke}" stroke-width="2" fill-opacity="0.18"></polygon>`;
    };

    const line = (values, maxValue, stroke) => {
      if (!values.length) return "";
      const points = values
        .map((value, index) => {
          const x = left + (plotWidth * index) / Math.max(values.length - 1, 1);
          const y = bottom - ((Number(value) || 0) / Math.max(maxValue, 1)) * plotHeight;
          return `${x},${y}`;
        })
        .join(" ");
      return `<polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"></polyline>`;
    };

    const palette = {
      bat: ["rgba(152, 211, 91, 0.45)", "#98d35b"],
      load: ["rgba(111, 214, 235, 0.38)", "#6fd6eb"],
      solar: ["rgba(255, 209, 60, 0.42)", "#ffd13c"],
      feed_in: ["rgba(255, 143, 62, 0.34)", "#ff8f3e"],
      consumed: ["rgba(211, 157, 108, 0.28)", "#d39d6c"],
    };

    const xTicks = [0, 0.17, 0.34, 0.51, 0.68, 0.85, 1];
    const tickLabels = xTicks.map(
      (point) => times[Math.min(times.length - 1, Math.max(0, Math.round(point * (times.length - 1))))] || ""
    );
    const powerTicks = this._powerTickValues(powerMax);
    const selectedDate = this._selectedReportDate();
    const todayValue = this._formatLocalDate(this._todayLocalDate());
    const selectedDateLabel = selectedDate || powerDiagram.date || "";
    const selectionLabel = selection?.aggregate
      ? "All Batteries"
      : String(selection?.remark || selection?.sys_sn || selection?.label || "Selected battery");
    const historyNotice = this._historyConfigured() && selectedDate
      ? this._historyRecordForDate(selectedDate)
        ? this._isTodaySelection(selectedDate)
          ? `<div class="chart-history-note">Today's time-series report loaded through ${this._escape(this._formatTimeLabel(new Date()))}.</div>`
          : `<div class="chart-history-note">Archived report loaded for ${this._escape(selectedDate)}.</div>`
        : this._historyLoading
          ? `<div class="chart-history-note">Loading report history for ${this._escape(selectedDate)}...</div>`
          : `<div class="chart-history-note chart-history-note--warn">No stored report history found yet for ${this._escape(selectedDate)}. HEM has requested it.</div>`
      : "";

    return `
      <section class="panel">
        <div class="panel-header chart-header">
          <div class="chart-header__row chart-header__row--primary">
            <div class="panel-tabs">
              <button type="button" class="${this._view === "power" ? "active" : ""}" data-view="power">Power Diagram</button>
              <button type="button" class="${this._view === "statistical" ? "active" : ""}" data-view="statistical">Statistical Diagram</button>
            </div>
            <span class="chart-selection-pill" title="Chart follows the selected battery">${this._escape(selectionLabel)}</span>
          </div>
          <div class="chart-header__row chart-header__row--secondary">
            <div class="chart-tools chart-tools--date">
              <button class="date-nav" type="button" data-shift-date="-1" aria-label="Previous day">&#8249;</button>
              <input class="date-input" type="date" data-report-date value="${this._escape(selectedDateLabel)}" max="${this._escape(todayValue)}">
              <button class="date-nav" type="button" data-shift-date="1" aria-label="Next day">&#8250;</button>
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
          <svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Home Energy Manager power diagram chart">
            <line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" class="axis"></line>
            <line x1="${left}" y1="${top}" x2="${left}" y2="${bottom}" class="axis"></line>
            <line x1="${right}" y1="${top}" x2="${right}" y2="${bottom}" class="axis axis-soc"></line>
            ${powerTicks
              .map((point) => {
                const ratio = powerMax > 0 ? point / powerMax : 0;
                const y = bottom - ratio * plotHeight;
                return `
                  <line x1="${left}" y1="${y}" x2="${right}" y2="${y}" class="grid"></line>
                  <text x="${left - 10}" y="${y + 4}" class="tick tick-left" text-anchor="end">${this._escape(formatPowerAxis(point))}</text>
                  <text x="${right + 10}" y="${y + 4}" class="tick tick-right" text-anchor="start">${Math.round(ratio * 100)}%</text>
                `;
              })
              .join("")}
            ${seriesKeys
              .map((key) => {
                const values = series[key] || [];
                const hidden = this._activeSeries[key] === false ? " hidden" : "";
                if (key === "bat") {
                  return `<g data-chart-series="${key}"${hidden}>${area(values, 100, palette[key][0], palette[key][1])}${line(values, 100, palette[key][1])}</g>`;
                }
                return `<g data-chart-series="${key}"${hidden}>${area(values, powerMax, palette[key][0], palette[key][1])}${line(values, powerMax, palette[key][1])}</g>`;
              })
              .join("")}
            ${tickLabels
              .map((label, index) => {
                const x = left + plotWidth * xTicks[index];
                return `<text x="${x}" y="${bottom + 24}" class="tick" text-anchor="middle">${this._escape(label)}</text>`;
              })
              .join("")}
            <text x="${left + plotWidth / 2}" y="${bottom + 54}" class="axis-title" text-anchor="middle">Time of day</text>
            <text x="18" y="${top + plotHeight / 2}" class="axis-title" text-anchor="middle" transform="rotate(-90 18 ${top + plotHeight / 2})">Power (W / kW)</text>
            <text x="${width - 18}" y="${top + plotHeight / 2}" class="axis-title axis-title-soc" text-anchor="middle" transform="rotate(90 ${width - 18} ${top + plotHeight / 2})">Battery SOC (%)</text>
          </svg>
          <div class="legend-row">
            ${seriesKeys
              .map((key) => this._legendButton(key === "bat" ? "BAT" : key === "load" ? "Load" : key === "solar" ? "Solar" : key === "feed_in" ? "Feed-in" : "Consumed", key))
              .join("")}
          </div>
          <div class="chart-explainer">
            Left axis shows live power for Load, Solar, Feed-in, and Consumed. Right axis shows BAT as battery SOC percent.
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
      <div class="ring-card ring-${kind}">
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
      layer.toggleAttribute("hidden", this._activeSeries[key] === false);
    });
    this.shadowRoot.querySelectorAll("[data-series]").forEach((button) => {
      const key = button.dataset.series;
      const active = this._activeSeries[key] !== false;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  _statCard(label, value) {
    return `
      <div class="stat-card">
        <div class="stat-label">${label}</div>
        <div class="stat-value">${value}</div>
      </div>
    `;
  }

  render() {
    if (!this._hass || !this._config) return;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const historyKey = `${this._historyUrl()}|${this._historyScopeKey()}`;
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
        .shell { display:grid; gap:14px; padding:16px; }
        .title-row { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
        .title-icon {
          width:34px; height:34px; border-radius:12px; display:flex; align-items:center; justify-content:center;
          background:linear-gradient(180deg, var(--primary-color, #4ba4ff), color-mix(in srgb, var(--primary-color, #2f75d8) 72%, black)); color:var(--text-primary-color, #fff); font-weight:800;
          box-shadow:0 12px 24px color-mix(in srgb, var(--primary-color, #2f75d8) 22%, transparent);
        }
        .title { font-size:1.4rem; font-weight:800; }
        .version-badge {
          display:inline-flex; align-items:center; justify-content:center; padding:4px 8px;
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
          padding:18px;
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
        .chart-selection-pill {
          display:inline-flex;
          align-items:center;
          padding:8px 12px;
          border-radius:999px;
          border:1px solid color-mix(in srgb, var(--primary-color, #205ca8) 22%, transparent);
          background:color-mix(in srgb, var(--primary-color, #e8f3ff) 12%, var(--card-background-color, #fff));
          color:color-mix(in srgb, var(--primary-color, #205ca8) 88%, var(--primary-text-color, #17263a));
          font-size:0.8rem;
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
          padding:8px 12px;
          border-radius:999px;
          border:1px solid color-mix(in srgb, var(--divider-color, rgba(51, 92, 140, 0.16)) 72%, transparent);
          background:color-mix(in srgb, var(--primary-color, #eef5ff) 10%, var(--card-background-color, #fff));
          color:var(--secondary-text-color, #36567b);
          font-size:0.9rem;
          font-weight:700;
        }
        .chart-history-note {
          margin:-4px 0 12px;
          color:var(--secondary-text-color, #486782);
          font-size:0.88rem;
          font-weight:700;
        }
        .chart-history-note--warn {
          color:color-mix(in srgb, #916000 85%, var(--secondary-text-color, #916000));
        }
        .chart-header { margin-bottom:12px; display:grid; gap:8px; }
        .chart-header__row { display:flex; align-items:center; gap:10px; justify-content:space-between; flex-wrap:wrap; }
        .panel-tabs { display:flex; gap:8px; }
        .chart-tools { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
        .chart-tools--date { justify-content:flex-start; }
        .chart-tools--action { justify-content:flex-end; margin-left:auto; }
        .panel-tabs button,
        .legend-chip,
        .download-btn {
          border:none;
          border-radius:999px;
          padding:7px 12px;
          font-weight:700;
          cursor:pointer;
          transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease, color 0.15s ease;
        }
        .panel-tabs button {
          background:color-mix(in srgb, var(--primary-color, #e8eff8) 10%, var(--card-background-color, #fff));
          color:var(--secondary-text-color, #476687);
        }
        .panel-tabs button.active {
          background:var(--primary-color, #2f75d8);
          color:var(--text-primary-color, #fff);
        }
        .panel-tabs button:hover,
        .panel-tabs button:focus-visible,
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
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap:8px;
          margin-bottom:14px;
        }
        .ring-card {
          border-radius:20px;
          padding:6px 8px;
          text-align:center;
          border:2px solid transparent;
          background:linear-gradient(180deg, color-mix(in srgb, var(--card-background-color, #fbfdff) 96%, var(--primary-color, #2f75d8) 4%), var(--card-background-color, #fbfdff));
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
          min-height:60px;
        }
        .ring-solar { border-color:#f2a63a; }
        .ring-load { border-color:#7ad0df; }
        .ring-bat { border-color:#9acc54; }
        .ring-feed { border-color:#ef8d3a; }
        .ring-grid { border-color:#d9a26d; }
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
          margin-top:10px;
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
          margin-top:10px;
          color:var(--secondary-text-color, #526d8b);
          font-size:0.88rem;
          font-weight:700;
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
          .panel-tabs {
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
            <div class="title">Home Energy Manager Report</div>
                <div class="version-badge">v${HOME_ENERGY_MANAGER_REPORT_CARD_BUILD}</div>
          </div>
          ${
            reporting || this._lastReportingForDisplay?.reporting
              ? `
            ${this._renderDataSourceBanner(reporting)}
            ${this._renderHeroBanner(reporting)}
            ${this._renderAggregateStrip(reporting)}
            ${this._renderAggregateTable(reporting)}
            ${this._renderChart(reporting)}
          `
              : `<div class="empty">Reporting data is not available yet. Select a battery target and wait for the next coordinator refresh.</div>`
          }
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
    this.shadowRoot.querySelectorAll("[data-series]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const key = button.dataset.series;
        this._activeSeries[key] = !(this._activeSeries[key] !== false);
        this._hassRenderSignature = this._renderSignature();
        this.render();
      });
    });
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
        this._historyRequestedKey = "";
        this._hassRenderSignature = this._renderSignature();
        this.render();
        if (this._historyConfigured()) {
          await this._ensureHistoryForSelectedDate();
        }
      });
    });
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
  if (!customElements.get("home-energy-manager-report-card")) {
    customElements.define("home-energy-manager-report-card", ByteWattReportCard);
  }
  if (!customElements.get(HOME_ENERGY_MANAGER_REPORT_CARD_TAG)) {
    customElements.define(
      HOME_ENERGY_MANAGER_REPORT_CARD_TAG,
      class extends ByteWattReportCard {},
    );
  }
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "home-energy-manager-report-card",
  name: "Home Energy Manager Report Card",
  description: `Home Energy Manager reporting card build ${HOME_ENERGY_MANAGER_REPORT_CARD_BUILD}.`,
});

window.homeEnergyManagerReportCardBuild = HOME_ENERGY_MANAGER_REPORT_CARD_BUILD;
window.homeEnergyManagerReportCardTag = HOME_ENERGY_MANAGER_REPORT_CARD_TAG;
