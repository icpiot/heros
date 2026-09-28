import importlib.util
import os
import sys
from datetime import date

import pytest


def _load_roi_module():
    here = os.path.dirname(__file__)
    path = os.path.abspath(os.path.join(here, "..", "custom_components", "heros", "roi.py"))
    spec = importlib.util.spec_from_file_location("heros_roi", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


roi = _load_roi_module()
RepaymentScheduleEntry = roi.RepaymentScheduleEntry
VppRateEntry = roi.VppRateEntry
RoiSettings = roi.RoiSettings


def test_roi_settings_retains_repayment_change_history():
    settings = RoiSettings(
        solar_installation_cost=12000,
        battery_installation_cost=8000,
        repayments=(
            RepaymentScheduleEntry(effective_start_date="2026-09-06", amount=200, frequency="weekly"),
            RepaymentScheduleEntry(effective_start_date="2027-01-01", amount=150, frequency="weekly"),
        ),
    )

    restored = RoiSettings.from_dict(settings.to_dict())

    assert restored.total_installation_cost == 20000
    assert restored.active_repayment(date(2026, 12, 31)).amount == 200
    assert restored.active_repayment(date(2027, 1, 1)).amount == 150


def test_roi_settings_rejects_duplicate_repayment_start_date():
    with pytest.raises(ValueError, match="one repayment"):
        RoiSettings(
            repayments=(
                RepaymentScheduleEntry(effective_start_date="2026-09-06", amount=200),
                RepaymentScheduleEntry(effective_start_date="2026-09-06", amount=150),
            )
        )

def test_roi_settings_retains_vpp_rate_history():
    settings = RoiSettings(vpp_rates=(
        VppRateEntry(provider="Synergy", effective_start_date="2026-09-06", cents_per_kwh=5),
        VppRateEntry(provider="Synergy", effective_start_date="2027-01-01", cents_per_kwh=7.5),
    ))
    restored = RoiSettings.from_dict(settings.to_dict())
    assert [entry.cents_per_kwh for entry in restored.vpp_rates] == [5, 7.5]


def test_roi_settings_rejects_duplicate_vpp_provider_date():
    with pytest.raises(ValueError, match="one VPP rate"):
        RoiSettings(vpp_rates=(
            VppRateEntry(provider="Synergy", effective_start_date="2026-09-06", cents_per_kwh=5),
            VppRateEntry(provider="synergy", effective_start_date="2026-09-06", cents_per_kwh=7),
        ))

def test_repayment_extended_fields_round_trip_and_non_recurring_flag():
    entry = RepaymentScheduleEntry(
        effective_start_date="2026-09-06",
        effective_end_date="2026-12-31",
        description="Battery repayment",
        amount=200,
        repayment_period="monthly",
        is_recurring=False,
        notes="Review at year end",
    )

    restored = RepaymentScheduleEntry.from_dict(entry.to_dict())

    assert restored.repayment_period == "monthly"
    assert restored.frequency == "monthly"
    assert restored.is_recurring is False
    assert restored.effective_end_date == date(2026, 12, 31)
    assert restored.description == "Battery repayment"
    assert restored.notes == "Review at year end"


def test_repayment_end_date_cannot_precede_start_date():
    with pytest.raises(ValueError, match="effective_end_date"):
        RepaymentScheduleEntry(
            effective_start_date="2026-09-06",
            effective_end_date="2026-09-05",
            amount=200,
        )