export const FORECAST_LAYOUT_VERSION = 1;
export const FORECAST_LAYOUT_STORAGE_KEY = "hem.frontend.layout.forecast.v1";

export const forecastDefaultLayout = [
  { id: "forecast-summary", x: 0, y: 0, w: 4, h: 3, minW: 3, minH: 2 },
  { id: "forecast-solar", x: 4, y: 0, w: 4, h: 3, minW: 3, minH: 2 },
  { id: "forecast-battery", x: 8, y: 0, w: 4, h: 3, minW: 3, minH: 2 },
  { id: "forecast-load", x: 0, y: 3, w: 6, h: 3, minW: 4, minH: 2 },
  { id: "forecast-pricing", x: 6, y: 3, w: 6, h: 3, minW: 4, minH: 2 },
];
