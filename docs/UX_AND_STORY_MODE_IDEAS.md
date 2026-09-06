# UX and Story Mode Ideas

This document captures product and interface ideas discussed while comparing HEROS with commercial battery portals such as AlphaESS and Bytewatt.

The purpose is not to copy a vendor portal. The goal is to keep the familiar energy concepts users already understand, while making HEROS more transparent, diagnostic, interactive, and vendor-independent.

## Product direction

Most commercial energy portals are good at showing **what is happening now**:

- Solar production
- House consumption
- Battery charge or discharge
- Grid import or export
- State of charge
- Daily and cumulative energy totals

HEROS should go further by explaining:

1. **What is happening?**
2. **Why is it happening?**
3. **What is expected to happen next?**
4. **What can the user do about it?**

Story Mode is the main interface for delivering that explanation.

## 1. Story Mode

Story Mode should translate raw energy states, automation activity, forecasts, tariffs, and control decisions into plain-language explanations.

Example:

> The battery started charging at 10:15 because the electricity price fell to 8 cents per kWh. Tomorrow's solar forecast is lower than normal, so the system is storing cheaper energy now to reduce morning peak imports. Charging will stop at 90% or when the off-peak period ends.

Useful Story Mode content could include:

- Why the battery is charging or discharging
- Why the home is importing from or exporting to the grid
- Why a scheduled action did or did not run
- Which tariff, forecast, SOC limit, or automation influenced the decision
- When the current behaviour is expected to end
- What event will cause the system to reconsider
- Whether the behaviour is automatic, scheduled, manually overridden, or provider-controlled

### Suggested Story Mode event structure

Each significant event should ideally record:

- Timestamp
- Event type
- Current operating state
- Trigger
- Decision or action taken
- Main reason
- Supporting data
- Expected duration
- Re-evaluation time or condition
- Alternative actions considered, where available
- Outcome after the event completes

This structure could later support both a timeline and natural-language summaries.

## 2. A contextual “Why?” action

Important values and flows should offer a contextual **Why?** action.

Examples:

- Battery: Why is it charging?
- Grid: Why are we importing?
- Solar: Why is output below forecast?
- Export: Why are we exporting instead of charging?
- Automation: Why did this rule not run?

The answer should be generated from known system state rather than a generic help page.

## 3. “What if?” scenarios

A **What if?** mode could let users compare possible actions before changing system behaviour.

Examples:

- What if I force-charge the battery now?
- What if I export excess solar instead of storing it?
- What if I raise the battery reserve from 15% to 30%?
- What if tomorrow produces 30% less solar than forecast?
- What if I add another 10 kWh of battery capacity?
- What if I add an EV with a typical daily driving profile?

The result should show estimated effects on:

- Cost
- Export income
- Peak-rate imports
- Battery SOC
- Self-consumption
- Self-sufficiency
- Backup reserve
- Battery cycling

These estimates should show their assumptions and uncertainty.

## 4. Decision Replay

Decision Replay would provide an audit trail for optimiser or automation choices.

A replay entry might show:

- The decision made
- The trigger that caused evaluation
- Inputs used at the time
- Alternatives considered
- Why each alternative was accepted or rejected
- Confidence level
- When the decision will be reviewed again
- Actual outcome compared with the predicted outcome

Example:

> Considered grid charging between 01:00 and 05:00. Rejected because tomorrow's solar forecast is high and the battery is expected to reach 82% before the evening peak. The decision will be reviewed at 16:00 if the forecast changes.

This feature would make automated control easier to trust and troubleshoot.

## 5. Time Machine

A historical **Time Machine** could use a time slider to replay the home’s energy state through a selected day.

As the user moves through time, the interface could update:

- Energy flow animation
- Solar, load, battery, and grid power
- SOC
- Tariff state
- Active automations
- Story Mode explanation
- Alerts and system events

This would be more intuitive than interpreting several independent charts.

Possible modes:

- Scrub manually through the day
- Play at accelerated speed
- Jump between significant events
- Compare two days
- Compare actual behaviour with forecast or planned behaviour

## 6. Mission Control overview

The main operational page should answer four questions immediately:

1. What is the system doing now?
2. Why is it doing that?
3. What is expected to happen next?
4. Is anything abnormal or requiring attention?

Suggested Mission Control elements:

- Live energy-flow graphic
- Current operating mode
- One-sentence Story Mode explanation
- Next expected system action
- Current tariff and next tariff change
- Forecast battery position at key times
- Active overrides
- Important health alerts
- Confidence or data-quality indicator

The page should remain clean, with deeper detail available by selecting each component.

## 7. Clickable energy flows and progressive detail

The energy-flow overview should stay simple, but each object and flow should be interactive.

### Battery detail

- SOC and SOH
- Charge/discharge power
- Temperature
- Current limits
- Reserve settings
- Charge source
- Estimated time to target SOC
- Daily throughput
- Round-trip efficiency estimate
- Cycles or equivalent full cycles
- Recent decisions affecting the battery

### Solar detail

- Total PV production
- MPPT or string-level breakdown where available
- Roof orientation grouping
- Current versus expected output
- Shading or imbalance indicators
- Clipping detection
- Curtailment detection
- Yield comparison with similar weather days

### Grid detail

- Import/export power
- Current buy and sell price
- Tariff period
- Import/export limits
- Reason for current grid flow
- Cost or revenue accumulating now
- Scheduled grid actions

### House/load detail

- Current consumption
- Base load
- Major detected load changes
- Flexible versus non-flexible loads
- Load forecast
- Possible load shifting opportunities

## 8. MPPT and solar diagnostics

AlphaESS and similar portals increasingly expose MPPT information. HEROS should treat this as a diagnostic capability rather than only another chart.

Potential MPPT views:

- Voltage, current, and power per MPPT
- Daily energy per MPPT
- Comparison between MPPTs
- Normalised performance by array size
- Roof orientation labels
- Current versus expected output
- Persistent imbalance detection
- Sudden production drop detection
- Partial shading indicators
- String fault indicators where the data supports them

The UI should avoid declaring a fault from a single reading. It should distinguish between observations, likely causes, and confirmed faults.

## 9. Forecast confidence and uncertainty

Forecasts should not be presented as certain.

Examples:

- Expected solar: 24 kWh
- Likely range: 19–28 kWh
- Confidence: Medium

Confidence can reflect:

- Weather-model agreement
- Cloud uncertainty
- Historical forecast accuracy
- Missing data
- Recent system behaviour
- Unusual load patterns
- Tariff uncertainty

Story Mode should explain low-confidence forecasts in plain language.

## 10. System Health page

The Health page should assess the whole energy system, not only battery health.

Suggested sections:

- Solar array
- MPPTs and strings
- Inverter
- Battery
- Grid connection
- Provider API or Modbus connection
- Home Assistant entities
- Automations and schedules
- Tariff data
- Weather and forecast data
- Internet or cloud dependencies

Each section could show:

- Current status
- Last successful update
- Data quality
- Recent anomalies
- Trend away from normal
- Recommended action

A health score may be useful, but the underlying evidence should always be visible.

## 11. Expected-versus-actual comparisons

HEROS should compare planned or expected behaviour with what actually happened.

Examples:

- Forecast solar versus actual solar
- Forecast load versus actual load
- Planned battery SOC versus actual SOC
- Expected savings versus actual savings
- Scheduled charge energy versus delivered charge energy
- Predicted evening reserve versus actual reserve

This would improve both user understanding and future optimisation accuracy.

## 12. Data quality and source transparency

The interface should show where important information came from and whether it is current.

Possible indicators:

- Local Modbus
- Vendor cloud API
- Home Assistant sensor
- Forecast service
- Tariff service
- Estimated or calculated value

Useful metadata:

- Last update time
- Sample interval
- Stale-data warning
- Estimated-data warning
- Missing-data period
- Source priority when multiple sources exist

This is especially important for a vendor-independent platform.

## 13. Manual overrides with clear consequences

Manual controls should explain their likely effect before submission.

Example:

> Raising minimum SOC from 15% to 30% reserves approximately 6 kWh for backup. Based on recent usage, this may increase peak grid imports by about 2–4 kWh on a low-solar day.

Overrides should clearly show:

- What setting is changing
- When it takes effect
- How long it remains active
- What automation it supersedes
- How to return to automatic control
- Estimated cost, energy, or backup impact

The existing staged-edit and Submit Settings workflow is a strong foundation for this.

## 14. Alerts that explain importance

Alerts should say more than “high”, “low”, or “offline”.

A useful alert should include:

- What changed
- Why it matters
- Whether immediate action is required
- Likely causes
- Evidence used
- Recommended next step
- Whether the condition is still active

Example:

> MPPT 2 has produced 38% less energy than MPPT 1 under similar conditions for four clear days. This may indicate persistent shading, a string issue, or a configuration difference. No immediate safety fault is detected.

## 15. Milestones and achievements

Optional milestones can make long-term energy performance more engaging without turning the interface into a game.

Examples:

- 100% solar-powered day
- No peak-rate imports for one month
- Record solar production day
- Record export day
- First megawatt-hour generated
- One tonne of estimated CO₂ avoided
- Longest backup operation
- Highest self-sufficiency month

These should be factual, configurable, and easy to disable.

## 16. Ask HEROS

A future **Ask HEROS** interface could answer natural-language questions using the system’s stored energy, event, tariff, forecast, and configuration data.

Example questions:

- Why did my bill increase this week?
- Why did the battery not charge overnight?
- What caused yesterday’s grid import spike?
- How much would another 10 kWh of storage have saved?
- Which days had the worst forecast accuracy?
- What happens if I buy an EV next year?
- Is one solar array underperforming?
- Which automation has had the largest financial effect?

Ask HEROS should cite the measurements, events, and assumptions behind each answer.

## 17. Vendor-independent interface

The interface should use common energy concepts rather than reproducing one vendor’s terminology.

Examples:

- Battery reserve instead of a vendor-specific field name
- Grid import limit
- Export limit
- Forced charge window
- Forced discharge window
- Self-consumption mode
- Time-of-use optimisation

Provider adapters can translate these concepts to vendor-specific APIs or Modbus registers.

Where providers expose extra capabilities, the UI can add provider-specific advanced panels without changing the core navigation.

## 18. Design principles

The following principles should guide implementation:

- Keep the main page understandable in a few seconds
- Reveal technical depth progressively
- Explain decisions, not only measurements
- Show confidence and uncertainty
- Make automated actions auditable
- Make manual overrides reversible
- Distinguish observed facts from inferred causes
- Prefer local and current data where available
- Preserve vendor independence
- Avoid visual noise and unnecessary cards
- Design for desktop and mobile from the start

## Suggested implementation order

### Near term

1. Expand Story Mode event explanations
2. Add contextual Why? actions
3. Make energy-flow components clickable
4. Add current-state and next-action summaries
5. Add MPPT detail when provider data is available
6. Add source freshness and data-quality indicators

### Medium term

1. Decision Replay
2. Time Machine day replay
3. Forecast confidence and likely ranges
4. Expected-versus-actual comparisons
5. Whole-system Health page
6. Better manual-override impact explanations

### Longer term

1. What-if simulation
2. Capacity and EV scenario modelling
3. Ask HEROS natural-language analysis
4. Optimiser alternative-decision logging
5. Cross-provider performance benchmarking

## Open design questions

- Which events deserve a Story Mode entry?
- How long should detailed decision history be retained?
- Which explanations can be deterministic, and which require inference?
- How should confidence be calculated and displayed?
- Should Ask HEROS run fully locally, optionally use an external model, or support both?
- How should provider-specific controls fit into a common interface?
- Which features belong in the sidebar panel versus Home Assistant entities and services?
- How should forecasts and simulations communicate assumptions without overwhelming users?

## Competitive positioning

Commercial portals such as AlphaESS and Bytewatt establish familiar patterns for energy flows, charts, battery controls, schedules, and increasingly MPPT diagnostics. Their interfaces are useful benchmarks, but HEROS should differentiate itself through:

- Plain-language reasoning
- Decision transparency
- Historical replay
- Forecast uncertainty
- Rich diagnostics
- Vendor independence
- Local Home Assistant integration
- User-controlled automation
- Scenario modelling

The strongest product statement is:

> HEROS does not only show what the energy system is doing. It explains why, predicts what comes next, and lets the user safely explore alternatives.
