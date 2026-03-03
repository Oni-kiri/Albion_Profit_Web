# ⚔️ Albion Equipment Enhancement Profit Calculator

A web-based calculator for analyzing equipment enhancement profitability in Albion Online. Fetches real-time market prices from the Albion Online Data Project API and automatically calculates ROI for all equipment enhancements.

## 🎯 Purpose

Determine which equipment enhancements offer the best profit margins across all Albion royal cities. Instantly identify profitable enhancement opportunities by comparing market prices against material costs.

## ✨ Features

### Market Data & Coverage
- **Real-time Pricing**: Fetches live prices from Albion Online Data Project API
- **5 Royal Cities**: Fort Sterling, Lymhurst, Bridgewatch, Martlock, Thetford
- **All 6 Equipment Types**: Weapons, Helmets, Armor, Shoes, Capes, Off-hands
- **Tiers 4-7**: Comprehensive tier coverage for all item types
- **Enhancement Levels**: Analyzes enhancements 0→1 (Rune), 1→2 (Soul), 2→3 (Relic)

### Smart Filtering & Display
- **Per-City Analysis**: Separate refresh buttons for each city (reduces API rate limiting)
- **ROI Threshold**: Configurable minimum ROI filter (default: 15%)
- **Data Validation Tab**: Inspect cached prices and verify data quality
- **Material Price Tracking**: View Rune, Soul, and Relic prices by tier and city
- **CSV Export**: Download results for spreadsheet analysis

### Local Data Management
- **Browser Storage**: All fetched data persists in localStorage
- **Offline Access**: Use cached data without re-fetching
- **Data Inspector**: Verify cached prices and item counts
- **Clear Function**: Reset cached data when needed

## 🚀 Getting Started

### Requirements
- Modern web browser (Chrome, Firefox, Safari, Edge)
- Internet connection (for API fetches)
- No installation needed

### Installation

1. Download all repository files
2. Open `index.html` in your web browser
3. Click a city button to fetch market data

## 📖 Usage Guide

### Fetching Data

1. **Click a City Button** (Profit Results tab)
   - Fetches independently - no rate-limit issues
   - Progress bar shows fetch status
   - Data automatically saves to browser storage

2. **View Results**
   - Items with ROI ≥15% displayed by default
   - Results sorted by profit (highest first)
   - Color-coded by data freshness

3. **Inspect Data** (Data Validation tab)
   - View material prices per city/tier
   - Check item inventory
   - Verify storage usage
   - Export or inspect samples

### Filtering Results

- **Tier Select**: Show T4, T5, T6, T7, or all
- **Category Select**: Filter by equipment type
- **Min ROI Slider**: Adjust profitability threshold

### Export Data

Click **CSV Export** to download results as spreadsheet

## 🔧 Technical Details

### Enhancement Cost Formula
```
Total Cost = Base Item Price + (Material Quantity × Material Unit Price)
```

### ROI Calculation
```
Revenue = Enhanced Item Price × 0.9  (10% marketplace tax)
Net Profit = Revenue - Total Cost
ROI (%) = (Net Profit / Total Cost) × 100
```

### Material Requirements

| Enhancement | Material | Weapon | Armor | Helmet | Shoes | Cape | Off-hand |
|-------------|----------|--------|-------|--------|-------|------|----------|
| 0→1 | Rune | 384 | 192 | 96 | 96 | 96 | 288 |
| 1→2 | Soul | 384 | 192 | 96 | 96 | 96 | 288 |
| 2→3 | Relic | 384 | 192 | 96 | 96 | 96 | 288 |

### Data Storage

Market data stored in browser `localStorage`:
- `albion_equipment_data` - Equipment prices by city
- `albion_material_prices` - Rune/Soul/Relic prices by city/tier
- `albion_cities_fetched` - Cached city list
- `albion_last_update` - Last fetch timestamp

**Note**: Storage is browser-specific and persists until manually cleared.

## ⚙️ Configuration

Edit `app.js` to customize:

```javascript
const CONFIG = {
    API_BASE: 'https://east.albion-online-data.com/api/v2/stats/prices',
    QUALITY_EXCELLENT: 4,
    MIN_ROI: 15,
    TAX_RATE: 0.1,
    CITIES: ['Fort Sterling', 'Lymhurst', 'Bridgewatch', 'Martlock', 'Thetford'],
    TIERS: [4, 5, 6, 7]
};
```

## 🗂️ File Structure

```
├── index.html                  # Main UI
├── app.js                      # Core logic
├── database.js                 # LocalStorage module
├── item_names.json            # Item mappings
├── all_equipment_items.json   # Equipment database
├── items.txt                  # Reference data
├── README.md                  # This file
└── LICENSE                    # MIT License
```

## 🐛 Troubleshooting

### Materials show "No Price"
- Material data not fetched yet
- Check console for fetch status logs
- Click city button to refresh

### Items missing from results
- Missing material prices (shown as "No Price")
- ROI below minimum threshold
- Check Data Validation tab for details

### API Connection Issues
- Verify internet connection
- Check browser console (F12) for errors
- Albion Data Project API may be temporarily offline

### Old prices showing
- Data cached >24 hours old
- Click city button to re-fetch
- Or use "Clear All Data" to start fresh

## 📝 Notes

- Only items with calculated profit are displayed
- Items requiring unavailable materials are skipped
- Prices use `sell_price_min` only
- Data quality timestamp shown for each result
- CSV export preserves all calculation details

## 📄 License

MIT License - See LICENSE file

---

Built with vanilla HTML/CSS/JavaScript. No external dependencies.
