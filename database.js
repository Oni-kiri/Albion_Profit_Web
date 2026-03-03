// Local Database Module for Albion Profit Calculator
// Stores fetched market data locally for reuse across tabs

const DB = {
    // Storage keys
    KEYS: {
        EQUIPMENT_DATA: 'albion_equipment_data',
        MATERIAL_PRICES: 'albion_material_prices',
        LAST_UPDATE: 'albion_last_update',
        CITIES: 'albion_cities_fetched',
    },
    
    // Save equipment prices for a city
    saveEquipmentPrices(city, priceData) {
        try {
            let allData = this.getAllEquipmentPrices() || {};
            
            // Convert to storable format
            const normalized = {};
            priceData.forEach(item => {
                const itemId = item.item_id || item.ItemId;
                normalized[itemId] = {
                    item_id: itemId,
                    sell_price_min: item.sell_price_min || item.SellPriceMin || 0,
                    sell_price_max: item.sell_price_max || item.SellPriceMax || 0,
                    sell_price_min_date: item.sell_price_min_date || item.SellPriceMinDate || null,
                    quality: item.quality || item.Quality || 1,
                };
            });
            
            allData[city] = normalized;
            localStorage.setItem(this.KEYS.EQUIPMENT_DATA, JSON.stringify(allData));
            
            // Track which cities have been fetched
            let cities = this.getCitiesFetched() || [];
            if (!cities.includes(city)) {
                cities.push(city);
            }
            localStorage.setItem(this.KEYS.CITIES, JSON.stringify(cities));
            
            console.log(`💾 Saved ${Object.keys(normalized).length} equipment prices for ${city} to local DB`);
            return true;
        } catch (error) {
            console.error('❌ Error saving equipment prices:', error);
            return false;
        }
    },
    
    // Get all equipment prices
    getAllEquipmentPrices() {
        try {
            const data = localStorage.getItem(this.KEYS.EQUIPMENT_DATA);
            return data ? JSON.parse(data) : {};
        } catch (error) {
            console.error('❌ Error reading equipment prices:', error);
            return {};
        }
    },
    
    // Get equipment prices for specific city
    getEquipmentPrices(city) {
        try {
            const allData = this.getAllEquipmentPrices();
            return allData[city] || {};
        } catch (error) {
            console.error(`❌ Error reading equipment prices for ${city}:`, error);
            return {};
        }
    },
    
    // Save material prices
    saveMaterialPrices(materialPrices) {
        try {
            localStorage.setItem(this.KEYS.MATERIAL_PRICES, JSON.stringify(materialPrices));
            console.log(`💾 Saved material prices for ${Object.keys(materialPrices).length} cities to local DB`);
            return true;
        } catch (error) {
            console.error('❌ Error saving material prices:', error);
            return false;
        }
    },
    
    // Get all material prices
    getAllMaterialPrices() {
        try {
            const data = localStorage.getItem(this.KEYS.MATERIAL_PRICES);
            return data ? JSON.parse(data) : {};
        } catch (error) {
            console.error('❌ Error reading material prices:', error);
            return {};
        }
    },
    
    // Get which cities have been fetched
    getCitiesFetched() {
        try {
            const data = localStorage.getItem(this.KEYS.CITIES);
            return data ? JSON.parse(data) : [];
        } catch (error) {
            console.error('❌ Error reading cities fetched:', error);
            return [];
        }
    },
    
    // Check if city has been fetched
    isCityFetched(city) {
        return this.getCitiesFetched().includes(city);
    },
    
    // Get storage stats
    getStats() {
        const allEquipment = this.getAllEquipmentPrices();
        const allMaterials = this.getAllMaterialPrices();
        const cities = this.getCitiesFetched();
        
        let totalItems = 0;
        cities.forEach(city => {
            totalItems += Object.keys(allEquipment[city] || {}).length;
        });
        
        return {
            citiesFetched: cities.length,
            cities: cities,
            totalItemsStored: totalItems,
            materialCitiesCached: Object.keys(allMaterials).length,
            storageSize: new Blob([JSON.stringify(allEquipment)]).size + new Blob([JSON.stringify(allMaterials)]).size,
        };
    },
    
    // Clear all data
    clearAll() {
        try {
            localStorage.removeItem(this.KEYS.EQUIPMENT_DATA);
            localStorage.removeItem(this.KEYS.MATERIAL_PRICES);
            localStorage.removeItem(this.KEYS.CITIES);
            console.log('🗑️ Cleared all local database');
            return true;
        } catch (error) {
            console.error('❌ Error clearing database:', error);
            return false;
        }
    },
    
    // Load data into memory from local DB
    loadIntoMemory(allPriceData, materialPrices) {
        try {
            const storedEquipment = this.getAllEquipmentPrices();
            const storedMaterials = this.getAllMaterialPrices();
            
            // Load equipment data
            Object.keys(storedEquipment).forEach(city => {
                if (!allPriceData[city]) {
                    allPriceData[city] = {};
                }
                Object.assign(allPriceData[city], storedEquipment[city]);
            });
            
            // Load material data
            Object.assign(materialPrices, storedMaterials);
            
            const stats = this.getStats();
            console.log(`📂 Loaded from local DB: ${stats.citiesFetched} cities, ${stats.totalItemsStored} items`);
            return true;
        } catch (error) {
            console.error('❌ Error loading from database:', error);
            return false;
        }
    },
};

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DB;
}
