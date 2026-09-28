# Legacy naming review

## Keep for compatibility

These names are part of the existing ByteWatt transport and persisted Home Assistant
state. Renaming them needs an explicit migration plan:

- `bytewatt_client.py`, `ByteWattClient`, `ByteWattDataUpdateCoordinator` and
  `ByteWattAPIError`
- provider key `bytewatt`
- notification IDs beginning with `bytewatt_`
- persisted pricing and policy storage names beginning with `bytewatt_`
- existing example files whose paths include `bytewatt_`

Changing any of these casually risks duplicate entities, orphaned storage or broken
external automations.

## Safe user-facing clean-up candidates

These can move to HEROS wording in a separate documentation and translation pass,
without changing technical identifiers:

- the component-local README heading and installation text
- user-facing recovery notification titles and descriptions when the selected
  provider is FoxESS
- legacy example titles and comments
- test fixture labels that appear in documentation output

## Recommended sequence

1. Keep transport and persisted identifier families unchanged.
2. Replace user-visible generic product wording with HEROS, while preserving the
   real provider name where it helps diagnose a connection.
3. Add compatibility tests for entity IDs and storage paths before any technical
   migration.
4. Perform any technical rename only in a dedicated, versioned migration.