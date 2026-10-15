"""Functional checks for the panel-only pricing UI helpers."""
from __future__ import annotations

import subprocess
import textwrap
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_pricing_panel_ui_overlap_and_delete_logic():
    script = textwrap.dedent(
        r"""
        const fs = require("fs");
        const vm = require("vm");

        let source = fs.readFileSync("examples/www/heros-panel.js", "utf8");
        source = source.replace(/^import .*$/mg, "");
        source = source.replace(
          "class HerosPanel extends HTMLElement",
          "globalThis.HerosPanel = class HerosPanel extends HTMLElement",
        );

        class HTMLElement {
          attachShadow() {
            return {
              innerHTML: "",
              addEventListener() {},
              querySelectorAll() { return []; },
              querySelector() { return null; },
            };
          }
        }

        const storage = new Map();
        const context = {
          console,
          HTMLElement,
          setTimeout,
          clearTimeout,
          URL,
          window: {
            location: { hash: "" },
            addEventListener() {},
            removeEventListener() {},
            history: { replaceState() {} },
            confirm() { return true; },
          },
          document: {
            addEventListener() {},
            removeEventListener() {},
            createElement() { return {}; },
          },
          customElements: {
            get() { return false; },
            define() {},
          },
          localStorage: {
            getItem(key) { return storage.has(key) ? storage.get(key) : null; },
            setItem(key, value) { storage.set(key, String(value)); },
            removeItem(key) { storage.delete(key); },
          },
        };
        context.globalThis = context;
        vm.createContext(context);
        vm.runInContext(source, context, { filename: "heros-panel.js" });

        const panel = new context.HerosPanel();
        panel._connectionName = () => "Test Provider";
        const group = {
          ...panel._pricingUiGroupDefaults(),
          group_id: "g1",
          label: "Rates from Jan 1",
          effective_start_date: "2026-01-01",
          rules: [],
        };
        const peak = {
          ...panel._pricingUiRuleDefaults(),
          rule_id: "r1",
          label: "Peak",
          day_types: ["mon", "tue", "wed", "thu", "fri"],
          start_time: "14:00",
          end_time: "20:00",
          import_rate: "0.42",
        };
        const overlap = {
          ...panel._pricingUiRuleDefaults(),
          rule_id: "r2",
          label: "Overlap",
          day_types: ["fri"],
          start_time: "19:00",
          end_time: "21:00",
          import_rate: "0.45",
        };
        const nonOverlap = {
          ...panel._pricingUiRuleDefaults(),
          rule_id: "r3",
          label: "Off peak",
          day_types: ["fri"],
          start_time: "20:00",
          end_time: "23:00",
          import_rate: "0.20",
        };
        const holiday = {
          ...panel._pricingUiRuleDefaults(),
          rule_id: "r4",
          label: "Holiday",
          day_types: ["public_holiday"],
          start_time: "00:00",
          end_time: "23:59",
          import_rate: "0.30",
        };

        group.rules.push(peak);
        const results = {
          overlapBlocked: panel._pricingUiValidationForRule(group, overlap).includes("Overlaps with"),
          nonOverlapAllowed: panel._pricingUiValidationForRule(group, nonOverlap) === "",
          holidayAllowed: panel._pricingUiValidationForRule(group, holiday) === "",
          overnightSegments: panel._pricingRuleSegments({ start_time: "22:00", end_time: "06:00" }).length === 2,
        };
        group.rules.push(nonOverlap, holiday);
        group.rules = group.rules.filter((rule) => rule.rule_id !== "r3");
        results.deleteRecordWorks = group.rules.length === 2 && !group.rules.some((rule) => rule.rule_id === "r3");
        const model = { groups: [group], activeGroupId: "g1", warning: "" };
        model.groups = model.groups.filter((item) => item.group_id !== "g1");
        results.deleteGroupWorks = model.groups.length === 0;

        if (!Object.values(results).every(Boolean)) {
          console.error(JSON.stringify(results, null, 2));
          process.exit(1);
        }
        """
    )

    subprocess.run(["node", "-e", script], cwd=ROOT, check=True)


def test_pricing_panel_ui_authoritative_empty_refresh_clears_deleted_groups():
    script = textwrap.dedent(
        r"""
        const fs = require("fs");
        const vm = require("vm");
        let source = fs.readFileSync("examples/www/heros-panel.js", "utf8");
        source = source.replace(/^import .*$/mg, "");
        source = source.replace(
          "class HerosPanel extends HTMLElement",
          "globalThis.HerosPanel = class HerosPanel extends HTMLElement",
        );
        class HTMLElement {
          attachShadow() { return { innerHTML: "", addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; } }; }
        }
        const storage = new Map([["heros.panel.pricing.ui", JSON.stringify({
          groups: [{ group_id: "deleted-group", label: "Stale group", rules: [{ rule_id: "deleted-buy", record_type: "buy" }] }],
          activeGroupId: "deleted-group",
          localUpdatedAt: Date.now(),
          pendingWriteUntil: 0,
        })]]);
        const context = {
          console, HTMLElement, setTimeout, clearTimeout, URL, Date,
          window: { location: { hash: "" }, addEventListener() {}, removeEventListener() {}, history: { replaceState() {} } },
          document: { addEventListener() {}, removeEventListener() {}, createElement() { return {}; } },
          customElements: { get() { return false; }, define() {} },
          localStorage: { getItem(key) { return storage.get(key) || null; }, setItem(key, value) { storage.set(key, String(value)); }, removeItem(key) { storage.delete(key); } },
        };
        context.globalThis = context;
        vm.createContext(context);
        vm.runInContext(source, context, { filename: "heros-panel.js" });
        const panel = new context.HerosPanel();
        panel._pricingGroupEditorOpen = true;
        panel._pricingRecordEditorMode = "sell";
        panel._pricingUiGroupDraft = { group_id: "deleted-group", label: "Stale group" };
        panel._pricingUiRuleDrafts = { buy: { rule_id: "deleted-buy" }, sell: { rule_id: "deleted-sell" } };
        panel._pricingUiRuleDraft = panel._pricingUiRuleDrafts.sell;
        panel._savePricingUiFromBackend({ groups: [], activeGroupId: "", backendUpdatedAt: "2026-10-12T13:04:39.057545+00:00" }, true);
        const restored = panel._pricingUiMemoryState;
        if (restored.groups.length !== 0 || restored.activeGroupId !== ""
          || panel._pricingGroupEditorOpen || panel._pricingRecordEditorMode
          || Object.keys(panel._pricingUiGroupDraft).length
          || panel._pricingUiRuleDrafts.buy.rule_id || panel._pricingUiRuleDrafts.sell.rule_id) {
          console.error(JSON.stringify({ restored, panelState: {
            groupEditor: panel._pricingGroupEditorOpen,
            recordMode: panel._pricingRecordEditorMode,
            groupDraft: panel._pricingUiGroupDraft,
            ruleDrafts: panel._pricingUiRuleDrafts,
          } }, null, 2));
          process.exit(1);
        }
        """
    )
    subprocess.run(["node", "-e", script], cwd=ROOT, check=True)


def test_pricing_panel_ui_reloads_authoritative_file_when_returning_to_pricing():
    source = (ROOT / "examples/www/heros-panel.js").read_text(encoding="utf-8")
    assert 'if (this._page === "pricing" && previousPage !== "pricing")' in source
    assert 'if (this._page === "pricing") {\n        this._invalidatePricingFileLoad();' in source


def test_pricing_panel_ui_rolls_back_when_service_call_fails():
    script = textwrap.dedent(
        r"""
        const fs = require("fs");
        const vm = require("vm");

        let source = fs.readFileSync("examples/www/heros-panel.js", "utf8");
        source = source.replace(/^import .*$/mg, "");
        source = source.replace(
          "class HerosPanel extends HTMLElement",
          "globalThis.HerosPanel = class HerosPanel extends HTMLElement",
        );

        class HTMLElement {
          attachShadow() {
            return {
              innerHTML: "",
              addEventListener() {},
              querySelectorAll() { return []; },
              querySelector() { return null; },
            };
          }
        }

        const storage = new Map();
        const context = {
          console,
          HTMLElement,
          setTimeout,
          clearTimeout,
          URL,
          window: {
            location: { hash: "" },
            addEventListener() {},
            removeEventListener() {},
            history: { replaceState() {} },
            confirm() { return true; },
          },
          document: {
            addEventListener() {},
            removeEventListener() {},
            createElement() { return {}; },
          },
          customElements: {
            get() { return false; },
            define() {},
          },
          localStorage: {
            getItem(key) { return storage.has(key) ? storage.get(key) : null; },
            setItem(key, value) { storage.set(key, String(value)); },
            removeItem(key) { storage.delete(key); },
          },
        };
        context.globalThis = context;
        vm.createContext(context);
        vm.runInContext(source, context, { filename: "heros-panel.js" });

        const panel = new context.HerosPanel();
        panel._connectionName = () => "Test Provider";
        panel._render = () => {};
        panel._holdRenderWindow = () => {};
        panel._pricingGroupDraft = {};
        panel._pricingUiGroupDraft = {};
        panel._hass = {
          callService() {
            return Promise.reject(new Error("backend failed"));
          },
        };

        const original = {
          groups: [{
            group_id: "g1",
            label: "Existing",
            provider: "Test Provider",
            plan_name: "",
            effective_start_date: "2026-01-01",
            pricing_type: "dynamic",
            daily_connection_charge: "",
            other_charges: "",
            notes: "",
            rules: [],
          }],
          activeGroupId: "g1",
          warning: "",
        };
        panel._savePricingUi(original);
        panel.shadowRoot = {
          querySelectorAll() { return []; },
          querySelector() { return null; },
        };

        Promise.resolve()
          .then(async () => {
            await panel._handlePricingUiDeleteGroup("g1");
            const restored = panel._loadPricingUi();
            const ok = restored.groups.length === 1 && restored.groups[0].group_id === "g1";
            if (!ok) {
              console.error(JSON.stringify(restored, null, 2));
              process.exit(1);
            }
          })
          .catch((error) => {
            console.error(error);
            process.exit(1);
          });
        """
    )

    subprocess.run(["node", "-e", script], cwd=ROOT, check=True)


def test_pricing_panel_ui_blocks_group_delete_when_rendered_model_has_linked_rules():
    script = textwrap.dedent(
        r"""
        const fs = require("fs");
        const vm = require("vm");

        let source = fs.readFileSync("examples/www/heros-panel.js", "utf8");
        source = source.replace(/^import .*$/mg, "");
        source = source.replace(
          "class HerosPanel extends HTMLElement",
          "globalThis.HerosPanel = class HerosPanel extends HTMLElement",
        );

        class HTMLElement {
          attachShadow() {
            return {
              innerHTML: "",
              addEventListener() {},
              querySelectorAll() { return []; },
              querySelector() { return null; },
            };
          }
        }

        let confirmCalls = 0;
        let saved = null;
        const context = {
          console,
          HTMLElement,
          setTimeout,
          clearTimeout,
          URL,
          window: {
            location: { hash: "" },
            addEventListener() {},
            removeEventListener() {},
            history: { replaceState() {} },
            confirm() { confirmCalls += 1; return true; },
          },
          document: {
            addEventListener() {},
            removeEventListener() {},
            createElement() { return {}; },
          },
          customElements: { get() { return false; }, define() {} },
          localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
        };
        context.globalThis = context;
        vm.createContext(context);
        vm.runInContext(source, context, { filename: "heros-panel.js" });

        const panel = new context.HerosPanel();
        panel._render = () => {};
        panel._loadPricingUi = () => ({
          groups: [{ group_id: "g1", rules: [] }], activeGroupId: "g1", warning: "",
        });
        panel._loadStoredPricingUi = () => ({
          groups: [{ group_id: "g1", rules: [{ rule_id: "buy-1" }] }], activeGroupId: "g1", warning: "",
        });
        panel._savePricingUi = (model) => { saved = model; };

        Promise.resolve()
          .then(async () => {
            await panel._handlePricingUiDeleteGroup("g1");
            const ok = confirmCalls === 0
              && saved?.warning === "Group cannot be deleted until all linked buy and sell rate records have been deleted.";
            if (!ok) {
              console.error(JSON.stringify({ confirmCalls, saved }, null, 2));
              process.exit(1);
            }
          })
          .catch((error) => { console.error(error); process.exit(1); });
        """
    )

    subprocess.run(["node", "-e", script], cwd=ROOT, check=True)


def test_pricing_panel_ui_prefers_backend_file_data_over_stale_browser_storage():
    script = textwrap.dedent(
        r"""
        const fs = require("fs");
        const vm = require("vm");

        let source = fs.readFileSync("examples/www/heros-panel.js", "utf8");
        source = source.replace(/^import .*$/mg, "");
        source = source.replace(
          "class HerosPanel extends HTMLElement",
          "globalThis.HerosPanel = class HerosPanel extends HTMLElement",
        );

        class HTMLElement {
          attachShadow() {
            return {
              innerHTML: "",
              addEventListener() {},
              querySelectorAll() { return []; },
              querySelector() { return null; },
            };
          }
        }

        const storage = new Map([
          ["heros.panel.pricing.ui", JSON.stringify({
            groups: [{ group_id: "local-only", label: "Local draft" }],
            activeGroupId: "local-only",
            warning: "stale local draft",
          })],
        ]);
        const context = {
          console,
          HTMLElement,
          setTimeout,
          clearTimeout,
          URL,
          window: {
            location: { hash: "" },
            addEventListener() {},
            removeEventListener() {},
            history: { replaceState() {} },
          },
          document: {
            addEventListener() {},
            removeEventListener() {},
            createElement() { return {}; },
          },
          customElements: {
            get() { return false; },
            define() {},
          },
          localStorage: {
            getItem(key) { return storage.has(key) ? storage.get(key) : null; },
            setItem(key, value) { storage.set(key, String(value)); },
            removeItem(key) { storage.delete(key); },
          },
        };
        context.globalThis = context;
        vm.createContext(context);
        vm.runInContext(source, context, { filename: "heros-panel.js" });

        const panel = new context.HerosPanel();
        panel._connectionName = () => "Test Provider";
        panel._pricingScheduleData = () => ({
          available: true,
          groups: [{
            group_id: "backend-group",
            label: "Backend group",
            provider: "Test Provider",
            plan_name: "",
            effective_start_date: "2026-08-01",
            pricing_type: "fixed",
            daily_connection_charge: "0.149",
            other_charges: "",
            notes: "",
            records: [],
          }],
          activeGroup: { group_id: "backend-group" },
        });

        const restored = panel._loadPricingUi();
        const backendGroup = restored.groups.find((group) => group.group_id === "backend-group");
        const ok = Boolean(backendGroup)
          && !restored.groups.some((group) => group.group_id === "local-only")
          && restored.activeGroupId === "backend-group"
          && storage.has("heros.panel.pricing.ui");

        if (!ok) {
          console.error(JSON.stringify({ restored, storage: [...storage.entries()] }, null, 2));
          process.exit(1);
        }
        """
    )

    subprocess.run(["node", "-e", script], cwd=ROOT, check=True)


def test_pricing_panel_ui_backend_file_load_does_not_replace_pending_local_record():
    script = textwrap.dedent(
        r"""
        const fs = require("fs");
        const vm = require("vm");

        let source = fs.readFileSync("examples/www/heros-panel.js", "utf8");
        source = source.replace(/^import .*$/mg, "");
        source = source.replace(
          "class HerosPanel extends HTMLElement",
          "globalThis.HerosPanel = class HerosPanel extends HTMLElement",
        );

        class HTMLElement {
          attachShadow() {
            return {
              innerHTML: "",
              addEventListener() {},
              querySelectorAll() { return []; },
              querySelector() { return null; },
            };
          }
        }

        const group = {
          group_id: "group",
          label: "Rates",
          effective_start_date: "2026-08-01",
          rules: [
            { rule_id: "peak", record_type: "buy", label: "Peak" },
            { rule_id: "shoulder", record_type: "buy", label: "Shoulder" },
          ],
        };
        const storage = new Map([
          ["heros.panel.pricing.ui", JSON.stringify({
            groups: [group],
            activeGroupId: "group",
            localUpdatedAt: Date.now(),
            pendingWriteUntil: Date.now() + 120000,
          })],
        ]);
        const context = {
          console,
          HTMLElement,
          setTimeout,
          clearTimeout,
          URL,
          Date,
          window: {
            location: { hash: "" },
            addEventListener() {},
            removeEventListener() {},
            history: { replaceState() {} },
          },
          document: {
            addEventListener() {},
            removeEventListener() {},
            createElement() { return {}; },
          },
          customElements: {
            get() { return false; },
            define() {},
          },
          localStorage: {
            getItem(key) { return storage.has(key) ? storage.get(key) : null; },
            setItem(key, value) { storage.set(key, String(value)); },
            removeItem(key) { storage.delete(key); },
          },
        };
        context.globalThis = context;
        vm.createContext(context);
        vm.runInContext(source, context, { filename: "heros-panel.js" });

        const panel = new context.HerosPanel();
        panel._savePricingUiFromBackend({
          groups: [{ ...group, rules: [{ rule_id: "peak", record_type: "buy", label: "Peak" }] }],
          activeGroupId: "group",
          backendUpdatedAt: "2026-08-01T00:00:00+00:00",
        });

        const restored = JSON.parse(storage.get("heros.panel.pricing.ui"));
        const rules = restored.groups[0]?.rules || [];
        if (rules.length !== 2 || !rules.some((rule) => rule.rule_id === "shoulder")) {
          console.error(JSON.stringify({ restored }, null, 2));
          process.exit(1);
        }
        """
    )

    subprocess.run(["node", "-e", script], cwd=ROOT, check=True)


def test_pricing_panel_ui_keeps_selected_future_group_active():
    script = textwrap.dedent(
        r"""
        const fs = require("fs");
        const vm = require("vm");

        let source = fs.readFileSync("examples/www/heros-panel.js", "utf8");
        source = source.replace(/^import .*$/mg, "");
        source = source.replace(
          "class HerosPanel extends HTMLElement",
          "globalThis.HerosPanel = class HerosPanel extends HTMLElement",
        );

        class HTMLElement {
          attachShadow() {
            return {
              innerHTML: "",
              addEventListener() {},
              querySelectorAll() { return []; },
              querySelector() { return null; },
            };
          }
        }

        const context = {
          console,
          HTMLElement,
          setTimeout,
          clearTimeout,
          URL,
          window: {
            location: { hash: "" },
            addEventListener() {},
            removeEventListener() {},
            history: { replaceState() {} },
          },
          document: {
            addEventListener() {},
            removeEventListener() {},
            createElement() { return {}; },
          },
          customElements: {
            get() { return false; },
            define() {},
          },
          localStorage: {
            getItem() { return null; },
            setItem() {},
            removeItem() {},
          },
        };
        context.globalThis = context;
        vm.createContext(context);
        vm.runInContext(source, context, { filename: "heros-panel.js" });

        const panel = new context.HerosPanel();
        const selectedGroup = {
          group_id: "future-group",
          label: "Future Group",
          provider: "Test Provider",
          plan_name: "",
          effective_start_date: "2026-09-01",
          pricing_type: "dynamic",
          daily_connection_charge: "",
          other_charges: "",
          notes: "",
          rules: [],
        };
        const model = {
          groups: [selectedGroup],
          activeGroupId: "future-group",
          warning: "",
        };

        const active = panel._pricingUiActiveGroup(model);
        if (!active || active.group_id !== "future-group") {
          console.error(JSON.stringify({ active }, null, 2));
          process.exit(1);
        }
        """
    )

    subprocess.run(["node", "-e", script], cwd=ROOT, check=True)


def test_pricing_panel_ui_new_group_keeps_stable_group_id():
    script = textwrap.dedent(
        r"""
        const fs = require("fs");
        const vm = require("vm");

        let source = fs.readFileSync("examples/www/heros-panel.js", "utf8");
        source = source.replace(/^import .*$/mg, "");
        source = source.replace(
          "class HerosPanel extends HTMLElement",
          "globalThis.HerosPanel = class HerosPanel extends HTMLElement",
        );

        class HTMLElement {
          attachShadow() {
            return {
              innerHTML: "",
              addEventListener() {},
              querySelectorAll() { return []; },
              querySelector() { return null; },
            };
          }
        }

        const context = {
          console,
          HTMLElement,
          setTimeout,
          clearTimeout,
          URL,
          window: {
            location: { hash: "" },
            addEventListener() {},
            removeEventListener() {},
            history: { replaceState() {} },
          },
          document: {
            addEventListener() {},
            removeEventListener() {},
            createElement() { return {}; },
          },
          customElements: {
            get() { return false; },
            define() {},
          },
          localStorage: {
            getItem() { return null; },
            setItem() {},
            removeItem() {},
          },
        };
        context.globalThis = context;
        vm.createContext(context);
        vm.runInContext(source, context, { filename: "heros-panel.js" });

        const panel = new context.HerosPanel();
        panel._render = () => {};
        panel._holdRenderWindow = () => {};
        panel._connectionName = () => "Test Provider";
        panel._savePricingUi = () => {};
        panel._loadPricingUi = () => ({ groups: [], activeGroupId: "", warning: "" });
        panel._pricingGroupDraft = {};
        panel._handlePricingUiNewGroup();

        const draft = panel._pricingUiGroupDraft;
        panel.shadowRoot = {
          querySelector() { return null; },
          querySelectorAll() {
            return [
              { dataset: { pricingGroupField: "group_id" }, value: draft.group_id },
              { dataset: { pricingGroupField: "label" }, value: "Browser Test Group" },
              { dataset: { pricingGroupField: "effective_start_date" }, value: "2026-08-03" },
              { dataset: { pricingGroupField: "pricing_type" }, value: "dynamic" },
              { dataset: { pricingGroupField: "daily_connection_charge" }, value: "" },
              { dataset: { pricingGroupField: "other_charges" }, value: "" },
              { dataset: { pricingGroupField: "notes" }, value: "" },
            ];
          },
        };

        const readBack = panel._readPricingUiGroupForm();
        const ok = Boolean(draft.group_id)
          && readBack.group_id === draft.group_id
          && readBack.effective_start_date === "2026-08-03";

        if (!ok) {
          console.error(JSON.stringify({ draft, readBack }, null, 2));
          process.exit(1);
        }
        """
    )

    subprocess.run(["node", "-e", script], cwd=ROOT, check=True)


def test_pricing_panel_ui_save_sell_renders_record_without_reload():
    script = textwrap.dedent(
        r"""
        const fs = require("fs");
        const vm = require("vm");

        let source = fs.readFileSync("examples/www/heros-panel.js", "utf8");
        source = source.replace(/^import .*$/mg, "");
        source = source.replace(
          "class HerosPanel extends HTMLElement",
          "globalThis.HerosPanel = class HerosPanel extends HTMLElement",
        );

        class HTMLElement {
          attachShadow() {
            return { innerHTML: "", addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; } };
          }
        }
        const context = {
          console,
          HTMLElement,
          setTimeout,
          clearTimeout,
          URL,
          window: {
            location: { hash: "" },
            addEventListener() {},
            removeEventListener() {},
            history: { replaceState() {} },
          },
          document: { addEventListener() {}, removeEventListener() {}, createElement() { return {}; } },
          customElements: { get() { return false; }, define() {} },
          localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
        };
        context.globalThis = context;
        vm.createContext(context);
        vm.runInContext(source, context, { filename: "heros-panel.js" });

        const panel = new context.HerosPanel();
        let state = {
          groups: [{ group_id: "g1", label: "Temporary", rules: [] }],
          activeGroupId: "g1",
          warning: "",
        };
        const renderCalls = [];
        let servicePayload = null;
        panel._pricingUiSaveInFlight = false;
        panel._loadPricingUi = () => state;
        panel._savePricingUi = (next) => { state = JSON.parse(JSON.stringify(next)); };
        panel._readPricingUiRuleForm = () => ({
          rule_id: "sell-1",
          label: "TEMP_SELL_POST_FIX_QA",
          record_type: "sell",
          day_types: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
          start_time: "00:00",
          end_time: "23:59",
          import_rate: "",
          export_rate: 1,
          other_charges: "",
          notes: "",
        });
        panel._pricingUiValidationForRule = () => "";
        panel._generateRuleId = () => "sell-generated";
        panel._resetPricingUiRuleDraft = () => {};
        panel._clearPricingEditorUrl = () => {};
        panel._holdRenderWindow = () => {};
        panel._render = (force) => renderCalls.push({ force, rules: state.groups[0].rules.map((rule) => ({ ...rule })) });
        panel._callPricingRecordService = (_groupId, rule) => { servicePayload = { ...rule }; return Promise.resolve(); };

        Promise.resolve()
          .then(async () => {
            await panel._handlePricingUiAddRule("sell");
            const immediate = renderCalls[0];
            const final = renderCalls[renderCalls.length - 1];
            const savedSell = state.groups[0].rules.find((rule) => rule.record_type === "sell");
            const ok = renderCalls.length >= 2
              && immediate?.force === true
              && immediate.rules.some((rule) => rule.record_type === "sell")
              && final.rules.some((rule) => rule.label === "TEMP_SELL_POST_FIX_QA")
              && savedSell?.export_rate === 1
              && servicePayload?.record_type === "sell";
            if (!ok) {
              console.error(JSON.stringify({ renderCalls, state, servicePayload }, null, 2));
              process.exit(1);
            }
          })
          .catch((error) => { console.error(error); process.exit(1); });
        """
    )

    subprocess.run(["node", "-e", script], cwd=ROOT, check=True)


def test_pricing_panel_ui_save_validation_clears_in_flight_and_buy_still_saves():
    script = textwrap.dedent(
        r"""
        const fs = require("fs");
        const vm = require("vm");
        let source = fs.readFileSync("examples/www/heros-panel.js", "utf8");
        source = source.replace(/^import .*$/mg, "");
        source = source.replace("class HerosPanel extends HTMLElement", "globalThis.HerosPanel = class HerosPanel extends HTMLElement");
        class HTMLElement { attachShadow() { return { innerHTML: "", addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; } }; } }
        const context = {
          console, HTMLElement, setTimeout, clearTimeout, URL,
          window: { location: { hash: "" }, addEventListener() {}, removeEventListener() {}, history: { replaceState() {} } },
          document: { addEventListener() {}, removeEventListener() {}, createElement() { return {}; } },
          customElements: { get() { return false; }, define() {} },
          localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
        };
        context.globalThis = context;
        vm.createContext(context);
        vm.runInContext(source, context, { filename: "heros-panel.js" });
        const panel = new context.HerosPanel();
        let state = { groups: [{ group_id: "g1", rules: [] }], activeGroupId: "g1", warning: "" };
        let type = "sell";
        let calls = [];
        let renderCalls = [];
        panel._loadPricingUi = () => state;
        panel._savePricingUi = (next) => { state = JSON.parse(JSON.stringify(next)); };
        panel._readPricingUiRuleForm = () => type === "sell"
          ? { rule_id: "sell-1", label: "Sell", record_type: "sell", day_types: ["mon"], start_time: "00:00", end_time: "23:59", import_rate: "", export_rate: "", other_charges: "", notes: "" }
          : { rule_id: "buy-1", label: "Buy", record_type: "buy", day_types: ["mon"], start_time: "00:00", end_time: "23:59", import_rate: 1, export_rate: "", other_charges: "", notes: "" };
        panel._pricingUiValidationForRule = (_group, rule) => rule.record_type === "sell" && !rule.export_rate ? "Sell rate is required." : "";
        panel._resetPricingUiRuleDraft = () => {};
        panel._clearPricingEditorUrl = () => {};
        panel._holdRenderWindow = () => {};
        panel._render = (force) => { renderCalls.push({ force, warning: state.warning }); };
        panel._callPricingRecordService = (_groupId, rule) => { calls.push({ ...rule }); return Promise.resolve(); };
        Promise.resolve()
          .then(async () => {
            await panel._handlePricingUiAddRule("sell");
            const invalidOk = state.warning === "Sell rate is required."
              && panel._pricingUiSaveInFlight === false
              && calls.length === 0
              && renderCalls[0]?.force === true
              && renderCalls[0]?.warning === "Sell rate is required.";
            type = "buy";
            state.warning = "";
            await panel._handlePricingUiAddRule("buy");
            const buyOk = state.groups[0].rules.some((rule) => rule.record_type === "buy" && rule.import_rate === 1)
              && calls.some((rule) => rule.record_type === "buy");
            if (!invalidOk || !buyOk) {
              console.error(JSON.stringify({ state, calls, renderCalls, invalidOk, buyOk }, null, 2));
              process.exit(1);
            }
          })
          .catch((error) => { console.error(error); process.exit(1); });
        """
    )
    subprocess.run(["node", "-e", script], cwd=ROOT, check=True)


def test_pricing_panel_ui_save_sell_button_binds_and_calls_service():
    script = textwrap.dedent(
        r"""
        const fs = require("fs");
        const vm = require("vm");
        let source = fs.readFileSync("examples/www/heros-panel.js", "utf8");
        source = source.replace(/^import .*$/mg, "");
        source = source.replace("class HerosPanel extends HTMLElement", "globalThis.HerosPanel = class HerosPanel extends HTMLElement");
        class HTMLElement { attachShadow() { return { innerHTML: "", addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; } }; } }
        const context = {
          console, HTMLElement, setTimeout, clearTimeout, URL,
          window: { location: { hash: "" }, addEventListener() {}, removeEventListener() {}, history: { replaceState() {} } },
          document: { addEventListener() {}, removeEventListener() {}, createElement() { return {}; } },
          customElements: { get() { return false; }, define() {} },
          localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
        };
        context.globalThis = context;
        vm.createContext(context);
        vm.runInContext(source, context, { filename: "heros-panel.js" });
        const panel = new context.HerosPanel();
        const fields = [
          { type: "hidden", dataset: { pricingRecordType: "sell", pricingRuleField: "rule_id" }, value: "sell-1" },
          { type: "text", dataset: { pricingRecordType: "sell", pricingRuleField: "label" }, value: "TEMP_SELL_POST_FIX_QA" },
          { type: "number", dataset: { pricingRecordType: "sell", pricingRuleField: "export_rate" }, value: "1" },
          { type: "time", dataset: { pricingRecordType: "sell", pricingRuleField: "start_time" }, value: "00:00" },
          { type: "time", dataset: { pricingRecordType: "sell", pricingRuleField: "end_time" }, value: "23:59" },
        ];
        const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => ({
          type: "checkbox", checked: true, dataset: { pricingRecordType: "sell", pricingRuleDay: day },
        }));
        const button = { dataset: { pricingUiAddRule: "sell" }, addEventListener() {} };
        panel.shadowRoot = {
          activeElement: null,
          addEventListener() {},
          querySelector() { return null; },
          querySelectorAll(selector) {
            if (selector === '[data-pricing-ui-add-rule]') return [button];
            if (selector === '[data-pricing-rule-field][data-pricing-record-type="sell"]') return fields;
            if (selector === '[data-pricing-rule-day][data-pricing-record-type="sell"]:checked') return days;
            return [];
          },
        };
        let state = { groups: [{ group_id: "temp-group", rules: [] }], activeGroupId: "temp-group", warning: "" };
        let calls = [];
        let renders = [];
        panel._loadPricingUi = () => state;
        panel._savePricingUi = (next) => { state = JSON.parse(JSON.stringify(next)); };
        panel._pricingUiRuleDrafts = { buy: panel._pricingUiRuleDefaults("buy"), sell: panel._pricingUiRuleDefaults("sell") };
        panel._pricingUiRuleDraft = panel._pricingUiRuleDrafts.sell;
        panel._pricingUiSaveInFlight = false;
        panel._resetPricingUiRuleDraft = () => {};
        panel._clearPricingEditorUrl = () => {};
        panel._holdRenderWindow = () => {};
        panel._render = (force) => renders.push({ force, rules: state.groups[0].rules.map((rule) => ({ ...rule })) });
        panel._callPricingRecordService = (groupId, rule) => { calls.push({ groupId, ...rule, export_rate: Number(rule.export_rate) }); return Promise.resolve(); };
        panel._criticalPressHandlersBound = true;
        Promise.resolve()
          .then(async () => {
            panel._bindInteractiveControls();
            if (typeof button.onclick !== "function") throw new Error("Save Sell button was not bound");
            button.onclick({ preventDefault() {}, stopPropagation() {} });
            await new Promise((resolve) => setTimeout(resolve, 0));
            const saved = state.groups[0].rules[0];
            const ok = calls.length === 1
              && calls[0].groupId === "temp-group"
              && calls[0].record_type === "sell"
              && calls[0].export_rate === 1
              && saved?.record_type === "sell"
              && saved?.export_rate === "1"
              && renders.some((render) => render.force === true && render.rules.some((rule) => rule.record_type === "sell"));
            if (!ok) {
              console.error(JSON.stringify({ calls, state, renders, bound: typeof button.onclick }, null, 2));
              process.exit(1);
            }
          })
          .catch((error) => { console.error(error); process.exit(1); });
        """
    )
    subprocess.run(["node", "-e", script], cwd=ROOT, check=True)


def test_pricing_panel_ui_delete_cleanup_clears_editor_and_draft_state():
    script = textwrap.dedent(
        r"""
        const fs = require("fs");
        const vm = require("vm");
        let source = fs.readFileSync("examples/www/heros-panel.js", "utf8");
        source = source.replace(/^import .*$/mg, "");
        source = source.replace("class HerosPanel extends HTMLElement", "globalThis.HerosPanel = class HerosPanel extends HTMLElement");
        class HTMLElement {
          attachShadow() { return { innerHTML: "", addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; } }; }
        }
        const context = {
          console, HTMLElement, URL,
          window: { location: { href: "http://example.test/heros?heros_page=pricing&heros_editor=modify&heros_action=edit" }, history: { replaceState() {} } },
          document: { addEventListener() {}, removeEventListener() {} },
          customElements: { get() { return false; }, define() {} },
        };
        context.globalThis = context;
        vm.createContext(context);
        vm.runInContext(source, context, { filename: "heros-panel.js" });
        const panel = new context.HerosPanel();
        panel._pricingGroupSelectorOpen = true;
        panel._pricingGroupEditorOpen = true;
        panel._pricingRecordEditorMode = "sell";
        panel._pricingUiGroupDraft = { group_id: "deleted-group" };
        panel._pricingUiForcedGroupType = "fixed";
        panel._pricingUiRuleDrafts = { buy: { rule_id: "buy-1" }, sell: { rule_id: "sell-1" } };
        panel._pricingUiRuleDraft = panel._pricingUiRuleDrafts.sell;
        panel._renderHoldUntil = Date.now() + 10000;
        panel._clearPricingEditorUrl = () => { panel._urlCleared = true; };
        panel._clearPricingUiEditorState();
        const ok = !panel._pricingGroupSelectorOpen
          && !panel._pricingGroupEditorOpen
          && panel._pricingRecordEditorMode === ""
          && Object.keys(panel._pricingUiGroupDraft).length === 0
          && panel._pricingUiForcedGroupType === ""
          && !panel._pricingUiRuleDrafts.buy?.rule_id
          && !panel._pricingUiRuleDrafts.sell?.rule_id
          && panel._pricingUiRuleDraft === panel._pricingUiRuleDrafts.buy
          && panel._renderHoldUntil === 0
          && panel._urlCleared === true;
        if (!ok) throw new Error("Pricing delete cleanup did not clear editor state");
        """
    )
    subprocess.run(["node", "-e", script], cwd=ROOT, check=True)
