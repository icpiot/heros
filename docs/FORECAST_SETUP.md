# Solar forecast setup

Solar forecasting is an optional step after the HEROS energy provider has been
installed. FoxESS V2 supplies inverter data; it does not install or provide a
solar forecast service.

To use Forecast.Solar:

1. In Home Assistant, install and configure the Forecast.Solar integration
   from **Settings → Devices & services → Add integration**.
2. Enter the installation location, panel capacity, orientation, tilt, and
   any provider-specific settings. Home Assistant then creates the forecast
   sensor entities.
3. Configure or reconfigure HEROS and choose **forecast.solar** in the
   optional forecast step.
4. Map the Forecast.Solar entities offered by Home Assistant. HEROS stores
   those mappings and uses them in reports and estimates.

Choosing **No forecast provider** completes HEROS setup without forecast
entities. Forecast can be added later by reconfiguring HEROS; it is not
required for FoxESS V2 authentication, live data, or five-minute polling.
