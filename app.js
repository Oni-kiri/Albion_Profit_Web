// Configuration
const CONFIG = {
    API_BASE: 'https://east.albion-online-data.com/api/v2/stats/prices',
    QUALITY_EXCELLENT: 4,
    MIN_ROI: 15,
    TAX_RATE: 0.1, // 10% tax
    CITIES: ['Fort Sterling', 'Lymhurst', 'Bridgewatch', 'Martlock', 'Thetford'],
    TIERS: [4, 5, 6, 7],
};

// Enhancement material requirements by broad category (fallback)
const MATERIAL_REQUIREMENTS = {
    weapon: { rune: 384, soul: 384, relic: 384 },
    helmet: { rune: 96, soul: 96, relic: 96 },
    armor: { rune: 192, soul: 192, relic: 192 },
    shoes: { rune: 96, soul: 96, relic: 96 },
    cape: { rune: 96, soul: 96, relic: 96 },
    offhand: { rune: 288, soul: 288, relic: 288 },
};

// Determine item category from item ID
function getCategoryFromItemId(itemId) {
    if (itemId.includes('_MAIN_') || itemId.includes('_2H_')) return 'weapon';
    if (itemId.includes('_HEAD_')) return 'helmet';
    if (itemId.includes('_ARMOR_')) return 'armor';
    if (itemId.includes('_SHOES_')) return 'shoes';
    if (itemId.includes('_CAPE')) return 'cape';
    if (itemId.includes('_OFF_')) return 'offhand';
    return null;
}

// Global data storage
let allEquipmentItems = [];
let allPriceData = {};
let materialPrices = {}; // Store material prices by city and tier
let lastUpdateTime = null;
let filteredResults = {};
let calcStats = {};

// Item name mapping
let itemNameMap = {};

// Progress tracking
let progressStartTime = null;

// Material item IDs for fetching from API (Format: T#_MATERIALNAME from items.txt)
const MATERIAL_IDS = {
    rune: ['T4_RUNE', 'T5_RUNE', 'T6_RUNE', 'T7_RUNE'],
    soul: ['T4_SOUL', 'T5_SOUL', 'T6_SOUL', 'T7_SOUL'],
    relic: ['T4_RELIC', 'T5_RELIC', 'T6_RELIC', 'T7_RELIC'],
};

// Load all equipment items from JSON file
async function loadEquipmentItems() {
    try {
        const response = await fetch('all_equipment_items.json');
        if (!response.ok) throw new Error('Failed to load equipment items');
        allEquipmentItems = await response.json();
        console.log(`Loaded ${allEquipmentItems.length} unique equipment items`);
        return allEquipmentItems;
    } catch (error) {
        console.error('Error loading equipment items:', error);
        showError('Failed to load equipment database.');
        return [];
    }
}

// Load item names from JSON file
async function loadItemNames() {
    try {
        const response = await fetch('item_names.json');
        if (!response.ok) throw new Error('Failed to load item names');
        itemNameMap = await response.json();
        console.log(`Loaded ${Object.keys(itemNameMap).length} item name mappings`);
    } catch (error) {
        console.error('Error loading item names:', error);
    }
}

// Get display name for an item ID
function getItemName(itemId) {
    return itemNameMap[itemId] || itemId;
}

// Extract tier from item ID (e.g., T4_ -> 4)
function getTierFromItemId(itemId) {
    const match = /^T(\d)_/.exec(itemId);
    return match ? match[1] : null;
}

// Parse value safely from mixed API schemas
function getNumericValue(value) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : 0;
}

// Normalize API market row to a consistent schema
function normalizeMarketEntry(raw) {
    if (!raw) return null;
    const itemId = raw.item_id || raw.ItemId;
    if (!itemId) return null;

    // Use ONLY sell_price_min (no fallback to other price fields)
    const sellMin = getNumericValue(raw.sell_price_min);
    const sellDate = raw.sell_price_min_date || null;

    return {
        item_id: itemId,
        sell_price_min: sellMin,
        sell_price_min_date: sellDate,
    };
}

// Keep the best market entry for same item (prefer non-zero, then newer)
// Use ONLY sell_price_min for comparison
function mergeBestMarketEntry(previous, incoming) {
    if (!previous) return incoming;
    if (!incoming) return previous;

    const prevPrice = previous.sell_price_min || 0;
    const nextPrice = incoming.sell_price_min || 0;

    if (prevPrice === 0 && nextPrice > 0) return incoming;
    if (nextPrice === 0 && prevPrice > 0) return previous;

    const prevDate = previous.sell_price_min_date ? new Date(previous.sell_price_min_date).getTime() : 0;
    const nextDate = incoming.sell_price_min_date ? new Date(incoming.sell_price_min_date).getTime() : 0;
    return nextDate >= prevDate ? incoming : previous;
}

// Exact material quantity by item type
function getMaterialQuantity(itemId, category, materialTypeKey) {
    if (itemId.includes('_2H_')) return 384;
    if (itemId.includes('_MAIN_') || itemId.includes('_OFF_')) return 288;
    if (itemId.includes('_ARMOR_') || itemId.includes('_BAG')) return 192;
    if (itemId.includes('_HEAD_') || itemId.includes('_SHOES_') || itemId.includes('_CAPE')) return 96;

    const fallback = MATERIAL_REQUIREMENTS[category] || MATERIAL_REQUIREMENTS.weapon;
    return fallback[materialTypeKey] || 96;
}

// Get material info for enhancement level
function getMaterialInfo(enhancement) {
    const materials = {
        1: { name: 'Rune', multiplier: 1 },
        2: { name: 'Soul Stone', multiplier: 2 },
        3: { name: 'Relic Fragment', multiplier: 3 },
    };
    return materials[enhancement] || { name: 'Unknown', multiplier: 1 };
}

// Get material cost breakdown string
function getMaterialCostBreakdown(item) {
    const material = getMaterialInfo(item.enhancement);
    const typeKey = material.name === 'Rune' ? 'rune' : material.name === 'Soul Stone' ? 'soul' : 'relic';
    const quantity = item.materialQuantity || getMaterialQuantity(item.itemId, item.category, typeKey);
    const total = item.materialCost;
    
    return `<div style="font-size: 0.85rem; line-height: 1.2;">${quantity}x<br><small>= ${total.toLocaleString()}</small></div>`;
}

function renderAllItemsList() {
    const container = document.getElementById('allItemsContainer');
    const countEl = document.getElementById('allItemsCount');
    if (!container || !countEl) return;

    const selectedCategory = document.getElementById('categorySelect').value;
    const selectedTier = document.getElementById('tierSelect').value;

    // Check if we have price data
    const hasPriceData = Object.keys(allPriceData).length > 0;

    let items = allEquipmentItems.map(itemId => {
        return {
            itemId,
            itemName: getItemName(itemId),
            category: getCategoryFromItemId(itemId),
            tier: getTierFromItemId(itemId),
        };
    });

    items = items.filter(item => {
        if (selectedCategory && item.category !== selectedCategory) return false;
        if (selectedTier && item.tier !== selectedTier) return false;
        return true;
    });

    items.sort((a, b) => {
        if (a.tier !== b.tier) return Number(a.tier) - Number(b.tier);
        return a.itemName.localeCompare(b.itemName);
    });

    countEl.textContent = items.length.toLocaleString();

    if (items.length === 0) {
        container.innerHTML = '<div class="alert alert-info">No items match the current filters.</div>';
        return;
    }

    if (!hasPriceData) {
        container.innerHTML = '<div class="alert alert-warning">Click "Refresh Data" to load prices from all cities.</div>';
        return;
    }

    // Create separate table for each city
    let html = '';
    
    CONFIG.CITIES.forEach(city => {
        const cityData = allPriceData[city] || {};
        
        html += `
            <div class="city-section mb-4">
                <div class="city-title">📍 ${city}</div>
                <div class="table-responsive">
                    <table class="table table-dark table-striped table-hover table-sm">
                        <thead>
                            <tr>
                                <th>Item Name</th>
                                <th>Tier</th>
                                <th>Category</th>
                                <th style="text-align: right;">Sell Min</th>
                                <th style="text-align: right;">Sell Max</th>
                                <th>Last Updated</th>
                            </tr>
                        </thead>
                        <tbody>
        `;
        
        items.forEach(item => {
            const priceInfo = cityData[item.itemId];
            const sellMin = priceInfo?.sell_price_min || 0;
            const sellMax = priceInfo?.sell_price_max || 0;
            const lastUpdate = priceInfo?.sell_price_min_date || 'N/A';
            
            const sellMinDisplay = sellMin > 0 ? sellMin.toLocaleString() : '-';
            const sellMaxDisplay = sellMax > 0 ? sellMax.toLocaleString() : '-';
            
            let updateDisplay = '-';
            if (lastUpdate !== 'N/A') {
                try {
                    const date = new Date(lastUpdate);
                    const now = new Date();
                    const diffHours = Math.floor((now - date) / (1000 * 60 * 60));
                    const diffMins = Math.floor((now - date) / (1000 * 60));
                    
                    if (diffHours > 24) {
                        updateDisplay = `${Math.floor(diffHours / 24)}d ago`;
                    } else if (diffHours > 0) {
                        updateDisplay = `${diffHours}h ago`;
                    } else {
                        updateDisplay = `${diffMins}m ago`;
                    }
                } catch (e) {
                    updateDisplay = 'Error';
                }
            }
            
            html += `
                <tr>
                    <td><strong>${item.itemName}</strong></td>
                    <td>${item.tier}</td>
                    <td>${item.category}</td>
                    <td style="text-align: right;">${sellMinDisplay}</td>
                    <td style="text-align: right;">${sellMaxDisplay}</td>
                    <td>${updateDisplay}</td>
                </tr>
            `;
        });
        
        html += `
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

// Update progress bar display
function updateProgressBar(currentChunk, totalChunks, city) {
    const percent = Math.round((currentChunk / totalChunks) * 100);
    
    document.getElementById('progressBar').style.width = percent + '%';
    document.getElementById('progressPercent').textContent = percent + '%';
    document.getElementById('currentCity').textContent = city || 'Waiting...';
    document.getElementById('currentChunk').textContent = currentChunk;
    document.getElementById('totalChunks').textContent = totalChunks;
    
    // Update elapsed time
    const elapsedSeconds = Math.floor((Date.now() - progressStartTime) / 1000);
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    document.getElementById('elapsedTime').textContent = 
        minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

// Show progress bar
function showProgressBar() {
    document.getElementById('progressContainer').style.display = 'block';
    progressStartTime = Date.now();
    updateProgressBar(0, 1, '');
}

// Hide progress bar
function hideProgressBar() {
    document.getElementById('progressContainer').style.display = 'none';
}

// Build complete item ID list with all enhancements
function buildCompleteItemList() {
    const itemsToFetch = [];
    
    for (const baseItem of allEquipmentItems) {
        // For each base item, add versions with @1 to @4 enhancements
        for (let enhancement = 0; enhancement <= 4; enhancement++) {
            const itemId = enhancement === 0 ? baseItem : `${baseItem}@${enhancement}`;
            itemsToFetch.push(itemId);
        }
    }
    
    console.log(`Total items to fetch (with enhancements): ${itemsToFetch.length}`);
    return itemsToFetch;
}

// Fetch data from API with progress callback
async function fetchPricesForItemsWithProgress(itemIds, city, onChunkComplete) {
    try {
        // Larger batch size = fewer API calls (40→60 items per request)
        const chunkSize = 60;
        const chunks = [];
        for (let i = 0; i < itemIds.length; i += chunkSize) {
            chunks.push(itemIds.slice(i, i + chunkSize));
        }
        
        let allData = [];
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            console.log(`📦 Fetching ${city}: chunk ${i + 1}/${chunks.length} (${chunk.length} items) - ${chunk.join(',').substr(0, 100)}...`);
            
            const url = `${CONFIG.API_BASE}/${chunk.join(',')}.json?locations=${city}&qualities=${CONFIG.QUALITY_EXCELLENT}`;
            const response = await fetch(url);
            
            if (!response.ok) {
                console.warn(`❌ API returned ${response.status} for ${city} chunk ${i + 1}`);
                onChunkComplete(i + 1, chunks.length);
                continue;
            }
            
            const data = await response.json();
            console.log(`✅ Got ${data.length} prices from chunk ${i + 1}/${chunks.length}`);
            
            // Debug: Log sample data structure
            if (i === 0 && data.length > 0) {
                console.log('Sample API response item:', data[0]);
            }
            
            allData = allData.concat(data);
            
            // Update progress
            onChunkComplete(i + 1, chunks.length);
            
            // Rate limiting delay
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        console.log(`✅ Retrieved ${allData.length} items from ${city} (used ${chunks.length} batched API calls)`);
        return allData;
    } catch (error) {
        console.error(`Error fetching data for ${city}:`, error);
        return [];
    }
}

// Build item ID list for API request

// Fetch material prices for all tiers and cities
async function fetchMaterialPrices(city) {
    try {
        // Flatten all material IDs into one array
        const allMaterialIds = [];
        Object.values(MATERIAL_IDS).forEach(ids => {
            allMaterialIds.push(...ids);
        });
        
        // Build single URL with ALL materials at once (no chunking)
        const url = `${CONFIG.API_BASE}/${allMaterialIds.join(',')}.json?locations=${city}`;
        console.log(`🔍 Fetching ALL materials for ${city} - Material IDs:`, allMaterialIds);
        console.log(`📡 Full URL: ${url}`);
        
        const response = await fetch(url);
        
        if (!response.ok) {
            console.error(`❌ API returned ${response.status} for ${city}`);
            return;
        }
        
        const allMaterials = await response.json();
        console.log(`📥 API Response for ${city} - Got ${allMaterials.length} items:`, allMaterials);
        
        // Store prices by material type and tier
        if (!materialPrices[city]) {
            materialPrices[city] = { rune: {}, soul: {}, relic: {} };
        }
        
        let processedCount = 0;
        let storedCount = 0;
        
        allMaterials.forEach(item => {
            const normalized = normalizeMarketEntry(item);
            if (!normalized) return;

            const itemId = normalized.item_id;
            const price = normalized.sell_price_min || 0;
            
            processedCount++;
            
            // SKIP if price is 0 (no active listings - not useful)
            if (price === 0) {
                console.warn(`⚠️ Skipping ${itemId} - price is 0 (no active listings)`);
                return;
            }
            
            // Extract tier (T4, T5, T6, T7) from format like T4_RUNE, T5_SOUL, T7_RELIC
            const tierMatch = /^T(\d)_/.exec(itemId);
            if (!tierMatch) {
                console.warn(`⚠️ Could not extract tier from: ${itemId}`);
                return;
            }
            const tier = tierMatch[1];
            
            console.log(`🔎 Processing material: ${itemId} -> Tier: ${tier}, Price: ${price.toLocaleString()}`);
            storedCount++;
            
            // Categorize material
            if (itemId.includes('RUNE')) {
                materialPrices[city].rune[tier] = price;
                console.log(`✅ ${city} T${tier} Rune: ${price.toLocaleString()}`);
            } else if (itemId.includes('SOUL')) {
                materialPrices[city].soul[tier] = price;
                console.log(`✅ ${city} T${tier} Soul: ${price.toLocaleString()}`);
            } else if (itemId.includes('RELIC')) {
                materialPrices[city].relic[tier] = price;
                console.log(`✅ ${city} T${tier} Relic: ${price.toLocaleString()}`);
            }
        });
        
        console.log(`📊 Material fetch summary for ${city}: Processed ${processedCount} items, Stored ${storedCount} with prices`);
        console.log(`📈 Final materialPrices[${city}]:`, materialPrices[city]);
    } catch (error) {
        console.error(`Error fetching material prices for ${city}:`, error);
    }
}

function buildItemIdList() {
    return buildCompleteItemList();
}

// Check if data is outdated (more than 24 hours old)
function isDataOutdated(priceData) {
    if (!priceData || !priceData.sell_price_min_date) return true;
    const lastUpdate = new Date(priceData.sell_price_min_date);
    const now = new Date();
    const diffHours = (now - lastUpdate) / (1000 * 60 * 60);
    return diffHours > 24;
}

function isTimestampOutdated(timestamp) {
    if (!timestamp) return true;
    const time = new Date(timestamp).getTime();
    if (!Number.isFinite(time)) return true;
    const diffHours = (Date.now() - time) / (1000 * 60 * 60);
    return diffHours > 24;
}

function getLatestTimestamp(...timestamps) {
    let latest = null;
    timestamps.forEach(ts => {
        if (!ts) return;
        const time = new Date(ts).getTime();
        if (!Number.isFinite(time)) return;
        if (!latest || time > new Date(latest).getTime()) {
            latest = ts;
        }
    });
    return latest;
}

function formatLastUpdateCell(timestamp) {
    if (!timestamp) return '<span class="data-timestamp data-missing">❌ No data</span>';
    const updateDate = new Date(timestamp);
    if (!Number.isFinite(updateDate.getTime())) return '<span class="data-timestamp data-missing">❌ Invalid</span>';

    const now = new Date();
    const diffMinutes = Math.floor((now - updateDate) / (1000 * 60));
    let ageText = `${diffMinutes}m ago`;
    if (diffMinutes >= 60) {
        const hours = Math.floor(diffMinutes / 60);
        ageText = `${hours}h ago`;
    }
    if (diffMinutes >= 1440) {
        const days = Math.floor(diffMinutes / 1440);
        ageText = `${days}d ago`;
    }

    return `<div><small>${updateDate.toLocaleString()}</small><br><span class="data-timestamp ${diffMinutes > 1440 ? 'data-old' : 'data-fresh'}">${ageText}</span></div>`;
}

function formatMaterialPriceByTier(city, materialType) {
    const cityMaterials = materialPrices[city] || {};
    const byTier = cityMaterials[materialType] || {};
    return CONFIG.TIERS.map(tier => {
        const value = byTier[String(tier)] || 0;
        return `T${tier}: ${value > 0 ? value.toLocaleString() : '-'}`;
    }).join(' | ');
}

// Calculate profitability for an item
function calculateProfitability(baseItem, enhancedItem, materialCost) {
    if (!baseItem || !enhancedItem) return null;
    
    // Use ONLY sell_price_min
    const basePrice = baseItem.sell_price_min;
    const enhancedPrice = enhancedItem.sell_price_min;
    
    if (!basePrice || !enhancedPrice || basePrice === 0 || enhancedPrice === 0) return null;
    
    const enhancementCost = basePrice + materialCost;
    const revenue = enhancedPrice * (1 - CONFIG.TAX_RATE);
    const profit = revenue - enhancementCost;
    const roi = (profit / enhancementCost) * 100;
    
    return {
        basePrice,
        enhancedPrice,
        materialCost,
        enhancementCost,
        revenue,
        profit,
        roi,
        isOutdated: isDataOutdated(baseItem) || isDataOutdated(enhancedItem),
    };
}

// Fetch all data from all cities (in parallel for faster performance)
// Fetch data for a single city (per-city refresh)
async function refreshCityData(city) {
    showLoading(true);
    
    try {
        // Load equipment items if not already loaded
        if (allEquipmentItems.length === 0) {
            await loadEquipmentItems();
        }
        
        // Load item names if not already loaded
        if (Object.keys(itemNameMap).length === 0) {
            await loadItemNames();
        }
        
        if (allEquipmentItems.length === 0) {
            throw new Error('No equipment items available');
        }
        
        const itemIds = buildItemIdList();
        console.log(`🚀 START: Fetching ${itemIds.length} items for ${city} only...`);
        
        // Show progress bar
        showProgressBar();
        
        // Fetch equipment data for this ONE city only
        console.log(`📦 Fetching equipment for ${city}...`);
        const equipmentData = await fetchPricesForItemsWithProgress(itemIds, city, (current, total) => {
            updateProgressBar(current, total + 1, city); // +1 for material fetch
        });
        
        // Fetch material prices for this city
        console.log(`💎 Fetching material prices for ${city}...`);
        await fetchMaterialPrices(city);
        updateProgressBar(Math.ceil(itemIds.length / 60) + 1, Math.ceil(itemIds.length / 60) + 1, city);
        
        // Store equipment results
        allPriceData[city] = {};
        equipmentData.forEach(item => {
            const normalized = normalizeMarketEntry(item);
            if (!normalized) return;
            const itemId = normalized.item_id;
            allPriceData[city][itemId] = mergeBestMarketEntry(allPriceData[city][itemId], normalized);
        });
        
        console.log(`✅ ${city}: ${equipmentData.length} items cached`);
        console.log(`💎 Material prices for ${city}:`, materialPrices[city]);
        
        // 💾 SAVE TO LOCAL DATABASE
        DB.saveEquipmentPrices(city, equipmentData);
        DB.saveMaterialPrices(materialPrices);
        console.log(`💾 Saved all data to local database`);
        
        // Hide progress bar when done
        hideProgressBar();
        
        // Update database stats and cached cities list
        updateDbStats();
        updateCachedCitiesList();
        updateMaterialPricesInspector();
        
        lastUpdateTime = new Date();
        updateRefreshInfo();
        calculateResults();
        displayResults();
        
        showLoading(false);
        
    } catch (error) {
        console.error(`Error fetching data for ${city}:`, error);
        showError(`Failed to fetch data from ${city}: ` + error.message);
        hideProgressBar();
        showLoading(false);
    }
}

// Legacy function - kept for backward compatibility
async function fetchAllData() {
    refreshCityData('Fort Sterling');
}

// Calculate profitability results for all items
function calculateResults() {
    filteredResults = {};
    calcStats = {};
    
    CONFIG.CITIES.forEach(city => {
        filteredResults[city] = [];
        calcStats[city] = {
            totalPairs: 0,
            missingPrice: 0,
            filteredByRoi: 0,
            added: 0,
        };
        const cityData = allPriceData[city] || {};
        
        // For each base equipment item
        allEquipmentItems.forEach(baseItemId => {
            const category = getCategoryFromItemId(baseItemId);
            if (!category) return;
            
            const baseItem = cityData[baseItemId];
            if (!baseItem) return;
            
            // Check enhancements 0->1, 1->2, 2->3
            for (let enhancement = 1; enhancement <= 3; enhancement++) {
                const sourceItemId = enhancement === 1 ? baseItemId : `${baseItemId}@${enhancement - 1}`;
                const targetItemId = `${baseItemId}@${enhancement}`;
                const sourceItem = cityData[sourceItemId];
                const targetItem = cityData[targetItemId];
                
                if (!sourceItem || !targetItem) continue;

                calcStats[city].totalPairs++;
                const sourcePrice = sourceItem.SellPriceMin || sourceItem.sell_price_min || 0;
                const targetPrice = targetItem.SellPriceMin || targetItem.sell_price_min || 0;
                if (!sourcePrice || !targetPrice) {
                    calcStats[city].missingPrice++;
                    continue;
                }
                
                // Determine material type and get actual price from API
                let materialType = 'rune';
                let materialTypeKey = 'rune';
                
                if (enhancement === 2) {
                    materialType = 'soul';
                    materialTypeKey = 'soul';
                } else if (enhancement === 3) {
                    materialType = 'relic';
                    materialTypeKey = 'relic';
                }
                
                // Get actual material price from API for this city
                const cityMaterials = materialPrices[city] || {};
                const tier = getTierFromItemId(baseItemId); // e.g., "4" from T4_...
                
                let unitPrice = 0;
                if (cityMaterials[materialTypeKey] && cityMaterials[materialTypeKey][tier]) {
                    unitPrice = cityMaterials[materialTypeKey][tier];
                }
                
                // SKIP if material price is missing - materials need to be fetched from game
                if (unitPrice === 0) {
                    console.log(`⏭️ Skipping ${baseItemId}@${enhancement}: ${materialType} (T${tier}) price not available - needs fetch from game`);
                    calcStats[city].missingPrice++;
                    continue;
                }
                
                const materialQuantity = getMaterialQuantity(baseItemId, category, materialTypeKey);
                const materialCost = materialQuantity * unitPrice;
                
                const profitability = calculateProfitability(sourceItem, targetItem, materialCost);
                
                if (!profitability || profitability.roi < CONFIG.MIN_ROI) {
                    calcStats[city].filteredByRoi++;
                    continue;
                }

                filteredResults[city].push({
                    itemId: baseItemId,
                    itemName: getItemName(baseItemId),
                    category: category,
                    enhancement: enhancement,
                    materialType,
                    materialQuantity,
                    materialUnitPrice: unitPrice,
                    sourceItemId,
                    targetItemId,
                    sourcePrice,
                    targetPrice,
                    sourceUpdatedAt: sourceItem.sell_price_min_date || sourceItem.SellPriceMinDate || null,
                    targetUpdatedAt: targetItem.sell_price_min_date || targetItem.SellPriceMinDate || null,
                    latestUpdatedAt: getLatestTimestamp(
                        sourceItem.sell_price_min_date || sourceItem.SellPriceMinDate,
                        targetItem.sell_price_min_date || targetItem.SellPriceMinDate
                    ),
                    ...profitability,
                });
                calcStats[city].added++;
            }
        });
    });
    
    console.log('Calculation complete');
}

// Display results
function displayResults() {
    const container = document.getElementById('resultsContainer');
    container.innerHTML = '';
    
    // Check if we have data at all
    const hasAnyEquipmentData = Object.values(allPriceData).some(cityData => Object.keys(cityData || {}).length > 0);
    if (!hasAnyEquipmentData) {
        document.getElementById('emptyStateMessage').style.display = 'block';
        document.getElementById('refreshInfo').style.display = 'none';
        return;
    }
    
    document.getElementById('emptyStateMessage').style.display = 'none';
    document.getElementById('refreshInfo').style.display = 'block';
    
    const minRoi = parseFloat(document.getElementById('roiFilter').value) || CONFIG.MIN_ROI;
    const selectedCategory = document.getElementById('categorySelect').value;
    const selectedTier = document.getElementById('tierSelect').value;
    const selectedCity = document.getElementById('citySelect').value;
    const statusFilterElement = document.getElementById('statusFilter');
    const statusFilter = statusFilterElement ? statusFilterElement.value : 'all';
    
    let totalResults = 0;
    
    // Determine which cities to display
    const citiesToDisplay = selectedCity ? [selectedCity] : CONFIG.CITIES;

    // Debug summary banner
    let debugTotalPairs = 0;
    let debugMissingPrice = 0;
    let debugFilteredByRoi = 0;
    let debugAdded = 0;

    citiesToDisplay.forEach(city => {
        const stats = calcStats[city];
        if (!stats) return;
        debugTotalPairs += stats.totalPairs;
        debugMissingPrice += stats.missingPrice;
        debugFilteredByRoi += stats.filteredByRoi;
        debugAdded += stats.added;
    });

    const cityDebugRows = citiesToDisplay.map(city => {
        const stats = calcStats[city] || { totalPairs: 0, missingPrice: 0, filteredByRoi: 0, added: 0 };
        const successRate = stats.totalPairs > 0 ? ((stats.added / stats.totalPairs) * 100) : 0;
        const spreadRate = debugAdded > 0 ? ((stats.added / debugAdded) * 100) : 0;
        return `
            <tr>
                <td><strong>${city}</strong></td>
                <td>${stats.totalPairs.toLocaleString()}</td>
                <td>${stats.missingPrice.toLocaleString()}</td>
                <td>${stats.filteredByRoi.toLocaleString()}</td>
                <td>${stats.added.toLocaleString()}</td>
                <td>${successRate.toFixed(2)}%</td>
                <td>${spreadRate.toFixed(2)}%</td>
            </tr>
        `;
    }).join('');

    const cityMaterialRows = CONFIG.CITIES.map(city => `
        <tr>
            <td><strong>${city}</strong></td>
            <td>${formatMaterialPriceByTier(city, 'rune')}</td>
            <td>${formatMaterialPriceByTier(city, 'soul')}</td>
            <td>${formatMaterialPriceByTier(city, 'relic')}</td>
        </tr>
    `).join('');

    container.innerHTML = `
        <div class="alert alert-info" style="margin-bottom: 1rem;">
            <strong>Debug Summary:</strong>
            Pairs Checked: ${debugTotalPairs.toLocaleString()} | 
            Missing Price: ${debugMissingPrice.toLocaleString()} | 
            Filtered by ROI: ${debugFilteredByRoi.toLocaleString()} | 
            Added: ${debugAdded.toLocaleString()}
            <div class="table-responsive mt-2">
                <table class="table table-dark table-sm mb-0">
                    <thead>
                        <tr>
                            <th>City</th>
                            <th>Pairs</th>
                            <th>Missing</th>
                            <th>ROI Filtered</th>
                            <th>Success</th>
                            <th>Success %</th>
                            <th>Success Spread %</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${cityDebugRows}
                    </tbody>
                </table>
            </div>

            <div class="mt-3"><strong>City Material Prices (T4-T7)</strong></div>
            <div class="table-responsive mt-2">
                <table class="table table-dark table-sm mb-0">
                    <thead>
                        <tr>
                            <th>City</th>
                            <th>Rune Prices</th>
                            <th>Soul Prices</th>
                            <th>Relic Prices</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${cityMaterialRows}
                    </tbody>
                </table>
            </div>
        </div>
    `;
    
    citiesToDisplay.forEach(city => {
        let results = filteredResults[city] || [];

        results = results.filter(item => {
            if (selectedCategory && item.category !== selectedCategory) return false;
            if (selectedTier && getTierFromItemId(item.itemId) !== selectedTier) return false;
            if (item.roi < minRoi) return false;

            const rowIsOutdated = isTimestampOutdated(item.latestUpdatedAt);
            if (statusFilter === 'fresh' && rowIsOutdated) return false;
            if (statusFilter === 'old' && !rowIsOutdated) return false;
            return true;
        });
        
        if (results.length === 0) return;
        
        totalResults += results.length;
        
        const citySection = document.createElement('div');
        citySection.className = 'city-section';
        
        const cityTitle = document.createElement('div');
        cityTitle.className = 'city-title';
        cityTitle.textContent = `📍 ${city} (${results.length} items)`;
        citySection.appendChild(cityTitle);
        
        const table = document.createElement('div');
        table.className = 'table-responsive';
        
        let tableHtml = `
            <table class="table table-dark table-striped table-hover">
                <thead>
                    <tr>
                        <th style="width: 18%;">Item</th>
                        <th style="width: 6%;">Tier</th>
                        <th style="width: 10%;">Category</th>
                        <th style="width: 8%;">Process</th>
                        <th style="width: 8%;">Base Price</th>
                        <th style="width: 8%;">Enhanced</th>
                        <th style="width: 10%;">Material<br><small>(Type @ Price)</small></th>
                        <th style="width: 10%;">Material Cost<br><small>(Qty × Type)</small></th>
                        <th style="width: 7%;">Total Cost</th>
                        <th style="width: 7%;">After Tax</th>
                        <th style="width: 7%;">Profit</th>
                        <th style="width: 6%;">ROI</th>
                        <th style="width: 10%;">Last Update</th>
                        <th style="width: 4%;">Status</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        results.sort((a, b) => b.roi - a.roi);
        results = results.slice(0, 50); // Show top 50
        
        results.forEach(item => {
            const rowIsOutdated = isTimestampOutdated(item.latestUpdatedAt);
            const roiClass = item.roi >= 50 ? 'roi-high' : item.roi >= 30 ? 'roi-medium' : 'roi-low';
            const dataStatus = rowIsOutdated ? '⚠️ Old' : '✅ Fresh';
            
            // Highlight rows with missing prices or outdated data
            let rowClass = '';
            if (item.basePrice === 0 || item.enhancedPrice === 0) {
                rowClass = 'row-no-price';
            } else if (rowIsOutdated) {
                rowClass = 'row-outdated';
            }
            
            // Get tier from item ID
            const tier = getTierFromItemId(item.itemId);
            const tierBadge = getTierBadge(parseInt(tier.replace('T', '')));
            
            // Remove tier prefix from item name (Adept's, Expert's, Master's, Grandmaster's)
            const cleanName = item.itemName.replace(/^(Adept's|Expert's|Master's|Grandmaster's)\s+/, '');
            
            // Show enhancement process (0→1, 1→2, etc.)
            const prevLevel = item.enhancement - 1;
            const enhProcess = `${prevLevel} → ${item.enhancement}`;
            const processTrace = `${item.sourceItemId} (${item.sourcePrice.toLocaleString()}) → ${item.targetItemId} (${item.targetPrice.toLocaleString()})`;
            
            tableHtml += `
                <tr class="${rowClass}">
                    <td><strong>${cleanName}</strong></td>
                    <td>${tierBadge}</td>
                    <td>${getCategoryBadge(item.category)}</td>
                    <td title="${processTrace}"><strong>${enhProcess}</strong></td>
                    <td class="price-col">${item.basePrice > 0 ? item.basePrice.toLocaleString() : '❌'}</td>
                    <td class="price-col">${item.enhancedPrice > 0 ? item.enhancedPrice.toLocaleString() : '❌'}</td>
                    <td class="price-col"><strong>${getMaterialInfo(item.enhancement).name}</strong><div><small>@ ${item.materialUnitPrice.toLocaleString()}</small></div></td>
                    <td class="price-col">${getMaterialCostBreakdown(item)}</td>
                    <td class="price-col">${item.enhancementCost.toLocaleString()}</td>
                    <td class="price-col">${item.revenue.toLocaleString()}</td>
                    <td class="price-col profit-positive">${item.profit > 0 ? item.profit.toLocaleString() : item.profit.toFixed(0)}</td>
                    <td class="roi-value ${roiClass}"><strong>${item.roi.toFixed(2)}%</strong></td>
                    <td>${formatLastUpdateCell(item.latestUpdatedAt)}</td>
                    <td><span class="${rowIsOutdated ? 'text-warning' : 'text-success'}">${dataStatus}</span></td>
                </tr>
            `;
        });
        
        tableHtml += `
                </tbody>
            </table>
        `;
        
        table.innerHTML = tableHtml;
        citySection.appendChild(table);
        container.appendChild(citySection);
    });
    
    // Show message if no results
    if (totalResults === 0) {
        container.innerHTML = '<div class="alert alert-info">No profitable items found with current filters.</div>';
    }
}

// Update refresh info
function updateRefreshInfo() {
    const refreshInfo = document.getElementById('refreshInfo');
    if (refreshInfo) {
        refreshInfo.style.display = 'block';
    }
    updateCurrentTimeNow();
    document.getElementById('lastUpdateTime').textContent = lastUpdateTime.toLocaleString();
    updateMinutesAgo();
}

function updateCurrentTimeNow() {
    const currentTimeElement = document.getElementById('currentTimeNow');
    if (!currentTimeElement) return;
    currentTimeElement.textContent = new Date().toLocaleString();
}

// Update minutes ago display
function updateMinutesAgo() {
    if (!lastUpdateTime) return;
    const now = new Date();
    const diffMs = now - lastUpdateTime;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    document.getElementById('minutesAgo').textContent = `(${diffMins} minute${diffMins !== 1 ? 's' : ''} ago)`;
}

// Show/hide loading indicator
function showLoading(show) {
    document.getElementById('loadingIndicator').style.display = show ? 'block' : 'none';
}

// Show error message
function showError(message) {
    const errorAlert = document.getElementById('errorAlert');
    if (errorAlert) {
        document.getElementById('errorMessage').textContent = message;
        errorAlert.style.display = 'block';
    }
}

// Export to CSV
function exportToCSV() {
    let csv = 'City,Item,Enhancement,Category,Base Price,Enhanced Price,Material Cost,Total Cost,Revenue After Tax,Profit,ROI %,Data Status\n';
    
    Object.entries(filteredResults).forEach(([city, results]) => {
        results.forEach(item => {
            const status = item.isOutdated ? 'Outdated' : 'Fresh';
            csv += `"${city}","${item.itemName}",@${item.enhancement},"${item.category}",${item.basePrice},${item.enhancedPrice},${item.materialCost},${item.enhancementCost},${item.revenue},${item.profit},${item.roi.toFixed(2)},"${status}"\n`;
        });
    });
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `albion-profit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
}

// Event listeners
window.addEventListener('load', async () => {
    console.log('Albion Enhancement Profit Calculator loaded');
    console.log('Initializing...');
    
    // Load equipment items on page load
    await loadEquipmentItems();
    
    // Load item names on page load
    await loadItemNames();
    
    // Setup global filter event listeners (for Profit Results tab)
    document.getElementById('categorySelect').addEventListener('change', displayResults);
    document.getElementById('tierSelect').addEventListener('change', displayResults);
    document.getElementById('citySelect').addEventListener('change', displayResults);
    document.getElementById('roiFilter').addEventListener('change', displayResults);
    document.getElementById('statusFilter').addEventListener('change', displayResults);
    
    // Setup city refresh button listeners (using data-city attribute)
    document.querySelectorAll('.refreshCityBtn').forEach(btn => {
        btn.addEventListener('click', function() {
            const city = this.getAttribute('data-city');
            if (city) {
                refreshCityData(city);
            }
        });
    });
    
    // Setup export button listener
    document.getElementById('exportBtn').addEventListener('click', exportToCSV);
    
    // Setup inspect city dropdown listener
    document.getElementById('inspectCity').addEventListener('change', inspectCityData);

    // Load existing data from local database
    const storedEquipment = DB.getAllEquipmentPrices();
    const storedMaterials = DB.getAllMaterialPrices();
    allPriceData = storedEquipment && typeof storedEquipment === 'object' ? storedEquipment : {};
    materialPrices = storedMaterials && typeof storedMaterials === 'object' ? storedMaterials : {};

    updateDbStats();
    updateCachedCitiesList();
    updateMaterialPricesInspector();
    
    // If we have cached data, calculate and display results
    const hasCachedData = Object.values(allPriceData).some(cityData => Object.keys(cityData || {}).length > 0);
    if (hasCachedData) {
        console.log('📊 Loading cached results...');
        calculateResults();
        displayResults();
    }

    updateCurrentTimeNow();
    
    console.log('Ready for data fetch - click a city button to start');
});

// Update minutes ago display every minute
setInterval(updateMinutesAgo, 60000);
setInterval(updateCurrentTimeNow, 1000);

// Fetch data for a single city
async function fetchCityData(city) {
    const loadingId = city.toLowerCase().replace(' ', '');
    const container = document.getElementById(`${loadingId}-container`);
    
    if (!container) return;
    
    container.innerHTML = '<div class="text-center"><div class="spinner-border text-primary" role="status"></div><p>Loading...</p></div>';
    
    try {
        // Load equipment items if not already loaded
        if (allEquipmentItems.length === 0) {
            await loadEquipmentItems();
        }
        
        // Load item names if not already loaded
        if (Object.keys(itemNameMap).length === 0) {
            await loadItemNames();
        }
        
        const itemIds = buildItemIdList();
        console.log(`Fetching ${itemIds.length} items for ${city}...`);
        
        const priceData = await fetchPricesForItemsWithProgress(itemIds, city, (current, total) => {
            const percent = Math.round((current / total) * 100);
            container.innerHTML = `<div class="text-center"><div class="spinner-border text-primary" role="status"></div><p>Loading ${city}... ${percent}%</p></div>`;
        });
        
        allPriceData[city] = {};
        priceData.forEach(item => {
            const normalized = normalizeMarketEntry(item);
            if (!normalized) return;
            const itemId = normalized.item_id;
            allPriceData[city][itemId] = mergeBestMarketEntry(allPriceData[city][itemId], normalized);
        });
        
        console.log(`Completed ${city}: ${priceData.length} items`);
        
        renderCityData(city);
        
    } catch (error) {
        console.error(`Error fetching ${city}:`, error);
        container.innerHTML = `<div class="alert alert-danger">Failed to load data: ${error.message}</div>`;
    }
}

// Helper function to get tier badge HTML
function getTierBadge(tier) {
    return `<span class="tier-badge tier-${tier}">T${tier}</span>`;
}

// Helper function to get category badge HTML
function getCategoryBadge(category) {
    const categoryMap = {
        'weapon': '⚔️ Weapon',
        'helmet': '🎖️ Helmet',
        'armor': '🛡️ Armor',
        'shoes': '👢 Shoes',
        'cape': '🧥 Cape',
        'offhand': '📖 Off-hand'
    };
    return `<span class="category-badge cat-${category || 'unknown'}">${categoryMap[category] || category}</span>`;
}

// Helper function to format timestamp with status
function getTimestampWithStatus(priceInfo) {
    if (!priceInfo || !priceInfo.sell_price_min_date) {
        return '<span class="data-timestamp data-missing">❌ No data</span>';
    }
    
    try {
        const date = new Date(priceInfo.sell_price_min_date);
        const now = new Date();
        const diffHours = (now - date) / (1000 * 60 * 60);
        
        let statusClass = 'data-fresh';
        let statusText = '';
        
        if (diffHours > 24) {
            statusClass = 'data-old';
            statusText = `⚠️ ${Math.floor(diffHours / 24)}d old`;
        } else if (diffHours > 1) {
            statusClass = 'data-old';
            statusText = `${Math.floor(diffHours)}h old`;
        } else {
            statusClass = 'data-fresh';
            statusText = '✅ Fresh';
        }
        
        return `<span class="data-timestamp ${statusClass}">${statusText}</span>`;
    } catch (e) {
        return '<span class="data-timestamp data-missing">❌ Error</span>';
    }
}

// Helper function to get filter value for a city
function getCityFilterValue(city, filterType) {
    const cityId = city.toLowerCase().replace(' ', '');
    const filterId = `${cityId}-${filterType}`;
    const element = document.getElementById(filterId);
    return element ? element.value : '';
}

// Helper function to format price with status highlighting
function formatPriceWithStatus(price, priceInfo) {
    if (!priceInfo) return '<span style="color: red;">❌</span>';
    if (!price || price === 0) return '<span style="color: red;">❌</span>';
    
    const isOutdated = isDataOutdated(priceInfo);
    const color = isOutdated ? 'orange' : 'inherit';
    
    return `<span style="color: ${color};">${price.toLocaleString()}</span>`;
}

// Render data for a single city with enhancement levels
function renderCityData(city) {
    const loadingId = city.toLowerCase().replace(' ', '');
    const container = document.getElementById(`${loadingId}-container`);
    if (!container) return;
    
    // Get city-specific filters
    const selectedCategory = getCityFilterValue(city, 'category');
    const selectedTier = getCityFilterValue(city, 'tier');
    
    const cityData = allPriceData[city] || {};
    
    let items = allEquipmentItems.map(itemId => {
        return {
            itemId,
            itemName: getItemName(itemId),
            category: getCategoryFromItemId(itemId),
            tier: getTierFromItemId(itemId),
        };
    });
    
    items = items.filter(item => {
        if (selectedCategory && item.category !== selectedCategory) return false;
        if (selectedTier && item.tier !== selectedTier) return false;
        return true;
    });
    
    items.sort((a, b) => {
        if (a.tier !== b.tier) return Number(a.tier) - Number(b.tier);
        return a.itemName.localeCompare(b.itemName);
    });
    
    let html = `
        <div class="city-header">
            <h4 class="city-header-title">📍 ${city}</h4>
            <span class="city-header-meta">
                <span class="item-count-badge">${items.length.toLocaleString()} items</span>
            </span>
        </div>

        <div class="sticky-filters" style="margin-bottom: 1rem;">
            <h5 class="mb-3">🔍 Filters for ${city}</h5>
            <div class="row mb-1">
                <div class="col-md-4">
                    <label for="${loadingId}-tier" class="form-label">Filter by Tier:</label>
                    <select id="${loadingId}-tier" class="form-select" onchange="renderCityData('${city}')">
                        <option value="" ${selectedTier === '' ? 'selected' : ''}>All Tiers (4-7)</option>
                        <option value="4" ${selectedTier === '4' ? 'selected' : ''}>Tier 4 (Adept) 🔴</option>
                        <option value="5" ${selectedTier === '5' ? 'selected' : ''}>Tier 5 (Expert) 🔵</option>
                        <option value="6" ${selectedTier === '6' ? 'selected' : ''}>Tier 6 (Master) 🟣</option>
                        <option value="7" ${selectedTier === '7' ? 'selected' : ''}>Tier 7 (Grandmaster) 🟡</option>
                    </select>
                </div>
                <div class="col-md-4">
                    <label for="${loadingId}-category" class="form-label">Filter by Category:</label>
                    <select id="${loadingId}-category" class="form-select" onchange="renderCityData('${city}')">
                        <option value="" ${selectedCategory === '' ? 'selected' : ''}>All Categories</option>
                        <option value="weapon" ${selectedCategory === 'weapon' ? 'selected' : ''}>⚔️ Weapons</option>
                        <option value="helmet" ${selectedCategory === 'helmet' ? 'selected' : ''}>🎖️ Helmets</option>
                        <option value="armor" ${selectedCategory === 'armor' ? 'selected' : ''}>🛡️ Armor</option>
                        <option value="shoes" ${selectedCategory === 'shoes' ? 'selected' : ''}>👢 Shoes</option>
                        <option value="cape" ${selectedCategory === 'cape' ? 'selected' : ''}>🧥 Capes</option>
                        <option value="offhand" ${selectedCategory === 'offhand' ? 'selected' : ''}>📖 Off-hands</option>
                    </select>
                </div>
            </div>
        </div>

        <div class="table-responsive">
            <table class="table table-dark table-striped table-hover table-sm">
                <thead>
                    <tr>
                        <th style="width: 25%;">Item Name</th>
                        <th style="width: 8%; text-align: center;">Tier</th>
                        <th style="width: 12%; text-align: center;">Category</th>
                        <th class="price-col" style="width: 10%;">Base</th>
                        <th class="price-col" style="width: 10%;">@1 (Rune)</th>
                        <th class="price-col" style="width: 10%;">@2 (Soul)</th>
                        <th class="price-col" style="width: 10%;">@3 (Relic)</th>
                        <th class="price-col" style="width: 10%;">@4</th>
                        <th style="width: 15%;">Last Update</th>
                    </tr>
                </thead>
                <tbody>
    `;
    
    items.forEach(item => {
        // Get prices for each enhancement level
        const basePrice = cityData[item.itemId];
        const price1 = cityData[`${item.itemId}@1`];
        const price2 = cityData[`${item.itemId}@2`];
        const price3 = cityData[`${item.itemId}@3`];
        const price4 = cityData[`${item.itemId}@4`];
        const latestRowUpdate = getLatestTimestamp(
            basePrice?.sell_price_min_date,
            price1?.sell_price_min_date,
            price2?.sell_price_min_date,
            price3?.sell_price_min_date,
            price4?.sell_price_min_date
        );
        
        const basePriceVal = basePrice?.sell_price_min || 0;
        
        html += `
            <tr>
                <td><strong>${item.itemName}</strong></td>
                <td style="text-align: center;">${getTierBadge(item.tier)}</td>
                <td style="text-align: center;">${getCategoryBadge(item.category)}</td>
                <td class="price-col">${formatPriceWithStatus(basePriceVal, basePrice)}${basePrice ? getTimestampWithStatus(basePrice) : ''}</td>
                <td class="price-col">${formatPriceWithStatus(price1?.sell_price_min || 0, price1)}</td>
                <td class="price-col">${formatPriceWithStatus(price2?.sell_price_min || 0, price2)}</td>
                <td class="price-col">${formatPriceWithStatus(price3?.sell_price_min || 0, price3)}</td>
                <td class="price-col">${formatPriceWithStatus(price4?.sell_price_min || 0, price4)}</td>
                <td>${formatLastUpdateCell(latestRowUpdate)}</td>
            </tr>
        `;
    });
    
    html += `
                </tbody>
            </table>
        </div>
    `;
    
    container.innerHTML = html;
}

// ===== DATABASE MANAGEMENT FUNCTIONS =====

// Update database stats display
function updateDbStats() {
    const stats = DB.getStats();
    const statsHtml = `
        <div class="row">
            <div class="col-md-3">
                <div class="stats-box">
                    <strong>${stats.citiesFetched}</strong><br>
                    <small>Cities Cached</small>
                </div>
            </div>
            <div class="col-md-3">
                <div class="stats-box">
                    <strong>${stats.totalItemsStored.toLocaleString()}</strong><br>
                    <small>Items Stored</small>
                </div>
            </div>
            <div class="col-md-3">
                <div class="stats-box">
                    <strong>${stats.materialCitiesCached}</strong><br>
                    <small>Material Cities</small>
                </div>
            </div>
            <div class="col-md-3">
                <div class="stats-box">
                    <strong>${(stats.storageSize / 1024).toFixed(2)} KB</strong><br>
                    <small>Storage Used</small>
                </div>
            </div>
        </div>
    `;
    const dbStatsContainer = document.getElementById('dbStatsContent');
    if (dbStatsContainer) {
        dbStatsContainer.innerHTML = statsHtml;
    }
}

// Update cached cities list
function updateCachedCitiesList() {
    const cities = DB.getCitiesFetched();
    const container = document.getElementById('cachedCitiesList');
    if (!container) return;
    
    if (cities.length === 0) {
        container.innerHTML = '<p class="text-muted">No cities cached yet. Click a city button to fetch data.</p>';
        return;
    }
    
    let html = '<div class="row">';
    cities.forEach(city => {
        const cityData = DB.getEquipmentPrices(city);
        const itemCount = Object.keys(cityData).length;
        const badge = itemCount > 0 ? '✅' : '⚠️';
        html += `
            <div class="col-md-4 mb-2">
                <div class="filter-section">
                    <h6>${badge} ${city}</h6>
                    <small>${itemCount.toLocaleString()} items cached</small>
                </div>
            </div>
        `;
    });
    html += '</div>';
    container.innerHTML = html;
}

// Inspect city data
function inspectCityData() {
    const city = document.getElementById('inspectCity').value;
    const inspector = document.getElementById('cityDataInspector');
    
    if (!city) {
        inspector.innerHTML = '';
        return;
    }
    
    const cityData = DB.getEquipmentPrices(city);
    if (Object.keys(cityData).length === 0) {
        inspector.innerHTML = `<p class="text-warning">No data cached for ${city}</p>`;
        return;
    }
    
    // Show sample items
    const items = Object.keys(cityData).slice(0, 10);
    let html = `<strong>Sample Data from ${city} (showing first 10 of ${Object.keys(cityData).length} items):</strong><br><br>`;
    html += '<div class="table-responsive"><table class="table table-sm table-dark"><thead><tr><th>Item ID</th><th>Sell Price Min</th><th>Last Update</th></tr></thead><tbody>';
    
    items.forEach(itemId => {
        const item = cityData[itemId];
        const price = item.sell_price_min || 0;
        const date = item.sell_price_min_date ? new Date(item.sell_price_min_date).toLocaleString() : 'Unknown';
        html += `<tr><td>${itemId}</td><td>${price.toLocaleString()}</td><td><small>${date}</small></td></tr>`;
    });
    
    html += '</tbody></table></div>';
    inspector.innerHTML = html;
}

// Update material prices inspector
function updateMaterialPricesInspector() {
    const materialPrices = DB.getAllMaterialPrices();
    const inspector = document.getElementById('materialPricesInspector');
    
    if (!inspector) return;
    
    if (Object.keys(materialPrices).length === 0) {
        inspector.innerHTML = '<p class="text-muted">No material prices cached yet</p>';
        return;
    }
    
    let html = '<div class="table-responsive"><table class="table table-sm table-dark"><thead><tr><th>City</th><th>Material</th><th>T4</th><th>T5</th><th>T6</th><th>T7</th></tr></thead><tbody>';
    
    CONFIG.CITIES.forEach(city => {
        const cityMaterials = materialPrices[city] || {};
        ['rune', 'soul', 'relic'].forEach(material => {
            const prices = cityMaterials[material] || {};
            const displayName = material.charAt(0).toUpperCase() + material.slice(1);
            html += `
                <tr>
                    <td>${city}</td>
                    <td>${displayName}</td>
                    <td><span class="${prices['4'] ? 'text-success' : 'text-danger'}">${prices['4'] ? prices['4'].toLocaleString() : 'No Price'}</span></td>
                    <td><span class="${prices['5'] ? 'text-success' : 'text-danger'}">${prices['5'] ? prices['5'].toLocaleString() : 'No Price'}</span></td>
                    <td><span class="${prices['6'] ? 'text-success' : 'text-danger'}">${prices['6'] ? prices['6'].toLocaleString() : 'No Price'}</span></td>
                    <td><span class="${prices['7'] ? 'text-success' : 'text-danger'}">${prices['7'] ? prices['7'].toLocaleString() : 'No Price'}</span></td>
                </tr>
            `;
        });
    });
    
    html += '</tbody></table></div>';
    inspector.innerHTML = html;
}

// Clear all database
function clearDatabase() {
    if (!confirm('⚠️ Are you sure you want to clear ALL locally cached data? This cannot be undone.')) {
        return;
    }
    
    DB.clearAll();
    allPriceData = {};
    materialPrices = {};
    
    updateDbStats();
    updateCachedCitiesList();
    updateMaterialPricesInspector();
    
    document.getElementById('cityDataInspector').innerHTML = '';
    
    console.log('✅ Database cleared');
    alert('✅ All local data has been cleared');
}

