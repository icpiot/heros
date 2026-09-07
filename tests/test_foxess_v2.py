"""V2 acceptance tests use synthetic identities only, never HAR material."""
import asyncio
import hashlib
import importlib
import json
import os
from pathlib import Path
import sys
import threading
import types

import pytest

ROOT = Path(__file__).resolve().parents[1]
# Load this deliberately HA-independent API without importing HA's integration
# __init__, and without replacing any real HA/aiohttp module in sys.modules.
PACKAGE = "_heros_foxess_v2_tests"
package = types.ModuleType(PACKAGE)
package.__path__ = [str(ROOT / "custom_components" / "heros" / "api")]
sys.modules[PACKAGE] = package
api = importlib.import_module(f"{PACKAGE}.foxess_v2")
signer_module = importlib.import_module(f"{PACKAGE}.foxess_v2_signer")


class FakeSigner:
    def __init__(self):
        self.calls = []
        self.threads = []

    def sign(self, *args):
        self.calls.append(args)
        self.threads.append(threading.get_ident())
        return "synthetic-signature"


class Response:
    def __init__(self, payload=None, *, status=200, headers=None, raw=None):
        self.raw = raw if raw is not None else json.dumps(payload).encode()
        self.status = status
        self.headers = headers or {}
        self.content = self

    async def read(self, size):
        # Deliberately fragmented to exercise partial HTTP reads.
        part, self.raw = self.raw[:7], self.raw[7:]
        return part

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass


class HTTP:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def ok(result, **kwargs):
    return Response({"errno": 0, "result": result}, **kwargs)


def make_session(responses):
    http, signer = HTTP(responses), FakeSigner()
    session = api.FoxESSV2Session(http, signer, "synthetic-user", "Synthetic-Passé", timezone="Australia/Perth",
        minimum_request_interval=0, clock_ms=lambda: 1788705641429)
    return session, http, signer


def run(awaitable):
    return asyncio.run(awaitable)


def test_login_hash_empty_token_headers_and_timestamp():
    session, http, signer = make_session([ok({"token": "synthetic-session"})])
    main_thread = threading.get_ident()
    run(session.login())
    method, url, args = http.calls[0]
    assert method == "POST" and url == api.BASE_URL + api.LOGIN_PATH
    assert args["json"] == {"account": "synthetic-user", "password": hashlib.md5("Synthetic-Passé".encode()).hexdigest()}
    assert signer.calls == [(api.LOGIN_PATH, "", "en", 1788705641429)]
    assert signer.threads[0] != main_thread
    assert args["headers"]["dt"] == "Australia/Perth@1788705641429@2026-09-06 22:40:41"
    assert args["headers"]["timestamp"] == "1788705641429"
    assert args["headers"]["X-Auth-Platform"] == "FOX_CLOUD_WEB_2_0"
    assert args["headers"]["Content-Type"] == "application/json"
    assert args["headers"]["token"] == ""
    assert args["allow_redirects"] is False and args["timeout"] == 30
    assert session._token == "synthetic-session"
    assert "Synthetic-Passé" not in vars(session).values()


def test_query_is_transmitted_but_not_signed_and_refresh_rotates():
    session, http, signer = make_session([
        ok({"token": "first"}, headers={"refreshed-token": "second"}),
        ok({}, headers={"refreshed-token": "third"}), ok({}),
    ])
    async def scenario():
        await session.request("GET", "/dew/w/v0/plant/extra/info?plantID=synthetic-plant")
        await session.request("GET", "/dew/w/plant/work/mode", params={"plantID": "synthetic-plant"})
    run(scenario())
    assert signer.calls[1][:2] == ("/dew/w/v0/plant/extra/info", "second")
    assert signer.calls[2][1] == "third"
    assert http.calls[1][2]["params"] == {"plantID": "synthetic-plant"}
    assert "?" not in http.calls[1][1]
    assert session._token == "third"


@pytest.mark.parametrize("expiry_count", [1, 2])
def test_session_expiry_reauthenticates_only_once(expiry_count):
    session, http, _ = make_session([
        Response({"errno": 41819}), ok({"token": "renewed"}),
        Response({"errno": 41819}) if expiry_count == 2 else ok({"ok": True}),
    ])
    session._token = "expired"
    if expiry_count == 2:
        with pytest.raises(api.FoxESSV2AuthError):
            run(session.request("GET", "/dew/w/plant/work/mode"))
        assert session._token == ""
    else:
        assert run(session.request("GET", "/dew/w/plant/work/mode")) == {"ok": True}
    assert len(http.calls) == 3
    assert sum(url.endswith(api.LOGIN_PATH) for _, url, _ in http.calls) == 1


def test_login_expiry_cannot_recurse():
    session, http, _ = make_session([Response({"errno": 41819})])
    with pytest.raises(api.FoxESSV2AuthError):
        run(session.login())
    assert len(http.calls) == 1


@pytest.mark.parametrize("response", [
    Response({"errno": 42, "msg": "synthetic-secret-identity"}),
    Response({"errno": 0, "result": {}}, status=503),
    Response({"errno": "synthetic-secret-identity"}),
    Response(["synthetic-secret-identity"]),
    Response({"result": {}}), Response({"errno": 0}),
    Response(raw=b"synthetic-secret-identity"),
    RuntimeError("synthetic-secret-identity"),
])
def test_api_http_and_decode_errors_do_not_leak(response, caplog):
    session, http, _ = make_session([response])
    session._token = "synthetic-secret-token"
    with pytest.raises(api.FoxESSV2Error) as failure:
        run(session.request("GET", "/dew/w/plant/work/mode"))
    assert "synthetic-secret" not in str(failure.value)
    assert "synthetic-secret" not in caplog.text
    assert len(http.calls) == 1


def test_missing_login_token_and_clear_credentials():
    session, _, _ = make_session([ok({})])
    with pytest.raises(api.FoxESSV2AuthError):
        run(session.login())
    session.clear_credentials()
    assert session._token == session._password_md5 == session._username == ""


def test_discovery_pagination_and_proven_read_endpoints():
    session, http, _ = make_session([
        ok({"token": "synthetic-token"}),
        ok({"total": 2, "data": [{"plantID": "synthetic-a"}]}),
        ok({"total": 2, "data": [{"plantID": "synthetic-b"}]}),
        *[ok({"synthetic-result": True}) for _ in range(8)],
    ])
    client = api.FoxESSV2Client(session)
    async def scenario():
        plants = await client.list_plants()
        assert [p["plantID"] for p in plants] == ["synthetic-a", "synthetic-b"]
        for name in ("get_plant_extra_info", "get_work_mode", "get_last_energy", "get_alarms",
                     "get_flow_preinfo", "get_plant_detail", "get_green_energy"):
            assert await getattr(client, name)(plants[1]["plantID"]) == {"synthetic-result": True}
        await client.get_raw_analysis(plants[0]["plantID"], "DAY", {"year": "2026", "month": "9", "day": "6"})
    run(scenario())
    assert http.calls[1][2]["json"] == {"page": 1, "size": 20, "fuzzyCondition": "", "status": 0, "exportFlag": False}
    assert http.calls[2][2]["json"]["page"] == 2
    assert http.calls[-1][2]["json"] == {"plantId": "synthetic-a", "dimension": "DAY",
        "date": {"year": "2026", "month": "09", "day": "06"}, "downloadFlag": False}
    assert {url.removeprefix(api.BASE_URL) for _, url, _ in http.calls[1:]} == set(api.READ_ENDPOINTS)


def test_undiscovered_plant_is_rejected():
    session, http, _ = make_session([ok({"token": "synthetic-token"}), ok({"total": 0, "data": []})])
    client = api.FoxESSV2Client(session)
    with pytest.raises(api.FoxESSV2Error, match="discovery"):
        run(client.get_work_mode("unknown-synthetic-plant"))
    assert len(http.calls) == 2


def test_discover_plants_matches_config_flow_contract():
    session, _http, _ = make_session([
        ok({"token": "synthetic-token"}),
        ok({"total": 1, "data": [{"plantID": "synthetic-a"}]}),
        ok({"total": 1, "data": [{"plantID": "synthetic-b"}]}),
    ])
    client = api.FoxESSV2Client(session)
    assert run(client.discover_plants(force=True)) == [{"plantID": "synthetic-a"}]
    assert run(client.discover_plants(force=True)) == [{"plantID": "synthetic-b"}]


@pytest.mark.parametrize("path", ["https://other.invalid/dew/w/plant/work/mode", "//other.invalid/test", "/write", "/dew/v0/wsmaitian"])
def test_arbitrary_hosts_writes_and_websockets_are_rejected(path):
    session, http, _ = make_session([])
    with pytest.raises((api.FoxESSV2Error, signer_module.FoxESSV2SignerError)):
        run(session.request("GET", path))
    assert not http.calls


def test_signer_failure_is_sanitized():
    session, http, signer = make_session([])
    def fail(*args):
        raise RuntimeError("synthetic-secret")
    signer.sign = fail
    with pytest.raises(api.FoxESSV2Error) as failure:
        run(session.login())
    assert "synthetic-secret" not in str(failure.value)
    assert not http.calls


def test_setup_failure_is_controlled(tmp_path):
    class Hass:
        async def async_add_executor_job(self, *args):
            raise RuntimeError("synthetic-secret")
    wasm_path = tmp_path / "signature.wasm"
    wasm_path.write_bytes(b"not real wasm")
    with pytest.raises(api.FoxESSV2Error, match="setup failed"):
        run(api.async_create_foxess_v2_client(Hass(), "u", "p", str(wasm_path)))


def test_setup_creates_signer_directory_and_reports_missing_file(tmp_path):
    class Hass:
        async def async_add_executor_job(self, *args):
            raise AssertionError("signer should not load without an asset")

    wasm_path = tmp_path / "heros" / "foxess" / "signature.wasm"
    with pytest.raises(api.FoxESSV2Error, match="signer file is missing"):
        run(api.async_create_foxess_v2_client(Hass(), "u", "p", str(wasm_path)))
    assert wasm_path.parent.is_dir()


@pytest.fixture
def real_signer():
    asset = os.environ.get("FOXESS_V2_WASM_PATH")
    if not asset:
        pytest.skip("Operator-provided FoxESS WASM asset required for real signer acceptance tests")
    importlib.import_module("wasmtime")
    return signer_module.FoxESSV2Signer(asset)


def test_concurrent_requests_share_one_login():
    session, http, _ = make_session([ok({"token": "shared"}), ok({}), ok({})])
    async def scenario():
        await asyncio.gather(session.request("GET", "/dew/w/plant/work/mode"),
                             session.request("GET", "/dew/w/plant/last/energy"))
    run(scenario())
    assert len(http.calls) == 3
    assert sum(url.endswith(api.LOGIN_PATH) for _, url, _ in http.calls) == 1


def test_request_throttle_uses_nonblocking_sleep(monkeypatch):
    session, _, _ = make_session([ok({"token": "t"}), ok({})])
    session._interval = 5
    sleeps = []
    async def sleep(delay):
        sleeps.append(delay)
    monkeypatch.setattr(api.time, "monotonic", lambda: 10)
    monkeypatch.setattr(api.asyncio, "sleep", sleep)
    run(session.request("GET", "/dew/w/plant/work/mode"))
    assert sleeps == [5]


def test_repeated_discovery_page_is_rejected():
    session, http, _ = make_session([ok({"token": "t"}),
        ok({"total": 2, "data": [{"plantID": "synthetic-a"}]}),
        ok({"total": 2, "data": [{"plantID": "synthetic-a"}]}),
    ])
    with pytest.raises(api.FoxESSV2Error, match="repeated"):
        run(api.FoxESSV2Client(session).list_plants())
    assert len(http.calls) == 3


def test_uncaptured_history_dimension_is_rejected():
    session, http, _ = make_session([])
    with pytest.raises(api.FoxESSV2Error, match="DAY"):
        run(api.FoxESSV2Client(session).get_raw_analysis("synthetic-a", "YEAR", {}))
    assert not http.calls


def test_login_failure_during_retry_does_not_recurse():
    session, http, _ = make_session([Response({"errno": 41819}), Response({"errno": 41819})])
    session._token = "expired"
    with pytest.raises(api.FoxESSV2AuthError):
        run(session.request("GET", "/dew/w/plant/work/mode"))
    assert len(http.calls) == 2


def test_exact_wasm_vector_and_repeated_calls(real_signer):
    for _ in range(100):
        assert real_signer.sign("/foxess/biz/auth/login", "", "en", 1788705641429) == "f733e2d52d22e24b73990c768f9289b0.5245784"


@pytest.mark.parametrize("path,timestamp,expected", [
    ("/dew/w/v0/plant/extra/info?plantID=synthetic-plant", 1788705641429, "ad9396af7c623d5f24e78af1f85fc668.5245784"),
    ("/dew/w/plant/analysis/raw", 1788705641430, "aed3254c01e27d1c2938e9ec79afcdc8.5245784"),
])
def test_additional_node_reference_vectors(real_signer, path, timestamp, expected):
    assert real_signer.sign(path, "synthetic-token", "en", timestamp) == expected


def test_asset_hash_is_enforced(tmp_path):
    pytest.importorskip("wasmtime")
    path = tmp_path / "invalid.wasm"
    path.write_bytes(b"not-the-official-asset")
    with pytest.raises(signer_module.FoxESSV2SignerError, match="hash"):
        signer_module.FoxESSV2Signer(path)
