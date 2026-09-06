# FoxESS Cloud V2 read-only transport

HEROS has an isolated FoxESS V2 web transport in `api/foxess_v2.py`, based on the
supplied 2026-09-06 handoff. It accepts web username/password credentials and
does not use an OpenAPI API key. It is not yet wired into the HEROS setup UI,
ByteWatt settings manager, entities, or reporting model. This prevents unproven
control operations or invented telemetry mappings from leaking into the shared
architecture. No Home Assistant instance was modified by this work.

## Signer and runtime

`FoxESSV2Signer` runs the official WASM with Python `wasmtime==48.0.0`. There is
no Node dependency in Home Assistant. Construction and signing are executed off
the event loop. The compiled module is cached; each signature gets a new bounded
instance, with 32 MiB memory and instruction fuel limits. This avoids retaining
credential strings in WASM memory between calls.

The browser's no-argument `endSignature()` maps to a zero i32 at the WASM ABI.
Repeated signatures on one instance change the allocation-dependent suffix;
fresh instances reproduce the acceptance vector consistently. The same vector
and two additional synthetic vectors were compared with the supplied Node glue.

The signer asset is operator-provided and must have SHA-256:

`c817419723bff8168497384db98719f7e10f2840c763df997ba66a5223ee3a5b`

HEROS does not redistribute FoxESS's proprietary glue or WASM, or download them
per request. Redistribution permission was not established by the handoff. Keep
the asset outside version control and pass its path to the factory. A changed
asset is rejected until separately verified. The HA factory installs the pinned
Python runtime through HA's requirements helper only when the V2 transport is
requested. Runtime installation/architecture failures become a controlled setup
error; existing ByteWatt startup does not load this dependency.

## Connection sequence

Call `await async_create_foxess_v2_client(hass, username, password, wasm_path)`.
It uses HA's shared HTTP session and IANA timezone, with no network login at
construction. Then `await client.list_plants()` logs in if needed and discovers
all pages. Select a `plantID` from the returned list; the client rejects any ID
that was not discovered. Multiple plants are returned for the caller to choose,
never implicitly bound to a captured plant.

The login endpoint is `/foxess/biz/auth/login`, with `account` and lowercase
MD5 of the UTF-8 password. Its signature always uses an empty token. Only the
hash is retained in session memory, and it remains sensitive credential data.
The session token is memory-only. `refreshed-token` takes precedence even on
login responses. Error 41819 permits one controlled re-login and retry; a login
error or second expiry ends the operation. Concurrent requests are serialized.

The request path alone is signed. Query parameters are sent separately, and
request bodies are not signer inputs. One clock value supplies the signature,
`timestamp`, and timezone-local `dt` headers.

Available methods: `list_plants`, `get_plant_extra_info`, `get_work_mode`,
`get_last_energy`, `get_alarms`, `get_flow_preinfo`, `get_plant_detail`,
`get_green_energy`, and `get_raw_analysis(plant_id, "DAY", date)`.
The analysis date uses year/month/day string fields. Other dimensions, writes,
arbitrary hosts/paths and WebSocket endpoints are rejected. Results are preserved
as provider payloads; no unverified field normalization is performed.

## Polling, privacy and lifecycle

Requests are spaced at least five seconds apart by default. For a future HA
coordinator, use `DEFAULT_POLL_INTERVAL` (300 seconds) or slower and do not poll
static detail/discovery on each telemetry update. This is a conservative local
policy, not a claim about FoxESS's undocumented private API quota.

Every request has a 30-second timeout, bounded response size, and disabled
redirects. Failures raise sanitized `FoxESSV2Error` subclasses without provider
messages or raw responses. The module logs no account, token, password/hash,
plant/device identifiers, addresses, coordinates, NMI, cookies, or raw data.
Call `client.session.clear_credentials()` on unload; do not close HA's shared
HTTP session. The owning config flow/coordinator must surface connection errors
without making HA startup depend on a successful cloud request.

## Verification

Local result: 200 tests passed with the supplied WASM and existing HA test
dependencies, including 31 V2 tests. Python compilation passed. The seven
warnings come from existing third-party HA dependencies. No live account
requests, HA sync, or V2 code push were performed.

Set `FOXESS_V2_WASM_PATH` to the local operator-provided asset, install the test
requirements, and run `python -m pytest tests/test_foxess_v2.py -q`.
Without the asset, real-WASM tests are explicitly skipped; transport tests still
use synthetic responses. Never treat those mocked responses as live validation.

The acceptance suite checks the exact signer vector, repeated and additional
signatures, password hashing, login token, query signing, single timestamp,
token rotation, bounded expiry retry, discovery/pagination, all captured read
methods, unsupported routes, and sanitized failures. Live account login, plant
listing, GET query signing, and DAY history still require operator credentials
and a real session. HAR files or captured credentials must never be used.

The private interactive check is `scripts/check_foxess_v2.py`. Run it in a Python
environment with aiohttp and the pinned wasmtime runtime, passing `--wasm` and
`--timezone`. It prompts for both credentials without echo, checks the signer
before authentication, discovers plants, and exercises the captured reads. It
prints operation status only, never IDs, credentials or payloads. With multiple
plants, choose `--plant-index` from discovery order; no captured ID is used.
