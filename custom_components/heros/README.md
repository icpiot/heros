# HEROS Home Assistant Integration

**HEROS** stands for **Home Energy Reporting & Optimisation System**.

HEROS is a custom Home Assistant integration for monitoring, reporting on, and controlling supported battery, solar, grid, and household energy systems. Provider-specific implementations such as ByteWatt/Neovolt sit behind the HEROS integration rather than defining the integration name or service namespace.

## Configuration

Configure HEROS through the Home Assistant UI:

1. Go to **Settings → Devices & Services**.
2. Click **Add Integration**.
3. Search for **HEROS**.
4. Enter the credentials requested for your selected provider.
5. Complete any provider, inverter, or Host selection steps shown by the setup flow.

## Automatic recovery

HEROS includes connection-health and recovery handling for supported cloud providers. Depending on the provider, this can include heartbeat monitoring, stale-data detection, re-authentication, reconnect attempts, and diagnostics.

If data stops updating:

1. Confirm Home Assistant and the provider service both have network access.
2. Confirm the inverter/battery system is online.
3. Run `heros.force_reconnect` from Developer Tools → Actions if a reconnect is needed.
4. Check the Home Assistant logs for `custom_components.heros` messages.
5. Restart Home Assistant if the integration remains unavailable.

## Setup persistence

HEROS setup mappings and hero-mapping overrides must use Home Assistant-backed configuration as their source of truth rather than browser-only storage.

This includes:

- forecast setup mappings
- battery setup mappings
- battery hero mapping overrides
- solar hero mapping overrides

The panel may keep browser-local UI preferences such as the last open page, selected battery target, debug toggle, settings focus, or remembered entry ID. These are convenience settings only and are not shared HEROS configuration.

## Setup page mapping model

HEROS separates the provider payload from the HEROS-facing hero mapping layer.

Setup sections can include:

- `Bytewatt Sensors`
- `Battery Hero Mapping Summary`
- `Solar Hero Mapping Summary`
- `HEROS Hero Sensors`

The direct provider payload is scope-aware and can include:

- `all_systems`
- `selected_scope`
- `live_batteries`

This allows setup and debug views to compare aggregate provider values, the currently selected battery scope, and each live per-battery row returned by the provider.

When ByteWatt exposes MPPT power fields, the setup page can also surface `ppv1`, `ppv2`, `ppv3`, and `ppv4`.

Per-battery rows are dynamic; HEROS does not assume a fixed number of batteries.

## Direct API expectations

Setup and debug views should prefer current provider values. If a direct provider field is unavailable, the UI should report it as unavailable rather than silently substituting stale browser data.

Common battery-facing fields include `soc`, `pbat`, `pload`, `pgrid`, `powerSource`, and `forceChargeMode`.

Common solar-facing fields include `ppv`, `ppv1`, `ppv2`, `ppv3`, and `ppv4`.

## Services

HEROS services use the `heros` namespace. Common actions include:

- `heros.force_reconnect`
- `heros.health_check`
- `heros.toggle_diagnostics`
- `heros.update_battery_settings`
- `heros.set_minimum_soc`
- `heros.set_charge_cap`
- `heros.set_discharge_start_time`
- `heros.set_discharge_time`
- `heros.set_charge_start_time`
- `heros.set_charge_end_time`
- `heros.set_grid_feedin_enabled`
- `heros.set_grid_feedin_cutoff_soc`
- `heros.update_grid_feedin_slot`

For the current installation, setup, reporting, storage, and service documentation, see the repository README and the files under `docs/`.
