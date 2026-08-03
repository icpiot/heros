"""Vendor-neutral pricing history helpers.

This module is intentionally separate from the live reporting/card flow.
It provides a simple data model that can represent:

- fixed import or export tariffs
- time-of-use windows
- dynamic market intervals
- spike or peak export pricing

The current integration does not calculate tariff totals yet. These models
exist so future pricing storage and card views can reuse the same shape.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time
from uuid import uuid4
from typing import Any

_FLOW_VALUES = {"import", "export", "net"}
_MODE_VALUES = {"fixed", "tou", "dynamic", "market"}
_PRICING_TYPE_VALUES = {"fixed", "dynamic"}
_RATE_RECORD_TYPE_VALUES = {"buy", "sell"}
_DAY_TYPE_VALUES = {"mon", "tue", "wed", "thu", "fri", "sat", "sun", "public_holiday"}


def _clean_text(value: Any, default: str = "") -> str:
    text = str(value or "").strip()
    return text or default


def _parse_datetime(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value
    text = _clean_text(value)
    if not text:
        return None
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def _parse_date(value: Any) -> date | None:
    if value in (None, ""):
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    text = _clean_text(value)
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def _parse_time(value: Any, default: str = "00:00") -> str:
    text = _clean_text(value, default)
    if not text:
        return default
    if len(text) == 4 and text.isdigit():
        text = f"{text[:2]}:{text[2:]}"
    try:
        parsed = time.fromisoformat(text[:5])
    except ValueError as err:
        raise ValueError(f"Invalid time value: {value!r}") from err
    return parsed.strftime("%H:%M")


def _parse_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError) as err:
        raise ValueError(f"Invalid numeric value: {value!r}") from err


def _parse_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    text = _clean_text(value).lower()
    return text in {"1", "true", "yes", "on"}


def _jsonable_datetime(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.isoformat()


def _jsonable_date(value: date | None) -> str | None:
    if value is None:
        return None
    return value.isoformat()


def _clean_string_list(values: Any) -> tuple[str, ...]:
    if not values:
        return ()
    if isinstance(values, str):
        items = values.split(",")
    else:
        items = list(values)
    cleaned = []
    for item in items:
        text = _clean_text(item).lower()
        if text:
            cleaned.append(text)
    return tuple(dict.fromkeys(cleaned))


def _time_to_minutes(value: str) -> int:
    parsed = time.fromisoformat(_parse_time(value))
    return parsed.hour * 60 + parsed.minute


def _time_segments(start_time: str, end_time: str) -> tuple[tuple[int, int], ...]:
    start = _time_to_minutes(start_time)
    end = _time_to_minutes(end_time)
    if start == end:
        return ()
    if end > start:
        return ((start, end),)
    return ((start, 1440), (0, end))


@dataclass(frozen=True, slots=True)
class PriceRecord:
    """One time-bounded tariff record.

    ``flow`` identifies the energy direction being priced. ``mode`` describes
    how the value was sourced. ``priority`` allows narrow spike entries to win
    over broader base rates when windows overlap.
    """

    flow: str
    mode: str
    value: float
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    label: str = ""
    currency: str = "AUD"
    unit: str = "c/kWh"
    source: str = ""
    region: str = ""
    tariff_name: str = ""
    priority: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        flow = _clean_text(self.flow).lower()
        mode = _clean_text(self.mode).lower()
        if flow not in _FLOW_VALUES:
            raise ValueError(f"Unsupported flow: {self.flow!r}")
        if mode not in _MODE_VALUES:
            raise ValueError(f"Unsupported mode: {self.mode!r}")
        if self.ends_at is not None and self.starts_at is not None and self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be after starts_at")
        object.__setattr__(self, "flow", flow)
        object.__setattr__(self, "mode", mode)
        object.__setattr__(self, "label", _clean_text(self.label))
        object.__setattr__(self, "currency", _clean_text(self.currency, "AUD"))
        object.__setattr__(self, "unit", _clean_text(self.unit, "c/kWh"))
        object.__setattr__(self, "source", _clean_text(self.source))
        object.__setattr__(self, "region", _clean_text(self.region))
        object.__setattr__(self, "tariff_name", _clean_text(self.tariff_name))
        object.__setattr__(self, "priority", int(self.priority or 0))
        object.__setattr__(self, "metadata", dict(self.metadata or {}))

    def contains(self, at: datetime) -> bool:
        """Return True when ``at`` falls inside the record window."""
        if self.starts_at is not None and at < self.starts_at:
            return False
        if self.ends_at is not None and at >= self.ends_at:
            return False
        return True

    def to_dict(self) -> dict[str, Any]:
        """Serialize the record to plain JSON-safe data."""
        return {
            "flow": self.flow,
            "mode": self.mode,
            "value": self.value,
            "starts_at": _jsonable_datetime(self.starts_at),
            "ends_at": _jsonable_datetime(self.ends_at),
            "label": self.label,
            "currency": self.currency,
            "unit": self.unit,
            "source": self.source,
            "region": self.region,
            "tariff_name": self.tariff_name,
            "priority": self.priority,
            "metadata": dict(self.metadata),
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "PriceRecord":
        """Build a record from a serialized dictionary."""
        return cls(
            flow=_clean_text(payload.get("flow"), "export"),
            mode=_clean_text(payload.get("mode"), "fixed"),
            value=float(payload.get("value") or 0),
            starts_at=_parse_datetime(payload.get("starts_at")),
            ends_at=_parse_datetime(payload.get("ends_at")),
            label=_clean_text(payload.get("label")),
            currency=_clean_text(payload.get("currency"), "AUD"),
            unit=_clean_text(payload.get("unit"), "c/kWh"),
            source=_clean_text(payload.get("source")),
            region=_clean_text(payload.get("region")),
            tariff_name=_clean_text(payload.get("tariff_name")),
            priority=int(payload.get("priority") or 0),
            metadata=dict(payload.get("metadata") or {}),
        )


@dataclass(slots=True)
class PriceHistory:
    """Ordered collection of pricing records."""

    entries: list[PriceRecord] = field(default_factory=list)

    def add(self, record: PriceRecord) -> None:
        self.entries.append(record)

    def for_flow(self, flow: str) -> list[PriceRecord]:
        flow = _clean_text(flow).lower()
        return [record for record in self.entries if record.flow == flow]

    def active_at(self, at: datetime, *, flow: str | None = None) -> list[PriceRecord]:
        """Return all records active at a point in time."""
        min_start = datetime.min.replace(tzinfo=at.tzinfo) if at.tzinfo is not None else datetime.min
        matches = [
            record
            for record in self.entries
            if record.contains(at) and (flow is None or record.flow == _clean_text(flow).lower())
        ]
        return sorted(
            matches,
            key=lambda record: (record.priority, record.starts_at or min_start),
        )

    def best_match(self, at: datetime, *, flow: str | None = None) -> PriceRecord | None:
        """Return the single best record for a timestamp."""
        matches = self.active_at(at, flow=flow)
        return matches[-1] if matches else None

    def to_dict(self) -> dict[str, Any]:
        return {"entries": [record.to_dict() for record in self.entries]}

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "PriceHistory":
        entries = payload.get("entries") or []
        records = [
            PriceRecord.from_dict(entry)
            for entry in entries
            if isinstance(entry, dict)
        ]
        return cls(entries=records)


@dataclass(frozen=True, slots=True)
class PricingRateRecord:
    """One day/time tariff record inside a date-effective pricing group."""

    record_id: str = ""
    record_type: str = "buy"
    label: str = ""
    day_types: tuple[str, ...] = field(default_factory=tuple)
    start_time: str = "00:00"
    end_time: str = "23:59"
    import_rate: float | None = None
    export_rate: float | None = None
    controlled_load_rate: float | None = None
    other_charges: str = ""
    notes: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        day_types = _clean_string_list(self.day_types)
        invalid_days = [day for day in day_types if day not in _DAY_TYPE_VALUES]
        if invalid_days:
            raise ValueError(f"Unsupported day type(s): {', '.join(invalid_days)}")
        record_type = _clean_text(self.record_type, "buy").lower()
        if record_type not in _RATE_RECORD_TYPE_VALUES:
            raise ValueError(f"Unsupported record_type: {self.record_type!r}")
        start_time = _parse_time(self.start_time)
        end_time = _parse_time(self.end_time, "23:59")
        if not _time_segments(start_time, end_time):
            raise ValueError("end_time must differ from start_time")
        object.__setattr__(self, "record_id", _clean_text(self.record_id) or uuid4().hex)
        object.__setattr__(self, "record_type", record_type)
        object.__setattr__(self, "label", _clean_text(self.label))
        object.__setattr__(self, "day_types", day_types or ("mon", "tue", "wed", "thu", "fri"))
        object.__setattr__(self, "start_time", start_time)
        object.__setattr__(self, "end_time", end_time)
        object.__setattr__(self, "import_rate", _parse_float(self.import_rate))
        object.__setattr__(self, "export_rate", _parse_float(self.export_rate))
        object.__setattr__(self, "controlled_load_rate", _parse_float(self.controlled_load_rate))
        object.__setattr__(self, "other_charges", _clean_text(self.other_charges))
        object.__setattr__(self, "notes", _clean_text(self.notes))
        object.__setattr__(self, "metadata", dict(self.metadata or {}))

    @property
    def is_public_holiday(self) -> bool:
        return "public_holiday" in self.day_types

    def overlaps(self, other: "PricingRateRecord") -> bool:
        """Return True when records conflict inside the same override bucket."""
        if self.record_type != other.record_type:
            return False
        if self.is_public_holiday != other.is_public_holiday:
            return False
        if not any(day in other.day_types for day in self.day_types):
            return False
        return any(
            start_a < end_b and start_b < end_a
            for start_a, end_a in _time_segments(self.start_time, self.end_time)
            for start_b, end_b in _time_segments(other.start_time, other.end_time)
        )

    def applies_to(self, at: datetime, *, is_public_holiday: bool = False) -> bool:
        day_key = "public_holiday" if is_public_holiday else at.strftime("%a").lower()[:3]
        if day_key not in self.day_types:
            return False
        current = at.hour * 60 + at.minute
        return any(start <= current < end for start, end in _time_segments(self.start_time, self.end_time))

    def sort_key(self) -> tuple[Any, ...]:
        return (self.is_public_holiday, self.start_time, self.end_time, self.label, self.record_id)

    def to_dict(self) -> dict[str, Any]:
        return {
            "record_id": self.record_id,
            "record_type": self.record_type,
            "label": self.label,
            "day_types": list(self.day_types),
            "start_time": self.start_time,
            "end_time": self.end_time,
            "import_rate": self.import_rate,
            "export_rate": self.export_rate,
            "controlled_load_rate": self.controlled_load_rate,
            "other_charges": self.other_charges,
            "notes": self.notes,
            "metadata": dict(self.metadata),
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "PricingRateRecord":
        return cls(
            record_id=_clean_text(payload.get("record_id") or payload.get("rule_id")),
            record_type=_clean_text(payload.get("record_type"), "buy"),
            label=_clean_text(payload.get("label")),
            day_types=payload.get("day_types") or payload.get("days_of_week") or (),
            start_time=_clean_text(payload.get("start_time"), "00:00"),
            end_time=_clean_text(payload.get("end_time"), "23:59"),
            import_rate=payload.get("import_rate"),
            export_rate=payload.get("export_rate"),
            controlled_load_rate=payload.get("controlled_load_rate") or payload.get("controlled_load_1"),
            other_charges=_clean_text(payload.get("other_charges")),
            notes=_clean_text(payload.get("notes")),
            metadata=dict(payload.get("metadata") or {}),
        )


@dataclass(frozen=True, slots=True)
class PricingRateGroup:
    """Date-effective collection of tariff records."""

    group_id: str = ""
    label: str = ""
    provider: str = ""
    plan_name: str = ""
    effective_start_date: date | None = None
    pricing_type: str = "dynamic"
    daily_connection_charge: float | None = None
    other_charges: str = ""
    notes: str = ""
    records: tuple[PricingRateRecord, ...] = field(default_factory=tuple)
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        effective_start_date = _parse_date(self.effective_start_date)
        if effective_start_date is None:
            raise ValueError("effective_start_date is required")
        pricing_type = _clean_text(self.pricing_type, "dynamic").lower()
        if pricing_type not in _PRICING_TYPE_VALUES:
            raise ValueError(f"Unsupported pricing type: {self.pricing_type!r}")
        records = tuple(
            record if isinstance(record, PricingRateRecord) else PricingRateRecord.from_dict(record)
            for record in (self.records or ())
        )
        self._raise_for_overlaps(records)
        object.__setattr__(self, "group_id", _clean_text(self.group_id) or uuid4().hex)
        object.__setattr__(self, "label", _clean_text(self.label))
        object.__setattr__(self, "provider", _clean_text(self.provider))
        object.__setattr__(self, "plan_name", _clean_text(self.plan_name))
        object.__setattr__(self, "effective_start_date", effective_start_date)
        object.__setattr__(self, "pricing_type", pricing_type)
        object.__setattr__(self, "daily_connection_charge", _parse_float(self.daily_connection_charge))
        object.__setattr__(self, "other_charges", _clean_text(self.other_charges))
        object.__setattr__(self, "notes", _clean_text(self.notes))
        object.__setattr__(self, "records", tuple(sorted(records, key=lambda item: item.sort_key())))
        object.__setattr__(self, "metadata", dict(self.metadata or {}))

    @staticmethod
    def _raise_for_overlaps(records: tuple[PricingRateRecord, ...]) -> None:
        for index, record in enumerate(records):
            for other in records[index + 1:]:
                if record.overlaps(other):
                    raise ValueError(f"Pricing record {record.label or record.record_id!r} overlaps {other.label or other.record_id!r}")

    def active_records(self, at: datetime, *, holiday_dates: set[str] | None = None) -> list[PricingRateRecord]:
        is_public_holiday = at.date().isoformat() in (holiday_dates or set())
        public_holiday_matches = [
            record for record in self.records
            if record.is_public_holiday and record.applies_to(at, is_public_holiday=is_public_holiday)
        ]
        if public_holiday_matches:
            return sorted(public_holiday_matches, key=lambda item: item.sort_key())
        return sorted(
            [record for record in self.records if record.applies_to(at, is_public_holiday=False)],
            key=lambda item: item.sort_key(),
        )

    def active_record(self, at: datetime, *, holiday_dates: set[str] | None = None) -> PricingRateRecord | None:
        matches = self.active_records(at, holiday_dates=holiday_dates)
        return matches[-1] if matches else None

    def to_dict(self) -> dict[str, Any]:
        return {
            "group_id": self.group_id,
            "label": self.label,
            "provider": self.provider,
            "plan_name": self.plan_name,
            "effective_start_date": _jsonable_date(self.effective_start_date),
            "pricing_type": self.pricing_type,
            "daily_connection_charge": self.daily_connection_charge,
            "other_charges": self.other_charges,
            "notes": self.notes,
            "records": [record.to_dict() for record in self.records],
            "metadata": dict(self.metadata),
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "PricingRateGroup":
        return cls(
            group_id=_clean_text(payload.get("group_id")),
            label=_clean_text(payload.get("label")),
            provider=_clean_text(payload.get("provider")),
            plan_name=_clean_text(payload.get("plan_name")),
            effective_start_date=_parse_date(payload.get("effective_start_date")),
            pricing_type=_clean_text(payload.get("pricing_type"), "dynamic"),
            daily_connection_charge=payload.get("daily_connection_charge"),
            other_charges=_clean_text(payload.get("other_charges")),
            notes=_clean_text(payload.get("notes")),
            records=tuple(PricingRateRecord.from_dict(record) for record in payload.get("records") or [] if isinstance(record, dict)),
            metadata=dict(payload.get("metadata") or {}),
        )


@dataclass(frozen=True, slots=True)
class PricingRule:
    """Date-effective pricing rule for fixed or dynamic tariffs."""

    rule_id: str = ""
    effective_date: date | None = None
    pricing_type: str = "fixed"
    start_time: str = "00:00"
    end_time: str = ""
    effective_end_date: date | None = None
    effective_end_time: str = ""
    provider: str = ""
    label: str = ""
    import_rate: float | None = None
    export_rate: float | None = None
    supply_charge: float | None = None
    controlled_load_1: float | None = None
    controlled_load_2: float | None = None
    additional_charge: float | None = None
    holiday_only: bool = False
    notes: str = ""
    priority: int = 0
    days_of_week: tuple[str, ...] = field(default_factory=tuple)
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        pricing_type = _clean_text(self.pricing_type).lower()
        if pricing_type not in _PRICING_TYPE_VALUES:
            raise ValueError(f"Unsupported pricing type: {self.pricing_type!r}")
        effective_date = _parse_date(self.effective_date)
        if effective_date is None:
            raise ValueError("effective_date is required")
        effective_end_date = _parse_date(self.effective_end_date)
        start_time = _parse_time(self.start_time)
        end_time = _parse_time(self.end_time, "") if self.end_time else ""
        effective_end_time = _parse_time(self.effective_end_time, "") if self.effective_end_time else ""
        if effective_end_date is not None and effective_end_date < effective_date:
            raise ValueError("effective_end_date must be after effective_date")
        if effective_end_date is not None and effective_end_date == effective_date:
            start_dt = datetime.combine(effective_date, time.fromisoformat(start_time))
            if effective_end_time:
                end_dt = datetime.combine(effective_end_date, time.fromisoformat(effective_end_time))
                if end_dt <= start_dt:
                    raise ValueError("effective_end_time must be after start_time")
            elif end_time:
                end_dt = datetime.combine(effective_end_date, time.fromisoformat(end_time))
                if end_dt <= start_dt:
                    raise ValueError("end_time must be after start_time")
        object.__setattr__(self, "rule_id", _clean_text(self.rule_id) or uuid4().hex)
        object.__setattr__(self, "effective_date", effective_date)
        object.__setattr__(self, "pricing_type", pricing_type)
        object.__setattr__(self, "start_time", start_time)
        object.__setattr__(self, "end_time", end_time)
        object.__setattr__(self, "effective_end_date", effective_end_date)
        object.__setattr__(self, "effective_end_time", effective_end_time)
        object.__setattr__(self, "provider", _clean_text(self.provider))
        object.__setattr__(self, "label", _clean_text(self.label))
        object.__setattr__(self, "import_rate", _parse_float(self.import_rate))
        object.__setattr__(self, "export_rate", _parse_float(self.export_rate))
        object.__setattr__(self, "supply_charge", _parse_float(self.supply_charge))
        object.__setattr__(self, "controlled_load_1", _parse_float(self.controlled_load_1))
        object.__setattr__(self, "controlled_load_2", _parse_float(self.controlled_load_2))
        object.__setattr__(self, "additional_charge", _parse_float(self.additional_charge))
        object.__setattr__(self, "holiday_only", _parse_bool(self.holiday_only))
        object.__setattr__(self, "notes", _clean_text(self.notes))
        object.__setattr__(self, "priority", int(self.priority or 0))
        object.__setattr__(self, "days_of_week", _clean_string_list(self.days_of_week))
        object.__setattr__(self, "metadata", dict(self.metadata or {}))

    @property
    def effective_key(self) -> str:
        return self.effective_date.isoformat() if self.effective_date else "unknown"

    def contains(self, at: datetime, *, holiday_dates: set[str] | None = None) -> bool:
        """Return True when the rule applies to the supplied datetime."""
        if self.effective_date is None:
            return False
        tzinfo = at.tzinfo
        current_date = at.date()
        if current_date < self.effective_date:
            return False
        if self.effective_end_date is not None and current_date > self.effective_end_date:
            return False
        if self.holiday_only and current_date.isoformat() not in (holiday_dates or set()):
            return False
        if self.days_of_week:
            weekday = at.strftime("%a").lower()
            if weekday not in self.days_of_week and weekday[:3] not in self.days_of_week:
                return False
        start_dt = datetime.combine(self.effective_date, time.fromisoformat(self.start_time))
        if tzinfo is not None:
            start_dt = start_dt.replace(tzinfo=tzinfo)
        if at < start_dt:
            return False
        if self.effective_end_date is not None and self.effective_end_time:
            end_dt = datetime.combine(self.effective_end_date, time.fromisoformat(self.effective_end_time))
            if tzinfo is not None:
                end_dt = end_dt.replace(tzinfo=tzinfo)
            return at < end_dt
        if self.effective_end_date is not None and self.end_time:
            end_dt = datetime.combine(self.effective_end_date, time.fromisoformat(self.end_time))
            if tzinfo is not None:
                end_dt = end_dt.replace(tzinfo=tzinfo)
            return at < end_dt
        if self.end_time:
            end_dt = datetime.combine(self.effective_date, time.fromisoformat(self.end_time))
            if tzinfo is not None:
                end_dt = end_dt.replace(tzinfo=tzinfo)
            if end_dt > start_dt and at >= end_dt:
                return False
        return True

    def sort_key(self) -> tuple[Any, ...]:
        return (
            self.effective_date or date.min,
            self.start_time,
            self.pricing_type,
            self.priority,
            self.rule_id,
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "rule_id": self.rule_id,
            "effective_date": _jsonable_date(self.effective_date),
            "effective_end_date": _jsonable_date(self.effective_end_date),
            "start_time": self.start_time,
            "end_time": self.end_time,
            "effective_end_time": self.effective_end_time,
            "type": self.pricing_type,
            "provider": self.provider,
            "label": self.label,
            "import_rate": self.import_rate,
            "export_rate": self.export_rate,
            "supply_charge": self.supply_charge,
            "controlled_load_1": self.controlled_load_1,
            "controlled_load_2": self.controlled_load_2,
            "additional_charge": self.additional_charge,
            "holiday_only": self.holiday_only,
            "notes": self.notes,
            "priority": self.priority,
            "days_of_week": list(self.days_of_week),
            "metadata": dict(self.metadata),
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "PricingRule":
        return cls(
            rule_id=_clean_text(payload.get("rule_id")),
            effective_date=_parse_date(payload.get("effective_date")),
            effective_end_date=_parse_date(payload.get("effective_end_date")),
            start_time=_clean_text(payload.get("start_time"), "00:00"),
            end_time=_clean_text(payload.get("end_time")),
            effective_end_time=_clean_text(payload.get("effective_end_time")),
            pricing_type=_clean_text(payload.get("type") or payload.get("pricing_type"), "fixed"),
            provider=_clean_text(payload.get("provider")),
            label=_clean_text(payload.get("label")),
            import_rate=payload.get("import_rate"),
            export_rate=payload.get("export_rate"),
            supply_charge=payload.get("supply_charge"),
            controlled_load_1=payload.get("controlled_load_1"),
            controlled_load_2=payload.get("controlled_load_2"),
            additional_charge=payload.get("additional_charge"),
            holiday_only=payload.get("holiday_only"),
            notes=_clean_text(payload.get("notes")),
            priority=int(payload.get("priority") or 0),
            days_of_week=payload.get("days_of_week") or (),
            metadata=dict(payload.get("metadata") or {}),
        )


@dataclass(slots=True)
class PricingSchedule:
    """Ordered collection of date-based pricing rules and holidays."""

    rules: list[PricingRule] = field(default_factory=list)
    groups: list[PricingRateGroup] = field(default_factory=list)
    holiday_dates: list[date] = field(default_factory=list)
    holiday_source: str = ""
    region: str = ""
    updated_at: datetime | None = None

    def __post_init__(self) -> None:
        self.groups = sorted(self.groups, key=lambda item: item.effective_start_date or date.min)
        self._raise_for_duplicate_group_dates()

    def add_rule(self, rule: PricingRule) -> None:
        self.rules = [existing for existing in self.rules if existing.rule_id != rule.rule_id]
        self.rules.append(rule)
        self.rules.sort(key=lambda item: item.sort_key())

    def remove_rule(self, rule_id: str) -> bool:
        before = len(self.rules)
        self.rules = [rule for rule in self.rules if rule.rule_id != _clean_text(rule_id)]
        return len(self.rules) != before

    def _raise_for_duplicate_group_dates(self) -> None:
        dates = [group.effective_start_date for group in self.groups if group.effective_start_date is not None]
        if len(dates) != len(set(dates)):
            raise ValueError("Pricing groups cannot share the same effective_start_date")

    def add_group(self, group: PricingRateGroup) -> None:
        existing_by_id = next((existing for existing in self.groups if existing.group_id == group.group_id), None)
        existing_by_date = next(
            (existing for existing in self.groups if existing.effective_start_date == group.effective_start_date),
            None,
        )
        if existing_by_id and existing_by_date and existing_by_id.group_id != existing_by_date.group_id:
            raise ValueError("Pricing groups cannot share the same effective_start_date")

        existing = existing_by_id or existing_by_date
        if existing:
            group_payload = group.to_dict()
            group = PricingRateGroup.from_dict({
                **group_payload,
                "group_id": existing.group_id,
                "records": group_payload.get("records") or [record.to_dict() for record in existing.records],
            })

        self.groups = [
            existing_group for existing_group in self.groups
            if existing_group.group_id != group.group_id
            and existing_group.effective_start_date != group.effective_start_date
        ]
        self.groups.append(group)
        self.groups.sort(key=lambda item: item.effective_start_date or date.min)
        self._raise_for_duplicate_group_dates()

    def remove_group(self, group_id: str) -> bool:
        before = len(self.groups)
        self.groups = [group for group in self.groups if group.group_id != _clean_text(group_id)]
        return len(self.groups) != before

    def has_holiday(self, value: date | str | None) -> bool:
        parsed = _parse_date(value)
        if parsed is None:
            return False
        return parsed.isoformat() in {item.isoformat() for item in self.holiday_dates}

    def active_rules(self, at: datetime | None = None) -> list[PricingRule]:
        at = at or datetime.now()
        holiday_dates = {item.isoformat() for item in self.holiday_dates}
        matches = [rule for rule in self.rules if rule.contains(at, holiday_dates=holiday_dates)]
        return sorted(matches, key=lambda item: item.sort_key())

    def active_rule(self, at: datetime | None = None) -> PricingRule | None:
        matches = self.active_rules(at)
        return matches[-1] if matches else None

    def active_group(self, at: datetime | None = None) -> PricingRateGroup | None:
        at = at or datetime.now()
        matches = [
            group for group in self.groups
            if group.effective_start_date is not None and group.effective_start_date <= at.date()
        ]
        return matches[-1] if matches else None

    def active_record(self, at: datetime | None = None) -> PricingRateRecord | None:
        at = at or datetime.now()
        group = self.active_group(at)
        if group is None:
            return None
        return group.active_record(
            at,
            holiday_dates={item.isoformat() for item in self.holiday_dates},
        )

    def rules_by_date(self) -> dict[str, dict[str, list[dict[str, Any]]]]:
        grouped: dict[str, dict[str, list[dict[str, Any]]]] = {}
        for rule in self.rules:
            date_key = rule.effective_key
            day_bucket = grouped.setdefault(date_key, {"fixed": [], "dynamic": []})
            day_bucket.setdefault(rule.pricing_type, []).append(rule.to_dict())
        return grouped

    def to_dict(self) -> dict[str, Any]:
        if self.groups:
            return {
                "version": 2,
                "updated_at": _jsonable_datetime(self.updated_at),
                "holiday_source": self.holiday_source,
                "region": self.region,
                "holiday_dates": [item.isoformat() for item in self.holiday_dates],
                "groups": [group.to_dict() for group in self.groups],
            }
        return {
            "version": 1,
            "updated_at": _jsonable_datetime(self.updated_at),
            "holiday_source": self.holiday_source,
            "region": self.region,
            "holiday_dates": [item.isoformat() for item in self.holiday_dates],
            "date_map": self.rules_by_date(),
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "PricingSchedule":
        if not isinstance(payload, dict):
            return cls()
        holiday_dates = [
            parsed
            for parsed in (_parse_date(value) for value in payload.get("holiday_dates") or [])
            if parsed is not None
        ]
        rules: list[PricingRule] = []
        groups: list[PricingRateGroup] = []
        if isinstance(payload.get("groups"), list):
            groups = [
                PricingRateGroup.from_dict(group)
                for group in payload.get("groups") or []
                if isinstance(group, dict)
            ]
        date_map = payload.get("date_map")
        if isinstance(date_map, dict):
            for _, type_map in sorted(date_map.items()):
                if not isinstance(type_map, dict):
                    continue
                for kind in ("fixed", "dynamic"):
                    for entry in type_map.get(kind) or []:
                        if isinstance(entry, dict):
                            rules.append(PricingRule.from_dict(entry))
        else:
            for entry in payload.get("rules") or payload.get("entries") or []:
                if isinstance(entry, dict):
                    rules.append(PricingRule.from_dict(entry))
        schedule = cls(
            rules=sorted(rules, key=lambda item: item.sort_key()),
            groups=groups,
            holiday_dates=holiday_dates,
            holiday_source=_clean_text(payload.get("holiday_source")),
            region=_clean_text(payload.get("region")),
        )
        updated_at = _parse_datetime(payload.get("updated_at") or payload.get("updated"))
        schedule.updated_at = updated_at
        return schedule
