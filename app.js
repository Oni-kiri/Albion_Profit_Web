// Configuration
const CONFIG = {
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
  TAX_RATE: 0.1, // 10% tax
  CITIES: ["Fort Sterling", "Lymhurst", "Bridgewatch", "Martlock", "Thetford"],
  TIERS: [4, 5, 6, 7],
};

function getApiBase() {
  const server = CONFIG.SERVERS[CONFIG.ACTIVE_SERVER] || CONFIG.SERVERS.east;
  return server.apiBase;
}

function getActiveServerLabel() {
  const server = CONFIG.SERVERS[CONFIG.ACTIVE_SERVER] || CONFIG.SERVERS.east;
  return server.label;
}

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
  if (itemId.includes("_MAIN_") || itemId.includes("_2H_")) return "weapon";
  if (itemId.includes("_HEAD_")) return "helmet";
  if (itemId.includes("_ARMOR_")) return "armor";
  if (itemId.includes("_SHOES_")) return "shoes";
  if (itemId.includes("_CAPE")) return "cape";
  if (itemId.includes("_OFF_")) return "offhand";
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
const THEME_STORAGE_KEY = "albion_theme_mode";

function applyThemeMode(mode) {
  const normalized = mode === "light" ? "light" : "dark";
  document.body.setAttribute("data-theme", normalized);

  const themeToggle = document.getElementById("themeToggle");
  if (themeToggle) {
    themeToggle.textContent = normalized === "dark" ? "☀️ Light" : "🌙 Dark";
  }

  try {
    localStorage.setItem(THEME_STORAGE_KEY, normalized);
  } catch {
    // Ignore storage write failures
  }
}

function initializeThemeMode() {
  let savedTheme = "dark";
  try {
    savedTheme = localStorage.getItem(THEME_STORAGE_KEY) || "dark";
  } catch {
    savedTheme = "dark";
  }
  applyThemeMode(savedTheme);
}

function updateServerDisplay() {
  const label = document.getElementById("activeServerLabel");
  if (label) {
    label.textContent = getActiveServerLabel();
  }

  const select = document.getElementById("serverSelect");
  if (select) {
    select.value = CONFIG.ACTIVE_SERVER;
  }
}

function resetRuntimeData() {
  allPriceData = {};
  materialPrices = {};
  filteredResults = {};
  calcStats = {};

  bmFlipData = [];
  bmRawCaerleonData = {};
  bmRawBlackMarketData = {};

  craftingProfitData = [];
  materialPricesData = {};

  weaponPriceData = [];
}

function initializeServerContext(serverId) {
  const normalized = (serverId || "").toLowerCase();
  if (!CONFIG.SERVERS[normalized]) {
    CONFIG.ACTIVE_SERVER = "east";
  } else {
    CONFIG.ACTIVE_SERVER = normalized;
  }

  DB.setActiveServer(CONFIG.ACTIVE_SERVER);
  updateServerDisplay();
}

function loadCachedStateForActiveServer() {
  resetRuntimeData();

  const storedEquipment = DB.getAllEquipmentPrices();
  const storedMaterials = DB.getAllMaterialPrices();
  allPriceData =
    storedEquipment && typeof storedEquipment === "object" ? storedEquipment : {};
  materialPrices =
    storedMaterials && typeof storedMaterials === "object" ? storedMaterials : {};

  const hasCachedData = Object.values(allPriceData).some(
    (cityData) => Object.keys(cityData || {}).length > 0,
  );

  if (hasCachedData) {
    calculateResults();
    displayResults();
  } else {
    const resultsContainer = document.getElementById("resultsContainer");
    if (resultsContainer) resultsContainer.innerHTML = "";
    const emptyState = document.getElementById("emptyStateMessage");
    if (emptyState) emptyState.style.display = "block";
  }

  initBlackMarketTab();
  initCraftingTab();
  initMatPricesTab();
  initWeaponPricesTab();

  updateDbStats();
  updateCachedCitiesList();
  updateMaterialPricesInspector();
}

// Material item IDs for fetching from API (Format: T#_MATERIALNAME from items.txt)
const MATERIAL_IDS = {
  rune: ["T4_RUNE", "T5_RUNE", "T6_RUNE", "T7_RUNE"],
  soul: ["T4_SOUL", "T5_SOUL", "T6_SOUL", "T7_SOUL"],
  relic: ["T4_RELIC", "T5_RELIC", "T6_RELIC", "T7_RELIC"],
};

// Load all equipment items from JSON file
async function loadEquipmentItems() {
  try {
    const response = await fetch("all_equipment_items.json");
    if (!response.ok) throw new Error("Failed to load equipment items");
    allEquipmentItems = await response.json();
    console.log(`Loaded ${allEquipmentItems.length} unique equipment items`);
    return allEquipmentItems;
  } catch (error) {
    console.error("Error loading equipment items:", error);
    showError("Failed to load equipment database.");
    return [];
  }
}

// Load item names from JSON file
async function loadItemNames() {
  try {
    const response = await fetch("item_names.json");
    if (!response.ok) throw new Error("Failed to load item names");
    itemNameMap = await response.json();
    console.log(`Loaded ${Object.keys(itemNameMap).length} item name mappings`);
  } catch (error) {
    console.error("Error loading item names:", error);
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

// Extract enchantment level from item ID (e.g., T4_SWORD@3 -> 3, T4_SWORD -> 0)
function getEnchantmentFromItemId(itemId) {
  const match = /@(\d)/.exec(itemId);
  return match ? parseInt(match[1]) : 0;
}

// Get base item ID without enchantment (e.g., T4_SWORD@3 -> T4_SWORD)
function getBaseItemId(itemId) {
  return itemId.split("@")[0];
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

  const prevDate = previous.sell_price_min_date
    ? new Date(previous.sell_price_min_date).getTime()
    : 0;
  const nextDate = incoming.sell_price_min_date
    ? new Date(incoming.sell_price_min_date).getTime()
    : 0;
  return nextDate >= prevDate ? incoming : previous;
}

function getSelectedFilterValues(selectId) {
  const multiRoot = document.getElementById(`${selectId}Multi`);
  if (multiRoot) {
    return Array.from(
      multiRoot.querySelectorAll('input[type="checkbox"]:checked'),
    )
      .map((input) => input.value)
      .filter((value) => value !== "");
  }

  const select = document.getElementById(selectId);
  if (!select) return [];
  return select.value ? [select.value] : [];
}

function initializeCheckboxFilterFromSelect(selectId) {
  const select = document.getElementById(selectId);
  if (!select || document.getElementById(`${selectId}Multi`)) return;

  const options = Array.from(select.options || []).filter(
    (option) => option.value !== "",
  );
  if (!options.length) return;

  const triggerChange = () => {
    select.dispatchEvent(new Event("change", { bubbles: true }));
  };

  select.style.display = "none";

  const root = document.createElement("div");
  root.id = `${selectId}Multi`;
  root.className = "mt-1";
  root.style.border = "1px solid rgba(255, 255, 255, 0.2)";
  root.style.borderRadius = "6px";
  root.style.padding = "0.5rem";
  root.style.maxHeight = "140px";
  root.style.overflowY = "auto";

  const toolbar = document.createElement("div");
  toolbar.className = "d-flex gap-2 mb-2";

  const selectAllBtn = document.createElement("button");
  selectAllBtn.type = "button";
  selectAllBtn.className = "btn btn-sm btn-outline-secondary";
  selectAllBtn.textContent = "Select all";

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "btn btn-sm btn-outline-secondary";
  clearBtn.textContent = "Clear";

  toolbar.appendChild(selectAllBtn);
  toolbar.appendChild(clearBtn);
  root.appendChild(toolbar);

  const optionsWrap = document.createElement("div");
  optionsWrap.className = "d-flex flex-column gap-1";

  options.forEach((option) => {
    const line = document.createElement("label");
    line.className = "form-check m-0";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "form-check-input";
    input.value = option.value;
    input.id = `${selectId}Multi_${option.value.replace(/[^A-Za-z0-9_-]/g, "_")}`;

    const text = document.createElement("span");
    text.className = "form-check-label ms-2";
    text.textContent = option.text;

    input.addEventListener("change", triggerChange);

    line.appendChild(input);
    line.appendChild(text);
    optionsWrap.appendChild(line);
  });

  root.appendChild(optionsWrap);

  selectAllBtn.addEventListener("click", () => {
    root
      .querySelectorAll('input[type="checkbox"]')
      .forEach((input) => (input.checked = true));
    triggerChange();
  });

  clearBtn.addEventListener("click", () => {
    root
      .querySelectorAll('input[type="checkbox"]')
      .forEach((input) => (input.checked = false));
    triggerChange();
  });

  select.insertAdjacentElement("afterend", root);
}

function initializeMultiSelectFilters() {
  [
    "citySelect",
    "tierSelect",
    "categorySelect",
    "bmTierSelect",
    "bmEnchantmentSelect",
    "bmQualitySelect",
    "craftTierFilter",
    "craftEnchantFilter",
    "craftQualityFilter",
    "craftWeaponCategoryFilter",
    "weaponTierFilter",
    "weaponCategoryFilter",
  ].forEach((id) => initializeCheckboxFilterFromSelect(id));
}

// Exact material quantity by item type
function getMaterialQuantity(itemId, category, materialTypeKey) {
  if (itemId.includes("_2H_")) return 384;
  if (itemId.includes("_MAIN_") || itemId.includes("_OFF_")) return 288;
  if (itemId.includes("_ARMOR_") || itemId.includes("_BAG")) return 192;
  if (
    itemId.includes("_HEAD_") ||
    itemId.includes("_SHOES_") ||
    itemId.includes("_CAPE")
  )
    return 96;

  const fallback =
    MATERIAL_REQUIREMENTS[category] || MATERIAL_REQUIREMENTS.weapon;
  return fallback[materialTypeKey] || 96;
}

// Get material info for enhancement level
function getMaterialInfo(enhancement) {
  const materials = {
    1: { name: "Rune", multiplier: 1 },
    2: { name: "Soul Stone", multiplier: 2 },
    3: { name: "Relic Fragment", multiplier: 3 },
  };
  return materials[enhancement] || { name: "Unknown", multiplier: 1 };
}

// Get material cost breakdown string
function getMaterialCostBreakdown(item) {
  const material = getMaterialInfo(item.enhancement);
  const typeKey =
    material.name === "Rune"
      ? "rune"
      : material.name === "Soul Stone"
        ? "soul"
        : "relic";
  const quantity =
    item.materialQuantity ||
    getMaterialQuantity(item.itemId, item.category, typeKey);
  const total = item.materialCost;

  return `<div style="font-size: 0.85rem; line-height: 1.2;">${quantity}x<br><small>= ${total.toLocaleString()}</small></div>`;
}

function renderAllItemsList() {
  const container = document.getElementById("allItemsContainer");
  const countEl = document.getElementById("allItemsCount");
  if (!container || !countEl) return;

  const selectedCategories = getSelectedFilterValues("categorySelect");
  const selectedTiers = getSelectedFilterValues("tierSelect");

  // Check if we have price data
  const hasPriceData = Object.keys(allPriceData).length > 0;

  let items = allEquipmentItems.map((itemId) => {
    return {
      itemId,
      itemName: getItemName(itemId),
      category: getCategoryFromItemId(itemId),
      tier: getTierFromItemId(itemId),
    };
  });

  items = items.filter((item) => {
    if (
      selectedCategories.length &&
      !selectedCategories.includes(item.category)
    )
      return false;
    if (selectedTiers.length && !selectedTiers.includes(item.tier)) return false;
    return true;
  });

  items.sort((a, b) => {
    if (a.tier !== b.tier) return Number(a.tier) - Number(b.tier);
    return a.itemName.localeCompare(b.itemName);
  });

  countEl.textContent = items.length.toLocaleString();

  if (items.length === 0) {
    container.innerHTML =
      '<div class="alert alert-info">No items match the current filters.</div>';
    return;
  }

  if (!hasPriceData) {
    container.innerHTML =
      '<div class="alert alert-warning">Click "Refresh Data" to load prices from all cities.</div>';
    return;
  }

  // Create separate table for each city
  let html = "";

  CONFIG.CITIES.forEach((city) => {
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

    items.forEach((item) => {
      const priceInfo = cityData[item.itemId];
      const sellMin = priceInfo?.sell_price_min || 0;
      const sellMax = priceInfo?.sell_price_max || 0;
      const lastUpdate = priceInfo?.sell_price_min_date || "N/A";

      const sellMinDisplay = sellMin > 0 ? sellMin.toLocaleString() : "-";
      const sellMaxDisplay = sellMax > 0 ? sellMax.toLocaleString() : "-";

      let updateDisplay = "-";
      if (lastUpdate !== "N/A") {
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
          updateDisplay = "Error";
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
  const progressBar = document.getElementById("progressBar");
  const progressPercent = document.getElementById("progressPercent");
  const currentCityEl = document.getElementById("currentCity");
  const currentChunkEl = document.getElementById("currentChunk");
  const totalChunksEl = document.getElementById("totalChunks");
  const elapsedTimeEl = document.getElementById("elapsedTime");

  // Check if elements exist before updating
  if (
    !progressBar ||
    !progressPercent ||
    !currentCityEl ||
    !currentChunkEl ||
    !totalChunksEl ||
    !elapsedTimeEl
  ) {
    console.warn("Progress bar elements not found in DOM");
    return;
  }

  const percent = Math.round((currentChunk / totalChunks) * 100);

  progressBar.style.width = percent + "%";
  progressPercent.textContent = percent + "%";
  currentCityEl.textContent = city || "Waiting...";
  currentChunkEl.textContent = currentChunk;
  totalChunksEl.textContent = totalChunks;

  // Update elapsed time
  const elapsedSeconds = Math.floor((Date.now() - progressStartTime) / 1000);
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  elapsedTimeEl.textContent =
    minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

// Show progress bar
function showProgressBar() {
  document.getElementById("progressContainer").style.display = "block";
  progressStartTime = Date.now();
  updateProgressBar(0, 1, "");
}

// Hide progress bar
function hideProgressBar() {
  document.getElementById("progressContainer").style.display = "none";
}

// Build complete item ID list with all enhancements
function buildCompleteItemList() {
  const itemsToFetch = [];

  for (const baseItem of allEquipmentItems) {
    // For each base item, add versions with @1 to @4 enhancements
    for (let enhancement = 0; enhancement <= 4; enhancement++) {
      const itemId =
        enhancement === 0 ? baseItem : `${baseItem}@${enhancement}`;
      itemsToFetch.push(itemId);
    }
  }

  console.log(
    `Total items to fetch (with enhancements): ${itemsToFetch.length}`,
  );
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
      console.log(
        `📦 Fetching ${city}: chunk ${i + 1}/${chunks.length} (${chunk.length} items) - ${chunk.join(",").substr(0, 100)}...`,
      );

      const url = `${getApiBase()}/${chunk.join(",")}.json?locations=${city}&qualities=${CONFIG.QUALITY_EXCELLENT}`;
      const response = await fetch(url);

      if (!response.ok) {
        console.warn(
          `❌ API returned ${response.status} for ${city} chunk ${i + 1}`,
        );
        onChunkComplete(i + 1, chunks.length);
        continue;
      }

      const data = await response.json();
      console.log(
        `✅ Got ${data.length} prices from chunk ${i + 1}/${chunks.length}`,
      );

      // Debug: Log sample data structure
      if (i === 0 && data.length > 0) {
        console.log("Sample API response item:", data[0]);
      }

      allData = allData.concat(data);

      // Update progress
      onChunkComplete(i + 1, chunks.length);

      // Rate limiting delay
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    console.log(
      `✅ Retrieved ${allData.length} items from ${city} (used ${chunks.length} batched API calls)`,
    );
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
    Object.values(MATERIAL_IDS).forEach((ids) => {
      allMaterialIds.push(...ids);
    });

    // Build single URL with ALL materials at once (no chunking)
    const url = `${getApiBase()}/${allMaterialIds.join(",")}.json?locations=${city}`;
    console.log(
      `🔍 Fetching ALL materials for ${city} - Material IDs:`,
      allMaterialIds,
    );
    console.log(`📡 Full URL: ${url}`);

    const response = await fetch(url);

    if (!response.ok) {
      console.error(`❌ API returned ${response.status} for ${city}`);
      return;
    }

    const allMaterials = await response.json();
    console.log(
      `📥 API Response for ${city} - Got ${allMaterials.length} items:`,
      allMaterials,
    );

    // Store prices by material type and tier
    if (!materialPrices[city]) {
      materialPrices[city] = { rune: {}, soul: {}, relic: {} };
    }

    let processedCount = 0;
    let storedCount = 0;

    allMaterials.forEach((item) => {
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

      console.log(
        `🔎 Processing material: ${itemId} -> Tier: ${tier}, Price: ${price.toLocaleString()}`,
      );
      storedCount++;

      // Categorize material
      if (itemId.includes("RUNE")) {
        materialPrices[city].rune[tier] = price;
        console.log(`✅ ${city} T${tier} Rune: ${price.toLocaleString()}`);
      } else if (itemId.includes("SOUL")) {
        materialPrices[city].soul[tier] = price;
        console.log(`✅ ${city} T${tier} Soul: ${price.toLocaleString()}`);
      } else if (itemId.includes("RELIC")) {
        materialPrices[city].relic[tier] = price;
        console.log(`✅ ${city} T${tier} Relic: ${price.toLocaleString()}`);
      }
    });

    console.log(
      `📊 Material fetch summary for ${city}: Processed ${processedCount} items, Stored ${storedCount} with prices`,
    );
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
  timestamps.forEach((ts) => {
    if (!ts) return;
    const time = new Date(ts).getTime();
    if (!Number.isFinite(time)) return;
    if (!latest || time > new Date(latest).getTime()) {
      latest = ts;
    }
  });
  return latest;
}

// Convert UTC timestamp to local time
function formatUTCToLocal(timestamp) {
  if (!timestamp) return null;

  // Albion API returns timestamps in UTC format like "2026-03-04T10:30:00"
  // Ensure we parse it as UTC, then convert to local time
  let date;

  if (timestamp.endsWith("Z")) {
    // Already has Z indicator for UTC
    date = new Date(timestamp);
  } else if (timestamp.includes("T")) {
    // ISO format without Z - explicitly treat as UTC
    date = new Date(timestamp + "Z");
  } else {
    // Fallback
    date = new Date(timestamp);
  }

  return date;
}

function formatLastUpdateCell(timestamp) {
  if (!timestamp)
    return '<span class="data-timestamp data-missing">❌ No data</span>';
  const updateDate = formatUTCToLocal(timestamp);
  if (!updateDate || !Number.isFinite(updateDate.getTime()))
    return '<span class="data-timestamp data-missing">❌ Invalid</span>';

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

  return `<div><small>${updateDate.toLocaleString()}</small><br><span class="data-timestamp ${diffMinutes > 1440 ? "data-old" : "data-fresh"}">${ageText}</span></div>`;
}

function formatMaterialPriceByTier(city, materialType) {
  const cityMaterials = materialPrices[city] || {};
  const byTier = cityMaterials[materialType] || {};
  return CONFIG.TIERS.map((tier) => {
    const value = byTier[String(tier)] || 0;
    return `T${tier}: ${value > 0 ? value.toLocaleString() : "-"}`;
  }).join(" | ");
}

// Calculate profitability for an item
function calculateProfitability(baseItem, enhancedItem, materialCost) {
  if (!baseItem || !enhancedItem) return null;

  // Use ONLY sell_price_min
  const basePrice = baseItem.sell_price_min;
  const enhancedPrice = enhancedItem.sell_price_min;

  if (!basePrice || !enhancedPrice || basePrice === 0 || enhancedPrice === 0)
    return null;

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
      throw new Error("No equipment items available");
    }

    const itemIds = buildItemIdList();
    console.log(
      `🚀 START: Fetching ${itemIds.length} items for ${city} only...`,
    );

    // Show progress bar
    showProgressBar();

    // Fetch equipment data for this ONE city only
    console.log(`📦 Fetching equipment for ${city}...`);
    const equipmentData = await fetchPricesForItemsWithProgress(
      itemIds,
      city,
      (current, total) => {
        updateProgressBar(current, total + 1, city); // +1 for material fetch
      },
    );

    // Fetch material prices for this city
    console.log(`💎 Fetching material prices for ${city}...`);
    await fetchMaterialPrices(city);
    updateProgressBar(
      Math.ceil(itemIds.length / 60) + 1,
      Math.ceil(itemIds.length / 60) + 1,
      city,
    );

    // Store equipment results
    allPriceData[city] = {};
    equipmentData.forEach((item) => {
      const normalized = normalizeMarketEntry(item);
      if (!normalized) return;
      const itemId = normalized.item_id;
      allPriceData[city][itemId] = mergeBestMarketEntry(
        allPriceData[city][itemId],
        normalized,
      );
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
  refreshCityData("Fort Sterling");
}

// Calculate profitability results for all items
function calculateResults() {
  filteredResults = {};
  calcStats = {};

  CONFIG.CITIES.forEach((city) => {
    filteredResults[city] = [];
    calcStats[city] = {
      totalPairs: 0,
      missingPrice: 0,
      filteredByRoi: 0,
      added: 0,
    };
    const cityData = allPriceData[city] || {};

    // For each base equipment item
    allEquipmentItems.forEach((baseItemId) => {
      const category = getCategoryFromItemId(baseItemId);
      if (!category) return;

      const baseItem = cityData[baseItemId];
      if (!baseItem) return;

      // Check enhancements 0->1, 1->2, 2->3
      for (let enhancement = 1; enhancement <= 3; enhancement++) {
        const sourceItemId =
          enhancement === 1 ? baseItemId : `${baseItemId}@${enhancement - 1}`;
        const targetItemId = `${baseItemId}@${enhancement}`;
        const sourceItem = cityData[sourceItemId];
        const targetItem = cityData[targetItemId];

        if (!sourceItem || !targetItem) continue;

        calcStats[city].totalPairs++;
        const sourcePrice =
          sourceItem.SellPriceMin || sourceItem.sell_price_min || 0;
        const targetPrice =
          targetItem.SellPriceMin || targetItem.sell_price_min || 0;
        if (!sourcePrice || !targetPrice) {
          calcStats[city].missingPrice++;
          continue;
        }

        // Determine material type and get actual price from API
        let materialType = "rune";
        let materialTypeKey = "rune";

        if (enhancement === 2) {
          materialType = "soul";
          materialTypeKey = "soul";
        } else if (enhancement === 3) {
          materialType = "relic";
          materialTypeKey = "relic";
        }

        // Get actual material price from API for this city
        const cityMaterials = materialPrices[city] || {};
        const tier = getTierFromItemId(baseItemId); // e.g., "4" from T4_...

        let unitPrice = 0;
        if (
          cityMaterials[materialTypeKey] &&
          cityMaterials[materialTypeKey][tier]
        ) {
          unitPrice = cityMaterials[materialTypeKey][tier];
        }

        // SKIP if material price is missing - materials need to be fetched from game
        if (unitPrice === 0) {
          console.log(
            `⏭️ Skipping ${baseItemId}@${enhancement}: ${materialType} (T${tier}) price not available - needs fetch from game`,
          );
          calcStats[city].missingPrice++;
          continue;
        }

        const materialQuantity = getMaterialQuantity(
          baseItemId,
          category,
          materialTypeKey,
        );
        const materialCost = materialQuantity * unitPrice;

        const profitability = calculateProfitability(
          sourceItem,
          targetItem,
          materialCost,
        );

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
          sourceUpdatedAt:
            sourceItem.sell_price_min_date ||
            sourceItem.SellPriceMinDate ||
            null,
          targetUpdatedAt:
            targetItem.sell_price_min_date ||
            targetItem.SellPriceMinDate ||
            null,
          latestUpdatedAt: getLatestTimestamp(
            sourceItem.sell_price_min_date || sourceItem.SellPriceMinDate,
            targetItem.sell_price_min_date || targetItem.SellPriceMinDate,
          ),
          ...profitability,
        });
        calcStats[city].added++;
      }
    });
  });

  console.log("Calculation complete");
}

// Display results
function displayResults() {
  const container = document.getElementById("resultsContainer");
  container.innerHTML = "";

  // Check if we have data at all
  const hasAnyEquipmentData = Object.values(allPriceData).some(
    (cityData) => Object.keys(cityData || {}).length > 0,
  );
  if (!hasAnyEquipmentData) {
    document.getElementById("emptyStateMessage").style.display = "block";
    document.getElementById("refreshInfo").style.display = "none";
    return;
  }

  document.getElementById("emptyStateMessage").style.display = "none";
  document.getElementById("refreshInfo").style.display = "block";

  const minRoi =
    parseFloat(document.getElementById("roiFilter").value) || CONFIG.MIN_ROI;
  const selectedCategories = getSelectedFilterValues("categorySelect");
  const selectedTiers = getSelectedFilterValues("tierSelect");
  const selectedCities = getSelectedFilterValues("citySelect");
  const statusFilterElement = document.getElementById("statusFilter");
  const statusFilter = statusFilterElement ? statusFilterElement.value : "all";

  let totalResults = 0;

  // Determine which cities to display
  const citiesToDisplay = selectedCities.length ? selectedCities : CONFIG.CITIES;

  // Debug summary banner
  let debugTotalPairs = 0;
  let debugMissingPrice = 0;
  let debugFilteredByRoi = 0;
  let debugAdded = 0;

  citiesToDisplay.forEach((city) => {
    const stats = calcStats[city];
    if (!stats) return;
    debugTotalPairs += stats.totalPairs;
    debugMissingPrice += stats.missingPrice;
    debugFilteredByRoi += stats.filteredByRoi;
    debugAdded += stats.added;
  });

  const cityDebugRows = citiesToDisplay
    .map((city) => {
      const stats = calcStats[city] || {
        totalPairs: 0,
        missingPrice: 0,
        filteredByRoi: 0,
        added: 0,
      };
      const successRate =
        stats.totalPairs > 0 ? (stats.added / stats.totalPairs) * 100 : 0;
      const spreadRate = debugAdded > 0 ? (stats.added / debugAdded) * 100 : 0;
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
    })
    .join("");

  const cityMaterialRows = CONFIG.CITIES.map(
    (city) => `
        <tr>
            <td><strong>${city}</strong></td>
            <td>${formatMaterialPriceByTier(city, "rune")}</td>
            <td>${formatMaterialPriceByTier(city, "soul")}</td>
            <td>${formatMaterialPriceByTier(city, "relic")}</td>
        </tr>
    `,
  ).join("");

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

  citiesToDisplay.forEach((city) => {
    let results = filteredResults[city] || [];

    results = results.filter((item) => {
      if (
        selectedCategories.length &&
        !selectedCategories.includes(item.category)
      )
        return false;
      if (
        selectedTiers.length &&
        !selectedTiers.includes(getTierFromItemId(item.itemId))
      )
        return false;
      if (item.roi < minRoi) return false;

      const rowIsOutdated = isTimestampOutdated(item.latestUpdatedAt);
      if (statusFilter === "fresh" && rowIsOutdated) return false;
      if (statusFilter === "old" && !rowIsOutdated) return false;
      return true;
    });

    if (results.length === 0) return;

    totalResults += results.length;

    const citySection = document.createElement("div");
    citySection.className = "city-section";

    const cityTitle = document.createElement("div");
    cityTitle.className = "city-title";
    cityTitle.textContent = `📍 ${city} (${results.length} items)`;
    citySection.appendChild(cityTitle);

    const table = document.createElement("div");
    table.className = "table-responsive";

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

    results.forEach((item) => {
      const rowIsOutdated = isTimestampOutdated(item.latestUpdatedAt);
      const roiClass =
        item.roi >= 50 ? "roi-high" : item.roi >= 30 ? "roi-medium" : "roi-low";
      const dataStatus = rowIsOutdated ? "⚠️ Old" : "✅ Fresh";

      // Highlight rows with missing prices or outdated data
      let rowClass = "";
      if (item.basePrice === 0 || item.enhancedPrice === 0) {
        rowClass = "row-no-price";
      } else if (rowIsOutdated) {
        rowClass = "row-outdated";
      }

      // Get tier from item ID
      const tier = getTierFromItemId(item.itemId);
      const tierBadge = getTierBadge(parseInt(tier.replace("T", "")));

      // Remove tier prefix from item name (Adept's, Expert's, Master's, Grandmaster's)
      const cleanName = item.itemName.replace(
        /^(Adept's|Expert's|Master's|Grandmaster's)\s+/,
        "",
      );

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
                    <td class="price-col">${item.basePrice > 0 ? item.basePrice.toLocaleString() : "❌"}</td>
                    <td class="price-col">${item.enhancedPrice > 0 ? item.enhancedPrice.toLocaleString() : "❌"}</td>
                    <td class="price-col"><strong>${getMaterialInfo(item.enhancement).name}</strong><div><small>@ ${item.materialUnitPrice.toLocaleString()}</small></div></td>
                    <td class="price-col">${getMaterialCostBreakdown(item)}</td>
                    <td class="price-col">${item.enhancementCost.toLocaleString()}</td>
                    <td class="price-col">${item.revenue.toLocaleString()}</td>
                    <td class="price-col profit-positive">${item.profit > 0 ? item.profit.toLocaleString() : item.profit.toFixed(0)}</td>
                    <td class="roi-value ${roiClass}"><strong>${item.roi.toFixed(2)}%</strong></td>
                    <td>${formatLastUpdateCell(item.latestUpdatedAt)}</td>
                    <td><span class="${rowIsOutdated ? "text-warning" : "text-success"}">${dataStatus}</span></td>
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
    container.innerHTML =
      '<div class="alert alert-info">No profitable items found with current filters.</div>';
  }
}

// Update refresh info
function updateRefreshInfo() {
  const refreshInfo = document.getElementById("refreshInfo");
  if (refreshInfo) {
    refreshInfo.style.display = "block";
  }
  updateCurrentTimeNow();
  document.getElementById("lastUpdateTime").textContent =
    lastUpdateTime.toLocaleString();
  updateMinutesAgo();
}

function updateCurrentTimeNow() {
  const currentTimeElement = document.getElementById("currentTimeNow");
  if (!currentTimeElement) return;
  currentTimeElement.textContent = new Date().toLocaleString();
}

// Update minutes ago display
function updateMinutesAgo() {
  if (!lastUpdateTime) return;
  const now = new Date();
  const diffMs = now - lastUpdateTime;
  const diffMins = Math.floor(diffMs / (1000 * 60));
  document.getElementById("minutesAgo").textContent =
    `(${diffMins} minute${diffMins !== 1 ? "s" : ""} ago)`;
}

// Show/hide loading indicator
function showLoading(show) {
  document.getElementById("loadingIndicator").style.display = show
    ? "block"
    : "none";
}

// Show error message
function showError(message) {
  const errorAlert = document.getElementById("errorAlert");
  if (errorAlert) {
    document.getElementById("errorMessage").textContent = message;
    errorAlert.style.display = "block";
  }
}

// Export to CSV
function exportToCSV() {
  let csv =
    "City,Item,Enhancement,Category,Base Price,Enhanced Price,Material Cost,Total Cost,Revenue After Tax,Profit,ROI %,Data Status\n";

  Object.entries(filteredResults).forEach(([city, results]) => {
    results.forEach((item) => {
      const status = item.isOutdated ? "Outdated" : "Fresh";
      csv += `"${city}","${item.itemName}",@${item.enhancement},"${item.category}",${item.basePrice},${item.enhancedPrice},${item.materialCost},${item.enhancementCost},${item.revenue},${item.profit},${item.roi.toFixed(2)},"${status}"\n`;
    });
  });

  const blob = new Blob([csv], { type: "text/csv" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `albion-profit-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

// ============================================
// BLACK MARKET FLIP FUNCTIONALITY
// ============================================

let bmFlipData = []; // Store black market opportunities
let bmSortColumn = "roi"; // Default sort column: roi, grossProfit, caerleonPrice, bmBuyPrice, itemName, tier
let bmSortDirection = "desc"; // 'asc' or 'desc'
let bmRawCaerleonData = {}; // Raw Caerleon data (all items fetched)
let bmRawBlackMarketData = {}; // Raw BlackMarket data (all items fetched)

function initBlackMarketTab() {
  const payload = DB.getBlackMarket();
  const info = document.getElementById("bmLastUpdateInfo");
  if (!payload || !Array.isArray(payload.flips)) {
    bmFlipData = [];
    bmRawCaerleonData = {};
    bmRawBlackMarketData = {};
    if (info) info.textContent = "No Black Market scan cached yet.";
    displayBlackMarketFlips();
    return;
  }

  bmFlipData = payload.flips;
  bmRawCaerleonData = payload.rawCaerleon || {};
  bmRawBlackMarketData = payload.rawBlackMarket || {};
  if (info) {
    info.textContent = payload.timestamp
      ? `Last scan: ${payload.timestamp} (${bmFlipData.length.toLocaleString()} rows cached)`
      : `${bmFlipData.length.toLocaleString()} rows cached`;
  }
  displayBlackMarketFlips();
}

function sortBlackMarketData(column) {
  // Toggle direction if same column, otherwise default to descending
  if (bmSortColumn === column) {
    bmSortDirection = bmSortDirection === "asc" ? "desc" : "asc";
  } else {
    bmSortColumn = column;
    bmSortDirection = column === "itemName" ? "asc" : "desc"; // Item name defaults to A-Z
  }
  displayBlackMarketFlips();
}

async function fetchBlackMarketPrices() {
  const container = document.getElementById("bmResultsContainer");
  const progressContainer = document.getElementById("bmProgressContainer");
  const progressBar = document.getElementById("bmProgressBar");
  const progressPercent = document.getElementById("bmProgressPercent");
  const progressText = document.getElementById("bmProgressText");
  const currentBatch = document.getElementById("bmCurrentBatch");
  const totalBatches = document.getElementById("bmTotalBatches");
  const itemsProcessed = document.getElementById("bmItemsProcessed");
  const flipsFound = document.getElementById("bmFlipsFound");
  const elapsedTime = document.getElementById("bmElapsedTime");

  // Show progress container
  progressContainer.style.display = "block";
  container.innerHTML = "";

  let startTime = Date.now();
  let foundCount = 0;

  const updateProgress = (current, total, processed, found) => {
    const percent = Math.round((current / total) * 100);
    progressBar.style.width = percent + "%";
    progressPercent.textContent = percent + "%";
    progressText.textContent = `Scanning batch ${current}/${total}...`;
    currentBatch.textContent = current;
    totalBatches.textContent = total;
    itemsProcessed.textContent = processed;
    flipsFound.textContent = found;

    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    elapsedTime.textContent = elapsed + "s";
  };

  try {
    // Load equipment items if not already loaded
    if (allEquipmentItems.length === 0) {
      progressText.textContent = "Loading equipment list...";
      await loadEquipmentItems();
    }

    // Load item names if not already loaded
    if (Object.keys(itemNameMap).length === 0) {
      progressText.textContent = "Loading item names...";
      await loadItemNames();
    }

    console.log(
      `Fetching Black Market prices for ${allEquipmentItems.length} items...`,
    );

    // Generate all enchantment variations (@0, @1, @2, @3) for each base item
    const itemsWithEnchantments = [];
    allEquipmentItems.forEach((baseItem) => {
      // Add base item (.0)
      itemsWithEnchantments.push(baseItem);
      // Add enchantment levels .1, .2, .3, .4
      for (let enchant = 1; enchant <= 4; enchant++) {
        itemsWithEnchantments.push(`${baseItem}@${enchant}`);
      }
    });

    console.log(`📊 Base items: ${allEquipmentItems.length}`);
    console.log(
      `📊 With all enchantments (@0-@4): ${itemsWithEnchantments.length} total items`,
    );
    console.log(
      `📊 Total batches to process: ${Math.ceil(itemsWithEnchantments.length / 100)}`,
    );

    // Clear previous scan data
    bmRawCaerleonData = {};
    bmRawBlackMarketData = {};

    const bmFlips = [];
    const batchSize = 100;
    const totalBatchCount = Math.ceil(itemsWithEnchantments.length / batchSize);
    let totalItemsScanned = 0;

    updateProgress(0, totalBatchCount, 0, 0);

    // Fetch prices for all items from both Caerleon and BlackMarket
    for (let i = 0; i < itemsWithEnchantments.length; i += batchSize) {
      const batch = itemsWithEnchantments.slice(i, i + batchSize);
      const itemIds = batch.join(",");
      const currentBatchNum = Math.floor(i / batchSize) + 1;

      console.log(
        `\n🔄 Batch ${currentBatchNum}/${totalBatchCount}: Fetching ${batch.length} items...`,
      );

      try {
        // Get prices from both Caerleon (player market) and BlackMarket (NPC buyer)
        const url = `${getApiBase()}/${itemIds}.json?locations=Caerleon,BlackMarket&qualities=1,2,3,4,5`;
        console.log(`📡 API URL: ${url.substring(0, 100)}...`);

        const response = await fetch(url);

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const prices = await response.json();
        console.log(
          `✅ Batch ${currentBatchNum}: Received ${prices.length} price entries`,
        );

        // Store raw data for data validation inspection
        prices.forEach((item) => {
          const key = `${item.item_id}_Q${item.quality || 1}`;

          if (item.city === "Caerleon") {
            bmRawCaerleonData[key] = {
              item_id: item.item_id,
              sell_price_min: item.sell_price_min || 0,
              sell_price_min_date: item.sell_price_min_date,
              quality: item.quality || 1,
            };
          } else if (item.city === "Black Market") {
            bmRawBlackMarketData[key] = {
              item_id: item.item_id,
              buy_price_max: item.buy_price_max || 0,
              buy_price_max_date: item.buy_price_max_date,
              quality: item.quality || 1,
            };
          }
        });

        // Group by item_id and quality to match Caerleon with BlackMarket
        const priceMap = new Map();

        prices.forEach((item) => {
          const key = `${item.item_id}_Q${item.quality || 1}`;

          if (!priceMap.has(key)) {
            priceMap.set(key, {
              caerleon: null,
              blackmarket: null,
              item_id: item.item_id,
              quality: item.quality || 1,
            });
          }

          const entry = priceMap.get(key);

          if (item.city === "Caerleon") {
            entry.caerleon = {
              sell_price_min: item.sell_price_min,
              sell_price_min_date: item.sell_price_min_date,
            };
          } else if (item.city === "Black Market") {
            entry.blackmarket = {
              buy_price_max: item.buy_price_max,
              buy_price_max_date: item.buy_price_max_date,
            };
          }
        });

        console.log(
          `🔍 Grouped into ${priceMap.size} unique item+quality combinations`,
        );

        let batchFlipsFound = 0;

        // Now compare Caerleon vs BlackMarket for each item
        priceMap.forEach((entry, key) => {
          if (!entry.caerleon || !entry.blackmarket) {
            // Missing one side, skip
            return;
          }

          if (
            !entry.caerleon.sell_price_min ||
            !entry.blackmarket.buy_price_max
          ) {
            // No prices available
            return;
          }

          const caerleonPrice = entry.caerleon.sell_price_min; // What we pay to buy
          const bmPrice = entry.blackmarket.buy_price_max; // What we get selling to BM

          // Calculate profit (8% fee, or 4% with premium - using 8% conservatively)
          const netSellPrice = bmPrice * 0.92; // After 8% tax
          const grossProfit = netSellPrice - caerleonPrice;
          const roi = (grossProfit / caerleonPrice) * 100;

          // Only include profitable flips
          if (grossProfit > 0) {
            const baseItemId = getBaseItemId(entry.item_id);
            const enchantment = getEnchantmentFromItemId(entry.item_id);

            bmFlips.push({
              itemId: entry.item_id,
              baseItemId: baseItemId,
              itemName:
                itemNameMap[baseItemId] ||
                itemNameMap[entry.item_id] ||
                baseItemId,
              enchantment: enchantment,
              quality: entry.quality,
              caerleonPrice: caerleonPrice,
              bmBuyPrice: bmPrice,
              netSellPrice: netSellPrice,
              grossProfit: grossProfit,
              roi: roi,
              timestamp:
                entry.caerleon.sell_price_min_date || new Date().toISOString(),
            });
            batchFlipsFound++;
            foundCount++;
          }
        });

        console.log(
          `💰 Batch ${currentBatchNum}: Found ${batchFlipsFound} profitable flips`,
        );
        totalItemsScanned += prices.length;

        updateProgress(
          currentBatchNum,
          totalBatchCount,
          totalItemsScanned,
          foundCount,
        );
      } catch (err) {
        console.error(
          `❌ Error fetching batch ${currentBatchNum}/${totalBatchCount}:`,
          err,
        );
      }

      // Small delay between batches to respect rate limits
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    console.log(`\n🎉 SCAN COMPLETE!`);
    console.log(`📊 Total items scanned: ${totalItemsScanned}`);
    console.log(`✅ Total profitable flips found: ${bmFlips.length}`);

    if (bmFlips.length > 0) {
      console.log(
        `🏆 Best flip: ${bmFlips[0].itemName} (Q${bmFlips[0].quality}) - ROI: ${bmFlips[0].roi.toFixed(2)}%`,
      );
    }

    console.log(`\n🎉 SCAN COMPLETE!`);
    console.log(`📊 Total items scanned: ${totalItemsScanned}`);
    console.log(`✅ Total profitable flips found: ${bmFlips.length}`);

    if (bmFlips.length > 0) {
      // Sort by ROI descending (most profitable first)
      bmFlips.sort((a, b) => b.roi - a.roi);
      const topFlip = bmFlips[0];
      const enchStr =
        topFlip.enchantment > 0 ? `@${topFlip.enchantment}` : ".0";
      console.log(
        `🏆 Best flip: ${topFlip.itemName} ${enchStr} (Q${topFlip.quality}) - ROI: ${topFlip.roi.toFixed(2)}% - Profit: ${topFlip.grossProfit.toLocaleString()} silver`,
      );
      console.log(`💎 Top 5 flips:`);
      bmFlips.slice(0, 5).forEach((flip, idx) => {
        const enh = flip.enchantment > 0 ? `@${flip.enchantment}` : ".0";
        console.log(
          `  ${idx + 1}. ${flip.itemName} ${enh} (Q${flip.quality}) - Buy: ${flip.caerleonPrice.toLocaleString()}, Sell: ${flip.bmBuyPrice.toLocaleString()}, Profit: ${flip.grossProfit.toLocaleString()}, ROI: ${flip.roi.toFixed(2)}%`,
        );
      });
    } else {
      console.log(`⚠️ No profitable flips found in this scan`);
    }

    bmFlipData = bmFlips;
    DB.saveBlackMarket({
      timestamp: new Date().toLocaleString(),
      flips: bmFlipData,
      rawCaerleon: bmRawCaerleonData,
      rawBlackMarket: bmRawBlackMarketData,
    });
    const bmInfo = document.getElementById("bmLastUpdateInfo");
    if (bmInfo) {
      bmInfo.textContent = `Last scan: ${new Date().toLocaleString()} (${bmFlipData.length.toLocaleString()} rows cached)`;
    }

    console.log(
      `📦 Data Validation: ${Object.keys(bmRawCaerleonData).length} Caerleon entries, ${Object.keys(bmRawBlackMarketData).length} BlackMarket entries stored`,
    );

    // Hide progress and show completion
    progressContainer.style.display = "none";
    displayBlackMarketFlips();
  } catch (error) {
    console.error("Error fetching Black Market prices:", error);
    progressContainer.style.display = "none";
    container.innerHTML = `<div class="alert alert-danger">❌ Error: ${error.message}</div>`;
  }
}

function displayBlackMarketFlips() {
  const container = document.getElementById("bmResultsContainer");
  const emptyState = document.getElementById("bmEmptyStateMessage");

  if (bmFlipData.length === 0) {
    container.innerHTML = "";
    emptyState.style.display = "block";
    return;
  }

  // Get filter values
  const tierFilters = getSelectedFilterValues("bmTierSelect");
  const enchantmentFilters = getSelectedFilterValues("bmEnchantmentSelect")
    .map((value) => parseInt(value, 10))
    .filter(Number.isFinite);
  const qualityFilters = getSelectedFilterValues("bmQualitySelect")
    .map((value) => parseInt(value, 10))
    .filter(Number.isFinite);
  const minRoi = parseFloat(
    document.getElementById("bmMinRoiFilter")?.value || 5,
  );
  const maxResults = parseInt(
    document.getElementById("bmMaxResults")?.value || 50,
  );

  // Apply filters
  let filtered = bmFlipData.filter((item) => {
    if (item.roi < minRoi) return false;

    if (
      enchantmentFilters.length &&
      !enchantmentFilters.includes(Number(item.enchantment))
    )
      return false;

    if (qualityFilters.length && !qualityFilters.includes(Number(item.quality)))
      return false;

    if (tierFilters.length) {
      const itemTier = getTierFromItemId(item.itemId);
      if (!tierFilters.includes(itemTier)) return false;
    }

    return true;
  });

  // Apply sorting
  filtered.sort((a, b) => {
    let aVal, bVal;

    switch (bmSortColumn) {
      case "itemName":
        aVal = a.itemName.toLowerCase();
        bVal = b.itemName.toLowerCase();
        break;
      case "tier":
        aVal = parseInt(getTierFromItemId(a.itemId));
        bVal = parseInt(getTierFromItemId(b.itemId));
        break;
      case "caerleonPrice":
        aVal = a.caerleonPrice;
        bVal = b.caerleonPrice;
        break;
      case "bmBuyPrice":
        aVal = a.bmBuyPrice;
        bVal = b.bmBuyPrice;
        break;
      case "grossProfit":
        aVal = a.grossProfit;
        bVal = b.grossProfit;
        break;
      case "roi":
      default:
        aVal = a.roi;
        bVal = b.roi;
        break;
    }

    if (typeof aVal === "string") {
      return bmSortDirection === "asc"
        ? aVal.localeCompare(bVal)
        : bVal.localeCompare(aVal);
    } else {
      return bmSortDirection === "asc" ? aVal - bVal : bVal - aVal;
    }
  });

  // Limit results
  filtered = filtered.slice(0, maxResults);

  if (filtered.length === 0) {
    container.innerHTML = "";
    emptyState.style.display = "block";
    return;
  }

  emptyState.style.display = "none";

  // Helper function to create sort indicator
  const getSortIcon = (column) => {
    if (bmSortColumn !== column) return '<span class="sort-arrows">⇅</span>';
    return bmSortDirection === "asc"
      ? '<span class="sort-arrow">▲</span>'
      : '<span class="sort-arrow">▼</span>';
  };

  // Build table
  let html =
    '<div class="table-responsive mt-4"><table class="table table-dark table-hover">';
  html += "<thead>";
  html += '<tr style="background-color: #2a5298;">';
  html += `<th class="sortable" onclick="sortBlackMarketData('itemName')">Item Name ${getSortIcon("itemName")}</th>`;
  html += `<th class="sortable" onclick="sortBlackMarketData('tier')">Tier ${getSortIcon("tier")}</th>`;
  html += "<th>Enhancement</th>";
  html += "<th>Quality</th>";
  html += `<th class="sortable" onclick="sortBlackMarketData('caerleonPrice')">Caerleon Buy Price ${getSortIcon("caerleonPrice")}</th>`;
  html += `<th class="sortable" onclick="sortBlackMarketData('bmBuyPrice')">Black Market Sell ${getSortIcon("bmBuyPrice")}</th>`;
  html += `<th class="sortable" onclick="sortBlackMarketData('grossProfit')">Gross Profit ${getSortIcon("grossProfit")}</th>`;
  html += `<th class="sortable" onclick="sortBlackMarketData('roi')">ROI % ${getSortIcon("roi")}</th>`;
  html += "<th>Last Updated</th>";
  html += "</tr>";
  html += "</thead>";
  html += "<tbody>";

  filtered.forEach((item) => {
    const qualityNames = [
      "",
      "Normal",
      "Good",
      "Outstanding",
      "Excellent",
      "Masterpiece",
    ];
    const roiClass =
      item.roi >= 50 ? "roi-high" : item.roi >= 20 ? "roi-medium" : "roi-low";
    const timeStr = formatLastUpdateCell(item.timestamp);
    const enchantmentBadge =
      item.enchantment === 0
        ? ""
        : `<span class="enhancement-level">@${item.enchantment}</span>`;

    const tier = getTierFromItemId(item.itemId);
    const tierBadgeClass = `tier-${tier}`;
    const tierNames = { 4: "T4", 5: "T5", 6: "T6", 7: "T7", 8: "T8" };
    const tierDisplay = tierNames[tier] || `T${tier}`;

    html += `
            <tr class="profitable">
                <td><strong>${item.itemName}</strong></td>
                <td><span class="tier-badge ${tierBadgeClass}">${tierDisplay}</span></td>
                <td class="col-enhancement">${enchantmentBadge || '<span class="text-muted">.0</span>'}</td>
                <td><span class="badge bg-info">${qualityNames[item.quality] || "Unknown"}</span></td>
                <td class="price-col">${item.caerleonPrice.toLocaleString()}</td>
                <td class="price-col">${item.bmBuyPrice.toLocaleString()}</td>
                <td class="profit-positive"><strong>+${item.grossProfit.toLocaleString()}</strong></td>
                <td class="roi-value ${roiClass}"><strong>${item.roi.toFixed(2)}%</strong></td>
                <td>${timeStr}</td>
            </tr>
        `;
  });

  html += "</tbody></table></div>";
  html += `<div class="alert alert-info mt-3">📊 Showing ${filtered.length} of ${bmFlipData.length} total opportunities | Min ROI: ${minRoi}%</div>`;

  container.innerHTML = html;
}

// Event listeners
window.addEventListener("load", async () => {
  console.log("Albion Market Profit Suite loaded");
  console.log("Initializing...");

  initializeThemeMode();

  const initialServer = DB.getActiveServer();
  initializeServerContext(initialServer);

  document.getElementById("themeToggle")?.addEventListener("click", () => {
    const current = document.body.getAttribute("data-theme") || "dark";
    applyThemeMode(current === "dark" ? "light" : "dark");
  });

  document
    .getElementById("serverSelect")
    ?.addEventListener("change", function () {
      initializeServerContext(this.value);
      loadCachedStateForActiveServer();
      inspectCityData();
    });

  // Load equipment items on page load
  await loadEquipmentItems();

  // Load item names on page load
  await loadItemNames();

  // Setup global filter event listeners (for Profit Results tab)
  document
    .getElementById("categorySelect")
    .addEventListener("change", displayResults);
  document
    .getElementById("tierSelect")
    .addEventListener("change", displayResults);
  document
    .getElementById("citySelect")
    .addEventListener("change", displayResults);
  document
    .getElementById("roiFilter")
    .addEventListener("change", displayResults);
  document
    .getElementById("statusFilter")
    .addEventListener("change", displayResults);

  // Setup city refresh button listeners (using data-city attribute)
  document.querySelectorAll(".refreshCityBtn").forEach((btn) => {
    btn.addEventListener("click", function () {
      const city = this.getAttribute("data-city");
      if (city) {
        refreshCityData(city);
      }
    });
  });

  // Setup export button listener
  document.getElementById("exportBtn").addEventListener("click", exportToCSV);

  // Setup Black Market button listeners
  document
    .getElementById("scanBlackMarketBtn")
    .addEventListener("click", fetchBlackMarketPrices);
  document
    .getElementById("bmTierSelect")
    .addEventListener("change", displayBlackMarketFlips);
  document
    .getElementById("bmEnchantmentSelect")
    .addEventListener("change", displayBlackMarketFlips);
  document
    .getElementById("bmQualitySelect")
    .addEventListener("change", displayBlackMarketFlips);
  document
    .getElementById("bmMinRoiFilter")
    .addEventListener("change", displayBlackMarketFlips);
  document
    .getElementById("bmMaxResults")
    .addEventListener("change", displayBlackMarketFlips);

  // Setup auto-refresh for Black Market
  let bmAutoRefreshInterval = null;
  document
    .getElementById("autoRefreshBMBtn")
    .addEventListener("click", function () {
      if (bmAutoRefreshInterval) {
        clearInterval(bmAutoRefreshInterval);
        bmAutoRefreshInterval = null;
        this.textContent = "🔄 Auto Refresh (30s)";
        this.classList.remove("btn-danger");
        this.classList.add("btn-info");
      } else {
        this.textContent = "⏸ Stop Auto Refresh";
        this.classList.remove("btn-info");
        this.classList.add("btn-danger");
        fetchBlackMarketPrices();
        bmAutoRefreshInterval = setInterval(fetchBlackMarketPrices, 30000);
      }
    });

  // Setup inspect city dropdown listener
  document
    .getElementById("inspectCity")
    .addEventListener("change", inspectCityData);

  // Setup inspect search box listener (real-time filtering)
  const inspectSearch = document.getElementById("inspectSearch");
  if (inspectSearch) {
    inspectSearch.addEventListener("keyup", inspectCityData);
  }

  initializeMultiSelectFilters();

  // Load all cached data for the active server across every tab.
  loadCachedStateForActiveServer();

  updateCurrentTimeNow();

  console.log("Ready for data fetch - click a city button to start");
});

// Update minutes ago display every minute
setInterval(updateMinutesAgo, 60000);
setInterval(updateCurrentTimeNow, 1000);

// Fetch data for a single city
async function fetchCityData(city) {
  const loadingId = city.toLowerCase().replace(" ", "");
  const container = document.getElementById(`${loadingId}-container`);

  if (!container) return;

  container.innerHTML =
    '<div class="text-center"><div class="spinner-border text-primary" role="status"></div><p>Loading...</p></div>';

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

    const priceData = await fetchPricesForItemsWithProgress(
      itemIds,
      city,
      (current, total) => {
        const percent = Math.round((current / total) * 100);
        container.innerHTML = `<div class="text-center"><div class="spinner-border text-primary" role="status"></div><p>Loading ${city}... ${percent}%</p></div>`;
      },
    );

    allPriceData[city] = {};
    priceData.forEach((item) => {
      const normalized = normalizeMarketEntry(item);
      if (!normalized) return;
      const itemId = normalized.item_id;
      allPriceData[city][itemId] = mergeBestMarketEntry(
        allPriceData[city][itemId],
        normalized,
      );
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
    weapon: "⚔️ Weapon",
    helmet: "🎖️ Helmet",
    armor: "🛡️ Armor",
    shoes: "👢 Shoes",
    cape: "🧥 Cape",
    offhand: "📖 Off-hand",
  };
  return `<span class="category-badge cat-${category || "unknown"}">${categoryMap[category] || category}</span>`;
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

    let statusClass = "data-fresh";
    let statusText = "";

    if (diffHours > 24) {
      statusClass = "data-old";
      statusText = `⚠️ ${Math.floor(diffHours / 24)}d old`;
    } else if (diffHours > 1) {
      statusClass = "data-old";
      statusText = `${Math.floor(diffHours)}h old`;
    } else {
      statusClass = "data-fresh";
      statusText = "✅ Fresh";
    }

    return `<span class="data-timestamp ${statusClass}">${statusText}</span>`;
  } catch (e) {
    return '<span class="data-timestamp data-missing">❌ Error</span>';
  }
}

// Helper function to get filter value for a city
function getCityFilterValue(city, filterType) {
  const cityId = city.toLowerCase().replace(" ", "");
  const filterId = `${cityId}-${filterType}`;
  const element = document.getElementById(filterId);
  return element ? element.value : "";
}

// Helper function to format price with status highlighting
function formatPriceWithStatus(price, priceInfo) {
  if (!priceInfo) return '<span style="color: red;">❌</span>';
  if (!price || price === 0) return '<span style="color: red;">❌</span>';

  const isOutdated = isDataOutdated(priceInfo);
  const color = isOutdated ? "orange" : "inherit";

  return `<span style="color: ${color};">${price.toLocaleString()}</span>`;
}

// Render data for a single city with enhancement levels
function renderCityData(city) {
  const loadingId = city.toLowerCase().replace(" ", "");
  const container = document.getElementById(`${loadingId}-container`);
  if (!container) return;

  // Get city-specific filters
  const selectedCategory = getCityFilterValue(city, "category");
  const selectedTier = getCityFilterValue(city, "tier");

  const cityData = allPriceData[city] || {};

  let items = allEquipmentItems.map((itemId) => {
    return {
      itemId,
      itemName: getItemName(itemId),
      category: getCategoryFromItemId(itemId),
      tier: getTierFromItemId(itemId),
    };
  });

  items = items.filter((item) => {
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
                        <option value="" ${selectedTier === "" ? "selected" : ""}>All Tiers (4-7)</option>
                        <option value="4" ${selectedTier === "4" ? "selected" : ""}>Tier 4 (Adept) 🔵</option>
                        <option value="5" ${selectedTier === "5" ? "selected" : ""}>Tier 5 (Expert) 🔴</option>
                        <option value="6" ${selectedTier === "6" ? "selected" : ""}>Tier 6 (Master) 🟠</option>
                        <option value="7" ${selectedTier === "7" ? "selected" : ""}>Tier 7 (Grandmaster) 🟡</option>
                    </select>
                </div>
                <div class="col-md-4">
                    <label for="${loadingId}-category" class="form-label">Filter by Category:</label>
                    <select id="${loadingId}-category" class="form-select" onchange="renderCityData('${city}')">
                        <option value="" ${selectedCategory === "" ? "selected" : ""}>All Categories</option>
                        <option value="weapon" ${selectedCategory === "weapon" ? "selected" : ""}>⚔️ Weapons</option>
                        <option value="helmet" ${selectedCategory === "helmet" ? "selected" : ""}>🎖️ Helmets</option>
                        <option value="armor" ${selectedCategory === "armor" ? "selected" : ""}>🛡️ Armor</option>
                        <option value="shoes" ${selectedCategory === "shoes" ? "selected" : ""}>👢 Shoes</option>
                        <option value="cape" ${selectedCategory === "cape" ? "selected" : ""}>🧥 Capes</option>
                        <option value="offhand" ${selectedCategory === "offhand" ? "selected" : ""}>📖 Off-hands</option>
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

  items.forEach((item) => {
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
      price4?.sell_price_min_date,
    );

    const basePriceVal = basePrice?.sell_price_min || 0;

    html += `
            <tr>
                <td><strong>${item.itemName}</strong></td>
                <td style="text-align: center;">${getTierBadge(item.tier)}</td>
                <td style="text-align: center;">${getCategoryBadge(item.category)}</td>
                <td class="price-col">${formatPriceWithStatus(basePriceVal, basePrice)}${basePrice ? getTimestampWithStatus(basePrice) : ""}</td>
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
    <div class="mb-2"><strong>Active Server:</strong> ${getActiveServerLabel()} (${stats.activeServer})</div>
        <div class="row">
      <div class="col-md-2">
                <div class="stats-box">
                    <strong>${stats.citiesFetched}</strong><br>
                    <small>Cities Cached</small>
                </div>
            </div>
      <div class="col-md-2">
                <div class="stats-box">
                    <strong>${stats.totalItemsStored.toLocaleString()}</strong><br>
                    <small>Items Stored</small>
                </div>
            </div>
      <div class="col-md-2">
                <div class="stats-box">
                    <strong>${stats.materialCitiesCached}</strong><br>
          <small>Enh. Materials</small>
                </div>
            </div>
      <div class="col-md-2">
        <div class="stats-box">
          <strong>${stats.blackMarketRowsCached.toLocaleString()}</strong><br>
          <small>BM Rows</small>
        </div>
      </div>
      <div class="col-md-2">
        <div class="stats-box">
          <strong>${stats.craftingRowsCached.toLocaleString()}</strong><br>
          <small>Craft Rows</small>
        </div>
      </div>
      <div class="col-md-2">
                <div class="stats-box">
                    <strong>${(stats.storageSize / 1024).toFixed(2)} KB</strong><br>
                    <small>Storage Used</small>
                </div>
            </div>
        </div>
    <div class="small text-muted mt-2">
      Weapon rows: ${stats.weaponRowsCached.toLocaleString()} | Material table cache: ${stats.hasMaterialTableCache ? "Yes" : "No"}
    </div>
    `;
  const dbStatsContainer = document.getElementById("dbStatsContent");
  if (dbStatsContainer) {
    dbStatsContainer.innerHTML = statsHtml;
  }
}

// Update cached cities list
function updateCachedCitiesList() {
  const cities = DB.getCitiesFetched();
  const container = document.getElementById("cachedCitiesList");
  if (!container) return;

  if (cities.length === 0) {
    container.innerHTML =
      '<p class="text-muted">No cities cached yet. Click a city button to fetch data.</p>';
    return;
  }

  let html = '<div class="row">';
  cities.forEach((city) => {
    const cityData = DB.getEquipmentPrices(city);
    const itemCount = Object.keys(cityData).length;
    const badge = itemCount > 0 ? "✅" : "⚠️";
    html += `
            <div class="col-md-4 mb-2">
                <div class="filter-section">
                    <h6>${badge} ${city}</h6>
                    <small>${itemCount.toLocaleString()} items cached</small>
                </div>
            </div>
        `;
  });
  html += "</div>";
  container.innerHTML = html;
}

// Inspect city data
function inspectCityData() {
  const city = document.getElementById("inspectCity").value;
  const searchTerm = (
    document.getElementById("inspectSearch")?.value || ""
  ).toLowerCase();
  const inspector = document.getElementById("cityDataInspector");

  if (!city) {
    inspector.innerHTML = "";
    return;
  }

  let cityData = {};
  let dataSource = city;

  // Handle special locations - group by item_id with all qualities in same row
  let groupedData = {}; // { item_id: { qualities: {1: {price, date}, 2: {...}, ...} } }

  if (city === "Caerleon" || city === "BlackMarket") {
    // These come from the raw Black Market scan data
    if (city === "Caerleon") {
      if (Object.keys(bmRawCaerleonData).length === 0) {
        inspector.innerHTML = `<p class="text-warning">⚠️ No Caerleon data cached yet. Click "Scan Black Market Flips" first to fetch Caerleon prices.</p>`;
        return;
      }
      // Group by item_id
      Object.values(bmRawCaerleonData).forEach((item) => {
        if (!groupedData[item.item_id]) {
          groupedData[item.item_id] = { qualities: {} };
        }
        groupedData[item.item_id].qualities[item.quality] = {
          price: item.sell_price_min || 0,
          date: item.sell_price_min_date,
        };
      });
    } else if (city === "BlackMarket") {
      if (Object.keys(bmRawBlackMarketData).length === 0) {
        inspector.innerHTML = `<p class="text-warning">⚠️ No Black Market data cached yet. Click "Scan Black Market Flips" first.</p>`;
        return;
      }
      // Group by item_id
      Object.values(bmRawBlackMarketData).forEach((item) => {
        if (!groupedData[item.item_id]) {
          groupedData[item.item_id] = { qualities: {} };
        }
        groupedData[item.item_id].qualities[item.quality] = {
          price: item.buy_price_max || 0,
          date: item.buy_price_max_date,
        };
      });
    }
  } else {
    // Regular equipment price data - need to group by base item
    const rawData = DB.getEquipmentPrices(city);
    Object.entries(rawData).forEach(([itemId, item]) => {
      if (!groupedData[itemId]) {
        groupedData[itemId] = { qualities: {} };
      }
      const quality = item.quality || 1;
      groupedData[itemId].qualities[quality] = {
        price: item.sell_price_min || item.buy_price_max || 0,
        date: item.sell_price_min_date,
      };
    });
  }

  if (Object.keys(groupedData).length === 0) {
    inspector.innerHTML = `<p class="text-warning">No data cached for ${city}</p>`;
    return;
  }

  // Filter by search term
  let items = Object.keys(groupedData);
  if (searchTerm) {
    items = items.filter((itemId) => {
      const itemName = itemNameMap[itemId] || itemId;
      return (
        itemId.toLowerCase().includes(searchTerm) ||
        itemName.toLowerCase().includes(searchTerm)
      );
    });
  }

  const totalItems = Object.keys(groupedData).length;
  const filteredItems = items;

  // Show scrollable table with all qualities in one row
  let html = `<div class="mb-2">
        <strong>📊 ${city} Data</strong> 
        <span class="text-muted">(showing ${filteredItems.length} of ${totalItems} items)</span>
    </div>`;

  if (searchTerm) {
    html += `<div class="alert alert-info alert-sm p-2"><small>🔍 Searching for: <strong>${searchTerm}</strong></small></div>`;
  }

  html +=
    '<div class="table-responsive" style="max-height: 600px; overflow-y: auto;"><table class="table table-sm table-dark mb-0" style="font-size: 0.85rem;"><thead style="position: sticky; top: 0; background-color: #2a5298; z-index: 10;"><tr><th style="min-width: 150px;">Item ID / Name</th><th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th><th>Q5</th><th>Last Update</th></tr></thead><tbody>';

  // Show items grouped by item_id with all qualities in same row
  filteredItems.forEach((itemId) => {
    const itemData = groupedData[itemId];
    const itemName = itemNameMap[itemId] || "Unknown";

    // Get most recent update time across all qualities
    let latestDate = null;
    Object.values(itemData.qualities).forEach((q) => {
      if (q.date) {
        const qDate = formatUTCToLocal(q.date);
        if (!latestDate || qDate > latestDate) {
          latestDate = qDate;
        }
      }
    });
    const dateStr = latestDate
      ? latestDate.toLocaleString("en-US", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
      : "Unknown";

    html += `<tr>
            <td><span class="text-info">${itemId}</span><br><small class="text-muted">${itemName}</small></td>`;

    // Show price for each quality (Q1-Q5)
    for (let q = 1; q <= 5; q++) {
      const qualityData = itemData.qualities[q];
      if (qualityData) {
        const price = qualityData.price;
        const priceClass = price > 0 ? "text-success" : "text-muted";
        const priceDisplay = price > 0 ? price.toLocaleString() : "-";
        html += `<td class="${priceClass}"><strong>${priceDisplay}</strong></td>`;
      } else {
        html += `<td class="text-muted">-</td>`;
      }
    }

    html += `<td><small>${dateStr}</small></td>`;
    html += `</tr>`;
  });

  html += "</tbody></table></div>";

  if (filteredItems.length === 0) {
    html += '<p class="text-warning mt-3">❌ No items match your search</p>';
  }

  inspector.innerHTML = html;
}

// Clear search box
function clearInspectSearch() {
  const searchBox = document.getElementById("inspectSearch");
  if (searchBox) {
    searchBox.value = "";
    inspectCityData(); // Refresh with cleared search
  }
}

// Update material prices inspector
function updateMaterialPricesInspector() {
  const materialPrices = DB.getAllMaterialPrices();
  const inspector = document.getElementById("materialPricesInspector");

  if (!inspector) return;

  if (Object.keys(materialPrices).length === 0) {
    inspector.innerHTML =
      '<p class="text-muted">No material prices cached yet</p>';
    return;
  }

  let html =
    '<div class="table-responsive"><table class="table table-sm table-dark"><thead><tr><th>City</th><th>Material</th><th>T4</th><th>T5</th><th>T6</th><th>T7</th></tr></thead><tbody>';

  CONFIG.CITIES.forEach((city) => {
    const cityMaterials = materialPrices[city] || {};
    ["rune", "soul", "relic"].forEach((material) => {
      const prices = cityMaterials[material] || {};
      const displayName = material.charAt(0).toUpperCase() + material.slice(1);
      html += `
                <tr>
                    <td>${city}</td>
                    <td>${displayName}</td>
                    <td><span class="${prices["4"] ? "text-success" : "text-danger"}">${prices["4"] ? prices["4"].toLocaleString() : "No Price"}</span></td>
                    <td><span class="${prices["5"] ? "text-success" : "text-danger"}">${prices["5"] ? prices["5"].toLocaleString() : "No Price"}</span></td>
                    <td><span class="${prices["6"] ? "text-success" : "text-danger"}">${prices["6"] ? prices["6"].toLocaleString() : "No Price"}</span></td>
                    <td><span class="${prices["7"] ? "text-success" : "text-danger"}">${prices["7"] ? prices["7"].toLocaleString() : "No Price"}</span></td>
                </tr>
            `;
    });
  });

  html += "</tbody></table></div>";
  inspector.innerHTML = html;
}

// Clear all database
function clearDatabase() {
  if (
    !confirm(
      "⚠️ Are you sure you want to clear ALL locally cached data? This cannot be undone.",
    )
  ) {
    return;
  }

  DB.clearAll();
  resetRuntimeData();

  updateDbStats();
  updateCachedCitiesList();
  updateMaterialPricesInspector();
  displayResults();
  displayBlackMarketFlips();
  displayCraftingProfits();
  displayWeaponPricesAndRecipes();

  document.getElementById("cityDataInspector").innerHTML = "";

  console.log("✅ Database cleared");
  alert("✅ All local data has been cleared");
}

// ============================================
// CRAFTING PROFIT CALCULATOR
// ============================================

let craftingProfitData = []; // Store profitable crafts
let materialPricesData = {}; // Store material prices from Caerleon
let craftSortColumn = "roi"; // Default sort: roi, profit, cost, revenue
let craftSortDirection = "desc";
let weaponPriceData = []; // Store weapon rows by tier, enchantment, and market quality
let weaponSortColumn = "tier";
let weaponSortDirection = "asc";
const WEAPON_QUALITY_NAMES = [
  "",
  "Normal",
  "Good",
  "Outstanding",
  "Excellent",
  "Masterpiece",
];
const WEAPON_RECIPE_COST_CITIES = [...CONFIG.CITIES];

function initCraftingTab() {
  const payload = DB.getCraftingProfits();
  if (!payload || !Array.isArray(payload.rows)) {
    craftingProfitData = [];
    displayCraftingProfits();
    const info = document.getElementById("craftLastUpdateInfo");
    if (info) info.textContent = "No crafting scan cached yet.";
    return;
  }

  craftingProfitData = payload.rows;
  displayCraftingProfits();

  const info = document.getElementById("craftLastUpdateInfo");
  if (info) {
    const count = craftingProfitData.length.toLocaleString();
    info.textContent = payload.timestamp
      ? `Last scan: ${payload.timestamp} (${count} profitable rows cached)`
      : `${count} profitable rows cached`;
  }
}

// Helper function: Get material ID in Albion format
function getMaterialId(materialType, tier, quality) {
  const tierChar = String(tier);
  const materialMap = {
    METALBAR: `T${tierChar}_METALBAR`,
    PLANKS: `T${tierChar}_PLANKS`,
    LEATHER: `T${tierChar}_LEATHER`,
    CLOTH: `T${tierChar}_CLOTH`,
  };
  const baseId = materialMap[materialType] || materialType;
  // Quality 1 maps to .0, quality 2..5 map to .1..4 refined resource IDs.
  if (quality <= 1) return baseId;
  const enchant = quality - 1;
  return `${baseId}_LEVEL${enchant}@${enchant}`;
}

function getMaterialDisplayName(materialType) {
  const materialNameMap = {
    METALBAR: "Metal Bar",
    PLANKS: "Planks",
    LEATHER: "Leather",
    CLOTH: "Cloth",
  };
  return materialNameMap[materialType] || materialType;
}

// Returns the correct API item ID for a refined resource by tier + enchantment level
// enchant 0 = base (T4_PLANKS), enchant 1 = T4_PLANKS_LEVEL1@1, etc.
function getMaterialIdByEnchant(materialType, tier, enchant) {
  const tierChar = String(tier);
  const baseMap = {
    METALBAR: `T${tierChar}_METALBAR`,
    PLANKS: `T${tierChar}_PLANKS`,
    LEATHER: `T${tierChar}_LEATHER`,
    CLOTH: `T${tierChar}_CLOTH`,
  };
  const baseId = baseMap[materialType] || materialType;
  if (enchant === 0) return baseId;
  return `${baseId}_LEVEL${enchant}@${enchant}`;
}

// Helper function: Get recipe key from item ID
function getRecipeForItem(baseItemId) {
  const equipmentToRecipeMap = globalThis.EQUIPMENT_TO_RECIPE_MAP;
  if (!equipmentToRecipeMap) return null;

  // Check if we have a direct mapping
  if (equipmentToRecipeMap.hasOwnProperty(baseItemId)) {
    return equipmentToRecipeMap[baseItemId];
  }

  // Try without enhancement level
  const withoutEnchant = baseItemId.split("@")[0];
  if (equipmentToRecipeMap.hasOwnProperty(withoutEnchant)) {
    return equipmentToRecipeMap[withoutEnchant];
  }

  return null;
}

function resolveCraftingRecipe(baseItemId, craftingRecipes) {
  const normalizedItemId = ((baseItemId || "").split("@")[0] || "").toUpperCase();
  if (!normalizedItemId || !craftingRecipes) {
    return { recipe: null, source: "missing", recipeKey: null };
  }

  const isWeapon = getCategoryFromItemId(normalizedItemId) === "weapon";
  if (!isWeapon) {
    const recipeKey = getRecipeForItem(normalizedItemId);
    const recipe = recipeKey ? craftingRecipes[recipeKey] || null : null;
    return {
      recipe,
      source: recipe ? "mapped" : "missing",
      recipeKey: recipeKey || null,
    };
  }

  const recipeKey = getRecipeForWeapon(normalizedItemId);
  let recipe = recipeKey ? craftingRecipes[recipeKey] || null : null;
  let source = recipe ? "mapped" : "missing";

  if (!recipe) {
    recipe = inferWeaponRecipe(normalizedItemId);
    if (recipe) {
      source = "inferred";
    }
  }

  const overriddenRecipe = applyWeaponRecipeOverrides(normalizedItemId, recipe);
  if (overriddenRecipe) {
    recipe = overriddenRecipe;
    source = source === "mapped" ? "mapped+override" : "override";
  }

  return {
    recipe: recipe || null,
    source,
    recipeKey: recipeKey || null,
  };
}

function sortCraftingData(column) {
  if (craftSortColumn === column) {
    craftSortDirection = craftSortDirection === "asc" ? "desc" : "asc";
  } else {
    craftSortColumn = column;
    craftSortDirection = column === "itemName" ? "asc" : "desc";
  }
  displayCraftingProfits();
}

async function fetchCraftingProfits() {
  const container = document.getElementById("craftResultsContainer");
  const progressContainer = document.getElementById("craftProgressContainer");
  const progressBar = document.getElementById("craftProgressBar");
  const progressText = document.getElementById("craftProgressText");
  const setCraftProgress = (percent, text) => {
    if (progressBar) {
      progressBar.style.width = `${percent}%`;
      progressBar.textContent = `${Math.round(percent)}%`;
    }
    if (progressText && text) {
      progressText.textContent = text;
    }
  };

  if (!container || !progressContainer || !progressBar) {
    console.error("Crafting profit UI elements not found");
    return;
  }

  progressContainer.style.display = "block";
  container.innerHTML = "";

  try {
    console.log("🔨 Starting crafting profit scan...");

    const equipmentToRecipeMap = globalThis.EQUIPMENT_TO_RECIPE_MAP;
    const craftingRecipes = globalThis.CRAFTING_RECIPES;

    if (!equipmentToRecipeMap || !craftingRecipes) {
      throw new Error(
        "Crafting recipe data is not loaded. Please refresh the page.",
      );
    }

    // Use unique base item IDs only. The map includes @1..@4 keys, which would
    // otherwise create duplicate and invalid request IDs during scan expansion.
    const craftableItemSet = new Set(
      Object.keys(equipmentToRecipeMap).map((itemId) => itemId.split("@")[0]),
    );

    // Include all weapon bases so artifact/missing-map lines can use inferred+override recipes.
    if (!Array.isArray(allEquipmentItems) || allEquipmentItems.length === 0) {
      await loadEquipmentItems();
    }
    allEquipmentItems.forEach((baseId) => {
      const tier = parseInt(getTierFromItemId(baseId) || "0", 10);
      if (getCategoryFromItemId(baseId) === "weapon" && tier >= 4 && tier <= 8) {
        craftableItemSet.add(baseId);
      }
    });

    const resolvedRecipeByBaseId = {};
    craftableItemSet.forEach((baseId) => {
      const resolved = resolveCraftingRecipe(baseId, craftingRecipes);
      if (resolved.recipe) {
        resolvedRecipeByBaseId[baseId] = resolved;
      }
    });

    const craftableItems = Object.keys(resolvedRecipeByBaseId);
    console.log(`📊 Found ${craftableItems.length} craftable item templates`);

    // Expand to include all enchantment levels (.0 - .4)
    const finishedItemIds = [];
    craftableItems.forEach((baseId) => {
      for (let enchantment = 0; enchantment <= 4; enchantment++) {
        finishedItemIds.push(
          enchantment === 0 ? baseId : `${baseId}@${enchantment}`,
        );
      }
    });

    console.log(
      `📊 Total crafting combinations (enhancement × quality): ${finishedItemIds.length * 5}`,
    );

    // Step 1: Fetch material prices from Caerleon
    setCraftProgress(20, "Fetching material prices from Caerleon...");

    const materialTypes = ["METALBAR", "PLANKS", "LEATHER", "CLOTH"];
    const materialIds = [];

    // Generate all material IDs (T4-T8, enchant .0-.4)
    for (let tier = 4; tier <= 8; tier++) {
      materialTypes.forEach((matType) => {
        for (let quality = 1; quality <= 5; quality++) {
          materialIds.push(getMaterialId(matType, tier, quality));
        }
      });
    }

    console.log(`📦 Fetching ${materialIds.length} material prices...`);

    const matPricesUrl = `${getApiBase()}/${materialIds.join(",")}.json?locations=Caerleon&qualities=1`;
    const matResponse = await fetch(matPricesUrl);
    const matPrices = await matResponse.json();

    // Store material prices
    materialPricesData = {};
    matPrices.forEach((mat) => {
      if (mat.city === "Caerleon" && mat.sell_price_min > 0) {
        materialPricesData[mat.item_id] = {
          price: mat.sell_price_min,
          date: mat.sell_price_min_date,
        };
      }
    });

    const artifactIds = Array.from(
      new Set(
        craftableItems
          .filter((baseId) => getCategoryFromItemId(baseId) === "weapon")
          .map((baseId) => getArtifactItemIdForWeapon(baseId))
          .filter(Boolean),
      ),
    );

    if (artifactIds.length > 0) {
      console.log(`💠 Fetching ${artifactIds.length} artifact prices...`);
      const artifactBatchSize = 100;
      for (let i = 0; i < artifactIds.length; i += artifactBatchSize) {
        const batch = artifactIds.slice(i, i + artifactBatchSize);
        const artifactUrl = `${getApiBase()}/${batch.join(",")}.json?locations=Caerleon&qualities=1`;
        const artifactResponse = await fetch(artifactUrl);
        if (!artifactResponse.ok) {
          throw new Error(`Artifact API error ${artifactResponse.status}`);
        }
        const artifactRows = await artifactResponse.json();
        artifactRows.forEach((row) => {
          if (row.city !== "Caerleon") return;
          const price = getNumericValue(row.sell_price_min);
          if (price <= 0) return;
          materialPricesData[row.item_id] = {
            price,
            date: row.sell_price_min_date || null,
          };
        });
      }
    }

    console.log(
      `✅ Loaded ${Object.keys(materialPricesData).length} material prices`,
    );

    // Step 2: Fetch finished item prices from Black Market
    setCraftProgress(50, "Fetching finished item prices from Black Market...");

    console.log(
      `🎯 Fetching ${finishedItemIds.length} finished item IDs across all qualities...`,
    );

    // Batch fetch (max 100 per request)
    const craftProfits = [];
    const batchSize = 100;
    const totalBatches = Math.ceil(finishedItemIds.length / batchSize);

    for (let i = 0; i < finishedItemIds.length; i += batchSize) {
      const batch = finishedItemIds.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;

      setCraftProgress(
        50 + (batchNum / totalBatches) * 40,
        `Fetching batch ${batchNum}/${totalBatches}...`,
      );

      const itemPricesUrl = `${getApiBase()}/${batch.join(",")}.json?locations=BlackMarket&qualities=1,2,3,4,5`;
      const itemResponse = await fetch(itemPricesUrl);
      const itemPrices = await itemResponse.json();

      // Calculate profits for this batch
      itemPrices.forEach((item) => {
        if (
          item.city !== "Black Market" ||
          !item.buy_price_max ||
          item.buy_price_max === 0
        )
          return;

        // Get base item ID and enchantment level from item suffix (@0..@4)
        const baseItemId = item.item_id.split("_LEVEL")[0].split("@")[0];
        const enchantMatch = item.item_id.match(/@(\d+)$/);
        const enchantment = enchantMatch ? parseInt(enchantMatch[1], 10) : 0;
        const marketQuality = parseInt(item.quality || item.Quality || "1", 10) || 1;
        const tier = getTierFromItemId(baseItemId);

        // Get recipe using the same resolver as the weapon tab.
        const resolvedRecipe = resolvedRecipeByBaseId[baseItemId];
        if (!resolvedRecipe || !resolvedRecipe.recipe) return;

        const recipe = resolvedRecipe.recipe;

        // Calculate material cost
        const primaryMatId = getMaterialIdByEnchant(
          recipe.primary,
          tier,
          enchantment,
        );
        const primaryMatPrice = materialPricesData[primaryMatId]?.price || 0;

        let secondaryMatPrice = 0;
        if (recipe.secondary) {
          const secondaryMatId = getMaterialIdByEnchant(
            recipe.secondary,
            tier,
            enchantment,
          );
          secondaryMatPrice = materialPricesData[secondaryMatId]?.price || 0;
        }

        const artifactId =
          getCategoryFromItemId(baseItemId) === "weapon"
            ? getArtifactItemIdForWeapon(baseItemId)
            : null;
        const artifactPrice = artifactId
          ? materialPricesData[artifactId]?.price || 0
          : 0;

        if (primaryMatPrice === 0) return; // Can't craft without primary material
        if (recipe.secondaryQty > 0 && secondaryMatPrice === 0) return; // Ignore crafts with missing secondary material price
        if (artifactId && artifactPrice === 0) return; // Ignore artifact crafts if artifact price is missing

        const totalMaterialCost =
          primaryMatPrice * recipe.primaryQty +
          secondaryMatPrice * recipe.secondaryQty +
          artifactPrice;
        const craftingFee = Math.floor(item.buy_price_max * 0.05); // ~5% crafting fee estimate
        const totalCost = totalMaterialCost + craftingFee;

        // Calculate revenue (BM price after 8% tax)
        const bmSellPrice = item.buy_price_max;
        const netRevenue = bmSellPrice * 0.92; // 8% tax

        const profit = netRevenue - totalCost;
        const roi = totalCost > 0 ? (profit / totalCost) * 100 : 0;

        // Only store profitable crafts
        if (profit > 0) {
          const rowWeaponCategory =
            getCategoryFromItemId(baseItemId) === "weapon"
              ? getWeaponSearchCategory(baseItemId)
              : "";

          craftProfits.push({
            itemId: item.item_id,
            baseItemId: baseItemId,
            itemName: itemNameMap[baseItemId] || baseItemId,
            category: recipe.category,
            weaponCategory: rowWeaponCategory,
            tier: tier,
            enchantment: enchantment,
            marketQuality: marketQuality,
            quality: marketQuality,
            materialCost: totalMaterialCost,
            craftingFee: craftingFee,
            totalCost: totalCost,
            bmSellPrice: bmSellPrice,
            netRevenue: netRevenue,
            profit: profit,
            roi: roi,
            recipe: recipe,
            recipeSource: resolvedRecipe.source,
            recipeKey: resolvedRecipe.recipeKey,
            primaryMatId: primaryMatId,
            primaryMatPrice: primaryMatPrice,
            secondaryMatId: recipe.secondary ? getMaterialIdByEnchant(recipe.secondary, tier, enchantment) : null,
            secondaryMatPrice: secondaryMatPrice,
            artifactId: artifactId,
            artifactPrice: artifactPrice,
            timestamp: item.buy_price_max_date,
          });
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 200)); // Rate limit
    }

    console.log(`✅ Found ${craftProfits.length} profitable crafts`);

    craftingProfitData = craftProfits;
    const scanTimestamp = new Date().toLocaleString();
    DB.saveCraftingProfits({
      timestamp: scanTimestamp,
      rows: craftingProfitData,
    });

    const info = document.getElementById("craftLastUpdateInfo");
    if (info) {
      info.textContent = `Last scan: ${scanTimestamp} (${craftingProfitData.length.toLocaleString()} profitable rows cached)`;
    }

    setCraftProgress(100, "Scan complete");

    progressContainer.style.display = "none";
    displayCraftingProfits();
  } catch (error) {
    console.error("❌ Error fetching crafting profits:", error);
    progressContainer.style.display = "none";
    container.innerHTML =
      '<div class="alert alert-danger">Failed to fetch crafting data. Check console for details.</div>';
  }
}

function displayCraftingProfits() {
  const container = document.getElementById("craftResultsContainer");
  const emptyState = document.getElementById("craftEmptyState");
  const getCraftEnchantment = (item) => {
    const directEnchant = Number(item.enchantment);
    if (Number.isFinite(directEnchant) && directEnchant >= 0) {
      return Math.floor(directEnchant);
    }
    const itemIdEnchant = /@(\d+)$/.exec(item.itemId || item.baseItemId || "");
    if (itemIdEnchant) return parseInt(itemIdEnchant[1], 10) || 0;
    return 0;
  };
  const getCraftQuality = (item) => {
    const marketQuality = Number(item.marketQuality);
    if (Number.isFinite(marketQuality) && marketQuality >= 1 && marketQuality <= 5) {
      return Math.floor(marketQuality);
    }
    const legacyQuality = Number(item.quality);
    if (Number.isFinite(legacyQuality) && legacyQuality >= 1 && legacyQuality <= 5) {
      return legacyQuality;
    }
    return 1;
  };

  if (!container) return;

  if (craftingProfitData.length === 0) {
    container.innerHTML = "";
    if (emptyState) emptyState.style.display = "block";
    return;
  }

  if (emptyState) emptyState.style.display = "none";

  // Get filters
  const tierFilters = getSelectedFilterValues("craftTierFilter");
  const enchantFilters = getSelectedFilterValues("craftEnchantFilter")
    .map((value) => parseInt(value, 10))
    .filter(Number.isFinite);
  const qualityFilters = getSelectedFilterValues("craftQualityFilter")
    .map((value) => parseInt(value, 10))
    .filter(Number.isFinite);
  const weaponCategoryFilters = getSelectedFilterValues(
    "craftWeaponCategoryFilter",
  );
  const searchFilter =
    (document.getElementById("craftSearchFilter")?.value || "")
      .toLowerCase()
      .trim();
  const minRoi = parseFloat(document.getElementById("craftMinROI")?.value || 0);
  const maxResults = parseInt(
    document.getElementById("craftMaxResults")?.value || 100,
  );

  // Apply filters
  let filtered = craftingProfitData.filter((item) => {
    const enchantment = getCraftEnchantment(item);
    const marketQuality = getCraftQuality(item);
    const itemId = item.baseItemId || item.itemId || "";
    const itemWeaponCategory =
      item.weaponCategory ||
      (getCategoryFromItemId(itemId) === "weapon"
        ? getWeaponSearchCategory(itemId)
        : "");
    if (item.roi < minRoi) return false;
    if (tierFilters.length && !tierFilters.includes(item.tier.toString()))
      return false;
    if (enchantFilters.length && !enchantFilters.includes(enchantment))
      return false;
    if (qualityFilters.length && !qualityFilters.includes(marketQuality))
      return false;
    if (
      weaponCategoryFilters.length &&
      !weaponCategoryFilters.includes(itemWeaponCategory)
    )
      return false;
    if (searchFilter) {
      const text = `${item.itemName || ""} ${item.itemId || ""} ${item.baseItemId || ""} ${item.category || ""} ${itemWeaponCategory}`
        .toLowerCase()
        .trim();
      if (!text.includes(searchFilter)) return false;
    }
    return true;
  });

  // Apply sorting
  filtered.sort((a, b) => {
    let aVal, bVal;

    switch (craftSortColumn) {
      case "itemName":
        aVal = a.itemName.toLowerCase();
        bVal = b.itemName.toLowerCase();
        break;
      case "tier":
        aVal = parseInt(a.tier);
        bVal = parseInt(b.tier);
        break;
      case "cost":
        aVal = a.totalCost;
        bVal = b.totalCost;
        break;
      case "revenue":
        aVal = a.netRevenue;
        bVal = b.netRevenue;
        break;
      case "profit":
        aVal = a.profit;
        bVal = b.profit;
        break;
      case "roi":
      default:
        aVal = a.roi;
        bVal = b.roi;
        break;
    }

    if (typeof aVal === "string") {
      return craftSortDirection === "asc"
        ? aVal.localeCompare(bVal)
        : bVal.localeCompare(aVal);
    } else {
      return craftSortDirection === "asc" ? aVal - bVal : bVal - aVal;
    }
  });

  filtered = filtered.slice(0, maxResults);

  // Build table
  const getSortIcon = (column) => {
    if (craftSortColumn !== column) return '<span class="sort-arrows">⇅</span>';
    return craftSortDirection === "asc"
      ? '<span class="sort-arrow">▲</span>'
      : '<span class="sort-arrow">▼</span>';
  };

  let html =
    '<div class="table-responsive mt-4"><table class="table table-dark table-hover">';
  html += '<thead><tr style="background-color: #2a5298;">';
  html += `<th class="sortable" onclick="sortCraftingData('itemName')">Item Name ${getSortIcon("itemName")}</th>`;
  html += `<th class="sortable" onclick="sortCraftingData('tier')">Tier ${getSortIcon("tier")}</th>`;
  html += "<th>Enhancement</th>";
  html += "<th>Quality</th>";
  html += "<th>Recipe</th>";
  html += `<th class="sortable" onclick="sortCraftingData('cost')">Total Cost ${getSortIcon("cost")}</th>`;
  html += `<th class="sortable" onclick="sortCraftingData('revenue')">BM Buy Price ${getSortIcon("revenue")}</th>`;
  html += `<th class="sortable" onclick="sortCraftingData('profit')">Net Profit ${getSortIcon("profit")}</th>`;
  html += `<th class="sortable" onclick="sortCraftingData('roi')">ROI % ${getSortIcon("roi")}</th>`;
  html += "<th>Last Update</th>";
  html += "</tr></thead><tbody>";

  const qualityNames = [
    "",
    "Normal",
    "Good",
    "Outstanding",
    "Excellent",
    "Masterpiece",
  ];

  filtered.forEach((item) => {
    const enchantment = getCraftEnchantment(item);
    const marketQuality = getCraftQuality(item);
    const tierBadgeClass = `tier-${item.tier}`;
    const tierDisplay = `T${item.tier}`;
    const roiClass =
      item.roi >= 50 ? "roi-high" : item.roi >= 20 ? "roi-medium" : "roi-low";

    // Build recipe display with prices
    const recipe = item.recipe;
    let recipeText = "Unknown";
    if (recipe) {
      const primaryCost = item.primaryMatPrice * recipe.primaryQty;
      const secondaryCost = item.secondaryMatPrice * recipe.secondaryQty;
      const primaryName = getMaterialDisplayName(recipe.primary);
      const secondaryName = getMaterialDisplayName(recipe.secondary);
      const primaryMatId =
        item.primaryMatId ||
        getMaterialIdByEnchant(recipe.primary, item.tier, enchantment);
      const secondaryMatId =
        item.secondaryMatId ||
        (recipe.secondary
          ? getMaterialIdByEnchant(recipe.secondary, item.tier, enchantment)
          : null);

      const formatMatTierEnchant = (matId) => {
        const tierMatch = /^T(\d)_/.exec(matId || "");
        const enchantMatch = /@(\d+)/.exec(matId || "");
        const matTier = tierMatch ? tierMatch[1] : item.tier;
        const matEnchant = enchantMatch ? enchantMatch[1] : "0";
        return `T${matTier}.${matEnchant}`;
      };

      recipeText = `${recipe.primaryQty}× ${primaryName} (${formatMatTierEnchant(primaryMatId)}) @ ${item.primaryMatPrice.toLocaleString()} = ${primaryCost.toLocaleString()}`;
      if (recipe.secondaryQty > 0 && item.secondaryMatPrice > 0) {
        recipeText += `<br>${recipe.secondaryQty}× ${secondaryName} (${formatMatTierEnchant(secondaryMatId)}) @ ${item.secondaryMatPrice.toLocaleString()} = ${secondaryCost.toLocaleString()}`;
      }
      if (item.artifactId && item.artifactPrice > 0) {
        recipeText += `<br>1× ${getItemName(item.artifactId)} @ ${item.artifactPrice.toLocaleString()} = ${item.artifactPrice.toLocaleString()}`;
      }
    }

    // Format timestamp
    let timestampText = "";
    if (item.timestamp) {
      const date = new Date(item.timestamp);
      timestampText = date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    }

    html += `<tr class="profitable">
            <td><strong>${item.itemName}</strong><br><small class="text-muted">${item.category}</small></td>
            <td><span class="tier-badge ${tierBadgeClass}">${tierDisplay}</span></td>
            <td><span class="badge bg-secondary">.${enchantment}</span></td>
            <td><span class="badge bg-info">${qualityNames[marketQuality]} (Q${marketQuality})</span></td>
            <td><small>${recipeText}</small></td>
            <td class="price-col">${item.totalCost.toLocaleString()}<br><small class="text-muted">Mat: ${item.materialCost.toLocaleString()} + Fee: ${item.craftingFee.toLocaleString()}</small></td>
            <td class="price-col">${item.bmSellPrice.toLocaleString()}<br><small class="text-muted">After Tax: ${item.netRevenue.toLocaleString()}</small></td>
            <td class="profit-positive"><strong>+${item.profit.toLocaleString()}</strong></td>
            <td class="roi-value ${roiClass}"><strong>${item.roi.toFixed(2)}%</strong></td>
            <td><small>${timestampText || "-"}</small></td>
        </tr>`;
  });

  html += "</tbody></table></div>";
  html += `<div class="alert alert-info mt-3">🔨 Showing ${filtered.length} of ${craftingProfitData.length} total profitable crafts | Min ROI: ${minRoi}%</div>`;

  container.innerHTML = html;
}

// ===== WEAPON PRICES & RECIPES TAB =====

function isArtifactWeapon(itemId) {
  return /_(AVALON|CRYSTAL|HELL|KEEPER|MORGANA|UNDEAD)$/.test(itemId || "");
}

function getArtifactItemIdForWeapon(baseItemId) {
  if (!isArtifactWeapon(baseItemId)) return null;
  const noEnchant = (baseItemId || "").split("@")[0];
  const firstUnderscore = noEnchant.indexOf("_");
  if (firstUnderscore <= 0) return null;
  const tierPrefix = noEnchant.slice(0, firstUnderscore); // e.g. T4
  const rest = noEnchant.slice(firstUnderscore + 1); // e.g. 2H_FIRESTAFF_HELL
  return `${tierPrefix}_ARTEFACT_${rest}`;
}

function getRecipeForWeapon(baseItemId) {
  const noEnchant = (baseItemId || "").split("@")[0];

  // 1) direct map
  let recipeKey = getRecipeForItem(noEnchant);
  if (recipeKey) return recipeKey;

  // 2) strip known suffixes (artifact/crystal variants)
  const artifactSuffixes = new Set([
    "AVALON",
    "CRYSTAL",
    "HELL",
    "KEEPER",
    "MORGANA",
    "UNDEAD",
  ]);
  const parts = noEnchant.split("_");
  if (parts.length > 3) {
    const last = parts[parts.length - 1];
    if (artifactSuffixes.has(last)) {
      recipeKey = getRecipeForItem(parts.slice(0, -1).join("_"));
      if (recipeKey) return recipeKey;
    }

    // 3) normalize SET2/SET3 to SET1 if needed
    if (/^SET\d+$/.test(last)) {
      recipeKey = getRecipeForItem([...parts.slice(0, -1), "SET1"].join("_"));
      if (recipeKey) return recipeKey;
      recipeKey = getRecipeForItem(parts.slice(0, -1).join("_"));
      if (recipeKey) return recipeKey;
    }
  }

  return null;
}

function inferWeaponRecipe(baseItemId) {
  const noEnchant = (baseItemId || "").split("@")[0];
  const isTwoHanded = noEnchant.includes("_2H_");

  const swordQty = {
    oneHand: { primary: 16, secondary: 8 },
    twoHand: { primary: 20, secondary: 12 },
  };

  const qty = {
    oneHand: { primary: 8, secondary: 4 },
    twoHand: { primary: 16, secondary: 8 },
  };

  const blendQty = {
    oneHand: { primary: 8, secondary: 2 },
    twoHand: { primary: 16, secondary: 4 },
  };

  const pick = isTwoHanded ? qty.twoHand : qty.oneHand;
  const pickBlend = isTwoHanded ? blendQty.twoHand : blendQty.oneHand;
  const pickSword = isTwoHanded ? swordQty.twoHand : swordQty.oneHand;

  // War gloves
  if (/_KNUCKLES/.test(noEnchant)) {
    return {
      category: "Melee",
      primary: "METALBAR",
      secondary: "LEATHER",
      primaryQty: 12,
      secondaryQty: 20,
      craftingFee: 0.05,
      inferred: true,
    };
  }

  // Quarterstaff branches
  if (
    /(QUARTERSTAFF|COMBATSTAFF|DOUBLEBLADEDSTAFF|SOULSCYTHE|BLACKMONK|GRAILSEEKER|IRONCLADEDSTAFF)/.test(
      noEnchant,
    )
  ) {
    return {
      category: "Melee",
      primary: "METALBAR",
      secondary: "LEATHER",
      primaryQty: 12,
      secondaryQty: 20,
      craftingFee: 0.05,
      inferred: true,
    };
  }

  // Magical staffs and related magical 2H weapons
  if (
    /(NATURESTAFF|HOLYSTAFF|FIRESTAFF|FROSTSTAFF|CURSEDSTAFF|ARCANESTAFF|DIVINESTAFF|DEMONICSTAFF|WITCHWORKSTAFF|LIFETOUCHSTAFF|LIFECURSESTAFF|WILDSTAFF|INFERNALSTAFF|ENIGMATICSTAFF|BRIMSTONE|PERMAFROST|DAWNSONG|EVENSONG|REDEMPTION|FALLENSTAFF|BLIGHTSTAFF|IRONROOTSTAFF|SHAPESHIFTER|ORB)/.test(
      noEnchant,
    )
  ) {
    const isOneHand = /_MAIN_/.test(noEnchant);
    return {
      category: "Magic",
      primary: "PLANKS",
      secondary: "METALBAR",
      primaryQty: isOneHand ? 16 : 20,
      secondaryQty: isOneHand ? 8 : 12,
      craftingFee: 0.05,
      inferred: true,
    };
  }

  // Ranged bows/crossbows
  if (/(BOW|CROSSBOW|REPEATER|BOLTCASTER|SIEGEBOW)/.test(noEnchant)) {
    return {
      category: "Ranged",
      primary: "PLANKS",
      secondary: "METALBAR",
      primaryQty: pick.primary,
      secondaryQty: pick.secondary,
      craftingFee: 0.05,
      inferred: true,
    };
  }

  // Blunt weapons
  if (/(MACE|HAMMER|FLAIL)/.test(noEnchant)) {
    return {
      category: "Melee",
      primary: "METALBAR",
      secondary: "CLOTH",
      primaryQty: isTwoHanded ? 20 : 16,
      secondaryQty: isTwoHanded ? 12 : 8,
      craftingFee: 0.05,
      inferred: true,
    };
  }

  // Sword line
  if (/(SWORD|SCIMITAR|CLAYMORE|CLEAVER)/.test(noEnchant)) {
    return {
      category: "Melee",
      primary: "METALBAR",
      secondary: "LEATHER",
      primaryQty: pickSword.primary,
      secondaryQty: pickSword.secondary,
      craftingFee: 0.05,
      inferred: true,
    };
  }

  // Bladed / piercing lines
  if (
    /(SWORD|AXE|DAGGER|SCIMITAR|CLEAVER|SICKLE|CLAW|KATAR|SPEAR|HARPOON)/.test(
      noEnchant,
    )
  ) {
    return {
      category: "Melee",
      primary: "METALBAR",
      secondary: "LEATHER",
      primaryQty: pickBlend.primary,
      secondaryQty: pickBlend.secondary,
      craftingFee: 0.05,
      inferred: true,
    };
  }

  return {
    category: "Melee",
    primary: "METALBAR",
    secondary: isTwoHanded ? "PLANKS" : "LEATHER",
    primaryQty: isTwoHanded ? 16 : 8,
    secondaryQty: isTwoHanded ? 8 : 2,
    craftingFee: 0.05,
    inferred: true,
  };
}

function applyWeaponRecipeOverrides(baseItemId, recipe) {
  const id = ((baseItemId || "").split("@")[0] || "").toUpperCase();
  const baseRecipe = recipe
    ? {
        ...recipe,
      }
    : {
        category: "Melee",
        primary: "METALBAR",
        secondary: null,
        primaryQty: 0,
        secondaryQty: 0,
        craftingFee: 0.05,
        inferred: true,
      };

  const withOverride = (
    category,
    primary,
    secondary,
    primaryQty,
    secondaryQty,
    extra = {},
  ) => ({
    ...baseRecipe,
    ...extra,
    category,
    primary,
    secondary,
    primaryQty,
    secondaryQty,
    craftingFee: 0.05,
    inferred: true,
  });

  const isMagicStaff =
    /(ARCANESTAFF|CURSEDSTAFF|FIRESTAFF|FROSTSTAFF|HOLYSTAFF|NATURESTAFF|DIVINESTAFF|DEMONICSTAFF|WITCHWORKSTAFF|LIFETOUCHSTAFF|LIFECURSESTAFF|WILDSTAFF|INFERNALSTAFF|ENIGMATICSTAFF|BRIMSTONE|PERMAFROST|DAWNSONG|EVENSONG|REDEMPTION|FALLENSTAFF|BLIGHTSTAFF|IRONROOTSTAFF|ORB)/.test(
      id,
    );
  const isArcaneStaff =
    /(ARCANESTAFF|ARCANE_RINGPAIR|ENIGMATICSTAFF|ENIGMATICORB|_ORB(_|$))/.test(
      id,
    );
  const isCursedStaff = /(CURSEDSTAFF|DEMONICSTAFF|SKULLORB)/.test(id);

  // Shapeshifter: fixed user-provided recipe override
  if (/_SHAPESHIFTER_/.test(id)) {
    return withOverride("Magic", "PLANKS", "LEATHER", 20, 12, {
      incompleteNote:
        "Shapeshifter artifact requirements are not fully complete in this model.",
    });
  }

  // Bow line: 32 planks, some variants also require artifacts
  if (/(^|_)2H_BOW($|_)|LONGBOW|WARBOW/.test(id)) {
    return withOverride("Ranged", "PLANKS", null, 32, 0);
  }

  // Crossbow line:
  // Light Crossbow (1H): 16 planks + 8 metal bar
  // Others: 20 planks + 12 metal bar
  if (/(CROSSBOW|BOLTCASTER|REPEATER)/.test(id)) {
    const isLightCrossbow = /MAIN_1HCROSSBOW/.test(id);
    return withOverride(
      "Ranged",
      "PLANKS",
      "METALBAR",
      isLightCrossbow ? 16 : 20,
      isLightCrossbow ? 8 : 12,
    );
  }

  // Axe line exact overrides from user:
  // Battle Axe: 8 planks + 16 metal bar
  if (/MAIN_AXE($|_)/.test(id)) {
    return withOverride("Melee", "PLANKS", "METALBAR", 8, 16);
  }

  // Great Axe / Infernal Scythe / Bear Paws / Realm Breaker / Crystal Reaper
  if (/(^|_)2H_AXE($|_)|SCYTHE_HELL|DUALAXE_KEEPER|2H_AXE_AVALON|SCYTHE_CRYSTAL/.test(id)) {
    return withOverride("Melee", "PLANKS", "METALBAR", 12, 20);
  }

  // Halberd / Carrioncaller
  if (/(^|_)2H_HALBERD($|_)|2H_HALBERD_MORGANA/.test(id)) {
    return withOverride("Melee", "PLANKS", "METALBAR", 20, 12);
  }

  // Sword line:
  // Broadsword + Clarent Blade + Infinity Blade = 16 metal bar + 8 leather
  if (/(MAIN_SWORD|MAIN_SCIMITAR_MORGANA)/.test(id)) {
    return withOverride("Melee", "METALBAR", "LEATHER", 16, 8);
  }

  // All other swords = 20 metal bar + 12 leather
  if (/(SWORD|SCIMITAR|CLAYMORE|CLEAVER)/.test(id)) {
    return withOverride("Melee", "METALBAR", "LEATHER", 20, 12);
  }

  // Dagger line
  // Dagger + Demonfang = 12 metal + 12 leather
  if (/MAIN_DAGGER($|_)/.test(id)) {
    return withOverride("Melee", "METALBAR", "LEATHER", 12, 12);
  }

  // Dagger Pair + Deathgivers + Twin Slayers = 16 metal + 16 leather
  if (/(2H_DAGGERPAIR|2H_DUALSICKLE)/.test(id)) {
    return withOverride("Melee", "METALBAR", "LEATHER", 16, 16);
  }

  // Claws + Bridled Fury = 12 metal + 20 leather
  if (/(2H_CLAWPAIR|2H_DAGGER_KATAR_AVALON)/.test(id)) {
    return withOverride("Melee", "METALBAR", "LEATHER", 12, 20);
  }

  // Bloodletter = 16 metal + 8 leather
  if (/MAIN_RAPIER_MORGANA/.test(id)) {
    return withOverride("Melee", "METALBAR", "LEATHER", 16, 8);
  }

  // Any remaining dagger family = 20 metal + 12 leather
  if (/(DAGGER|CLAW|KATAR|SICKLE)/.test(id)) {
    return withOverride("Melee", "METALBAR", "LEATHER", 20, 12);
  }

  // Hammer line
  // Hammer = 24 metal bar
  if (/MAIN_HAMMER($|_)/.test(id)) {
    return withOverride("Melee", "METALBAR", null, 24, 0);
  }

  // All other hammers = 20 metal bar + 12 cloth
  if (/(HAMMER|POLEHAMMER)/.test(id)) {
    return withOverride("Melee", "METALBAR", "CLOTH", 20, 12);
  }

  // Mace line
  if (/(MAIN_MACE|MAIN_ROCKMACE)/.test(id)) {
    return withOverride("Melee", "METALBAR", "CLOTH", 16, 8);
  }
  if (/(MACE|FLAIL)/.test(id)) {
    return withOverride("Melee", "METALBAR", "CLOTH", 20, 12);
  }

  // Quarterstaff line
  if (
    /(QUARTERSTAFF|COMBATSTAFF|DOUBLEBLADEDSTAFF|SOULSCYTHE|BLACKMONK|GRAILSEEKER|IRONCLADEDSTAFF)/.test(
      id,
    )
  ) {
    return withOverride("Melee", "METALBAR", "LEATHER", 12, 20);
  }

  // Spear line
  if (/(MAIN_SPEAR|MAIN_SPEAR_LANCE|MAIN_SPEAR_KEEPER)/.test(id)) {
    return withOverride("Melee", "PLANKS", "METALBAR", 16, 8);
  }
  if (/(2H_GLAIVE|2H_GLAIVE_CRYSTAL)/.test(id)) {
    return withOverride("Melee", "PLANKS", "METALBAR", 12, 20);
  }
  if (/(2H_SPEAR|2H_TRIDENT|2H_HARPOON)/.test(id)) {
    return withOverride("Melee", "PLANKS", "METALBAR", 20, 12);
  }

  // War gloves line
  if (/2H_KNUCKLES/.test(id)) {
    return withOverride("Melee", "METALBAR", "LEATHER", 12, 20);
  }

  // Arcane:
  // Arcane Staff + Witchwork Staff = 18 planks + 8 metal
  if (/MAIN_ARCANESTAFF($|_)/.test(id)) {
    return withOverride("Magic", "PLANKS", "METALBAR", 18, 8);
  }

  // All other Arcane = 20 planks + 12 metal
  if (isArcaneStaff) {
    return withOverride("Magic", "PLANKS", "METALBAR", 20, 12);
  }

  // Cursed:
  // Cursed + Lifecurse + Rotcaller + Shadowcaller = 16 planks + 8 metal
  if (/MAIN_CURSEDSTAFF($|_)/.test(id)) {
    return withOverride("Magic", "PLANKS", "METALBAR", 16, 8);
  }

  // All other Cursed = 20 planks + 12 metal
  if (isCursedStaff) {
    return withOverride("Magic", "PLANKS", "METALBAR", 20, 12);
  }

  // Generic magic staff handling:
  // 1H = 16 planks + 8 metal, 2H = 20 planks + 12 metal
  if (isMagicStaff) {
    const isOneHand = /MAIN_/.test(id);
    return withOverride(
      "Magic",
      "PLANKS",
      "METALBAR",
      isOneHand ? 16 : 20,
      isOneHand ? 8 : 12,
    );
  }

  return null;
}

function getWeaponFamilyKey(baseItemId) {
  return (baseItemId || "").split("@")[0].replace(/^T\d_/, "");
}

function stripTierPrefix(itemName) {
  return (itemName || "").replace(
    /^(Novice's|Journeyman's|Adept's|Expert's|Master's|Grandmaster's|Elder's)\s+/,
    "",
  );
}

function getWeaponSearchCategory(baseItemId) {
  const id = ((baseItemId || "").split("@")[0] || "").toUpperCase();

  if (/(^|_)KNUCKLES($|_)/.test(id)) return "War Gloves";
  if (/SHAPESHIFTER/.test(id)) return "Shapeshifter Staff";

  if (/(ARCANESTAFF|ARCANE_RINGPAIR|ENIGMATIC|_ORB(_|$))/.test(id))
    return "Arcane Staff";
  if (/(CURSEDSTAFF|DEMONICSTAFF|LIFECURSE)/.test(id))
    return "Cursed Staff";
  if (/(FIRESTAFF|INFERNOSTAFF|BRIMSTONE)/.test(id)) return "Fire Staff";
  if (/(FROSTSTAFF|GLACIAL|PERMAFROST|ICECRYSTAL|ICEGAUNTLETS)/.test(id))
    return "Frost Staff";
  if (/(HOLYSTAFF|DIVINESTAFF|REDEMPTION|FALLENSTAFF)/.test(id))
    return "Holy Staff";
  if (/(NATURESTAFF|WILDSTAFF|BLIGHTSTAFF|IRONROOT)/.test(id))
    return "Nature Staff";
  if (
    /(QUARTERSTAFF|COMBATSTAFF|DOUBLEBLADEDSTAFF|SOULSCYTHE|BLACKMONK|GRAILSEEKER|IRONCLADEDSTAFF)/.test(
      id,
    )
  )
    return "Quarterstaff";

  if (/(CROSSBOW|BOLTCASTER|REPEATER)/.test(id)) return "Crossbow";
  if (/(^|_)BOW($|_)|LONGBOW|WARBOW|SIEGEBOW/.test(id)) return "Bow";

  if (/(SPEAR|HARPOON|GLAIVE|TRIDENT)/.test(id)) return "Spear";
  if (/(SWORD|CLAYMORE|SCIMITAR|CLEAVER)/.test(id)) return "Sword";
  if (/(DAGGER|CLAW|KATAR|SICKLE)/.test(id)) return "Dagger";
  if (/(AXE|HALBERD)/.test(id)) return "Axe";
  if (/(HAMMER|POLEHAMMER)/.test(id)) return "Hammer";
  if (/(MACE|FLAIL)/.test(id)) return "Mace";

  return "Other";
}

function getWeaponTierEnchantLabel(tier, enchantment) {
  return `T${tier}.${enchantment}`;
}

function isWeaponPayloadCompatible(payload) {
  if (!payload || !Array.isArray(payload.rows) || payload.rows.length === 0)
    return false;
  const sample = payload.rows[0];
  return (
    payload.version === 5 &&
    Number.isInteger(sample.enchantment) &&
    Number.isInteger(sample.marketQuality) &&
    typeof sample.cityPrices === "object"
  );
}

function buildWeaponRecipeMarkup(groupRows) {
  const recipeRow = groupRows.find((row) => row.recipe) || groupRows[0];
  if (!recipeRow || !recipeRow.recipe) {
    return '<span class="text-muted">No recipe mapping found for this weapon.</span>';
  }

  const recipe = recipeRow.recipe;
  const parts = [
    `${recipe.primaryQty || 0} ${getMaterialDisplayName(recipe.primary)}`,
  ];

  if ((recipe.secondaryQty || 0) > 0 && recipe.secondary) {
    parts.push(
      `${recipe.secondaryQty} ${getMaterialDisplayName(recipe.secondary)}`,
    );
  }

  if (recipeRow.artifactId) {
    parts.push(`1 ${recipeRow.artifactName || recipeRow.artifactId}`);
  }

  let html = `
        <div class="weapon-recipe-chips">
            ${parts.map((part) => `<span class="recipe-chip">${part}</span>`).join("")}
        </div>
        <div class="weapon-recipe-note">Recipe cost in the table uses tier and enchantment matched material prices for each city.</div>
    `;

  if (recipeRow.artifactId) {
    html +=
      '<div class="weapon-recipe-note">Artifact line uses a default 1x estimate; exact artifact requirements may be incomplete for some variants.</div>';
  }

  if (recipe.incompleteNote) {
    html += `<div class="weapon-recipe-note">${recipe.incompleteNote}</div>`;
  }

  if (recipeRow.recipeSource === "inferred") {
    html +=
      '<div class="weapon-recipe-note">Recipe source: inferred template. Add a precise mapping in crafting_recipes.js for exact crafting math.</div>';
  }

  return html;
}

function getRelativeTimeText(timestamp) {
  if (!timestamp) return "No update";
  const updateDate = formatUTCToLocal(timestamp);
  if (!updateDate || !Number.isFinite(updateDate.getTime())) return "No update";

  const diffMinutes = Math.max(
    0,
    Math.floor((Date.now() - updateDate.getTime()) / (1000 * 60)),
  );
  if (diffMinutes >= 1440) return `${Math.floor(diffMinutes / 1440)}d ago`;
  if (diffMinutes >= 60) return `${Math.floor(diffMinutes / 60)}h ago`;
  return `${diffMinutes}m ago`;
}

function getShortTimestampText(timestamp) {
  if (!timestamp) return "No update";
  const updateDate = formatUTCToLocal(timestamp);
  if (!updateDate || !Number.isFinite(updateDate.getTime())) return "No update";

  return updateDate.toLocaleString([], {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getFirstAvailablePrice(cityMap) {
  if (!cityMap || typeof cityMap !== "object") return 0;
  for (const city of WEAPON_RECIPE_COST_CITIES) {
    const price = cityMap[city]?.price || 0;
    if (price > 0) return price;
  }
  return 0;
}

function buildWeaponRecipeCostMarkup(recipeRow) {
  if (!recipeRow || !recipeRow.recipe) {
    return '<span class="text-muted">No</span>';
  }

  const recipe = recipeRow.recipe;
  const lines = WEAPON_RECIPE_COST_CITIES.map((city) => {
    const primaryPrice = recipeRow.primaryMatPricesByCity?.[city]?.price || 0;
    const secondaryPrice = recipe.secondary
      ? recipeRow.secondaryMatPricesByCity?.[city]?.price || 0
      : 0;
    const artifactPrice = recipeRow.artifactId
      ? recipeRow.artifactPricesByCity?.[city]?.price || 0
      : 0;

    const parts = [];
    let total = 0;
    let complete = true;

    if ((recipe.primaryQty || 0) > 0) {
      parts.push(
        `${recipe.primaryQty}x${primaryPrice > 0 ? primaryPrice.toLocaleString() : "No"}`,
      );
      if (primaryPrice > 0) total += recipe.primaryQty * primaryPrice;
      else complete = false;
    }

    if ((recipe.secondaryQty || 0) > 0) {
      parts.push(
        `${recipe.secondaryQty}x${secondaryPrice > 0 ? secondaryPrice.toLocaleString() : "No"}`,
      );
      if (secondaryPrice > 0) total += recipe.secondaryQty * secondaryPrice;
      else complete = false;
    }

    if (recipeRow.artifactId) {
      parts.push(
        `1x${artifactPrice > 0 ? artifactPrice.toLocaleString() : "No"}`,
      );
      if (artifactPrice > 0) total += artifactPrice;
      else complete = false;
    }

    const totalText = complete ? total.toLocaleString() : "No";
    return `<div class="weapon-cost-line"><span class="weapon-cost-city">${city}</span>: ${parts.join(" + ")} = <span class="weapon-cost-total">${totalText}</span></div>`;
  }).join("");

  return `<div class="weapon-cost-cell">${lines}</div>`;
}

function buildWeaponPriceCellMarkup(priceRow) {
  if (!priceRow) {
    return `
            <td class="price-col matrix-missing">
                <div class="weapon-price-cell">
                    <div class="weapon-cell-price">No</div>
                    <div class="weapon-cell-meta">BM: No update</div>
                    ${CONFIG.CITIES.map((city) => `<div class="weapon-city-line matrix-missing">${city}: No</div>`).join("")}
                </div>
            </td>
        `;
  }

  const hasBmPrice = priceRow.bmPrice > 0;
  const bmPriceText = hasBmPrice ? priceRow.bmPrice.toLocaleString() : "No";
  const bmFreshnessClass = !priceRow.timestamp
    ? "matrix-missing"
    : Math.max(
          0,
          Math.floor(
            (Date.now() - formatUTCToLocal(priceRow.timestamp).getTime()) /
              (1000 * 60),
          ),
        ) > 1440
      ? "matrix-old"
      : "matrix-fresh";

  const cityPrices =
    priceRow.cityPrices && typeof priceRow.cityPrices === "object"
      ? priceRow.cityPrices
      : {};

  const cityLines = CONFIG.CITIES.map((city) => {
    const cityEntry = cityPrices[city];
    if (!cityEntry || !(cityEntry.price > 0)) {
      return `<div class="weapon-city-line matrix-missing">${city}: No</div>`;
    }

    const cityPrice = cityEntry.price;
    const deltaText = hasBmPrice
      ? `${priceRow.bmPrice - cityPrice >= 0 ? "+" : ""}${(priceRow.bmPrice - cityPrice).toLocaleString()}`
      : "No";
    const deltaClass = !hasBmPrice
      ? "matrix-missing"
      : priceRow.bmPrice - cityPrice >= 0
        ? "city-diff-positive"
        : "city-diff-negative";

    return `<div class="weapon-city-line">${city}: ${cityPrice.toLocaleString()} <span class="${deltaClass}">(Δ ${deltaText})</span></div>`;
  }).join("");

  return `
        <td class="price-col ${bmFreshnessClass}">
            <div class="weapon-price-cell">
                <div class="weapon-cell-price">${bmPriceText}</div>
                <div class="weapon-cell-meta">Upd: ${getShortTimestampText(priceRow.timestamp)}</div>
                ${cityLines}
            </div>
        </td>
    `;
}

function initWeaponPricesTab() {
  try {
    const payload = DB.getWeaponPrices();
    if (isWeaponPayloadCompatible(payload)) {
      weaponPriceData = payload.rows;
      displayWeaponPricesAndRecipes();
      const info = document.getElementById("weaponLastUpdateInfo");
      if (info && payload.timestamp) {
        info.textContent = `Last scan: ${payload.timestamp} (${weaponPriceData.length.toLocaleString()} rows)`;
      }
      return;
    }

    // Backward compatibility for old localStorage key
    const cached = localStorage.getItem("weaponPricesData");
    if (!cached) {
      weaponPriceData = [];
      displayWeaponPricesAndRecipes();
      const info = document.getElementById("weaponLastUpdateInfo");
      if (info) info.textContent = "No grouped weapon data fetched yet.";
      return;
    }
    const data = JSON.parse(cached);
    if (!isWeaponPayloadCompatible(data)) return;
    weaponPriceData = data.rows;
    displayWeaponPricesAndRecipes();
    if (typeof DB.saveWeaponPrices === "function") {
      DB.saveWeaponPrices({
        version: 5,
        timestamp: data.timestamp || new Date().toLocaleString(),
        rows: weaponPriceData,
      });
      localStorage.removeItem("weaponPricesData");
    }
    const info = document.getElementById("weaponLastUpdateInfo");
    if (info && data.timestamp) {
      info.textContent = `Last scan: ${data.timestamp} (${weaponPriceData.length.toLocaleString()} rows)`;
    }
  } catch (error) {
    console.warn("Failed to load cached weapon prices:", error);
  }
}

function sortWeaponPricesData(column) {
  if (weaponSortColumn === column) {
    weaponSortDirection = weaponSortDirection === "asc" ? "desc" : "asc";
  } else {
    weaponSortColumn = column;
    weaponSortDirection = column === "itemName" ? "asc" : "desc";
  }
  displayWeaponPricesAndRecipes();
}

async function fetchWeaponPricesAndRecipes() {
  const container = document.getElementById("weaponResultsContainer");
  const emptyState = document.getElementById("weaponEmptyState");
  const info = document.getElementById("weaponLastUpdateInfo");

  if (!container) return;
  if (emptyState) emptyState.style.display = "none";
  container.innerHTML =
    '<div class="alert alert-info">Fetching weapon recipes and Black Market prices...</div>';

  try {
    const craftingRecipes = globalThis.CRAFTING_RECIPES;
    if (!craftingRecipes) {
      throw new Error(
        "Crafting recipe data is not loaded. Please refresh the page.",
      );
    }

    if (!Array.isArray(allEquipmentItems) || allEquipmentItems.length === 0) {
      await loadEquipmentItems();
    }

    const baseWeapons = allEquipmentItems.filter((baseId) => {
      const tier = parseInt(getTierFromItemId(baseId) || "0", 10);
      return (
        getCategoryFromItemId(baseId) === "weapon" && tier >= 4 && tier <= 8
      );
    });

    const rowMap = {};
    const finishedItemIds = [];
    const materialIdSet = new Set();
    const artifactIdSet = new Set();

    baseWeapons.forEach((baseId) => {
      const resolvedRecipe = resolveCraftingRecipe(baseId, craftingRecipes);
      const recipe = resolvedRecipe.recipe;
      const recipeSource = resolvedRecipe.source;
      const recipeKey = resolvedRecipe.recipeKey;

      const tier = parseInt(getTierFromItemId(baseId) || "0", 10);
      const artifactId = getArtifactItemIdForWeapon(baseId);
      const displayName = itemNameMap[baseId] || baseId;
      const normalizedName = stripTierPrefix(displayName);

      if (artifactId) {
        artifactIdSet.add(artifactId);
      }

      for (let enchantment = 0; enchantment <= 4; enchantment += 1) {
        const itemId = enchantment === 0 ? baseId : `${baseId}@${enchantment}`;
        finishedItemIds.push(itemId);

        if (recipe) {
          materialIdSet.add(
            getMaterialIdByEnchant(recipe.primary, tier, enchantment),
          );
          if (recipe.secondary) {
            materialIdSet.add(
              getMaterialIdByEnchant(recipe.secondary, tier, enchantment),
            );
          }
        }

        for (let marketQuality = 1; marketQuality <= 5; marketQuality += 1) {
          const rowKey = `${itemId}#${marketQuality}`;
          rowMap[rowKey] = {
            itemId: itemId,
            baseItemId: baseId,
            weaponFamilyKey: getWeaponFamilyKey(baseId),
            weaponCategory: getWeaponSearchCategory(baseId),
            itemName: displayName,
            normalizedItemName: normalizedName,
            tier: tier,
            enchantment: enchantment,
            marketQuality: marketQuality,
            qualityName:
              WEAPON_QUALITY_NAMES[marketQuality] || `Q${marketQuality}`,
            recipe: recipe,
            recipeSource: recipeSource,
            recipeKey: recipeKey || null,
            artifactId: artifactId,
            artifactName: artifactId
              ? itemNameMap[artifactId] || artifactId
              : null,
            primaryMatPrice: 0,
            secondaryMatPrice: 0,
            baseMaterialCost: 0,
            artifactPrice: 0,
            artifactCost: 0,
            materialCost: 0,
            bmPrice: 0,
            timestamp: null,
          };
        }
      }
    });

    const weaponMaterialPrices = {};
    const materialIds = Array.from(materialIdSet);
    if (materialIds.length > 0) {
      const batchSize = 100;
      const encodedMaterialCities = encodeURIComponent(
        WEAPON_RECIPE_COST_CITIES.join(","),
      );
      for (let i = 0; i < materialIds.length; i += batchSize) {
        const batch = materialIds.slice(i, i + batchSize);
        const matPricesUrl = `${getApiBase()}/${batch.join(",")}.json?locations=${encodedMaterialCities}&qualities=1`;
        const matResponse = await fetch(matPricesUrl);
        if (!matResponse.ok)
          throw new Error(`Material API error ${matResponse.status}`);
        const matPrices = await matResponse.json();
        matPrices.forEach((mat) => {
          if (!WEAPON_RECIPE_COST_CITIES.includes(mat.city)) return;

          const nextPrice = getNumericValue(mat.sell_price_min);
          if (!weaponMaterialPrices[mat.item_id]) {
            weaponMaterialPrices[mat.item_id] = {};
          }

          const previous = weaponMaterialPrices[mat.item_id][mat.city];
          if (!previous || (previous.price || 0) === 0 || nextPrice > 0) {
            weaponMaterialPrices[mat.item_id][mat.city] = {
              price: nextPrice,
              date: mat.sell_price_min_date || null,
            };
          }
        });
      }
    }

    const artifactPriceMap = {};
    const artifactIds = Array.from(artifactIdSet);
    if (artifactIds.length > 0) {
      const batchSize = 100;
      const encodedArtifactCities = encodeURIComponent(
        WEAPON_RECIPE_COST_CITIES.join(","),
      );
      for (let i = 0; i < artifactIds.length; i += batchSize) {
        const batch = artifactIds.slice(i, i + batchSize);
        const artifactUrl = `${getApiBase()}/${batch.join(",")}.json?locations=${encodedArtifactCities}&qualities=1`;
        const artifactResponse = await fetch(artifactUrl);
        if (!artifactResponse.ok)
          throw new Error(`Artifact API error ${artifactResponse.status}`);
        const artifactRows = await artifactResponse.json();
        artifactRows.forEach((row) => {
          if (!WEAPON_RECIPE_COST_CITIES.includes(row.city)) return;

          if (!artifactPriceMap[row.item_id]) {
            artifactPriceMap[row.item_id] = {};
          }

          const nextPrice = getNumericValue(row.sell_price_min);
          const previous = artifactPriceMap[row.item_id][row.city];
          if (!previous || (previous.price || 0) === 0 || nextPrice > 0) {
            artifactPriceMap[row.item_id][row.city] = {
              price: nextPrice,
              date: row.sell_price_min_date || null,
            };
          }
        });
      }
    }

    const cityPriceByKey = {};
    if (finishedItemIds.length > 0) {
      const batchSize = 100;
      const encodedCities = encodeURIComponent(CONFIG.CITIES.join(","));

      for (let i = 0; i < finishedItemIds.length; i += batchSize) {
        const batch = finishedItemIds.slice(i, i + batchSize);
        const cityUrl = `${getApiBase()}/${batch.join(",")}.json?locations=${encodedCities}&qualities=1,2,3,4,5`;
        const cityResponse = await fetch(cityUrl);
        if (!cityResponse.ok)
          throw new Error(`City price API error ${cityResponse.status}`);

        const cityRows = await cityResponse.json();
        cityRows.forEach((row) => {
          const sellPrice = getNumericValue(row.sell_price_min);
          if (sellPrice <= 0) return;

          const rowQuality = parseInt(row.quality || row.Quality || "1", 10);
          const rowKey = `${row.item_id}#${rowQuality}`;
          if (!cityPriceByKey[rowKey]) {
            cityPriceByKey[rowKey] = {};
          }

          const cityName = row.city;
          const previous = cityPriceByKey[rowKey][cityName];

          if (!previous || sellPrice < previous.price) {
            cityPriceByKey[rowKey][cityName] = {
              price: sellPrice,
              timestamp: row.sell_price_min_date || null,
            };
          }
        });
      }
    }

    weaponPriceData = Object.values(rowMap).map((row) => {
      let primaryMatPrice = 0;
      let secondaryMatPrice = 0;
      let baseMaterialCost = 0;
      const primaryMatPricesByCity = {};
      const secondaryMatPricesByCity = {};
      const artifactPricesByCity = {};
      const materialCostByCity = {};

      if (row.recipe) {
        const primaryMatId = getMaterialIdByEnchant(
          row.recipe.primary,
          row.tier,
          row.enchantment,
        );
        const primaryCityMap = weaponMaterialPrices[primaryMatId] || {};
        primaryMatPrice = getFirstAvailablePrice(primaryCityMap);
        Object.assign(primaryMatPricesByCity, primaryCityMap);

        if (row.recipe.secondary) {
          const secondaryMatId = getMaterialIdByEnchant(
            row.recipe.secondary,
            row.tier,
            row.enchantment,
          );
          const secondaryCityMap = weaponMaterialPrices[secondaryMatId] || {};
          secondaryMatPrice = getFirstAvailablePrice(secondaryCityMap);
          Object.assign(secondaryMatPricesByCity, secondaryCityMap);
        }

        baseMaterialCost =
          primaryMatPrice * (row.recipe.primaryQty || 0) +
          secondaryMatPrice * (row.recipe.secondaryQty || 0);

        WEAPON_RECIPE_COST_CITIES.forEach((city) => {
          const cityPrimary = primaryMatPricesByCity[city]?.price || 0;
          const citySecondary = row.recipe.secondary
            ? secondaryMatPricesByCity[city]?.price || 0
            : 0;
          let total = 0;
          let complete = true;

          if ((row.recipe.primaryQty || 0) > 0) {
            if (cityPrimary > 0) total += row.recipe.primaryQty * cityPrimary;
            else complete = false;
          }

          if ((row.recipe.secondaryQty || 0) > 0) {
            if (citySecondary > 0)
              total += row.recipe.secondaryQty * citySecondary;
            else complete = false;
          }

          materialCostByCity[city] = {
            cost: complete ? total : 0,
            complete,
          };
        });
      }

      const artifactCityMap = row.artifactId
        ? artifactPriceMap[row.artifactId] || {}
        : {};
      const artifactPrice = row.artifactId
        ? getFirstAvailablePrice(artifactCityMap)
        : 0;
      const artifactCost = artifactPrice;
      const allCityPrices =
        cityPriceByKey[`${row.itemId}#${row.marketQuality}`] || {};

      if (row.artifactId) {
        Object.assign(artifactPricesByCity, artifactCityMap);
        WEAPON_RECIPE_COST_CITIES.forEach((city) => {
          if (!materialCostByCity[city]) {
            materialCostByCity[city] = { cost: 0, complete: true };
          }

          const cityArtifact = artifactPricesByCity[city]?.price || 0;
          if (cityArtifact > 0) {
            materialCostByCity[city].cost += cityArtifact;
          } else {
            materialCostByCity[city].complete = false;
            materialCostByCity[city].cost = 0;
          }
        });
      }

      return {
        ...row,
        primaryMatPrice,
        secondaryMatPrice,
        baseMaterialCost,
        primaryMatPricesByCity,
        secondaryMatPricesByCity,
        artifactPrice,
        artifactCost,
        artifactPricesByCity,
        materialCost: baseMaterialCost + artifactCost,
        materialCostByCity,
        cityPrices: allCityPrices,
      };
    });

    const rowsByKey = {};
    weaponPriceData.forEach((row) => {
      rowsByKey[`${row.itemId}#${row.marketQuality}`] = row;
    });

    const batchSize = 100;
    for (let i = 0; i < finishedItemIds.length; i += batchSize) {
      const batch = finishedItemIds.slice(i, i + batchSize);
      const url = `${getApiBase()}/${batch.join(",")}.json?locations=BlackMarket&qualities=1,2,3,4,5`;
      const response = await fetch(url);
      if (!response.ok)
        throw new Error(`Black Market API error ${response.status}`);

      const itemPrices = await response.json();
      itemPrices.forEach((item) => {
        if (item.city !== "Black Market") return;
        const itemQuality = parseInt(item.quality || item.Quality || "1", 10);
        const row = rowsByKey[`${item.item_id}#${itemQuality}`];
        if (!row) return;
        row.bmPrice = getNumericValue(item.buy_price_max);
        row.timestamp = item.buy_price_max_date || null;
      });
    }

    const now = new Date().toLocaleString();
    if (info) {
      info.textContent = `Last scan: ${now} (${weaponPriceData.length.toLocaleString()} rows)`;
    }

    DB.saveWeaponPrices({ version: 5, timestamp: now, rows: weaponPriceData });
    displayWeaponPricesAndRecipes();
  } catch (error) {
    console.error("Error fetching weapon prices:", error);
    container.innerHTML = `<div class="alert alert-danger">Failed to fetch weapon data: ${error.message}</div>`;
  }
}

function displayWeaponPricesAndRecipes() {
  const container = document.getElementById("weaponResultsContainer");
  const emptyState = document.getElementById("weaponEmptyState");
  if (!container) return;

  if (!weaponPriceData.length) {
    container.innerHTML = "";
    if (emptyState) emptyState.style.display = "block";
    return;
  }

  if (emptyState) emptyState.style.display = "none";

  const tierFilters = getSelectedFilterValues("weaponTierFilter");
  const categoryFilters = getSelectedFilterValues("weaponCategoryFilter");
  const searchFilter = (
    document.getElementById("weaponSearchFilter")?.value || ""
  )
    .toLowerCase()
    .trim();
  const maxResults = parseInt(
    document.getElementById("weaponMaxResults")?.value || "50",
    10,
  );

  let filtered = weaponPriceData.filter((item) => {
    if (tierFilters.length && !tierFilters.includes(String(item.tier)))
      return false;
    const itemCategory =
      item.weaponCategory || getWeaponSearchCategory(item.baseItemId || item.itemId);
    if (categoryFilters.length && !categoryFilters.includes(itemCategory))
      return false;
    if (searchFilter) {
      const text =
        `${item.itemName} ${item.normalizedItemName} ${item.itemId}`.toLowerCase();
      if (!text.includes(searchFilter)) return false;
    }
    return true;
  });

  const grouped = new Map();
  filtered.forEach((item) => {
    if (!grouped.has(item.weaponFamilyKey)) {
      grouped.set(item.weaponFamilyKey, []);
    }
    grouped.get(item.weaponFamilyKey).push(item);
  });

  const groups = Array.from(grouped.entries())
    .map(([familyKey, rows]) => {
      const sortedRows = rows
        .slice()
        .sort(
          (a, b) =>
            a.tier - b.tier ||
            a.enchantment - b.enchantment ||
            a.marketQuality - b.marketQuality,
        );
      const titleRow = sortedRows[0];
      return {
        familyKey,
        title: stripTierPrefix(titleRow?.itemName || familyKey),
        category:
          titleRow?.weaponCategory ||
          getWeaponSearchCategory(titleRow?.baseItemId || titleRow?.itemId),
        rows: sortedRows,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title))
    .slice(0, Math.max(1, maxResults));

  if (!groups.length) {
    container.innerHTML =
      '<div class="alert alert-info">No weapons match the current filters.</div>';
    return;
  }

  const qualityHeaders = WEAPON_QUALITY_NAMES.slice(1);
  const visibleTiers = tierFilters.length
    ? tierFilters
        .map((value) => parseInt(value, 10))
        .filter(Number.isFinite)
        .sort((a, b) => a - b)
    : [4, 5, 6, 7, 8];

  let html = '<div class="weapon-group-list">';

  groups.forEach((group) => {
    const rowLookup = new Map();
    group.rows.forEach((row) => {
      rowLookup.set(`${row.tier}-${row.enchantment}-${row.marketQuality}`, row);
    });

    html += `
            <section class="weapon-group-card">
                <div class="weapon-group-header">
                    <div>
                        <h5 class="weapon-group-title">${group.title}</h5>
                        <div class="weapon-group-subtitle">${group.category} · ${group.rows.length.toLocaleString()} price points cached</div>
                    </div>
                    <div class="weapon-recipe-panel">
                        ${buildWeaponRecipeMarkup(group.rows)}
                    </div>
                </div>
                <div class="table-responsive weapon-matrix-wrap">
                    <table class="table table-dark table-hover weapon-matrix-table">
                        <thead>
                            <tr>
                                <th>Tier</th>
                                <th>Recipe Cost</th>
                                ${qualityHeaders.map((label) => `<th>${label}</th>`).join("")}
                            </tr>
                        </thead>
                        <tbody>
        `;

    visibleTiers.forEach((tier) => {
      for (let enchantment = 0; enchantment <= 4; enchantment++) {
        const recipeRow = rowLookup.get(`${tier}-${enchantment}-1`);
        const costText = buildWeaponRecipeCostMarkup(recipeRow);

        html += `
                    <tr>
                        <td><span class="tier-badge tier-${tier}">${getWeaponTierEnchantLabel(tier, enchantment)}</span></td>
                        <td class="price-col">${costText}</td>
                `;

        for (let quality = 1; quality <= 5; quality++) {
          const priceRow = rowLookup.get(`${tier}-${enchantment}-${quality}`);
          html += buildWeaponPriceCellMarkup(priceRow);
        }

        html += "</tr>";
      }
    });

    html += `
                        </tbody>
                    </table>
                </div>
            </section>
        `;
  });

  html += "</div>";
  html += `<div class="alert alert-info mt-3">Showing ${groups.length} weapon groups from ${weaponPriceData.length.toLocaleString()} cached price rows.</div>`;
  container.innerHTML = html;
}

// ===== MATERIAL PRICES TAB =====

// Initialize material prices on page load
function initMatPricesTab() {
  let data = DB.getMaterialTable();

  // Backward compatibility: previous versions stored this cache globally.
  if (!data) {
    try {
      data = JSON.parse(localStorage.getItem("matPricesData") || "null");
    } catch {
      data = null;
    }
  }

  if (data) {
    displayMatPricesTab(
      data.materials,
      data.tiers,
      data.enchants,
      data.cities,
      data.priceMap,
      data.timestampMap || {},
    );
    const lastUpdateEl = document.getElementById("matPricesLastUpdate");
    if (lastUpdateEl) {
      lastUpdateEl.textContent = data.timestamp
        ? `Last updated: ${data.timestamp}`
        : "Loaded from local cache";
    }
    return;
  }

  const container = document.getElementById("matPricesContainer");
  if (container) {
    container.innerHTML = '<p class="text-muted">Click "Fetch Prices" to load data.</p>';
  }
  const lastUpdateEl = document.getElementById("matPricesLastUpdate");
  if (lastUpdateEl) {
    lastUpdateEl.textContent = "No material table cache yet.";
  }
}

async function fetchMatPricesTab() {
  const btn = document.getElementById("fetchMatPricesBtn");
  const container = document.getElementById("matPricesContainer");
  const lastUpdateEl = document.getElementById("matPricesLastUpdate");

  btn.disabled = true;
  btn.textContent = "⏳ Fetching...";
  container.innerHTML = '<p class="text-muted">Loading prices from API...</p>';

  const cities = [
    "Fort Sterling",
    "Lymhurst",
    "Bridgewatch",
    "Martlock",
    "Thetford",
    "Caerleon",
  ];
  const materials = [
    { key: "METALBAR", label: "⚙️ Metal Bar" },
    { key: "PLANKS", label: "🪵 Planks" },
    { key: "LEATHER", label: "🥩 Leather" },
    { key: "CLOTH", label: "🧵 Cloth" },
  ];
  const tiers = [4, 5, 6, 7, 8];
  const enchants = [0, 1, 2, 3];

  // Build all IDs: 4 materials × 5 tiers × 4 enchants = 80 IDs
  const itemIds = [];
  materials.forEach((mat) => {
    tiers.forEach((tier) => {
      enchants.forEach((enchant) => {
        itemIds.push(getMaterialIdByEnchant(mat.key, tier, enchant));
      });
    });
  });

  try {
    // Batch into groups of 50 to stay within URL length limits
    const batchSize = 50;
    const priceMap = {};
    const timestampMap = {};
    for (let i = 0; i < itemIds.length; i += batchSize) {
      const batch = itemIds.slice(i, i + batchSize);
      const url = `${getApiBase()}/${batch.join(",")}.json?locations=${cities.join(",")}&qualities=1`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const data = await response.json();
      data.forEach((entry) => {
        const id = entry.item_id || entry.ItemId;
        const city = entry.city;
        const price = getNumericValue(entry.sell_price_min);
        const ts = entry.sell_price_min_date || entry.SellPriceMinDate || null;
        if (id && city) {
          priceMap[`${id}__${city}`] = price;
          timestampMap[`${id}__${city}`] = ts;
        }
      });
    }

    displayMatPricesTab(
      materials,
      tiers,
      enchants,
      cities,
      priceMap,
      timestampMap,
    );
    const now = new Date().toLocaleTimeString();
    lastUpdateEl.textContent = `Last updated: ${now}`;

    DB.saveMaterialTable({
      materials,
      tiers,
      enchants,
      cities,
      priceMap,
      timestampMap,
      timestamp: now,
    });
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger">Failed to fetch prices: ${err.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "🔄 Fetch Prices";
  }
}

function getRelativeAgeInfo(timestamp) {
  if (!timestamp) return null;
  const dt = formatUTCToLocal(timestamp);
  if (!dt || !Number.isFinite(dt.getTime())) return null;

  const diffMinutes = Math.floor((Date.now() - dt.getTime()) / (1000 * 60));
  if (diffMinutes < 0)
    return {
      ageText: "just now",
      isFresh: true,
      localTime: dt.toLocaleString(),
    };

  let ageText = `${diffMinutes}m ago`;
  if (diffMinutes >= 60) {
    const hours = Math.floor(diffMinutes / 60);
    ageText = `${hours}h ago`;
  }
  if (diffMinutes >= 1440) {
    const days = Math.floor(diffMinutes / 1440);
    ageText = `${days}d ago`;
  }

  return {
    ageText,
    isFresh: diffMinutes <= 1440,
    localTime: dt.toLocaleString(),
  };
}

function displayMatPricesTab(
  materials,
  tiers,
  enchants,
  cities,
  priceMap,
  timestampMap = {},
) {
  const container = document.getElementById("matPricesContainer");

  // Enchantment level labels and colours
  const enchantLabel = { 0: "", 1: ".1", 2: ".2", 3: ".3" };
  const enchantStyle = {
    0: "color:#e0e0e0",
    1: "color:#4caf50", // green  — Uncommon
    2: "color:#2196f3", // blue   — Rare
    3: "color:#ff9800", // orange — Exceptional
  };

  let html = '<div class="row g-4">';

  materials.forEach((mat) => {
    html += `
        <div class="col-12">
            <div class="card" style="background:#1a232e; border:1px solid #2d3e50;">
                <div class="card-header" style="background:#0d1a26; border-bottom:1px solid #2d3e50; color:#f5f8ff;">
                    <strong>${mat.label}</strong>
                </div>
                <div class="card-body p-0">
                    <div class="table-responsive">
                        <table class="table table-dark table-hover table-sm mb-0">
                            <thead>
                                <tr>
                                    <th>Tier</th>`;
    cities.forEach((city) => {
      html += `<th class="text-center">${city}</th>`;
    });
    html += `</tr></thead><tbody>`;

    tiers.forEach((tier, tierIdx) => {
      // Visual separator between tiers
      if (tierIdx > 0) {
        html += `<tr><td colspan="${cities.length + 1}" style="padding:2px;background:#0d1a26;"></td></tr>`;
      }
      enchants.forEach((enchant) => {
        const label = `T${tier}${enchantLabel[enchant]}`;
        const style = enchantStyle[enchant];
        html += `<tr><td style="${style}"><strong>${label}</strong></td>`;
        cities.forEach((city) => {
          const itemId = getMaterialIdByEnchant(mat.key, tier, enchant);
          const lookupKey = `${itemId}__${city}`;
          const price = priceMap[lookupKey] || 0;
          const ts = timestampMap[lookupKey] || null;
          const ageInfo = getRelativeAgeInfo(ts);
          const statusHtml = ageInfo
            ? `<small style="${ageInfo.isFresh ? "color:#8fd19e" : "color:#ff8a80"}" title="Last update: ${ageInfo.localTime}">${ageInfo.isFresh ? "&#10003;" : "&#10007;"} ${ageInfo.ageText}</small>`
            : '<small class="text-muted">&#10007; no update</small>';

          if (price > 0) {
            html += `<td class="text-center" style="${style}"><div>${price.toLocaleString()}</div><div>${statusHtml}</div></td>`;
          } else {
            html += `<td class="text-center text-muted"><div>—</div><div>${statusHtml}</div></td>`;
          }
        });
        html += `</tr>`;
      });
    });

    html += `</tbody></table></div></div></div></div>`;
  });

  html += "</div>";
  container.innerHTML = html;
}
