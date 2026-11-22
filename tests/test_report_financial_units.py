"""Financial report totals use dollars while saved supply rates use cents."""
from __future__ import annotations

import subprocess
import textwrap
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_cost_summary_and_savings_convert_daily_supply_cents():
    script = textwrap.dedent(r"""
        const assert = require("node:assert/strict");
        const fs = require("node:fs");
        const vm = require("node:vm");
        const elements = new Map();
        const context = {
          HTMLElement: class {},
          window: {},
          customElements: {
            get(name) { return elements.get(name); },
            define(name, value) { elements.set(name, value); },
          },
        };
        vm.createContext(context);
        vm.runInContext(fs.readFileSync("examples/www/heros-report-card.009.js", "utf8"), context);
        const card = new (elements.get("heros-report-card"))();
        const totals = card._financialTotalsForDays([
          { tariff: { import: 0, credit: 0, supply: 108.4, gridOnly: 5.4 } },
        ]);
        assert.ok(Math.abs(totals.supplyCost - 1.084) < 0.000001);
        assert.ok(Math.abs(totals.netCost - 1.084) < 0.000001);
        assert.ok(Math.abs(totals.gridOnlyCost - 6.484) < 0.000001);
        assert.ok(Math.abs(totals.avoidedCost - 5.4) < 0.000001);

        const withCredit = card._financialTotalsForDays([
          { tariff: { import: 2, credit: 0.5, supply: 108.4, gridOnly: 5.4 } },
        ]);
        assert.ok(Math.abs(withCredit.netCost - 2.584) < 0.000001);
        assert.ok(Math.abs(withCredit.avoidedCost - 3.9) < 0.000001);
    """)
    subprocess.run(["node", "-e", script], cwd=ROOT, check=True)
