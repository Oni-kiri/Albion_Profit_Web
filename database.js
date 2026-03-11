// Local Database Module for Albion Profit Calculator
// Stores fetched market data locally for reuse across tabs and servers.

const DB = {
  KEYS: {
    EQUIPMENT_DATA: "albion_equipment_data",
    MATERIAL_PRICES: "albion_material_prices",
    WEAPON_PRICES: "albion_weapon_prices",
    BLACKMARKET_FLIPS: "albion_blackmarket_flips",
    CRAFTING_PROFITS: "albion_crafting_profits",
    MATERIAL_TABLE: "albion_material_table",
    CITIES: "albion_cities_fetched",
    ACTIVE_SERVER: "albion_active_server",
  },

  DEFAULT_SERVER: "east",

  setActiveServer(serverId) {
    try {
      const normalized = (serverId || "").toLowerCase();
      localStorage.setItem(
        this.KEYS.ACTIVE_SERVER,
        normalized || this.DEFAULT_SERVER,
      );
      return true;
    } catch (error) {
      console.error("❌ Error saving active server:", error);
      return false;
    }
  },

  getActiveServer() {
    try {
      return (
        localStorage.getItem(this.KEYS.ACTIVE_SERVER) || this.DEFAULT_SERVER
      ).toLowerCase();
    } catch {
      return this.DEFAULT_SERVER;
    }
  },

  getScopedKey(baseKey) {
    return `${baseKey}__${this.getActiveServer()}`;
  },

  readJSON(storageKey, fallbackValue) {
    try {
      const data = localStorage.getItem(storageKey);
      return data ? JSON.parse(data) : fallbackValue;
    } catch {
      return fallbackValue;
    }
  },

  writeJSON(storageKey, value) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error(`❌ Error writing ${storageKey}:`, error);
      return false;
    }
  },

  getScopedOrLegacy(baseKey, fallbackValue) {
    const scoped = this.readJSON(this.getScopedKey(baseKey), null);
    if (scoped !== null && scoped !== undefined) return scoped;
    return this.readJSON(baseKey, fallbackValue);
  },

  saveEquipmentPrices(city, priceData) {
    try {
      const allData = this.getAllEquipmentPrices() || {};
      const normalized = {};

      (priceData || []).forEach((item) => {
        const itemId = item.item_id || item.ItemId;
        if (!itemId) return;
        normalized[itemId] = {
          item_id: itemId,
          sell_price_min: item.sell_price_min || item.SellPriceMin || 0,
          sell_price_max: item.sell_price_max || item.SellPriceMax || 0,
          sell_price_min_date:
            item.sell_price_min_date || item.SellPriceMinDate || null,
          quality: item.quality || item.Quality || 1,
        };
      });

      allData[city] = normalized;
      this.writeJSON(this.getScopedKey(this.KEYS.EQUIPMENT_DATA), allData);

      const cities = this.getCitiesFetched();
      if (!cities.includes(city)) cities.push(city);
      this.writeJSON(this.getScopedKey(this.KEYS.CITIES), cities);

      return true;
    } catch (error) {
      console.error("❌ Error saving equipment prices:", error);
      return false;
    }
  },

  getAllEquipmentPrices() {
    return this.getScopedOrLegacy(this.KEYS.EQUIPMENT_DATA, {});
  },

  getEquipmentPrices(city) {
    const allData = this.getAllEquipmentPrices();
    return allData[city] || {};
  },

  saveMaterialPrices(materialPrices) {
    return this.writeJSON(
      this.getScopedKey(this.KEYS.MATERIAL_PRICES),
      materialPrices || {},
    );
  },

  getAllMaterialPrices() {
    return this.getScopedOrLegacy(this.KEYS.MATERIAL_PRICES, {});
  },

  saveWeaponPrices(payload) {
    return this.writeJSON(
      this.getScopedKey(this.KEYS.WEAPON_PRICES),
      payload || {},
    );
  },

  getWeaponPrices() {
    return this.getScopedOrLegacy(this.KEYS.WEAPON_PRICES, null);
  },

  saveBlackMarket(payload) {
    return this.writeJSON(
      this.getScopedKey(this.KEYS.BLACKMARKET_FLIPS),
      payload || {},
    );
  },

  getBlackMarket() {
    return this.getScopedOrLegacy(this.KEYS.BLACKMARKET_FLIPS, null);
  },

  saveCraftingProfits(payload) {
    return this.writeJSON(
      this.getScopedKey(this.KEYS.CRAFTING_PROFITS),
      payload || {},
    );
  },

  getCraftingProfits() {
    return this.getScopedOrLegacy(this.KEYS.CRAFTING_PROFITS, null);
  },

  saveMaterialTable(payload) {
    return this.writeJSON(
      this.getScopedKey(this.KEYS.MATERIAL_TABLE),
      payload || {},
    );
  },

  getMaterialTable() {
    return this.getScopedOrLegacy(this.KEYS.MATERIAL_TABLE, null);
  },

  getCitiesFetched() {
    return this.getScopedOrLegacy(this.KEYS.CITIES, []);
  },

  isCityFetched(city) {
    return this.getCitiesFetched().includes(city);
  },

  getStats() {
    const allEquipment = this.getAllEquipmentPrices();
    const allMaterials = this.getAllMaterialPrices();
    const weaponPayload = this.getWeaponPrices();
    const blackMarketPayload = this.getBlackMarket();
    const craftingPayload = this.getCraftingProfits();
    const materialTablePayload = this.getMaterialTable();
    const cities = this.getCitiesFetched();

    let totalItems = 0;
    cities.forEach((city) => {
      totalItems += Object.keys(allEquipment[city] || {}).length;
    });

    const weaponRows = Array.isArray(weaponPayload?.rows)
      ? weaponPayload.rows.length
      : 0;
    const blackMarketRows = Array.isArray(blackMarketPayload?.flips)
      ? blackMarketPayload.flips.length
      : 0;
    const craftingRows = Array.isArray(craftingPayload?.rows)
      ? craftingPayload.rows.length
      : 0;

    return {
      activeServer: this.getActiveServer(),
      citiesFetched: cities.length,
      cities,
      totalItemsStored: totalItems,
      materialCitiesCached: Object.keys(allMaterials).length,
      weaponRowsCached: weaponRows,
      blackMarketRowsCached: blackMarketRows,
      craftingRowsCached: craftingRows,
      hasMaterialTableCache:
        !!materialTablePayload && !!materialTablePayload.priceMap,
      storageSize:
        new Blob([JSON.stringify(allEquipment)]).size +
        new Blob([JSON.stringify(allMaterials)]).size +
        new Blob([JSON.stringify(weaponPayload || {})]).size +
        new Blob([JSON.stringify(blackMarketPayload || {})]).size +
        new Blob([JSON.stringify(craftingPayload || {})]).size +
        new Blob([JSON.stringify(materialTablePayload || {})]).size,
    };
  },

  clearAll() {
    try {
      const allScopedKeys = [
        this.KEYS.EQUIPMENT_DATA,
        this.KEYS.MATERIAL_PRICES,
        this.KEYS.WEAPON_PRICES,
        this.KEYS.BLACKMARKET_FLIPS,
        this.KEYS.CRAFTING_PROFITS,
        this.KEYS.MATERIAL_TABLE,
        this.KEYS.CITIES,
      ];

      allScopedKeys.forEach((baseKey) => {
        localStorage.removeItem(this.getScopedKey(baseKey));
      });

      // Remove legacy keys too.
      allScopedKeys.forEach((baseKey) => {
        localStorage.removeItem(baseKey);
      });

      return true;
    } catch (error) {
      console.error("❌ Error clearing database:", error);
      return false;
    }
  },

  loadIntoMemory(allPriceData, materialPrices) {
    try {
      const storedEquipment = this.getAllEquipmentPrices();
      const storedMaterials = this.getAllMaterialPrices();

      Object.keys(storedEquipment).forEach((city) => {
        if (!allPriceData[city]) {
          allPriceData[city] = {};
        }
        Object.assign(allPriceData[city], storedEquipment[city]);
      });

      Object.assign(materialPrices, storedMaterials);
      return true;
    } catch (error) {
      console.error("❌ Error loading from database:", error);
      return false;
    }
  },
};

// Export for use
if (typeof module !== "undefined" && module.exports) {
  module.exports = DB;
}
