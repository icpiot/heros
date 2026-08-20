"""Shared battery charge policy models and matching helpers."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, time
from typing import Any
from uuid import uuid4

_DAY_TYPE_VALUES = {"mon", "tue", "wed", "thu", "fri", "sat", "sun", "public_holiday"}
_DAY_INDEX = {
    0: "mon",
    1: "tue",
    2: "wed",
    3: "thu",
    4: "fri",
    5: "sat",
    6: "sun",
}


def _clean_text(value: Any, default: str = "") -> str:
    text = str(value or "").strip()
    return text or default


def _parse_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    return _clean_text(value).lower() in {"1", "true", "yes", "on"}


def _parse_time(value: Any, default: str = "00:00") -> str:
    text = _clean_text(value, default)
    if len(text) == 4 and text.isdigit():
        text = f"{text[:2]}:{text[2:]}"
    try:
        parsed = time.fromisoformat(text[:5])
    except ValueError as err:
        raise ValueError(f"Invalid time value: {value!r}") from err
    return parsed.strftime("%H:%M")


def _parse_int(value: Any, *, default: int = 0, minimum: int = 0, maximum: int = 100) -> int:
    if value in (None, ""):
        return default
    parsed = int(float(value))
    return max(minimum, min(maximum, parsed))


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


def _clean_day_types(values: Any) -> tuple[str, ...]:
    if not values:
        return ()
    if isinstance(values, str):
        items = values.split(",")
    else:
        items = list(values)
    cleaned: list[str] = []
    for item in items:
        text = _clean_text(item).lower()
        if text in _DAY_TYPE_VALUES and text not in cleaned:
            cleaned.append(text)
    return tuple(cleaned)


@dataclass(slots=True)
class PolicyChargeRow:
    """One scheduled charge window."""

    row_id: str = field(default_factory=lambda: uuid4().hex)
    label: str = ""
    start_time: str = "00:00"
    end_time: str = "00:15"
    cutoff_soc: int = 100
    day_types: tuple[str, ...] = ("mon", "tue", "wed", "thu", "fri")

    def __post_init__(self) -> None:
        self.row_id = _clean_text(self.row_id, uuid4().hex)
        self.label = _clean_text(self.label, "Battery Charge")
        self.start_time = _parse_time(self.start_time, "00:00")
        self.end_time = _parse_time(self.end_time, "00:15")
        self.cutoff_soc = _parse_int(self.cutoff_soc, default=100, minimum=1, maximum=100)
        day_types = _clean_day_types(self.day_types)
        self.day_types = day_types or ("mon", "tue", "wed", "thu", "fri")

    def matches(self, at: datetime, *, holiday_dates: set[str] | None = None) -> bool:
        current_day = _DAY_INDEX.get(at.weekday(), "mon")
        allowed_days = set(self.day_types)
        if current_day not in allowed_days:
            if "public_holiday" not in allowed_days:
                return False
            if at.date().isoformat() not in (holiday_dates or set()):
                return False
        current_minutes = at.hour * 60 + at.minute
        return any(start <= current_minutes < end for start, end in _time_segments(self.start_time, self.end_time))

    def to_dict(self) -> dict[str, Any]:
        return {
            "row_id": self.row_id,
            "label": self.label,
            "start_time": self.start_time,
            "end_time": self.end_time,
            "cutoff_soc": self.cutoff_soc,
            "day_types": list(self.day_types),
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "PolicyChargeRow":
        return cls(
            row_id=payload.get("row_id") or payload.get("record_id") or "",
            label=payload.get("label") or payload.get("policy_name") or "Battery Charge",
            start_time=payload.get("start_time") or "00:00",
            end_time=payload.get("end_time") or "00:15",
            cutoff_soc=payload.get("cutoff_soc") or 100,
            day_types=payload.get("day_types") or [],
        )


@dataclass(slots=True)
class PolicyChargeSchedule:
    """One saved charge policy for a selected target scope."""

    scope_key: str = "all"
    scope_label: str = "All systems"
    system_id: str = ""
    sys_sn: str = "All"
    policy_enabled: bool = False
    policy_name: str = "Battery Charge"
    immediate_cutoff_soc: int = 100
    charging_now: bool = False
    rows: list[PolicyChargeRow] = field(default_factory=list)
    last_command_ok: bool | None = None
    last_command_message: str = ""
    last_command_action: str = ""
    last_command_at: str = ""
    updated_at: str = ""

    def __post_init__(self) -> None:
        self.scope_key = _clean_text(self.scope_key, "all")
        self.scope_label = _clean_text(self.scope_label, "All systems")
        self.system_id = _clean_text(self.system_id)
        self.sys_sn = _clean_text(self.sys_sn, "All")
        self.policy_enabled = _parse_bool(self.policy_enabled)
        self.policy_name = _clean_text(self.policy_name, "Battery Charge")
        self.immediate_cutoff_soc = _parse_int(self.immediate_cutoff_soc, default=100, minimum=1, maximum=100)
        self.charging_now = _parse_bool(self.charging_now)
        self.rows = [row if isinstance(row, PolicyChargeRow) else PolicyChargeRow.from_dict(row) for row in (self.rows or [])]
        self.last_command_message = _clean_text(self.last_command_message)
        self.last_command_action = _clean_text(self.last_command_action)
        self.last_command_at = _clean_text(self.last_command_at)
        self.updated_at = _clean_text(self.updated_at)

    def active_row(self, at: datetime, *, soc: float | None = None, holiday_dates: set[str] | None = None) -> PolicyChargeRow | None:
        if not self.policy_enabled:
            return None
        for row in self.rows:
            if row.matches(at, holiday_dates=holiday_dates):
                if soc is None or float(soc) < float(row.cutoff_soc):
                    return row
        return None

    def to_dict(self) -> dict[str, Any]:
        return {
            "scope_key": self.scope_key,
            "scope_label": self.scope_label,
            "system_id": self.system_id,
            "sys_sn": self.sys_sn,
            "policy_enabled": self.policy_enabled,
            "policy_name": self.policy_name,
            "immediate_cutoff_soc": self.immediate_cutoff_soc,
            "charging_now": self.charging_now,
            "rows": [row.to_dict() for row in self.rows],
            "last_command_ok": self.last_command_ok,
            "last_command_message": self.last_command_message,
            "last_command_action": self.last_command_action,
            "last_command_at": self.last_command_at,
            "updated_at": self.updated_at,
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "PolicyChargeSchedule":
        return cls(
            scope_key=payload.get("scope_key") or "all",
            scope_label=payload.get("scope_label") or "All systems",
            system_id=payload.get("system_id") or "",
            sys_sn=payload.get("sys_sn") or "All",
            policy_enabled=payload.get("policy_enabled", False),
            policy_name=payload.get("policy_name") or "Battery Charge",
            immediate_cutoff_soc=payload.get("immediate_cutoff_soc") or 100,
            charging_now=payload.get("charging_now", False),
            rows=payload.get("rows") or [],
            last_command_ok=payload.get("last_command_ok"),
            last_command_message=payload.get("last_command_message") or "",
            last_command_action=payload.get("last_command_action") or "",
            last_command_at=payload.get("last_command_at") or "",
            updated_at=payload.get("updated_at") or payload.get("updated") or "",
        )


@dataclass(slots=True)
class PolicyChargeScheduleSet:
    """Collection of charge schedules for one integration entry."""

    schedules: list[PolicyChargeSchedule] = field(default_factory=list)
    updated_at: str = ""

    def by_scope(self) -> dict[str, PolicyChargeSchedule]:
        return {schedule.scope_key: schedule for schedule in self.schedules}

    def scope(self, scope_key: str) -> PolicyChargeSchedule | None:
        return self.by_scope().get(scope_key)

    def upsert(self, schedule: PolicyChargeSchedule) -> "PolicyChargeScheduleSet":
        items = self.by_scope()
        items[schedule.scope_key] = schedule
        self.schedules = list(items.values())
        return self

    def to_dict(self) -> dict[str, Any]:
        return {
            "updated_at": self.updated_at,
            "schedules": [schedule.to_dict() for schedule in self.schedules],
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "PolicyChargeScheduleSet":
        return cls(
            schedules=[PolicyChargeSchedule.from_dict(item) for item in (payload.get("schedules") or []) if isinstance(item, dict)],
            updated_at=_clean_text(payload.get("updated_at") or payload.get("updated") or ""),
        )
