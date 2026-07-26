# Battery Research

This document collects battery vendor and device behavior notes for Home Energy
Manager.

The canonical field/register list lives in `docs/MODBUS.md`. Keep detailed
Modbus addresses and web telemetry field mappings there, and use this file for
interpretation notes and vendor/device research.

## MTTP live telemetry: PV input channels

### Context

The initial working assumption was that the MTTP captures only exposed total PV
power, such as `ppv`. That is incomplete. The MTTP HAR captures show that the
individual PV input channels are also exposed as `ppv1` through `ppv4` in the
live telemetry response.

The important correction is that the individual PV inputs are already present
in the MTTP telemetry response. This is telemetry, not control, and is not the
force-charge command path.

### Alpha ESS

The Alpha ESS MTTP HAR includes the normal live data feed:

```http
GET /api/report/energyStorage/getLastPowerData?sysSn=ALD100000000000&stationId=
```

The response includes per-input PV channels:

```json
{
  "ppv": 2405.0,
  "ppv1": 1108.0,
  "ppv2": 1297.0,
  "ppv3": 0.0,
  "ppv4": 0.0,
  "pmeterDc": 0.0,
  "soc": 70.4,
  "pbat": -1844.0,
  "pload": 532.0,
  "pgrid": -29.0,
  "pev": 0,
  "upsModel": 0,
  "forceChargeMode": false,
  "hasChargingPile": null
}
```

This appears to be part of the normal live data feed rather than a manual
action. For Alpha ESS, the PV string breakdown is visible in
`getLastPowerData`. In this sample, the split is meaningful:
`1108.0 + 1297.0 = 2405.0`.

### Bytewatt

The Bytewatt MTTP HAR shows the same kind of live feed:

```http
GET /api/report/energyStorage/getLastPowerData?sysSn=All&stationId=
```

The response includes `ppv1`, `ppv2`, `ppv3`, and `ppv4`.

```json
{
  "ppv": 2110.0,
  "ppv1": 0.0,
  "ppv2": 0.0,
  "ppv3": 0.0,
  "ppv4": 0.0,
  "prealL1": 0,
  "prealL2": 0,
  "prealL3": 0,
  "pmeterDc": 2110.0,
  "soc": 52.44,
  "pbat": -1581.0,
  "pload": 529.0,
  "pgrid": 0.0,
  "pev": 0,
  "upsModel": 0,
  "forceChargeMode": null,
  "hasChargingPile": null
}
```

In the inspected Bytewatt sample, the per-input fields were zero while total
`ppv` and `pmeterDc` were non-zero. That means the feed and fields exist, but
the inspected capture did not prove that Bytewatt reports non-zero string-level
values in that sample.

### Field labels

These labels are suitable for UI legends and documentation. The labels for
`ppv1` through `ppv4`, `pbat`, `pload`, `pgrid`, and related values are inferred
from telemetry behavior and community usage, not from a single official API
schema document.

| Raw key | Human name | Meaning |
| --- | --- | --- |
| `ppv` | Total PV power | Total solar generation |
| `ppv1` | PV string 1 power | Solar input from string/MPPT 1 |
| `ppv2` | PV string 2 power | Solar input from string/MPPT 2 |
| `ppv3` | PV string 3 power | Solar input from string/MPPT 3 |
| `ppv4` | PV string 4 power | Solar input from string/MPPT 4 |
| `pmeterDc` / `pmeterDC` | DC meter / PV meter power | DC-side PV meter reading |
| `soc` | Battery state of charge | Battery percentage |
| `pbat` | Battery power | Battery charge/discharge power |
| `pload` | Load power | House consumption |
| `pgrid` | Grid power | Net grid import/export |
| `prealL1` | AC phase L1 power | Phase 1 real power |
| `prealL2` | AC phase L2 power | Phase 2 real power |
| `prealL3` | AC phase L3 power | Phase 3 real power |
| `pev` | EV charging power | Electric vehicle load |
| `upsModel` | UPS mode/model | UPS-related state |
| `forceChargeMode` | Force charge active | Charge-now state flag |
| `hasChargingPile` | EV charger present | Whether charger hardware is detected |

For a compact UI legend, prefer:

- Total PV
- PV1, PV2, PV3, PV4
- Battery SOC
- Battery power
- House load
- Grid power
- Phase L1/L2/L3 power

### Current conclusion

- The underlying `getLastPowerData` telemetry feed exists in both systems.
- Alpha ESS exposes the PV input breakdown as `ppv1` through `ppv4`.
- Bytewatt exposes the same fields as `ppv1` through `ppv4`, but the inspected
  capture had zero string values despite non-zero total `ppv`.
- Consumers should not assume total PV is the only available PV measurement.
- Consumers should not treat this as force-charge behavior. It is telemetry,
  not a control action.

### Sources and caveats

Official AlphaESS terminology is available in AlphaESS user-facing material,
including "Understanding Solar Terminology in AlphaCloud APP" and "How AlphaESS
system works".

Practical field mappings are also informed by community sources, including
Whirlpool Alpha ESS data discussions, `alphaess_modbus`, and
`Alpha-ESS-Modbus-TCP-Monitor-Openhab`.

The HAR samples are direct evidence that the fields exist in
`getLastPowerData`. The human-friendly labels remain best-effort mappings unless
confirmed by an official API schema.
