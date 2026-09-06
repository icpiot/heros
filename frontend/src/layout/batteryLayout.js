export const BATTERY_LAYOUT_VERSION = 2;
export const BATTERY_LAYOUT_STORAGE_KEY = "heros.frontend.layout.battery.v2";

export const batteryDefaultLayout = [
  { id: "battery-summary", x: 0, y: 0, w: 4, h: 3, minW: 3, minH: 2 },
  { id: "battery-flow", x: 4, y: 0, w: 4, h: 3, minW: 3, minH: 2 },
  { id: "battery-controls", x: 8, y: 0, w: 4, h: 2, minW: 3, minH: 2 },
  { id: "battery-mode-actions", x: 8, y: 2, w: 4, h: 2, minW: 3, minH: 2 },
  { id: "battery-forecast", x: 0, y: 3, w: 6, h: 3, minW: 4, minH: 2 },
  { id: "battery-health", x: 6, y: 4, w: 6, h: 3, minW: 4, minH: 2 },
];
