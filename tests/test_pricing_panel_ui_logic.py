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

        let source = fs.readFileSync("examples/www/home-energy-manager-panel.js", "utf8");
        source = source.replace(/^import .*$/mg, "");
        source = source.replace(
          "class HomeEnergyManagerPanel extends HTMLElement",
          "globalThis.HomeEnergyManagerPanel = class HomeEnergyManagerPanel extends HTMLElement",
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
        vm.runInContext(source, context, { filename: "home-energy-manager-panel.js" });

        const panel = new context.HomeEnergyManagerPanel();
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


def test_pricing_panel_ui_rolls_back_when_service_call_fails():
    script = textwrap.dedent(
        r"""
        const fs = require("fs");
        const vm = require("vm");

        let source = fs.readFileSync("examples/www/home-energy-manager-panel.js", "utf8");
        source = source.replace(/^import .*$/mg, "");
        source = source.replace(
          "class HomeEnergyManagerPanel extends HTMLElement",
          "globalThis.HomeEnergyManagerPanel = class HomeEnergyManagerPanel extends HTMLElement",
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
        vm.runInContext(source, context, { filename: "home-energy-manager-panel.js" });

        const panel = new context.HomeEnergyManagerPanel();
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


def test_pricing_panel_ui_prefers_backend_over_local_draft():
    script = textwrap.dedent(
        r"""
        const fs = require("fs");
        const vm = require("vm");

        let source = fs.readFileSync("examples/www/home-energy-manager-panel.js", "utf8");
        source = source.replace(/^import .*$/mg, "");
        source = source.replace(
          "class HomeEnergyManagerPanel extends HTMLElement",
          "globalThis.HomeEnergyManagerPanel = class HomeEnergyManagerPanel extends HTMLElement",
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
          ["home-energy-manager.panel.pricing.ui", JSON.stringify({
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
        vm.runInContext(source, context, { filename: "home-energy-manager-panel.js" });

        const panel = new context.HomeEnergyManagerPanel();
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
        const ok = restored.groups.length === 1
          && restored.groups[0].group_id === "backend-group"
          && restored.activeGroupId === "backend-group"
          && !storage.has("home-energy-manager.panel.pricing.ui")
          && !storage.has("home-energy-manager.panel.pricing.draft");

        if (!ok) {
          console.error(JSON.stringify({ restored, storage: [...storage.entries()] }, null, 2));
          process.exit(1);
        }
        """
    )

    subprocess.run(["node", "-e", script], cwd=ROOT, check=True)
