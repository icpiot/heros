# Forecast History

HEROS keeps two forecast concepts separate:

- Forecast snapshots are the values HEROS sees from mapped Home Assistant forecast
  entities at a point in time. These are stored in the HEROS report archive going
  forward.
- Historic averages are provider benchmark curves based on long-term weather or
  irradiation history for the site. They are useful when there is no captured
  forecast snapshot, but they are not the same as a forecast that was issued on
  that past day.

## Forecast.Solar Historic Averages

Forecast.Solar exposes a `history` route for historic-average production data.
The public/no-key tier does not allow this endpoint, so HEROS treats it as an
optional source that must be configured and tested before it is used.

Required settings:

- `forecast_history_provider`: currently `forecast_solar`
- `forecast_history_api_key`: optional in storage, but required by
  Forecast.Solar plans that support `history`
- `forecast_history_latitude`
- `forecast_history_longitude`
- `forecast_history_declination`
- `forecast_history_azimuth`
- `forecast_history_kwp`

Optional settings:

- `forecast_history_damping`
- `forecast_history_horizon`

## Services

`home_energy_manager.set_forecast_history_source` persists the optional source
configuration.

`home_energy_manager.test_forecast_history_source` calls the provider once and
creates a Home Assistant notification with non-secret test metadata, including
HTTP status and sample counts. It does not expose the API key.

The settings-target select exposes sanitized verification attributes for Jinja
and panel diagnostics:

- `forecast_history_provider`
- `forecast_history_api_key_configured`
- `forecast_history_latitude`
- `forecast_history_longitude`
- `forecast_history_declination`
- `forecast_history_azimuth`
- `forecast_history_kwp`
- `forecast_history_damping`
- `forecast_history_horizon`

The API key itself must never be exposed through entity attributes.

## Storage Direction

After a historic-average source has passed testing, HEROS should cache/archive the
returned average curves so reports do not repeatedly call the provider for the
same site, plane, and date window.
