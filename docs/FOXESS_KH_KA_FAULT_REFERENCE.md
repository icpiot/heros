FOXESS KH/KA FAULT / ALARM REFERENCE

Target inverter:
- FoxESS KH10
- Family: KH/KA
- Source: FoxESS KH/KA User Manual V1.0.6
- Region: Australia

IMPORTANT:
Treat the strings below as canonical FoxESS fault/alarm names.
Do not rename the raw fault value.
A separate friendly_name/category/description may be added.

==================================================
GRID / AC
==================================================

Grid Lost Fault
- Grid supply lost.

Grid Volt Fault
- Grid voltage outside permitted range.

Grid Freq Fault
- Grid frequency outside permitted range.

10min Volt Fault
- Grid voltage has remained outside the permitted range for 10 minutes.

Ground Fault
- Ground/earth connection fault.

Over Load Fault
- Overload while operating on-grid.

Main Relay Open
- Grid relay remains open.

S1 Close Fault
- Grid relay S1 remains closed.

S2 Close Fault
- Grid relay S2 remains closed.

M1 Close Fault
- Grid relay M1 remains closed.

M2 Close Fault
- Grid relay M2 remains closed.


==================================================
INVERTER / AC OUTPUT
==================================================

SW Inv Cur Fault
- High inverter/output current detected by software.

HW Inv Cur Fault
- High inverter/output current detected by hardware.

DCI Fault
- DC component in AC output current exceeds limit.

SW Bus Vol Fault
- DC bus voltage outside range, detected by software.

HW Bus Vol Fault
- DC bus voltage outside range, detected by hardware.

Temp Fault
- Inverter temperature too high.


==================================================
PV / SOLAR
==================================================

Pv Volt Fault
- PV input voltage outside permitted range.

SW Pv Cur Fault
- High PV input current detected by software.

HW Pv Cur Fault
- High PV input current detected by hardware.

PvCon Dir Fault
- PV polarity/connection reversed.


==================================================
BATTERY POWER STAGE
==================================================

Bat Volt Fault
- Battery voltage fault.

SW Bat Cur Fault
- High battery current detected by software.

HW Bat Cur Fault
- High battery current detected by hardware.

Bat Power Low
- Battery power / available battery energy too low.

Bat Relay Open
- Battery relay remains open.

Bat Relay Short Circuit
- Battery relay remains closed.

Bat Buck Fault
- Battery buck-converter MOSFET/circuit fault.

Bat Boost Fault
- Battery boost-converter MOSFET/circuit fault.

BatCon Dir Fault
- Battery polarity/connection reversed.


==================================================
EPS / BACKUP
==================================================

Eps Over Load
- EPS/off-grid output overloaded.

Eps Relay Fault
- EPS relay fault.


==================================================
ISOLATION / RESIDUAL CURRENT / SAFETY
==================================================

Iso Fault
- Electrical isolation/insulation fault.

Res Cur Fault
- Residual current is too high.

Res Cur HW Fault
- Residual-current detection hardware/device fault.


==================================================
INTERNAL INVERTER COMMUNICATION / PROCESSORS
==================================================

SCI Fault
- Communication between master controller and manager failed.

MDSP SPI Fault
- Communication between master and slave processor failed.

MDSP Smpl Fault
- Master sampling/detection circuit fault.

RDSP SPI Fault
- Communication between master and slave processor failed.

RDSP Smpl Fault
- Slave sampling/detection circuit fault.


==================================================
INTERNAL MEMORY / EEPROM
==================================================

Inv EEPROM Fault
- Inverter EEPROM fault.

ARM EEPROM Fault
- Manager/ARM EEPROM fault.


==================================================
MEASUREMENT CONSISTENCY
==================================================

GridV Cons Fault
- Grid-voltage samples between master and slave are inconsistent.

GridF Cons Fault
- Grid-frequency samples between master and slave are inconsistent.

Dci Cons Fault
- DC-injection samples between master and slave are inconsistent.

Rc Cons Fault
- Residual-current samples between master and slave are inconsistent.


==================================================
EXTERNAL COMMUNICATION
==================================================

Meter Lost Fault
- Communication between meter and inverter interrupted.

BMS Lost
- Communication between BMS and inverter interrupted.


==================================================
BMS COMMUNICATION / INTERNAL
==================================================

Bms Ext Fault
- BMS external communication fault / BMS-inverter communication interrupted.

Bms Int Fault
- Battery/BMS internal communication or configuration fault.


==================================================
BMS VOLTAGE
==================================================

Bms Volt High
- Battery over-voltage.

Bms Volt Low
- Battery under-voltage.


==================================================
BMS CURRENT
==================================================

Bms ChgCur High
- Battery charging current too high.

Bms DchgCur High
- Battery discharging current too high.


==================================================
BMS TEMPERATURE
==================================================

Bms Temp High
- Battery temperature too high.

Bms Temp Low
- Battery temperature too low.


==================================================
BMS CELL / HARDWARE / PROTECTION
==================================================

BmsCellImbalance
- Battery cell capacities/levels are inconsistent.

Bms HW Protect
- Battery hardware protection active.

BmsCircuit Fault
- BMS hardware circuit fault.

Bms Insul Fault
- Battery insulation fault.


==================================================
BMS SENSOR FAULTS
==================================================

BmsVoltsSen Fault
- Battery voltage sensor fault.

BmsTempSen Fault
- Battery temperature sensor fault.

BmsCurSen Fault
- Battery current sensor fault.


==================================================
BMS RELAY
==================================================

Bms Relay Fault
- Battery/BMS relay fault.


==================================================
BATTERY PACK / BMS COMPATIBILITY
==================================================

Bms Type Unmatch
- Battery pack capacity/type mismatch.

Bms Ver Unmatch
- Software versions between battery slaves do not match.

Bms Mfg Unmatch
- Cell manufacturers do not match.

Bms SwHw Unmatch
- Battery slave software and hardware do not match.

Bms M&S Unmatch
- Master and slave BMS software versions do not match.


==================================================
BMS CONTROL
==================================================

Bms ChgReq NoAck
- Charging request received no acknowledgement.


==================================================
CANONICAL FAULT NAMES — MACHINE-READABLE LIST
==================================================

[
    "Grid Lost Fault",
    "Grid Volt Fault",
    "Grid Freq Fault",
    "10min Volt Fault",
    "SW Inv Cur Fault",
    "DCI Fault",
    "HW Inv Cur Fault",
    "SW Bus Vol Fault",
    "Bat Volt Fault",
    "SW Bat Cur Fault",
    "Iso Fault",
    "Res Cur Fault",
    "Pv Volt Fault",
    "SW Pv Cur Fault",
    "Temp Fault",
    "Ground Fault",
    "Over Load Fault",
    "Eps Over Load",
    "Bat Power Low",
    "HW Bus Vol Fault",
    "HW Pv Cur Fault",
    "HW Bat Cur Fault",
    "SCI Fault",
    "MDSP SPI Fault",
    "MDSP Smpl Fault",
    "Res Cur HW Fault",
    "Inv EEPROM Fault",
    "PvCon Dir Fault",
    "Bat Relay Open",
    "Bat Relay Short Circuit",
    "Bat Buck Fault",
    "Bat Boost Fault",
    "Eps Relay Fault",
    "BatCon Dir Fault",
    "Main Relay Open",
    "S1 Close Fault",
    "S2 Close Fault",
    "M1 Close Fault",
    "M2 Close Fault",
    "GridV Cons Fault",
    "GridF Cons Fault",
    "Dci Cons Fault",
    "Rc Cons Fault",
    "RDSP SPI Fault",
    "RDSP Smpl Fault",
    "ARM EEPROM Fault",
    "Meter Lost Fault",
    "BMS Lost",
    "Bms Ext Fault",
    "Bms Int Fault",
    "Bms Volt High",
    "Bms Volt Low",
    "Bms ChgCur High",
    "Bms DchgCur High",
    "Bms Temp High",
    "Bms Temp Low",
    "BmsCellImbalance",
    "Bms HW Protect",
    "BmsCircuit Fault",
    "Bms Insul Fault",
    "BmsVoltsSen Fault",
    "BmsTempSen Fault",
    "BmsCurSen Fault",
    "Bms Relay Fault",
    "Bms Type Unmatch",
    "Bms Ver Unmatch",
    "Bms Mfg Unmatch",
    "Bms SwHw Unmatch",
    "Bms M&S Unmatch",
    "Bms ChgReq NoAck"
]