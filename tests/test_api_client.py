"""Tests for low-level API client helpers and the encryption fail-loud contract.

Load the relevant modules directly via importlib so the test suite doesn't
need the full integration package to be importable (which would pull in
voluptuous + homeassistant).
"""
from __future__ import annotations

import importlib
import os

import pytest

# auth helper needs pycryptodome at module load; the API client also imports it.
pytest.importorskip("Crypto.Cipher")
pytest.importorskip("aiohttp")


# the API client imports homeassistant.helpers.aiohttp_client at module load —
# skip cleanly when HA isn't installed (bare sandbox).
try:
    api_auth = importlib.import_module(
        "custom_components.home_energy_manager.api.neovolt_auth"
    )
    api_client = importlib.import_module(
        "custom_components.home_energy_manager.api.neovolt_client"
    )
except ModuleNotFoundError as exc:
    pytest.skip(f"Module not installed in this environment: {exc.name}", allow_module_level=True)

EncryptionError = api_auth.EncryptionError
encrypt_password = api_auth.encrypt_password
ApiError = api_client.ByteWattAPIError
_stat_value = api_client._stat_value
_decode_json_object = api_client._decode_json_object
_provider_power_diagram = api_client._provider_power_diagram
ApiClient = api_client.NeovoltClient


def test_stat_value_returns_value_when_present():
    assert _stat_value({"epvtoday": 12.5}, "epvtoday") == 12.5
    assert _stat_value({"epvtoday": 0}, "epvtoday") == 0


def test_stat_value_coalesces_missing_key_to_zero():
    assert _stat_value({}, "epvtoday") == 0


def test_stat_value_coalesces_explicit_none_to_zero():
    """The fragile arithmetic path used to crash on None — never again."""
    assert _stat_value({"epvtoday": None}, "epvtoday") == 0


def test_battery_discharged_today_calculation_survives_partial_data():
    """The discharge calc used to raise TypeError when any input was None.
    With _stat_value, the calc must complete with sensible zeros."""
    stats_data = {
        "epvtoday": 10,
        "ehomeload": None,   # Missing field
        # efeedIn missing entirely
        "einput": 5,
        "echarge": 2,
    }
    pv_today    = _stat_value(stats_data, "epvtoday")
    consumed    = _stat_value(stats_data, "ehomeload")
    feed_in     = _stat_value(stats_data, "efeedIn")
    grid_import = _stat_value(stats_data, "einput")
    charged     = _stat_value(stats_data, "echarge")
    # Should not raise.
    total_gained = pv_today + grid_import
    total_used   = consumed + feed_in + charged
    discharged = total_used - total_gained
    assert discharged == 2 - 15  # 0+0+2 - (10+5)


def test_encryption_known_vector():
    """Anchor a known cipher output so we'd catch any regression in the
    encryption algorithm (key derivation, IV, padding, base64)."""
    assert encrypt_password("1", "caraa") == "CH1iL1FqYK9bhTd9izZyMA=="
    assert encrypt_password("1", "carraa") == "oFzzKemj3O4WP92FBSjZzw=="


def test_encryption_error_is_runtime_error_subclass():
    """Callers can catch RuntimeError generically and still get EncryptionError."""
    assert issubclass(EncryptionError, RuntimeError)


def test_api_error_is_exception_subclass():
    """The coordinator catches Exception broadly — the API error must match."""
    assert issubclass(ApiError, Exception)


# ---------------------------------------------------------------------------
# _decode_json_object — must reject non-object JSON before .get() crashes
# ---------------------------------------------------------------------------

class _FakeResponse:
    """Minimal stand-in for aiohttp.ClientResponse."""

    def __init__(self, json_value=None, raise_exc=None):
        self._json_value = json_value
        self._raise_exc = raise_exc

    async def json(self):
        if self._raise_exc is not None:
            raise self._raise_exc
        return self._json_value


@pytest.mark.asyncio
async def test_decode_returns_dict_for_object():
    result = await _decode_json_object(_FakeResponse({"code": 200}), "ctx")
    assert result == {"code": 200}


@pytest.mark.asyncio
async def test_decode_returns_none_for_array():
    """Body is valid JSON but a list — `.get('code')` would crash later."""
    result = await _decode_json_object(_FakeResponse(["error", "details"]), "ctx")
    assert result is None


@pytest.mark.asyncio
async def test_decode_returns_none_for_string():
    """Body is valid JSON but a bare string."""
    result = await _decode_json_object(_FakeResponse("just an error message"), "ctx")
    assert result is None


@pytest.mark.asyncio
async def test_decode_returns_none_for_null():
    result = await _decode_json_object(_FakeResponse(None), "ctx")
    assert result is None


@pytest.mark.asyncio
async def test_decode_returns_none_on_value_error():
    """ValueError covers json.JSONDecodeError for malformed bodies."""
    result = await _decode_json_object(_FakeResponse(raise_exc=ValueError("bad json")), "ctx")
    assert result is None


class _FakeGetResponse:
    """Async context manager for GET responses."""

    def __init__(self, status=200, json_value=None):
        self.status = status
        self._json_value = json_value if json_value is not None else {"code": 200}

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def json(self):
        return self._json_value


class _FakeSession:
    """Minimal aiohttp session stand-in for _async_get tests."""

    def __init__(self, response):
        self.response = response
        self.calls = []

    def get(self, url, headers=None, timeout=None):
        self.calls.append({"url": url, "headers": headers, "timeout": timeout})
        return self.response


class _FakeSequenceSession:
    """Minimal aiohttp session stand-in for ordered GET requests."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []

    def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append({
            "url": url,
            "params": params or {},
            "headers": headers,
            "timeout": timeout,
        })
        if not self._responses:
            raise AssertionError("No fake responses left for session.get()")
        return self._responses.pop(0)


@pytest.mark.asyncio
async def test_async_get_logs_in_before_request_when_token_missing(monkeypatch):
    client = ApiClient.__new__(ApiClient)
    client.base_url = "https://monitor.byte-watt.com"
    client.session = _FakeSession(_FakeGetResponse(json_value={"code": 200, "data": []}))
    client.token = None

    login_calls = {"count": 0}

    async def _fake_login():
        login_calls["count"] += 1
        client.token = "fresh-token"
        return True

    client.async_login = _fake_login

    result = await client._async_get("api/stable/home/getCustomMenuEssList?inverterMode=0")

    assert result == {"code": 200, "data": []}
    assert login_calls["count"] == 1
    assert len(client.session.calls) == 1
    assert client.session.calls[0]["headers"]["Authorization"] == "Bearer fresh-token"


def test_provider_power_diagram_normalizes_web_chart_payload():
    payload = _provider_power_diagram(
        {
            "time": ["0:00", "0:05"],
            "cbat": [64.6, 64.5],
            "homePower": [0.4, 0.5],
            "ppvinverterPv": [0.0, 0.2],
            "feedInDetailList": [
                {"value": 0.001, "value1": 2.693, "value2": 2.694, "value3": 0},
                {"value": 0.047, "value1": 1.148, "value2": 1.195, "value3": 0},
            ],
            "gridDetailList": [
                {"value": 0.0, "value1": 0.35, "value2": 0.36, "value3": 0},
                {"value": 0.0, "value1": 0.45, "value2": 0.44, "value3": 0},
            ],
            "soc": 64.9,
            "maximumPower": 3,
            "powerSource": "grid",
        },
        report_date="2026-08-12",
        scope_label="All systems",
        summary={
            "soc": 64.9,
            "solar_generation": 25.24,
            "load_consumption": 30.21,
            "feed_in": 0.09,
            "grid_consumption": 4.83,
            "battery_charge": 0,
            "battery_discharge": 0,
        },
    )

    assert payload["date"] == "2026-08-12"
    assert payload["meta"]["label"] == "All systems"
    assert payload["meta"]["maximum_power"] == 3.0
    assert payload["series"]["bat"] == [64.6, 64.5]
    assert payload["series"]["load"] == [0.4, 0.5]
    assert payload["series"]["solar"] == [0.0, 0.2]
    assert payload["series"]["feed_in"] == [2.694, 1.195]
    assert payload["series"]["consumed"] == [0.36, 0.45]
    assert payload["summary"]["grid_consumption"] == 4.83
    assert payload["raw_provider"]["powerSource"] == "grid"
    assert payload["provider_payload"]["soc"] == 64.9
    assert payload["provider_payload"]["gridDetailList"][0]["value2"] == 0.36


def test_extract_account_ids_finds_nested_fields_and_query_fragments():
    payload = {
        "menuRoute": "/report/power?userId=q5jS4Up5MpNvz4PrEX&date=2026-08-13",
        "account": {
            "customerId": "customer-456",
        },
        "embedded": "{\"memberId\":\"member-789\"}",
    }

    assert ApiClient._extract_account_ids(payload) == [
        "q5jS4Up5MpNvz4PrEX",
        "customer-456",
        "member-789",
    ]


@pytest.mark.asyncio
async def test_async_get_battery_data_uses_user_id_chart_request_for_all_scope_statistics():
    client = ApiClient.__new__(ApiClient)
    client.base_url = "https://monitor.byte-watt.com"
    client.token = "token"
    client.host_system_id = "station-host-1"
    client.host_sys_sn = "25000SB244W00011"
    client.user_id = "user-123"
    client.user_id_candidates = ["user-123"]
    client.async_login = lambda: None  # pragma: no cover - token is already set
    client.session = _FakeSequenceSession([
        _FakeGetResponse(json_value={"code": 200, "data": {"epvT": 12.0, "eout": 0.0, "echarge": 0.0, "edischarge": 0.0, "eload": 4.0, "einput": 1.0}}),
        _FakeGetResponse(json_value={"code": 200, "data": {"epvtoday": 0.01, "eload": 0.61, "eoutput": 0.0, "einput": 0.01, "echarge": 0.0, "edischarge": 0.0}}),
        _FakeGetResponse(json_value={"code": 200, "data": {
            "time": ["0:00", "0:05"],
            "soc": [41.6, 41.4],
            "homePower": [0.4, 0.5],
            "ppvinverterPv": [0.0, 0.0],
            "feedInDetailList": [],
            "gridDetailList": [{"value2": 0.4}, {"value2": 0.5}],
            "epvtoday": 0.01,
            "ehomeload": 0.61,
            "efeedIn": 0.0,
            "einput": 0.01,
            "echarge": 0.0,
        }}),
    ])

    result = await client.async_get_battery_data(
        report_date="2026-08-20",
        include_realtime=False,
        sys_sn="All",
    )

    assert [call["params"].get("stationId") for call in client.session.calls[:2]] == [
        "",
        "",
    ]
    assert client.session.calls[2]["params"] == {
        "userId": "user-123",
        "date": "2026-08-20",
    }
    assert result["Power_Diagram"]["meta"]["source"] == "provider"
    assert result["Power_Diagram"]["time"] == ["0:00", "0:05"]


@pytest.mark.asyncio
async def test_async_get_battery_data_primes_user_id_before_all_scope_chart_request():
    client = ApiClient.__new__(ApiClient)
    client.base_url = "https://monitor.byte-watt.com"
    client.token = "token"
    client.host_system_id = "station-host-1"
    client.host_sys_sn = "25000SB244W00011"
    client.user_id = ""
    client.user_id_candidates = []
    client.async_login = lambda: None  # pragma: no cover - token is already set
    client.session = _FakeSequenceSession([
        _FakeGetResponse(json_value={"code": 200, "data": {"epvT": 12.0, "eout": 0.0, "echarge": 0.0, "edischarge": 0.0, "eload": 4.0, "einput": 1.0}}),
        _FakeGetResponse(json_value={"code": 200, "data": {"epvtoday": 0.01, "eload": 0.61, "eoutput": 0.0, "einput": 0.01, "echarge": 0.0, "edischarge": 0.0}}),
        _FakeGetResponse(json_value={"code": 200, "data": {"menuRoute": "/report/power?userId=user-456&date=2026-08-20"}}),
        _FakeGetResponse(json_value={"code": 200, "data": {
            "time": ["0:00", "0:05"],
            "soc": [41.6, 41.4],
            "homePower": [0.4, 0.5],
            "ppvinverterPv": [0.0, 0.0],
            "feedInDetailList": [],
            "gridDetailList": [{"value2": 0.4}, {"value2": 0.5}],
            "epvtoday": 0.01,
            "ehomeload": 0.61,
            "efeedIn": 0.0,
            "einput": 0.01,
            "echarge": 0.0,
        }}),
    ])

    result = await client.async_get_battery_data(
        report_date="2026-08-20",
        include_realtime=False,
        sys_sn="All",
    )

    assert client.session.calls[2]["url"].endswith("/api/devices/list")
    assert client.session.calls[3]["params"] == {
        "userId": "user-456",
        "date": "2026-08-20",
    }
    assert client.user_id == "user-456"
    assert result["Power_Diagram"]["meta"]["source"] == "provider"
