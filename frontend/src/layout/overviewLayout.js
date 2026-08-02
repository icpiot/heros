export const OVERVIEW_LAYOUT_VERSION = 1;
export const OVERVIEW_LAYOUT_STORAGE_KEY = "hem.frontend.layout.overview.v1";

export const overviewDefaultLayout = [
  { id: "battery-state", x: 0, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { id: "battery-power", x: 3, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { id: "solar-production", x: 6, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { id: "inverter-status", x: 9, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { id: "home-load", x: 0, y: 2, w: 4, h: 2, minW: 2, minH: 2 },
  { id: "grid-flow", x: 4, y: 2, w: 4, h: 2, minW: 2, minH: 2 },
  { id: "pricing-summary", x: 8, y: 2, w: 4, h: 2, minW: 2, minH: 2 },
];

export function createOverviewCards(hemState) {
  const { battery, inverter, solar, pricing, home } = hemState;

  return [
    {
      id: "battery-state",
      label: "Battery",
      value: `${battery.soc}%`,
      note: `${battery.selectedBattery} · ${battery.mode}`,
    },
    {
      id: "battery-power",
      label: "Battery Power",
      value: `${battery.powerKw} kW`,
      note: battery.status,
    },
    {
      id: "solar-production",
      label: "Solar",
      value: `${solar.powerKw} kW`,
      note: `${solar.todayKwh} kWh today · ${solar.forecast}`,
    },
    {
      id: "inverter-status",
      label: "Inverter",
      value: inverter.status,
      note: `${inverter.temperatureC} °C · ${inverter.gridMode}`,
    },
    {
      id: "home-load",
      label: "Home Load",
      value: `${home.loadKw} kW`,
      note: `${home.todayImportedKwh} kWh imported today`,
    },
    {
      id: "grid-flow",
      label: "Grid Flow",
      value: `${home.gridKw} kW`,
      note: `${home.todayExportedKwh} kWh exported today`,
    },
    {
      id: "pricing-summary",
      label: "Pricing",
      value: pricing.activeGroup,
      note: `Buy $${pricing.importPrice}/kWh · Sell $${pricing.feedInPrice}/kWh · Supply $${pricing.dailySupplyCharge}/day`,
    },
  ];
}
