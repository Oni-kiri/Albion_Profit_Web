window.APP_CONFIG = {
  SERVERS: {
    east: {
      label: "East (Asia)",
      apiBase: "https://east.albion-online-data.com/api/v2/stats/prices",
    },
    west: {
      label: "West (Americas)",
      apiBase: "https://west.albion-online-data.com/api/v2/stats/prices",
    },
    europe: {
      label: "Europe",
      apiBase: "https://europe.albion-online-data.com/api/v2/stats/prices",
    },
  },
  ACTIVE_SERVER: "east",
  QUALITY_EXCELLENT: 4,
  MIN_ROI: 15,
  TAX_RATE: 0.1,
  CITIES: ["Fort Sterling", "Lymhurst", "Bridgewatch", "Martlock", "Thetford"],
  TIERS: [4, 5, 6, 7],
  REFRESH_INTERVALS_MS: {
    blackMarketAutoRefresh: 30000,
  },
};
