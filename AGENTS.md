# HEROS Development Guide

## Repository Scope

- Source of truth: `C:\Dev\repos\heros`
- Do not use the deleted `neovoltBattery_HomeAssistantPlugin` repo unless the user explicitly asks for it.
- Treat this repo as the only active codebase for all work in this session.
- The existing ByteWatt installation at `10.0.0.102` must remain untouched unless explicitly authorized.
- The paired HEROS test instances are `10.0.0.111` and `10.0.0.112`, with config shares `\\10.0.0.111\config` and `\\10.0.0.112\config`. Keep both instances in sync for HEROS integration and served-panel deployments. Run relevant tests first, deploy the same files to both, restart both when required, and verify each target independently.
- Panel version integrity is mandatory: `HEROS_PANEL_BUILD` in `examples/www/heros-panel.js`, `PANEL_COMPONENT_NAME` and `PANEL_MODULE_URL` in `custom_components/heros/__init__.py`, and `examples/www/LATEST_BUILD.txt` must name the identical build. Before declaring a panel deployment successful, query `get_panels` on each HA host and confirm its custom panel name/module URL matches the served JavaScript build. If only assets are deployed, retain the currently registered build number; do not bump the asset build independently.

## Repository Layout

- `custom_components/heros/` - Home Assistant integration code
- `examples/www/` - panel and card assets served into Home Assistant
- `examples/panel/` - panel registration examples
- `scripts/` - repo/HA sync helpers
- `tests/` - unit tests

## Working Rules

- Keep changes inside this repo unless the user explicitly requests otherwise.
- Use `heros` for technical identifiers and HEROS for user-facing labels. Keep the system generic across energy providers.
- Do not reintroduce references to the deleted repo.
- If a file or script still contains stale legacy naming, update it to the current repo conventions.
- For longer Codex implementation runs, create a git checkpoint after roughly every 5 meaningful updates when the staged scope can be kept clean.
- When a change materially affects UI behavior, reporting/storage behavior, mappings, or workflow, update the relevant repo docs in the same run.
- Verify the explicitly authorized HA target before any sync. Do not infer a destination from a mapped drive.


## Instruction Priority and Mandatory Rule Compliance

- Established project rules are mandatory constraints, not suggestions, preferences, or defaults.
- Never knowingly violate, bypass, weaken, reinterpret, or ignore an established rule for convenience, speed, simplicity, perceived efficiency, implementation preference, or because an alternative appears "good enough".
- If you are aware that an action conflicts with a documented rule, you MUST NOT take that action unless the user has explicitly authorized an exception to that specific rule.
- You may not create your own exception to a rule.
- You may not treat successful tests, a working implementation, deployment success, or a visually acceptable result as permission to ignore a documented rule.
- A shortcut that violates a documented rule is an incorrect implementation, even if the shortcut appears to work.
- If two project rules appear to conflict, stop the conflicting action, identify the exact rules involved, and resolve the conflict using the instruction hierarchy below. Do not silently choose whichever rule is easier to satisfy.
- If a rule is ambiguous, follow the interpretation that preserves the rule's stated safety, validation, deployment, persistence, or completion requirement. Ask the user only when a genuine decision is required and the ambiguity cannot be resolved from the repository or task context.
- Before making a release, deployment, completion, or hand-back decision, explicitly check whether the chosen approach violates any applicable rule in this guide.
- If you discover after implementation that you violated a rule, the task is not complete. Correct the violation, repeat all affected validation, and only then continue toward completion.
- Never report a task as complete while knowingly leaving a rule violation in place.

### Instruction hierarchy

When instructions appear to conflict, apply them in this order:

1. The user's latest explicit instruction for the current task.
2. This `AGENTS.md` / HEROS Development Guide and other explicit repository-level instructions.
3. Task-specific requirements already provided by the user.
4. Existing architecture, tests, and repository conventions.
5. Existing implementation details.

Existing code is evidence of the current implementation, not authority to override a higher-priority instruction.

### No deliberate non-compliance

Statements or reasoning equivalent to any of the following indicate a process failure and MUST trigger correction before completion:

- "I deliberately chose the shortcut despite the documented rule."
- "The rule said X, but I chose Y because it was faster/easier/simpler."
- "I knew this did not meet the documented requirement, but the result worked."
- "I skipped the required validation because the change was small."
- "I decided the documented requirement was unnecessary."

If such a situation occurs, do not merely acknowledge it in the final response. Undo or correct the non-compliant decision, perform the required work, rerun affected validation, and verify compliance before handing the task back.

## Panel Interaction Rules

- Panel pages receive frequent Home Assistant `hass` updates, so dropdowns that must stay open during selection should use the held custom selector pattern from the shared battery selector.
- Avoid native `<select>` controls for panel setup workflows when a background render can interrupt the click/release cycle.
- A held selector needs explicit open state, render-hold coverage in `_shouldHoldRender()`, delegated handlers for toggle/option/outside-click, and matching fallback-controller state.
- When a UI field name differs from stored mapping keys, translate it before saving so the selected value appears immediately after release.
- For setup screens that need broad mapping controls, keep the mapping card full-width on desktop and let the dropdown menu inherit that width instead of stacking it into a narrow shared column.
- Do not store setup mappings or override state in browser-only storage such as `localStorage` when the value is intended to persist as project/user configuration.
- Setup mappings, hero mapping overrides, and similar configuration choices must persist through HEROS backend config or another shared HA-backed store so they survive browser changes and are consistent across devices.
- Browser-local storage is still acceptable for lightweight UI preferences only, such as the active page, battery selector convenience, debug visibility, settings focus, or a remembered `entry_id` hint. Those keys must not become the source of truth for shared HEROS configuration.

## Validation

- Run the relevant tests before handing back changes.
- For panel JavaScript, check syntax with Node if available.
- For Home Assistant integration changes, validate the affected Python modules and any related tests.

## Documentation Notes

- Keep repo instructions current with the actual tree.
- Repository instructions and explicit user instructions govern how work is performed. Existing code or repo state may reveal implementation reality, but it does not override a documented rule. If code conflicts with an established rule, treat the code as needing correction unless the user explicitly authorizes an exception.
- If you add any local-only operational notes for HA sync work, keep them under `.codex/` and out of git.


## HEROS UI / UX rules

When changing the UI:

- Do not judge the design from source code alone.
- Launch/render the interface and visually inspect it.
- Read every visible heading, label, value, unit and button.
- Check for clipping, wrapping, truncation and awkward line breaks.
- Check spacing, alignment, information hierarchy and card sizing.
- Avoid oversized cards with very little content.
- Avoid excessive nested cards.
- Important energy values should be visually prominent.
- Keep typography and spacing consistent across HEROS.
- Check desktop and mobile layouts.
- After implementation, perform a visual QA pass.
- Fix visual problems before declaring the task complete.


# Task Completion Rules

## Do not hand work back early

When given a task, continue working until the requested task is fully completed.

Do NOT stop merely because:
- you have identified the problem;
- you have implemented only part of the solution;
- one test passes;
- you have created a proposed solution;
- additional related changes are required;
- you have discovered another issue caused by your changes;
- the task is larger than initially expected.

You are expected to continue investigating, editing, testing, and fixing until the task meets the Definition of Done below.

## Definition of Done

A task is complete only when ALL applicable requirements are satisfied:

1. The requested functionality has been fully implemented.
2. Existing functionality affected by the change still works.
3. Relevant automated tests have been run.
4. Test failures caused by the change have been fixed.
5. Relevant linting/type/static checks have been run where available.
6. The actual application/output has been inspected where practical.
7. UI work has been checked for:
   - text overflow
   - clipping
   - alignment
   - spacing
   - responsive behaviour
   - readability
   - visual consistency with the existing application
8. No temporary debug code, placeholders, TODO implementations, or mock behaviour remains unless explicitly requested.
9. Any secondary files/configuration/tests required for the feature have also been updated.
10. The final response accurately states what was completed and what validation was performed.
11. Every applicable project rule and explicit task instruction has been followed. Known rule violations, deliberate shortcuts, skipped mandatory checks, or self-created exceptions make the task incomplete.

## Do not substitute instructions for execution

Do not tell the user to:
- run a command you can run yourself;
- edit a file you can edit yourself;
- check something you can inspect yourself;
- perform the next obvious development step.

Perform those actions yourself.

Only ask the user to perform an action when it genuinely requires something you cannot access, such as:
- credentials;
- physical hardware interaction;
- an unavailable external service;
- a decision requiring user preference.

## Resolve problems autonomously

If an implementation fails:
1. inspect the failure;
2. determine the cause;
3. modify the implementation;
4. rerun the relevant validation;
5. request visual confirmation of the report output if period controls are used'
6. repeat until resolved.

Do not return the task simply because the first approach failed.

## UI and Design Tasks

For any UI change, do not consider the task complete based only on source-code inspection.

Inspect the rendered result whenever the available tooling allows it, where not available, ask the user for a screenshot.

Specifically verify:
- all displayed text;
- labels and values fit their containers;
- cards/components are aligned;
- spacing is intentional;
- long and short values render correctly;
- the design is visually coherent with surrounding screens;
- visually inspect the period-control, if the rport contains them;
- the requested information is actually visible to the user.

If the rendered result looks poor, improve it before finishing.

## Final response

The final response should be a completion report, not a proposed next-step list.

Include:
- what was changed;
- what was tested;
- the validation result;
- any genuine limitation that could not be resolved;
- cache buster number update;
- clear steps and actions in a list the user must perform.

Do not end with "you can now..." or "next you should..." for work that could have been completed during the task.
## Mandatory task completion

Do not stop execution merely to report that work remains. Continue performing all remaining requested work immediately. Do not return control to the user to describe unfinished work, and do not use status updates or intermediate validation as completion. Stop only when the entire requested task is completed and verified, a genuine external blocker cannot be resolved without user-provided information or inaccessible resources, or an action requires explicit user approval. Before stopping, perform a final completion check against every requirement; any actionable requirement that can be performed in the workspace must be completed first.

The final completion check must also include a rule-compliance audit:
- review the applicable instructions in this guide;
- confirm no documented rule was knowingly bypassed or substituted with a shortcut;
- confirm no mandatory test, deployment, persistence, visual verification, or target-verification requirement was skipped;
- correct any non-compliance before stopping.

A task that works but violates an applicable rule is not complete.

## No premature stop

Finding unfinished work is a trigger to continue execution, not a reason to end the turn. Do not state that a requested implementation remains incomplete when it can still be performed; perform it and verify the result before handing the task back.

## Mandatory visual verification

Any change affecting the user interface, report layout, controls, filters, buttons, fields, labels, charts, tables, menus, parameters, styling, positioning, visibility, or displayed values is incomplete until the final rendered interface has been visually inspected. Open the affected page, navigate to the changed area, and confirm every element is visible, correctly positioned and labelled, not clipped, hidden, overlapping, duplicated, or malformed, and shows the expected options or values. Where practical, interact with the changed control. If a defect is found, fix it and repeat the visual inspection.

Source inspection, DOM changes, builds, tests, deployment success, asset versions, API responses, logs, and configuration files are supporting checks only and do not replace visual verification. If browser access is unavailable, request a screenshot of the affected area; do not mark the task complete or hand it back as successful until that screenshot has been inspected.


## Mandatory Completion Sequence

For every applicable implementation task, follow this sequence in order:

1. Implement all requested changes completely.
2. Run all relevant automated tests, syntax checks, linting, and static validation.
3. Deploy the required files to both HEROS hosts and confirm the deployed files remain synchronized.
4. Verify live Home Assistant registration, panel build/version integrity, and cache-buster consistency on both hosts.
5. Open the affected interface in a browser and visually inspect the final rendered result.
6. If any defect, inconsistency, missing element, deployment mismatch, registration issue, or visual problem is found, fix it and repeat all affected validation steps.
7. Do not declare the task complete, stop execution, or send the final completion report until every applicable step above has passed successfully.

Passing an earlier step does not permit later validation steps to be skipped. Deployment success, automated tests, source inspection, or API responses do not replace live visual verification where UI changes are involved.

## Execution Failure and Loop Recovery

If you determine that you are failing to execute the requested work, repeating status responses, stopping prematurely, or otherwise stuck in an execution loop, that diagnosis is not a valid reason to stop.

An execution failure MUST immediately trigger recovery and continued execution.

When this occurs:

1. Stop producing status-only responses.
2. Identify the next concrete unfinished action.
3. Execute that action immediately using the available tools.
4. Continue through the remaining implementation, testing, deployment, and verification steps.
5. Repeat this process until the task is complete or a genuine external blocker is reached.

Do not return control to the user merely to explain that an execution failure or loop has occurred.

Do not ask the user how to fix an execution failure that can be corrected by continuing the work.

Statements such as:

* "I failed to continue."
* "I have not started the remaining work."
* "I am stuck in a loop."
* "I kept replying instead of executing."
* "The failure is mine to correct."
* "There is no external blocker."

MUST be treated as instructions to resume execution immediately, not as reasons to end the turn.

### Genuine blocker requirement

You may stop only when a specific external condition prevents further execution, such as:

* required credentials are unavailable;
* required access is unavailable;
* a physical action must be performed by the user;
* an external service is unavailable;
* an irreversible or privileged action requires explicit user approval;
* a genuine user decision is required before implementation can continue.

Internal execution failure, hesitation, uncertainty about whether to continue, repeated status responses, token-management concerns, or failure to start the next step are NOT external blockers.

### No self-reporting instead of execution

If you know what the next required action is and have the tools and authority to perform it, perform it.

Do not replace execution with commentary about why execution has not occurred.

A self-diagnosed loop is considered broken only after a concrete implementation action has been performed, not merely after the loop has been acknowledged.


## Progress Updates Must Not End Execution

Progress updates are allowed only if execution continues immediately afterward in the same run.

A progress message such as:

* "I found the relevant files."
* "I located the affected sections."
* "I identified the problem."
* "I have started the remaining work."
* "I know what needs to change."

does not satisfy the requirement to continue working.

After any progress update, immediately perform the next concrete implementation action.

Do not end execution after discovery, inspection, planning, locating code, identifying affected files, or describing the next step.

If the requested work is still incomplete and no genuine external blocker exists, continue editing, testing, deploying, and verifying without returning control to the user.

"Continue until you need me" means the user should not receive control back merely because progress has been made. Control returns only when the task is complete or a genuine external blocker requires user involvement.


## No Voluntary Turn Termination

Do not voluntarily end an execution turn while requested work remains actionable.

If unfinished work exists, no genuine external blocker exists, and the required tools are available, you MUST continue executing the work.

The following are NOT valid reasons to end execution:

* "I am not making further changes in this turn."
* "The remaining work is still in progress."
* "I don't need anything from you yet."
* "There is no genuine progress to report."
* "The work remains incomplete."
* "I will continue in another turn."
* "I have reached a natural stopping point."
* deciding to stop because the current turn has already involved substantial work;
* sending a status response instead of performing the next available action.

There is no concept of voluntarily reserving unfinished work for a later turn.

If you can identify the next concrete action and can perform it with the available tools, perform it immediately.

### Response gating

Before sending any response while a task is active, evaluate:

1. Is the requested task fully complete and verified?
2. If not, is there a genuine external blocker that specifically requires user input, approval, credentials, access, or physical action?

If the answer to both questions is **No**, DO NOT send the response.

Instead:

1. identify the next unfinished action;
2. execute it;
3. inspect the result;
4. continue with the next action;
5. repeat until completion or a genuine external blocker is reached.

A response saying that work remains is not a substitute for performing that work.

### "Continue until you need me"

When the user says **"continue until you need me"**, treat it as standing authorization to continue all non-destructive implementation, testing, deployment, inspection, correction, and verification work required by the task.

After this instruction:

* do not send progress-only responses;
* do not ask whether to continue;
* do not return control merely because a tool operation has finished;
* do not stop between implementation phases;
* do not stop between editing, testing, deployment, and verification;
* do not announce that work is incomplete when you can continue working on it.

The next response to the user must be either:

1. the final completion report after all required work and verification has passed; or
2. a specific request for user involvement caused by a genuine external blocker.

Anything else is a premature hand-back.
