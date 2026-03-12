// Local Database Module for Albion Profit Calculator
// Uses IndexedDB for main persistence with a localStorage fallback.

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
  IDB_NAME: "albion-profit-suite",
  IDB_VERSION: 1,
  IDB_STORE: "cache_entries",
  CACHE_POLICY: {
    albion_equipment_data: { ttlMs: 6 * 60 * 60 * 1000, label: "Equipment" },
    albion_material_prices: {
      ttlMs: 6 * 60 * 60 * 1000,
      label: "Enhancement Materials",
    },
    albion_weapon_prices: { ttlMs: 30 * 60 * 1000, label: "Weapon Prices" },
    albion_blackmarket_flips: {
      ttlMs: 15 * 60 * 1000,
      label: "Black Market",
    },
    albion_crafting_profits: {
      ttlMs: 15 * 60 * 1000,
      label: "Crafting Profit",
    },
    albion_material_table: { ttlMs: 30 * 60 * 1000, label: "Material Table" },
    albion_cities_fetched: { ttlMs: 6 * 60 * 60 * 1000, label: "Cities" },
  },

  memoryCache: new Map(),
  idb: null,
  initialized: false,
  storageEngine: "localStorage",
  notifier: null,

  setNotifier(notifier) {
    this.notifier = typeof notifier === "function" ? notifier : null;
  },

  notify(level, message, detail) {
    if (!this.notifier) return;
    try {
      this.notifier({ level, message, detail });
    } catch {
      // Ignore notifier failures.
    }
  },

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
      this.notify("error", "Failed to save active server.", error.message);
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

  getPolicy(baseKey) {
    return this.CACHE_POLICY[baseKey] || { ttlMs: null, label: baseKey };
  },

  getBaseKeyFromStorageKey(storageKey) {
    return String(storageKey || "").split("__")[0];
  },

  isWrappedRecord(value) {
    return !!(
      value &&
      typeof value === "object" &&
      Object.prototype.hasOwnProperty.call(value, "key") &&
      Object.prototype.hasOwnProperty.call(value, "value")
    );
  },

  createRecord(baseKey, storageKey, value, updatedAt, expiresAt) {
    const now = Date.now();
    const policy = this.getPolicy(baseKey);
    return {
      key: storageKey,
      baseKey,
      value,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : now,
      expiresAt:
        expiresAt === null || Number.isFinite(expiresAt)
          ? expiresAt
          : policy.ttlMs
            ? now + policy.ttlMs
            : null,
    };
  },

  normalizeRecord(storageKey, rawValue) {
    if (rawValue === null || rawValue === undefined) return null;

    if (this.isWrappedRecord(rawValue)) {
      return this.createRecord(
        rawValue.baseKey || this.getBaseKeyFromStorageKey(rawValue.key || storageKey),
        rawValue.key || storageKey,
        rawValue.value,
        rawValue.updatedAt,
        rawValue.expiresAt,
      );
    }

    return this.createRecord(
      this.getBaseKeyFromStorageKey(storageKey),
      storageKey,
      rawValue,
      null,
      null,
    );
  },

  readLocalRecord(storageKey) {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw === null || raw === undefined) return null;
      return this.normalizeRecord(storageKey, JSON.parse(raw));
    } catch {
      return null;
    }
  },

  writeLocalRecord(record) {
    try {
      localStorage.setItem(record.key, JSON.stringify(record));
      return true;
    } catch (error) {
      console.error(`❌ Error writing ${record.key}:`, error);
      this.notify("error", `Failed to cache ${record.baseKey}.`, error.message);
      return false;
    }
  },

  rememberRecord(record) {
    if (!record || !record.key) return;
    this.memoryCache.set(record.key, record);
  },

  forgetRecord(storageKey) {
    this.memoryCache.delete(storageKey);
  },

  async openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.IDB_NAME, this.IDB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.IDB_STORE)) {
          db.createObjectStore(this.IDB_STORE, { keyPath: "key" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        reject(request.error || new Error("Failed to open IndexedDB."));
      };
    });
  },

  async getAllIndexedDbRecords() {
    if (!this.idb) return [];
    return new Promise((resolve, reject) => {
      const transaction = this.idb.transaction(this.IDB_STORE, "readonly");
      const store = transaction.objectStore(this.IDB_STORE);
      const request = store.getAll();

      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
      request.onerror = () => {
        reject(request.error || new Error("Failed to read IndexedDB cache."));
      };
    });
  },

  async putIndexedDbRecord(record) {
    if (!this.idb) return false;
    return new Promise((resolve, reject) => {
      const transaction = this.idb.transaction(this.IDB_STORE, "readwrite");
      const store = transaction.objectStore(this.IDB_STORE);
      store.put(record);
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => {
        reject(transaction.error || new Error("Failed to write IndexedDB cache."));
      };
    });
  },

  async deleteIndexedDbKey(storageKey) {
    if (!this.idb) return false;
    return new Promise((resolve, reject) => {
      const transaction = this.idb.transaction(this.IDB_STORE, "readwrite");
      const store = transaction.objectStore(this.IDB_STORE);
      store.delete(storageKey);
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => {
        reject(transaction.error || new Error("Failed to delete IndexedDB cache."));
      };
    });
  },

  loadLocalFallbackToMemory() {
    try {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key || !key.startsWith("albion_")) continue;
        if (key === this.KEYS.ACTIVE_SERVER) continue;
        const record = this.readLocalRecord(key);
        if (record) this.rememberRecord(record);
      }
      return true;
    } catch (error) {
      console.error("❌ Error loading local cache fallback:", error);
      return false;
    }
  },

  async loadIndexedDbIntoMemory() {
    const records = await this.getAllIndexedDbRecords();
    records.forEach((record) => {
      const normalized = this.normalizeRecord(record.key, record);
      if (normalized) this.rememberRecord(normalized);
    });
  },

  async migrateLegacyLocalStorage() {
    if (!this.idb) return false;

    const keysToCheck = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || !key.startsWith("albion_")) continue;
      if (key === this.KEYS.ACTIVE_SERVER) continue;
      keysToCheck.push(key);
    }

    for (const key of keysToCheck) {
      if (this.memoryCache.has(key)) continue;
      const legacyRecord = this.readLocalRecord(key);
      if (!legacyRecord) continue;
      this.rememberRecord(legacyRecord);
      try {
        await this.putIndexedDbRecord(legacyRecord);
      } catch (error) {
        console.warn(`⚠️ Failed migrating ${key} to IndexedDB:`, error);
      }
    }

    return true;
  },

  async initialize() {
    if (this.initialized) return this.storageEngine === "IndexedDB";

    this.memoryCache = new Map();
    this.loadLocalFallbackToMemory();

    try {
      if (typeof indexedDB === "undefined") {
        throw new Error("IndexedDB is not available in this browser.");
      }

      this.idb = await this.openDatabase();
      this.memoryCache = new Map();
      await this.loadIndexedDbIntoMemory();
      await this.migrateLegacyLocalStorage();
      this.storageEngine = "IndexedDB";
    } catch (error) {
      console.warn("⚠️ IndexedDB unavailable, using localStorage fallback:", error);
      this.idb = null;
      this.storageEngine = "localStorage";
      this.notify(
        "warning",
        "IndexedDB is unavailable. Falling back to localStorage cache.",
        error.message,
      );
    }

    this.initialized = true;
    return this.storageEngine === "IndexedDB";
  },

  getRecord(storageKey) {
    if (this.memoryCache.has(storageKey)) {
      return this.memoryCache.get(storageKey);
    }
    const localRecord = this.readLocalRecord(storageKey);
    if (localRecord) {
      this.rememberRecord(localRecord);
      return localRecord;
    }
    return null;
  },

  readJSON(storageKey, fallbackValue) {
    const record = this.getRecord(storageKey);
    return record ? record.value : fallbackValue;
  },

  writeJSON(storageKey, value) {
    const baseKey = this.getBaseKeyFromStorageKey(storageKey);
    const record = this.createRecord(baseKey, storageKey, value, null, null);
    this.rememberRecord(record);

    if (this.storageEngine === "IndexedDB" && this.idb) {
      this.putIndexedDbRecord(record).catch((error) => {
        console.error(`❌ Error writing ${storageKey} to IndexedDB:`, error);
        this.notify("error", `Failed to cache ${baseKey}.`, error.message);
      });
      try {
        localStorage.removeItem(storageKey);
      } catch {
        // Ignore local cleanup issues.
      }
      return true;
    }

    return this.writeLocalRecord(record);
  },

  getScopedOrLegacy(baseKey, fallbackValue) {
    const scopedRecord = this.getRecord(this.getScopedKey(baseKey));
    if (scopedRecord) return scopedRecord.value;

    const legacyRecord = this.getRecord(baseKey);
    if (legacyRecord) return legacyRecord.value;

    return fallbackValue;
  },

  getCacheMetadata(baseKey) {
    const record =
      this.getRecord(this.getScopedKey(baseKey)) || this.getRecord(baseKey);
    if (!record) return null;

    const policy = this.getPolicy(baseKey);
    return {
      label: policy.label,
      updatedAt: record.updatedAt || null,
      expiresAt: record.expiresAt || null,
      isStale: this.isRecordStale(record),
      storageKey: record.key,
    };
  },

  isRecordStale(record) {
    return !!(record && record.expiresAt && Date.now() > record.expiresAt);
  },

  isStale(baseKey) {
    const metadata = this.getCacheMetadata(baseKey);
    return metadata ? metadata.isStale : true;
  },

  getStaleDatasets() {
    return Object.keys(this.CACHE_POLICY)
      .map((baseKey) => ({ baseKey, metadata: this.getCacheMetadata(baseKey) }))
      .filter((entry) => entry.metadata)
      .filter((entry) => entry.metadata.isStale)
      .map((entry) => entry.metadata.label);
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
      this.notify("error", "Failed to save equipment prices.", error.message);
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
    const staleDatasets = this.getStaleDatasets();

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
      storageEngine: this.storageEngine,
      staleDatasets,
      staleDatasetCount: staleDatasets.length,
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
        const scopedKey = this.getScopedKey(baseKey);
        this.forgetRecord(scopedKey);
        localStorage.removeItem(scopedKey);
        if (this.idb) {
          this.deleteIndexedDbKey(scopedKey).catch((error) => {
            console.warn(`⚠️ Failed deleting ${scopedKey} from IndexedDB:`, error);
          });
        }
      });

      allScopedKeys.forEach((baseKey) => {
        this.forgetRecord(baseKey);
        localStorage.removeItem(baseKey);
        if (this.idb) {
          this.deleteIndexedDbKey(baseKey).catch((error) => {
            console.warn(`⚠️ Failed deleting ${baseKey} from IndexedDB:`, error);
          });
        }
      });

      return true;
    } catch (error) {
      console.error("❌ Error clearing database:", error);
      this.notify("error", "Failed to clear cached data.", error.message);
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
      this.notify("error", "Failed to load cached data.", error.message);
      return false;
    }
  },
};

// Export for use
if (typeof module !== "undefined" && module.exports) {
  module.exports = DB;
}
