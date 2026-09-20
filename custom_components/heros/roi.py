"""Pure data model for HEROS investment and repayment tracking."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any
from uuid import uuid4

_FREQUENCIES = {"weekly", "fortnightly", "monthly", "yearly"}


def _date(value: date | str | None) -> date:
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        return date.fromisoformat(value)
    raise ValueError("effective_start_date is required")


def _amount(value: float | int | str | None, label: str) -> float:
    try:
        amount = float(value)
    except (TypeError, ValueError) as err:
        raise ValueError(f"{label} must be a number") from err
    if amount < 0:
        raise ValueError(f"{label} cannot be negative")
    return amount


@dataclass(frozen=True, slots=True)
class RepaymentScheduleEntry:
    """A repayment amount effective from a given date until superseded."""

    effective_start_date: date | str | None = None
    amount: float | int | str | None = None
    frequency: str = "weekly"
    entry_id: str = ""
    notes: str = ""

    def __post_init__(self) -> None:
        frequency = str(self.frequency or "weekly").strip().lower()
        if frequency not in _FREQUENCIES:
            raise ValueError(f"Unsupported repayment frequency: {self.frequency!r}")
        object.__setattr__(self, "effective_start_date", _date(self.effective_start_date))
        object.__setattr__(self, "amount", _amount(self.amount, "repayment amount"))
        object.__setattr__(self, "frequency", frequency)
        object.__setattr__(self, "entry_id", str(self.entry_id or uuid4().hex).strip())
        object.__setattr__(self, "notes", str(self.notes or "").strip())

    def to_dict(self) -> dict[str, Any]:
        return {
            "entry_id": self.entry_id,
            "effective_start_date": self.effective_start_date.isoformat(),
            "amount": self.amount,
            "frequency": self.frequency,
            "notes": self.notes,
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "RepaymentScheduleEntry":
        return cls(**payload)



@dataclass(frozen=True, slots=True)
class VppRateEntry:
    """A VPP payment rate effective from a given date."""

    provider: str = ""
    effective_start_date: date | str | None = None
    cents_per_kwh: float | int | str | None = None
    entry_id: str = ""

    def __post_init__(self) -> None:
        provider = str(self.provider or "").strip()
        if not provider:
            raise ValueError("VPP provider is required")
        object.__setattr__(self, "provider", provider)
        object.__setattr__(self, "effective_start_date", _date(self.effective_start_date))
        object.__setattr__(self, "cents_per_kwh", _amount(self.cents_per_kwh, "VPP rate"))
        object.__setattr__(self, "entry_id", str(self.entry_id or uuid4().hex).strip())

    def to_dict(self) -> dict[str, Any]:
        return {"entry_id": self.entry_id, "provider": self.provider, "effective_start_date": self.effective_start_date.isoformat(), "cents_per_kwh": self.cents_per_kwh}

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "VppRateEntry":
        return cls(**payload)

@dataclass(frozen=True, slots=True)
class InstallationCostEntry:
    """An installation cost record effective from a given date."""
    effective_start_date: date | str | None = None
    description: str = ""
    amount: float | int | str | None = None
    entry_id: str = ""

    def __post_init__(self) -> None:
        description = str(self.description or "").strip()
        if not description:
            raise ValueError("Installation description is required")
        object.__setattr__(self, "effective_start_date", _date(self.effective_start_date))
        object.__setattr__(self, "description", description)
        object.__setattr__(self, "amount", _amount(self.amount, "installation amount"))
        object.__setattr__(self, "entry_id", str(self.entry_id or uuid4().hex).strip())

    def to_dict(self) -> dict[str, Any]:
        return {"entry_id": self.entry_id, "effective_start_date": self.effective_start_date.isoformat(), "description": self.description, "amount": self.amount}

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "InstallationCostEntry":
        return cls(**payload)


@dataclass(frozen=True, slots=True)
class RoiSettings:
    """Persisted investment costs and changing repayment schedule."""

    solar_installation_cost: float | int | str | None = 0
    battery_installation_cost: float | int | str | None = 0
    currency: str = "AUD"
    repayments: tuple[RepaymentScheduleEntry, ...] = field(default_factory=tuple)
    vpp_rates: tuple[VppRateEntry, ...] = field(default_factory=tuple)
    installation_costs: tuple[InstallationCostEntry, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        repayments = tuple(
            item if isinstance(item, RepaymentScheduleEntry) else RepaymentScheduleEntry.from_dict(item)
            for item in (self.repayments or ())
        )
        vpp_rates = tuple(
            item if isinstance(item, VppRateEntry) else VppRateEntry.from_dict(item)
            for item in (self.vpp_rates or ())
        )
        installation_costs = tuple(
            item if isinstance(item, InstallationCostEntry) else InstallationCostEntry.from_dict(item)
            for item in (self.installation_costs or ())
        )
        vpp_keys = [(item.provider.casefold(), item.effective_start_date) for item in vpp_rates]
        if len(vpp_keys) != len(set(vpp_keys)):
            raise ValueError("Only one VPP rate may start for each provider on each date")
        dates = [item.effective_start_date for item in repayments]
        if len(dates) != len(set(dates)):
            raise ValueError("Only one repayment amount may start on each date")
        object.__setattr__(self, "solar_installation_cost", _amount(self.solar_installation_cost, "solar installation cost"))
        object.__setattr__(self, "battery_installation_cost", _amount(self.battery_installation_cost, "battery installation cost"))
        object.__setattr__(self, "currency", str(self.currency or "AUD").strip().upper())
        object.__setattr__(self, "repayments", tuple(sorted(repayments, key=lambda item: item.effective_start_date)))
        object.__setattr__(self, "vpp_rates", tuple(sorted(vpp_rates, key=lambda item: (item.effective_start_date, item.provider.casefold()))))
        object.__setattr__(self, "installation_costs", tuple(sorted(installation_costs, key=lambda item: (item.effective_start_date, item.description.casefold()))))

    @property
    def total_installation_cost(self) -> float:
        return self.solar_installation_cost + self.battery_installation_cost

    def active_repayment(self, at: date) -> RepaymentScheduleEntry | None:
        matches = [item for item in self.repayments if item.effective_start_date <= at]
        return matches[-1] if matches else None

    def to_dict(self) -> dict[str, Any]:
        return {
            "solar_installation_cost": self.solar_installation_cost,
            "battery_installation_cost": self.battery_installation_cost,
            "currency": self.currency,
            "repayments": [item.to_dict() for item in self.repayments],
            "vpp_rates": [item.to_dict() for item in self.vpp_rates],
            "installation_costs": [item.to_dict() for item in self.installation_costs],
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "RoiSettings":
        return cls(
            solar_installation_cost=payload.get("solar_installation_cost", 0),
            battery_installation_cost=payload.get("battery_installation_cost", 0),
            currency=payload.get("currency", "AUD"),
            repayments=tuple(payload.get("repayments") or ()),
            vpp_rates=tuple(payload.get("vpp_rates") or ()),
            installation_costs=tuple(payload.get("installation_costs") or ()),
        )