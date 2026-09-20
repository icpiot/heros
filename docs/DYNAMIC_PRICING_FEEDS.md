# Dynamic pricing feeds

HEROS represents a live tariff as a Home Assistant entity mapping, rather than adding retailer-specific API clients. This works with any supported retailer integration, a local tariff integration, or a user-maintained template sensor.

## Group-level mapping

A dynamic rate group may identify these optional source entities:

- current import price
- next import price
- current export price

Each source must expose one numeric price. HEROS stores the source entity ID and reads its live state and timestamp directly for the tariff sensors.

Manual day/time records remain the fallback. They still describe supply charges, controlled-load rates, public-holiday rules and periods where a live feed is unavailable. A live feed never overwrites that tariff history.

## Units and availability

The mapped entity should use either cents per kWh or dollars per kWh and declare its unit. HEROS normalises the value internally to cents per kWh while retaining the original unit for display and diagnostics. An unavailable, unknown or non-numeric source produces an unavailable live price and falls back to the applicable manual record; it is never treated as a zero-cost rate.

## Current installation status

The active Home Assistant instance currently has no non-HEROS price or tariff entity to map. The integration therefore keeps the current manual pricing schedule active. Once a retailer or tariff sensor is installed, its entity ID can be saved in the Pricing editor without a provider-specific HEROS update.