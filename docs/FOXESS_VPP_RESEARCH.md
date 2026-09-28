# FoxESS VPP research notes

These notes record the VPP findings supplied during HEROS development. They are a working reference, not proof that a particular installation is currently enrolled in or dispatching through a VPP.

## Key distinction

- **VPP Enrolled / VPP Controlled** describes control ownership or participation. A FoxESS Work Mode value such as `VPP Controlled` is strong evidence of this state.
- **VPP Dispatch Active** describes an active instruction being executed now. Enrollment alone does not prove that a dispatch is happening.
- Sustained battery discharge or grid export is behavior evidence only. It does not identify the cause.

## Signals and confidence

| Signal | Interpretation | Confidence |
| --- | --- | --- |
| FoxESS reports `VPP Controlled` work mode | VPP control ownership/state | High |
| VPP/OpenPlatform enrollment status | Device is enrolled in a VPP application | High, if available |
| Scheduler/work-mode change not issued by HEROS | Possible external control | High-value clue |
| Force Discharge becomes active unexpectedly | Possible dispatch | Medium |
| Remote active-power target changes unexpectedly | Possible dispatch | Medium |
| `remote_enable = 1` | Remote control is enabled, but may be local or external | Insufficient alone |
| Battery discharge or grid export | Observed behavior only | Insufficient alone |

## Modbus and API clues

The FoxESS Modbus work discussed for KH/H1 includes remote-control values such as:

- `44000` — remote enable
- `44001` — remote timeout
- `44002` — active power target

These values can be used by a local controller as well as a VPP service, so HEROS must not classify `remote_enable = 1` as a VPP event by itself.

FoxESS also has a separate VPP/OpenPlatform architecture with VPP-specific API endpoints and device enrollment. The preferred implementation is to use an explicit active dispatch/order/status endpoint if the account exposes one.

## Recommended HEROS model

Expose two separate concepts:

1. **VPP Enrolled** — the device or work mode indicates VPP participation/control ownership.
2. **VPP Dispatch Active** — an explicit provider dispatch is active, or multiple external-control signals agree and HEROS did not issue the change.

For inferred dispatch detection, compare the current scheduler/work mode, remote-control state, active-power target, and force-charge/force-discharge state against commands recorded as issued by HEROS. A single behavior signal should remain a clue rather than a confirmed VPP event.

## Open investigation

- Identify the exact FoxESS API/OpenPlatform endpoint for active VPP dispatches, orders, or events.
- Confirm the field names and availability for Work Mode, enrollment, remote-control effective state, and active-power target on the target FoxESS model.
- Record HEROS-issued control changes so external changes can be distinguished from local commands.
- Map confirmed provider events into the Status hero as `VPP Event`; use a separate enrollment label if the UI needs to show participation without an active dispatch.
