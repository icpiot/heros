# ByteWatt Home Assistant Integration

This is a custom integration for Home Assistant that connects to ByteWatt/Neovolt battery systems.

## Automatic Recovery System

This integration includes an automatic recovery system to handle cases where the connection to the ByteWatt API becomes stuck or stops responding. The system provides:

1. **Heartbeat Monitoring**: The integration checks every 2 minutes to ensure data is being received properly.

2. **Stale Data Detection**: If no new data has been received for 5 minutes (configurable), the system will mark the data as stale.

3. **Automatic Recovery**: After detecting stale data for three consecutive checks, the system will automatically:
   - Reset the API client connection
   - Force re-authentication with the ByteWatt servers
   - Refresh all sensor data
   - Log the recovery process to Home Assistant logs

4. **Smart Retry Logic**: If recovery fails, the system will retry with increasing frequency using exponential backoff.

5. **Manual Recovery**: If needed, you can manually trigger the recovery process using the `bytewatt.force_reconnect` service from Developer Tools > Services in Home Assistant.

## Troubleshooting

If you notice the integration is not updating or showing stale data:

1. Check your internet connection
2. Verify the ByteWatt/Neovolt system is online
3. Use the `bytewatt.force_reconnect` service to manually trigger a reconnection
4. Check Home Assistant logs for any error messages
5. If problems persist, try restarting Home Assistant

## Configuration

Configure the integration through the Home Assistant UI:

1. Go to Configuration > Integrations
2. Click the "+ Add Integration" button
3. Search for "ByteWatt"
4. Enter your ByteWatt/Neovolt account credentials

## Setup persistence

HEROS setup mappings and hero-mapping overrides should not use
browser-only storage as their source of truth.

This includes:

- forecast setup mappings
- battery setup mappings
- battery hero mapping overrides
- solar hero mapping overrides

These values should be loaded from Home Assistant-backed config and saved
through HEROS services so they survive browser changes, cache
clears, and different devices.

The panel may still keep a few browser-local UI preferences such as the last
open page, selected battery target, debug toggle, settings focus, or remembered
entry id. Those are convenience hints only and must not become the source of
truth for shared HEROS configuration.

## Setup page mapping model

The HEROS setup page currently separates the provider payload
from the HEROS-facing hero mapping layer.

Setup sections:

- `Bytewatt Sensors`
- `Battery Hero Mapping Summary`
- `Solar Hero Mapping Summary`
- `HEROS Hero Sensors`

The direct provider payload shown by `Bytewatt Sensors` is scope-aware and can
include:

- `all_systems`
- `selected_scope`
- `live_batteries`

This allows setup and debug views to compare:

- aggregate provider values
- the currently selected battery scope
- each live per-battery row returned by the provider

When Bytewatt exposes MPPT power fields, the setup page can also surface:

- `ppv1`
- `ppv2`
- `ppv3`
- `ppv4`

Per-battery rows are dynamic. The setup page should not assume there are only
one or two batteries.

## Direct API expectations

For setup/debug work, the direct API layer should prefer live provider values.

That means:

- battery and solar setup comparisons should read from the current provider payload
- if a direct provider field is missing, the UI should show `Unavailable`
- setup/debug views should not silently substitute stored fallback values for missing direct API fields

Battery-facing fields commonly include:

- `soc`
- `pbat`
- `pload`
- `pgrid`
- `powerSource`
- `forceChargeMode`

Solar-facing fields commonly include:

- `ppv`
- `ppv1`
- `ppv2`
- `ppv3`
- `ppv4`

## Services

This integration provides several services to control your battery system:

- **bytewatt.force_reconnect**: Force reconnect to the API when it appears stuck
- **bytewatt.update_battery_settings**: Update multiple battery settings at once
- **bytewatt.set_discharge_start_time**: Set when battery discharge should start
- **bytewatt.set_discharge_time**: Set when battery discharge should end
- **bytewatt.set_charge_start_time**: Set when battery charging should start
- **bytewatt.set_charge_end_time**: Set when battery charging should end
- **bytewatt.set_minimum_soc**: Set the minimum battery state of charge

For more details on each service, see the Services tab in Developer Tools.
