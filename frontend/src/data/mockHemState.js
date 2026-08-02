export const mockHemState = {
  battery: {
    soc: 73,
    powerKw: -1.8,
    mode: "Self-consumption",
    status: "Charging from excess solar",
    selectedBattery: "Home Battery 1",
  },
  inverter: {
    status: "Online",
    temperatureC: 34,
    gridMode: "Export limited",
  },
  solar: {
    powerKw: 5.6,
    todayKwh: 21.4,
    forecast: "Clear afternoon",
  },
  pricing: {
    activeGroup: "Winter shoulder",
    importPrice: 0.267,
    feedInPrice: 0.08,
    dailySupplyCharge: 0.0677,
    groups: [
      {
        id: "2026-06-01",
        description: "Rates from Jun 1",
        effectiveDate: "2026-06-01",
        type: "dynamic",
        dailySupplyCharge: 0.0677,
        otherCharges: "",
        notes: "Mock group used by the standalone frontend.",
        rules: [
          { id: "buy-morning", direction: "buy", start: "00:00", end: "11:59" },
          { id: "sell-flat", direction: "sell", start: "00:00", end: "23:59" },
        ],
      },
      {
        id: "2026-08-02",
        description: "Future provider plan",
        effectiveDate: "2026-08-02",
        type: "fixed",
        dailySupplyCharge: 0.157,
        otherCharges: "",
        notes: "",
        rules: [],
      },
    ],
  },
  home: {
    loadKw: 2.9,
    gridKw: -2.1,
    todayImportedKwh: 4.2,
    todayExportedKwh: 9.7,
  },
};
