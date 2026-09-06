# Modbus and Web Telemetry Register Map

This document is the working master list for AlphaESS/Bytewatt telemetry fields
used by HEROS.

It separates two related but different data surfaces:

- local Modbus/BMS values exposed by the inverter or battery system;
- web/OpenAPI/MTTP values exposed through AlphaCloud-style HTTP endpoints.

Rows marked `address pending` are confirmed by a source as exposed values, but
the exact Modbus register address still needs to be verified from the AlphaESS
Modbus protocol document, source code, or a direct device read.

## Source confidence

| Confidence | Meaning |
| --- | --- |
| Confirmed HAR | Observed directly in the supplied MTTP HAR captures. |
| Confirmed repo | Listed by a maintained integration or official sample/API artifact. |
| Confirmed packet | Observed in a community packet capture from an AlphaESS device upload. |
| Inferred label | Field exists, but the human-friendly meaning is inferred from behavior/community usage. |
| Address pending | Entity is confirmed, but numeric Modbus address is not yet recorded here. |

## Local Modbus master list

Primary confirmed Modbus behavior comes from the community AlphaESS Modbus TCP
Home Assistant integration and AlphaESS Modbus reader projects. The Modbus TCP
defaults are port `502` and slave ID `85`.

### Real-time power

| Register / field | Address | Unit | Meaning | Source / confidence | Notes |
| --- | --- | --- | --- | --- | --- |
| Grid Power | address pending | W | Net grid import/export | Confirmed repo | Positive import, negative export in `ha-alphaess-modbus`. |
| Battery Power | address pending | W | Battery charge/discharge power | Confirmed repo | Sign convention must be verified per integration/device. |
| Active Power PV Meter | address pending | W | PV generation measured at meter point | Confirmed repo | Corresponds conceptually to `pmeterDc` / `PmeterDC`. |
| PV String 1 Power | address pending | W | PV input/string 1 power | Confirmed repo | Matches web `ppv1` concept. |
| PV String 2 Power | address pending | W | PV input/string 2 power | Confirmed repo | Matches web `ppv2` concept. |
| PV String 3 Power | address pending | W | PV input/string 3 power | Confirmed repo | Matches web `ppv3` concept. |
| PV String 4 Power | address pending | W | PV input/string 4 power | Confirmed repo | Matches web `ppv4` concept. |
| PV Total Power (Inverter) | `0x0453` / `1107` | W | Total PV power from inverter register | Confirmed repo | Disabled by default in `ha-alphaess-modbus`; separate from calculated PV total. |
| Inverter Power L1 | address pending | W | AC inverter output phase L1 | Confirmed repo | |
| Inverter Power L2 | address pending | W | AC inverter output phase L2 | Confirmed repo | |
| Inverter Power L3 | address pending | W | AC inverter output phase L3 | Confirmed repo | |
| Inverter Power | `0x040C` / `1036` | W | Total inverter active power | Confirmed repo | `alphaess_modbus` README example names `inverter_power_total` at this address. |

### Grid

| Register / field | Address | Unit | Meaning | Source / confidence | Notes |
| --- | --- | --- | --- | --- | --- |
| Grid Frequency | address pending | Hz | Grid frequency | Confirmed repo | |
| Grid Power Phase A | address pending | W | Grid import/export on phase A | Confirmed repo | |
| Grid Power Phase B | address pending | W | Grid import/export on phase B | Confirmed repo | |
| Grid Power Phase C | address pending | W | Grid import/export on phase C | Confirmed repo | |
| Grid Voltage Phase A | address pending | V | Grid voltage phase A | Confirmed repo | |
| Grid Voltage Phase B | address pending | V | Grid voltage phase B | Confirmed repo | |
| Grid Voltage Phase C | address pending | V | Grid voltage phase C | Confirmed repo | |
| Max Feed to Grid | address pending | % | Export limit as percent of installed PV capacity | Confirmed repo | Writable/control-adjacent; treat carefully. |

### PV strings

| Register / field | Address | Unit | Meaning | Source / confidence | Notes |
| --- | --- | --- | --- | --- | --- |
| PV String 1 Voltage | address pending | V | PV string/MPPT 1 voltage | Confirmed repo | |
| PV String 1 Current | address pending | A | PV string/MPPT 1 current | Confirmed repo | |
| PV String 2 Voltage | address pending | V | PV string/MPPT 2 voltage | Confirmed repo | |
| PV String 2 Current | `0x0422` / `1058` | A | PV string/MPPT 2 current | Confirmed repo | `alphaess_modbus` README example names `pv2_current` at this address. |
| PV String 3 Voltage | address pending | V | PV string/MPPT 3 voltage | Confirmed repo | |
| PV String 3 Current | address pending | A | PV string/MPPT 3 current | Confirmed repo | |
| PV String 4 Voltage | address pending | V | PV string/MPPT 4 voltage | Confirmed repo | |
| PV String 4 Current | address pending | A | PV string/MPPT 4 current | Confirmed repo | |
| PV Capacity Storage | address pending | W | Battery-storage PV nameplate capacity | Confirmed repo | Disabled by default. |
| PV Capacity of Grid Inverter | address pending | W | Grid inverter PV nameplate capacity | Confirmed repo | Disabled by default. |
| CT Rate PV Meter | address pending | - | PV meter CT ratio | Confirmed repo | Disabled by default. |
| CT Rate Grid Meter | address pending | - | Grid meter CT ratio | Confirmed repo | Disabled by default. |

### Battery and BMS

| Register / field | Address | Unit | Meaning | Source / confidence | Notes |
| --- | --- | --- | --- | --- | --- |
| Battery State of Charge | address pending | % | Battery SOC | Confirmed repo | Also exposed on web as `soc`. |
| Battery State of Health | address pending | % | Battery SOH | Confirmed repo | |
| Battery Min Cell Temp | address pending | degC | Lowest cell temperature in pack | Confirmed repo | This is the clearest confirmed battery temperature value. |
| Battery Max Cell Temp | address pending | degC | Highest cell temperature in pack | Confirmed repo | |
| Inverter Temperature | address pending | degC | Inverter internal temperature | Confirmed repo / packet | Community packet uses `Tinv`. |
| Battery Max Charge Current | address pending | A | BMS-reported maximum charge current | Confirmed repo | |
| Battery Max Discharge Current | address pending | A | BMS-reported maximum discharge current | Confirmed repo | |
| Battery Voltage | address pending | V | Pack terminal voltage | Confirmed repo / packet | Community packet uses `BatV`. |
| Battery Current | address pending | A | Pack current | Confirmed repo / packet | Community packet uses `BatC`. |
| Battery Status | address pending | - | Human-readable BMS status/raw code | Confirmed repo / packet | Community packet uses `FlagBms` and `BmsWork`. |
| Battery Remaining Time | address pending | min | Estimated remaining time | Confirmed repo | Disabled by default. |
| Battery Min Cell Voltage | address pending | V | Lowest cell voltage in pack | Confirmed repo / packet | Community packet uses `VcellLow`. |
| Battery Max Cell Voltage | address pending | V | Highest cell voltage in pack | Confirmed repo / packet | Community packet uses `VcellHigh`. |
| Battery Relay Status | address pending | - | BMS relay state | Confirmed repo / packet | Community packet uses `BmsRelay`. |
| Battery Charge Cutoff Voltage | address pending | V | Hardware upper voltage limit from BMS | Confirmed repo | Disabled by default. |
| Battery Discharge Cutoff Voltage | address pending | V | Hardware lower voltage limit from BMS | Confirmed repo | Disabled by default. |
| Battery Module Count | address pending | - | Number of installed battery modules | Confirmed repo / packet | Community packet uses `BmsNum`. |
| Battery Capacity | address pending | kWh | Pack nameplate capacity | Confirmed repo | Disabled by default. |
| Battery Type | address pending | - | Battery type code from BMS | Confirmed repo | Disabled by default. |
| Battery Warning | address pending | - | BMS-level warning bitmask/code | Confirmed repo / packet | Community packet uses `WarInv`, `ErrBms`, and temperature warning IDs. |
| Battery Fault | address pending | - | BMS-level fault bitmask/code | Confirmed repo / packet | |
| Battery 1-6 Warning | address pending | - | Per-module warnings | Confirmed repo | Disabled by default. |
| Battery 1-6 Fault | address pending | - | Per-module faults | Confirmed repo | Disabled by default. |

### Energy totals

| Register / field | Address | Unit | Meaning | Source / confidence | Notes |
| --- | --- | --- | --- | --- | --- |
| Total Energy from PV | address pending | kWh | Lifetime PV generation | Confirmed repo / packet | Community packet uses `EpvTotal`. |
| Total Energy Feed to Grid (Meter) | address pending | kWh | Lifetime grid export measured at grid meter | Confirmed repo | |
| Total Energy Consumption from Grid (Meter) | address pending | kWh | Lifetime grid import measured at grid meter | Confirmed repo | |
| Total Energy Feed to Grid (PV) | address pending | kWh | Lifetime export measured at PV meter | Confirmed repo | |
| Total Energy Charge Battery | address pending | kWh | Lifetime energy into battery | Confirmed repo / packet | Community packet uses `Echarge`. |
| Total Energy Discharge Battery | address pending | kWh | Lifetime energy drawn from battery | Confirmed repo / packet | Community packet uses `EDischarge`. |
| Total Energy Charge Battery from Grid | address pending | kWh | Lifetime grid-to-battery energy | Confirmed repo / packet | Community packet uses `EGridCharge`. |

### Scheduling, dispatch, and controls

These are control-adjacent registers. Read support is useful for UI state, but
write support must be handled with stronger safety checks than telemetry.

| Register / field | Address | Unit | Meaning | Source / confidence | Notes |
| --- | --- | --- | --- | --- | --- |
| Charging Time Period Control | address pending | - | Charge/discharge schedule mode | Confirmed repo | |
| Charging Cutoff SoC | address pending | % | Stop charging at this SOC | Confirmed repo | |
| Discharging Cutoff SoC | address pending | % | Stop discharging at this SOC | Confirmed repo | |
| Charging Period 1/2 Start/Stop Hour | address pending | h | Schedule hour fields | Confirmed repo | |
| Charging Period 1/2 Start/Stop Minute | address pending | min | Schedule minute fields | Confirmed repo | |
| Discharging Period 1/2 Start/Stop Hour | address pending | h | Schedule hour fields | Confirmed repo | |
| Discharging Period 1/2 Start/Stop Minute | address pending | min | Schedule minute fields | Confirmed repo | |
| Dispatch Start | address pending | - | 1 = dispatch active, 0 = stopped | Confirmed repo | Writable/control-adjacent. |
| Dispatch Active Power | address pending | W | Current dispatch power | Confirmed repo | Negative = charge in repo description. |
| Dispatch Reactive Power | address pending | W | Dispatch reactive power | Confirmed repo | |
| Dispatch Mode | address pending | - | Current dispatch mode code | Confirmed repo / packet | Community packet uses `DispatchMode`. |
| Dispatch SoC | address pending | % | Current dispatch SOC target | Confirmed repo / packet | Community packet uses `DispatchSoc`. |
| Dispatch Time | address pending | s | Remaining dispatch duration | Confirmed repo | |
| Dispatch Energy Flow Direction | address pending | - | Flow direction enum | Confirmed repo | |
| Freq Dispatch Flag | address pending | - | Frequency dispatch active flag | Confirmed repo | |
| Dispatch PV Switch | address pending | - | PV coupling switch during dispatch | Confirmed repo | |
| Freq Dispatch Power | address pending | W | Frequency dispatch power setpoint | Confirmed repo | Disabled by default. |
| Freq Dispatch Frequency | address pending | Hz | Frequency dispatch trigger frequency | Confirmed repo | Disabled by default. |

### Inverter, system, and network diagnostics

| Register / field | Address | Unit | Meaning | Source / confidence | Notes |
| --- | --- | --- | --- | --- | --- |
| Inverter Work Mode | address pending | - | Operating mode code | Confirmed repo / packet | Community packet uses `InvWorkMode`. |
| System Fault | address pending | - | Active system fault code | Confirmed repo | 0 = no fault. |
| Inverter Warning 1/2 | address pending | - | Inverter warning bitmask | Confirmed repo | |
| Inverter Fault 1/2 | address pending | - | Inverter fault bitmask | Confirmed repo | |
| Inverter Serial Number | address pending | - | Inverter serial number | Confirmed repo | |
| Inverter Version | address pending | - | DSP firmware version | Confirmed repo | |
| Inverter ARM Version | address pending | - | ARM firmware version | Confirmed repo | |
| BMS Version | address pending | - | BMS firmware version | Confirmed repo | |
| LMU Version | address pending | - | LMU firmware version | Confirmed repo | |
| ISO Version | address pending | - | ISO firmware version | Confirmed repo | |
| EMS Version | address pending | - | EMS firmware version | Confirmed repo / packet | Community packet uses `EmsStatus` for status, not version. |
| System Time YYMM/DDHH/MMSS | address pending | - | Packed inverter clock registers | Confirmed repo | Disabled by default. |
| Modbus Baud Rate | address pending | - | Serial Modbus baud setting | Confirmed repo | Disabled by default. |
| IP Method | address pending | - | DHCP/static mode | Confirmed repo | Disabled by default. |
| Local IP | address pending | - | Device IP address | Confirmed repo | Disabled by default. |
| Subnet Mask | address pending | - | Device subnet mask | Confirmed repo | Disabled by default. |
| Gateway | address pending | - | Device gateway | Confirmed repo | Disabled by default. |

## Web/OpenAPI/MTTP exposed values

### Official OpenAPI endpoints

The public AlphaESS OpenAPI repository and Postman collection list these
endpoints:

| Endpoint | Method | Purpose | Notes |
| --- | --- | --- | --- |
| `/api/getEssList` | GET | Registered system list and metadata | Requires `appId`, `timeStamp`, and `sign` headers. |
| `/api/getLastPowerData` | GET | Latest real-time power data by `sysSn` | Official OpenAPI equivalent of the MTTP live power feed. |
| `/api/getOneDayPowerBySn` | GET | One day of power history | Query includes `queryDate` and `sysSn`. |
| `/api/getOneDateEnergyBySn` | GET | One date of energy totals | Query includes `queryDate` and `sysSn`. |
| `/api/getChargeConfigInfo` | GET | Charge schedule/config | Control-adjacent. |
| `/api/updateChargeConfigInfo` | POST | Update charge schedule/config | Control path; not telemetry. |
| `/api/getDisChargeConfigInfo` | GET | Discharge schedule/config | Control-adjacent. |
| `/api/updateDisChargeConfigInfo` | POST | Update discharge schedule/config | Control path; not telemetry. |

The OpenAPI signature shown in the official demo is:

```text
SHA512(appId + appSecret + timestamp)
```

### `getLastPowerData` fields observed in MTTP HARs

| Raw key | Human name | Alpha ESS HAR | Bytewatt HAR | Source / confidence | Notes |
| --- | --- | --- | --- | --- | --- |
| `ppv` | Total PV power | `2405.0` | `2110.0` | Confirmed HAR | Total solar generation. |
| `ppv1` | PV string 1 power | `1108.0` | `0.0` | Confirmed HAR | Alpha split is meaningful in sample. |
| `ppv2` | PV string 2 power | `1297.0` | `0.0` | Confirmed HAR | Alpha `ppv1 + ppv2 = ppv`. |
| `ppv3` | PV string 3 power | `0.0` | `0.0` | Confirmed HAR | |
| `ppv4` | PV string 4 power | `0.0` | `0.0` | Confirmed HAR | |
| `pmeterDc` | DC meter / PV meter power | `0.0` | `2110.0` | Confirmed HAR / inferred label | Bytewatt sample uses this as non-zero PV-side meter reading. |
| `soc` | Battery state of charge | `70.4` | `52.44` | Confirmed HAR | Battery percentage. |
| `pbat` | Battery power | `-1844.0` | `-1581.0` | Confirmed HAR / inferred label | Charge/discharge sign convention must be normalized before UI use. |
| `pload` | Load power | `532.0` | `529.0` | Confirmed HAR / inferred label | House consumption. |
| `pgrid` | Grid power | `-29.0` | `0.0` | Confirmed HAR / inferred label | Net grid import/export. |
| `prealL1` | AC phase L1 power | not present | `0` | Confirmed HAR / inferred label | Present in Bytewatt sample. |
| `prealL2` | AC phase L2 power | not present | `0` | Confirmed HAR / inferred label | Present in Bytewatt sample. |
| `prealL3` | AC phase L3 power | not present | `0` | Confirmed HAR / inferred label | Present in Bytewatt sample. |
| `pev` | EV charging power | `0` | `0` | Confirmed HAR | |
| `upsModel` | UPS mode/model | `0` | `0` | Confirmed HAR / inferred label | UPS-related state. |
| `forceChargeMode` | Force charge active | `false` | `null` | Confirmed HAR | State flag only; not the charge command itself. |
| `hasChargingPile` | EV charger present | `null` | `null` | Confirmed HAR | Charging pile = EV charger in AlphaESS naming. |
| `hasSecData` | Secondary data present | `true` | `true` | Confirmed HAR | Needs interpretation. |
| `dataType` | Data type/source code | `1` | `0` | Confirmed HAR | Needs interpretation. |
| `ppvSlave` | Slave PV power/detail | `null` | `null` | Confirmed HAR | Needs interpretation. |
| `ev1Power`-`ev4Power` | EV charger power channels | `null` | not present | Confirmed HAR | Present in Alpha sample. |
| `batHeatingStateFlag` | Battery heating state flag | `null` | not present | Confirmed HAR | Flag only; not battery temperature. |
| `inverterMode` | Inverter mode | not present | `null` | Confirmed HAR | |

### Web value caveats

- Battery temperature is not present in the observed MTTP `getLastPowerData`
  payloads.
- `batHeatingStateFlag` is a heating/state flag, not a temperature reading.
- Battery min/max cell temperature is confirmed on the local Modbus side, not
  yet in the observed web/OpenAPI feed.
- Web field labels are mostly inferred from telemetry behavior, community
  mappings, and naming conventions unless AlphaESS publishes a schema.

## Open verification tasks

1. Fill numeric Modbus addresses for every `address pending` row from the
   AlphaESS Modbus protocol document or maintained integration source.
2. Capture a HAR from battery detail, BMS, diagnostics, installer, or fault
   pages and search for `TcellLow`, `TcellHigh`, `batTemp`, `batteryTemp`,
   `temperature`, `Bms`, `BatV`, `BatC`, and `IdTemp`.
3. Normalize sign conventions for `pbat`, `pgrid`, and Modbus battery/grid
   power before using them in UI calculations.
4. Keep telemetry and controls separate. `forceChargeMode` and dispatch state
   are status values; update endpoints and writable Modbus registers are
   control paths.
