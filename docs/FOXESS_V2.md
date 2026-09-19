# FoxESS Cloud V2 read-only transport

HEROS has an isolated FoxESS V2 web transport in `api/foxess_v2.py`, based on the
supplied 2026-09-06 handoff. It accepts web username/password credentials and
does not use an OpenAPI API key. It is exposed in the HEROS setup UI as the
`FoxESS_v2` provider, where setup validates login and plant discovery through
this V2 client. It is still separate from the Bytewatt settings manager,
entities, and reporting model. This prevents unproven control operations or
invented telemetry mappings from leaking into the shared architecture. No Home
Assistant instance was modified by this work.

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
the asset outside version control. HEROS resolves `heros/foxess/signature.wasm`
inside Home Assistant's config directory automatically; the login form does not
ask for a signer path. Existing entries with an explicit path remain supported.
A missing signer file or changed asset is rejected
until separately verified. The HA factory installs the pinned Python runtime
through HA's requirements helper only when the V2 transport is requested.
Runtime installation/architecture failures become a controlled setup error;
existing ByteWatt startup does not load this dependency.

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
`get_green_energy`, `get_raw_analysis(plant_id, "DAY", date)`,
`list_devices(plant_id)`, `get_device_realtime(device_id)`,
`get_battery_realtime(battery_id)`, `get_battery_health(battery_id)`, and
`get_battery_expected_life(battery_id)`. Device and battery IDs are discovered
from authenticated FoxESS responses for the selected plant; HEROS never stores
or accepts manually supplied identifiers.
The analysis date uses year/month/day string fields. Other dimensions, writes,
arbitrary hosts/paths and WebSocket endpoints are rejected. Results are preserved
as provider payloads; no unverified field normalization is performed.

## Initial HEROS mappings

The first FoxESS_v2 mapping pass is read-only and intentionally narrow. HEROS
maps only fields whose source meaning is clear from the captured endpoint and
label. These values flow through `FoxESSV2Client.get_battery_data()` into the
existing HEROS coordinator/sensor payload shape:

| FoxESS source | HEROS field | Unit handling | Confidence |
| --- | --- | --- | --- |
| `list_plants()[0].currentPower.value` | `ppv`, `pv_input_total_power` | Converts kW to W when needed | High |
| `list_plants()[0].totalYield.value` | `Total_Solar_Generation` | Converts Wh to kWh when needed | High |
| `get_last_energy().production.todayProduction.value` | `PV_Generated_Today` | Converts Wh to kWh when needed | High |
| `list_plants()[0].todayYield.value` | `PV_Generated_Today` fallback | Converts Wh to kWh when needed | High |
| `get_last_energy().consumption.todayConsumption.value` | `Consumed_Today`, `total_house_consumption` | Converts Wh to kWh when needed | High |
| `get_work_mode().online` | `communication_status` | Boolean to `online` / `offline` | High |
| `get_work_mode().workMode` | `operating_mode` | String preserved | High |
| `get_alarms().alarmCount` | `alarm_state` | Integer preserved | High |
| `list_plants()[0].status` | `plant_status` | Integer preserved | Medium |
| `list_plants()[0].systemSize.value` | `system_size_kw` | Converts W to kW when needed | Medium |
| `get_green_energy().co2.value` | `CO2_Reduction_Tons` | Converts kg to tonnes when supplied as kg | High |
| `get_green_energy().tree.value` | `Trees_Planted` | Numeric count preserved | High |
| `get_battery_realtime().soc.value` | `soc` | Percentage preserved | High |
| `get_battery_realtime().volt.value` | `battery_voltage` | Volts preserved | High |
| `get_battery_realtime().current.value` | `battery_current` | Amps preserved | High |
| `get_device_realtime().battery[0].temperature.value` | `battery_temperature` | Degrees Celsius preserved | High |
| get_device_realtime().battery[0].chargingPower / dischargingPower | pbat | Charging becomes negative W; discharging becomes positive W | High |
| `get_battery_health().soh.value` | `battery_state_of_health` | Percentage preserved | High |
| `get_battery_health().energy.value` | `battery_usable_capacity` | Converts Wh to kWh when needed | High |
| `get_battery_health().remainCapacity.value` | `battery_remaining_capacity` | Mapped only when FoxESS supplies Wh or kWh; amp-hours remain raw telemetry | High |
| `get_battery_expected_life().cyclesNum` | `battery_cycles` | Numeric value preserved | High |
| `get_battery_realtime().chargingEnergy*` | `Battery_Charged_Today`, `Total_Battery_Charge` | Converts Wh to kWh when needed | High |
| `get_battery_realtime().dischargingEnergy*` | `Battery_Discharged_Today`, `Total_Battery_Discharge` | Converts Wh to kWh when needed | High |
| `get_device_realtime().load.loadsPower.value` | `house_consumption` | Converts kW to W when needed | High |
| `get_device_realtime().load.loadsTotal.value` | `Total_House_Consumption` | Converts Wh to kWh when needed | High |
| `get_device_realtime().load.epsPower.value` | `eps_output_power` | Converts kW to W when needed | High |
| `get_device_realtime().gridInfo.gridConsumption*` | `pgrid`, `Grid_Import_Today`, `Grid_Power_Consumption` | Import-only, converted to W or kWh | High |
| `get_device_realtime().gridInfo.feedin*` | `Feed_In_Today`, `Total_Feed_In` | Converts Wh to kWh when needed | High |
| `get_device_realtime().gridOperatingData.operatingData[0]` | `grid_voltage`, `grid_current`, `grid_frequency` | Uses the supplied display units | High |
| `get_device_realtime().pvInfo.data[1:5]` | `pv_string_1..4_voltage`, `pv_string_1..4_current` | Uses the `pvInfo.unit` display units | High |

The adapter also keeps the source payloads under `raw_provider` for diagnostics
and later mapping work. It must not log or expose raw provider payloads by
default because plant metadata can contain identifiers and location details.

FoxESS V2's overview can omit the inverter. HEROS therefore uses the captured,
read-only meter association endpoint to discover the linked inverter before
calling its realtime endpoint. The first `pvInfo.data` row is the aggregate PV
reading; the following four rows are mapped to MPPT 1-4.

Battery power follows the HEROS convention: charging is negative and discharging is positive. Grid import and feed-in values remain separate fields; HEROS does not infer a net direction from them. The DAY analysis series (`socData`,
`supplyData`, and `usageData`) remain unmapped pending sanitized labels and
live validation.

## Battery telemetry aggregation decision

HEROS exposes both fixed per-battery sensors and aggregate whole-system sensors.
Per-battery entities use stable Battery 1, Battery 2, and subsequent numbering.
Aggregate values are used by HEROS reports and graphs by default. SOC and SOH
use capacity-weighted averages; temperature reports the highest battery value
(and may also expose an average); voltage is averaged; current, charge power,
discharge power, capacity, energy, and throughput are summed. Cycle count uses
the highest battery value because cycles are not additive. Status and fault
values represent the worst or active battery condition. The complete provider
payload remains available in debug raw data for traceability.
## Polling, privacy and lifecycle

The Home Assistant coordinator uses the fixed DEFAULT_POLL_INTERVAL of 60
seconds for FoxESS_v2. HEROS does not show a polling interval option for
FoxESS_v2 setup or options, and old stored scan_interval values are ignored
for this provider. The small, fixed read sequence within one refresh is spaced
by 0.5 seconds so that discovery, inverter, MPPT, and battery fields can
complete before the next one-minute cloud update. This interval is live-tested
against FoxESS and should be restored to five minutes if FoxESS begins
rejecting or throttling requests. It is not a claim about FoxESS's
undocumented private API quota.

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


## History coverage and installation dates

FoxESS history backfill uses two independent installation dates configured by
HEROS: one for the solar/inverter system and one for the battery system. The
solar/inverter date gates plant and inverter history (PV, load, grid, feed-in,
EPS, and related values). The battery date gates battery history (SOC,
charge/discharge, temperature, health, cycles, capacity, and per-battery
values). They can be different when a battery is added or replaced after the
inverter was installed.

The dates must be stored as configuration, validated so they are not in the
future, and exposed as independent manual/provider-derived settings. Reports
must preserve the separate coverage windows and leave values before a stream's
installation date absent rather than treating them as zero. A replacement
battery gets its own scope and start date while the prior scope's history is
retained.

For a new installation, do not request a historical download during initial
setup: live reporting begins immediately. Existing installations can set these
coverage dates and request a historical download later if they want older
reports. That download is optional and does not affect normal live telemetry.

The operator's initial installation date is **2026-09-06** for both streams.
The FoxESS history endpoints provide the source data; HEROS keeps the resulting
normalized snapshots and time-series in its local report archive for later
reports and exports.

## KH/KA fault and alarm reference

The canonical FoxESS KH/KA fault names and descriptions are documented in [FOXESS_KH_KA_FAULT_REFERENCE.md](FOXESS_KH_KA_FAULT_REFERENCE.md). Raw provider fault strings must remain unchanged; friendly names and categories may be layered on separately.