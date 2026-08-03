"""Tests for the vendor-neutral pricing history helpers."""
from __future__ import annotations

import importlib.util
import os
import sys
from datetime import date, datetime, timezone

import pytest


def _load_pricing_module():
    here = os.path.dirname(__file__)
    path = os.path.abspath(os.path.join(
        here, "..", "custom_components", "home_energy_manager", "pricing.py",
    ))
    spec = importlib.util.spec_from_file_location("home_energy_manager_pricing", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


pricing = _load_pricing_module()
PriceHistory = pricing.PriceHistory
PriceRecord = pricing.PriceRecord
PricingRateGroup = pricing.PricingRateGroup
PricingRateRecord = pricing.PricingRateRecord
PricingRule = pricing.PricingRule
PricingSchedule = pricing.PricingSchedule


def test_price_record_round_trip_preserves_fields():
    record = PriceRecord(
        flow="export",
        mode="dynamic",
        value=18.75,
        starts_at=datetime(2026, 7, 14, 14, 0, tzinfo=timezone.utc),
        ends_at=datetime(2026, 7, 14, 14, 30, tzinfo=timezone.utc),
        label="Spike export",
        currency="AUD",
        unit="c/kWh",
        source="AEMO",
        region="NSW",
        tariff_name="Peak window",
        priority=100,
        metadata={"interval_minutes": 30},
    )

    restored = PriceRecord.from_dict(record.to_dict())

    assert restored == record


def test_price_history_prefers_high_priority_window():
    history = PriceHistory()
    history.add(
        PriceRecord(
            flow="export",
            mode="fixed",
            value=8.0,
            starts_at=datetime(2026, 7, 14, 0, 0, tzinfo=timezone.utc),
            ends_at=datetime(2026, 7, 15, 0, 0, tzinfo=timezone.utc),
            label="Base export",
            priority=0,
        )
    )
    history.add(
        PriceRecord(
            flow="export",
            mode="dynamic",
            value=34.0,
            starts_at=datetime(2026, 7, 14, 14, 0, tzinfo=timezone.utc),
            ends_at=datetime(2026, 7, 14, 14, 30, tzinfo=timezone.utc),
            label="Spike export",
            priority=100,
        )
    )

    spike = history.best_match(
        datetime(2026, 7, 14, 14, 15, tzinfo=timezone.utc),
        flow="export",
    )
    base = history.best_match(
        datetime(2026, 7, 14, 15, 0, tzinfo=timezone.utc),
        flow="export",
    )

    assert spike is not None
    assert spike.label == "Spike export"
    assert spike.value == 34.0
    assert base is not None
    assert base.label == "Base export"


def test_price_history_filters_by_flow():
    history = PriceHistory(
        entries=[
            PriceRecord(
                flow="import",
                mode="tou",
                value=22.0,
                starts_at=datetime(2026, 7, 14, 7, 0, tzinfo=timezone.utc),
                ends_at=datetime(2026, 7, 14, 9, 0, tzinfo=timezone.utc),
            ),
            PriceRecord(
                flow="export",
                mode="tou",
                value=7.5,
                starts_at=datetime(2026, 7, 14, 7, 0, tzinfo=timezone.utc),
                ends_at=datetime(2026, 7, 14, 9, 0, tzinfo=timezone.utc),
            ),
        ]
    )

    active_export = history.active_at(
        datetime(2026, 7, 14, 8, 0, tzinfo=timezone.utc),
        flow="export",
    )
    active_import = history.active_at(
        datetime(2026, 7, 14, 8, 0, tzinfo=timezone.utc),
        flow="import",
    )

    assert len(active_export) == 1
    assert active_export[0].flow == "export"
    assert len(active_import) == 1
    assert active_import[0].flow == "import"


def test_price_history_round_trip_preserves_entries():
    history = PriceHistory(
        entries=[
            PriceRecord(
                flow="export",
                mode="market",
                value=19.0,
                starts_at=datetime(2026, 7, 14, 14, 0, tzinfo=timezone.utc),
                ends_at=datetime(2026, 7, 14, 14, 30, tzinfo=timezone.utc),
                label="Dynamic export",
                priority=50,
            )
        ]
    )

    restored = PriceHistory.from_dict(history.to_dict())

    assert restored == history


def test_price_record_rejects_bad_time_window():
    with pytest.raises(ValueError):
        PriceRecord(
            flow="export",
            mode="fixed",
            value=10.0,
            starts_at=datetime(2026, 7, 14, 9, 0, tzinfo=timezone.utc),
            ends_at=datetime(2026, 7, 14, 8, 0, tzinfo=timezone.utc),
        )


def test_pricing_rule_round_trip_preserves_schedule_fields():
    rule = PricingRule(
        rule_id="rule-1",
        effective_date=date(2026, 7, 1),
        effective_end_date=date(2026, 12, 31),
        pricing_type="fixed",
        start_time="13:00",
        end_time="15:00",
        provider="Amber",
        label="Peak afternoon",
        import_rate=28.5,
        export_rate=6.25,
        supply_charge=1.2,
        controlled_load_1=17.0,
        controlled_load_2=11.0,
        additional_charge=0.5,
        holiday_only=True,
        notes="Public holiday override",
        days_of_week=("mon", "tue"),
        metadata={"region": "NSW"},
    )

    restored = PricingRule.from_dict(rule.to_dict())

    assert restored == rule


def test_pricing_schedule_prefers_holiday_override():
    schedule = PricingSchedule(
        rules=[
            PricingRule(
                rule_id="base",
                effective_date=date(2026, 7, 1),
                pricing_type="fixed",
                start_time="00:00",
                end_time="23:59",
                provider="Retailer",
                label="Base tariff",
                import_rate=30.0,
            ),
            PricingRule(
                rule_id="holiday",
                effective_date=date(2026, 7, 16),
                pricing_type="fixed",
                start_time="00:00",
                end_time="23:59",
                provider="Retailer",
                label="Holiday tariff",
                import_rate=18.0,
                holiday_only=True,
            ),
        ],
        holiday_dates=[date(2026, 7, 16)],
    )

    active = schedule.active_rule(datetime(2026, 7, 16, 12, 0, tzinfo=timezone.utc))

    assert active is not None
    assert active.rule_id == "holiday"


def test_pricing_rate_group_round_trip_preserves_records():
    group = PricingRateGroup(
        group_id="group-1",
        label="Rates from Jan 1",
        provider="Retailer",
        plan_name="Plan",
        effective_start_date=date(2026, 1, 1),
        pricing_type="fixed",
        daily_connection_charge=1.23,
        records=(
            PricingRateRecord(
                record_id="record-1",
                record_type="buy",
                label="Weekday peak",
                day_types=("mon", "tue", "wed", "thu", "fri"),
                start_time="14:00",
                end_time="20:00",
                import_rate=0.42,
                export_rate=0.05,
                controlled_load_rate=0.18,
                metadata={
                    "sell_tiers": {
                        "tier_1_limit_kwh": 1000,
                        "tier_1_rate": 0.08,
                        "tier_2_rate": 0.02,
                    },
                },
            ),
        ),
    )

    restored = PricingRateGroup.from_dict(group.to_dict())

    assert restored == group


def test_pricing_rate_group_allows_buy_and_sell_same_time_window():
    group = PricingRateGroup(
        group_id="group",
        effective_start_date=date(2026, 1, 1),
        records=(
            PricingRateRecord(
                record_id="buy-all",
                record_type="buy",
                day_types=("mon",),
                start_time="00:00",
                end_time="23:59",
                import_rate=0.42,
            ),
            PricingRateRecord(
                record_id="sell-all",
                record_type="sell",
                day_types=("mon",),
                start_time="00:00",
                end_time="23:59",
                export_rate=0.08,
            ),
        ),
    )

    restored = PricingRateGroup.from_dict(group.to_dict())

    assert [record.record_type for record in restored.records] == ["buy", "sell"]


def test_overlapping_same_type_rate_records_are_rejected():
    with pytest.raises(ValueError, match="overlaps"):
        PricingRateGroup(
            group_id="group",
            effective_start_date=date(2026, 1, 1),
            records=(
                PricingRateRecord(
                    record_id="buy-all",
                    record_type="buy",
                    day_types=("mon",),
                    start_time="00:00",
                    end_time="23:59",
                ),
                PricingRateRecord(
                    record_id="buy-peak",
                    record_type="buy",
                    day_types=("mon",),
                    start_time="12:00",
                    end_time="18:00",
                ),
            ),
        )


def test_pricing_schedule_selects_latest_effective_group():
    schedule = PricingSchedule(
        groups=[
            PricingRateGroup(
                group_id="jan",
                effective_start_date=date(2026, 1, 1),
                records=(PricingRateRecord(record_id="jan-all", day_types=("mon",), import_rate=0.30),),
            ),
            PricingRateGroup(
                group_id="jun",
                effective_start_date=date(2026, 6, 1),
                records=(PricingRateRecord(record_id="jun-all", day_types=("mon",), import_rate=0.42),),
            ),
        ]
    )

    active = schedule.active_group(datetime(2026, 7, 6, 12, 0, tzinfo=timezone.utc))

    assert active is not None
    assert active.group_id == "jun"


def test_fixed_pricing_uses_day_time_records():
    schedule = PricingSchedule(
        groups=[
            PricingRateGroup(
                group_id="fixed",
                effective_start_date=date(2026, 1, 1),
                pricing_type="fixed",
                records=(
                    PricingRateRecord(
                        record_id="peak",
                        day_types=("mon",),
                        start_time="14:00",
                        end_time="20:00",
                        import_rate=0.42,
                    ),
                ),
            )
        ]
    )

    active = schedule.active_record(datetime(2026, 7, 6, 15, 0, tzinfo=timezone.utc))

    assert active is not None
    assert active.record_id == "peak"
    assert active.import_rate == 0.42


def test_public_holiday_record_overrides_standard_day_overlap():
    group = PricingRateGroup(
        group_id="group",
        effective_start_date=date(2026, 1, 1),
        records=(
            PricingRateRecord(
                record_id="weekday",
                day_types=("mon",),
                start_time="00:00",
                end_time="23:59",
                import_rate=0.42,
            ),
            PricingRateRecord(
                record_id="holiday",
                day_types=("public_holiday",),
                start_time="00:00",
                end_time="23:59",
                import_rate=0.20,
            ),
        ),
    )
    schedule = PricingSchedule(groups=[group], holiday_dates=[date(2026, 7, 6)])

    active = schedule.active_record(datetime(2026, 7, 6, 12, 0, tzinfo=timezone.utc))

    assert active is not None
    assert active.record_id == "holiday"


def test_overlapping_public_holiday_records_are_rejected():
    with pytest.raises(ValueError, match="overlaps"):
        PricingRateGroup(
            group_id="group",
            effective_start_date=date(2026, 1, 1),
            records=(
                PricingRateRecord(
                    record_id="holiday-all",
                    day_types=("public_holiday",),
                    start_time="00:00",
                    end_time="23:59",
                ),
                PricingRateRecord(
                    record_id="holiday-peak",
                    day_types=("public_holiday",),
                    start_time="12:00",
                    end_time="18:00",
                ),
            ),
        )


def test_duplicate_group_start_dates_are_rejected():
    with pytest.raises(ValueError, match="effective_start_date"):
        PricingSchedule(
            groups=[
                PricingRateGroup(group_id="one", effective_start_date=date(2026, 1, 1)),
                PricingRateGroup(group_id="two", effective_start_date=date(2026, 1, 1)),
            ]
        )


def test_group_upsert_uses_effective_start_date_as_key_and_preserves_records():
    schedule = PricingSchedule(groups=[
        PricingRateGroup(
            group_id="existing",
            label="Old label",
            effective_start_date=date(2026, 8, 1),
            records=(
                PricingRateRecord(
                    record_id="peak",
                    label="Peak",
                    day_types=("mon",),
                    start_time="15:00",
                    end_time="21:00",
                    import_rate=0.456,
                ),
            ),
        ),
    ])

    schedule.add_group(
        PricingRateGroup(
            group_id="new-ui-draft",
            label="Browser Test Group v149",
            effective_start_date=date(2026, 8, 1),
            pricing_type="fixed",
            daily_connection_charge=0.149,
        )
    )

    assert len(schedule.groups) == 1
    assert schedule.groups[0].group_id == "existing"
    assert schedule.groups[0].label == "Browser Test Group v149"
    assert schedule.groups[0].daily_connection_charge == 0.149
    assert [record.record_id for record in schedule.groups[0].records] == ["peak"]
