# Albion Market Profit Suite

A browser-based Albion Online market toolkit for enhancement ROI, Black Market flips, crafting profitability, weapon recipe pricing, and material price comparison.

## What This App Does

- Works with all three Albion data regions:
  - East (Asia)
  - West (Americas)
  - Europe
- Stores data locally by server selection, so tables can render from cache without refetching every time.
- Supports dark mode and light mode.
- Provides tab-specific workflows for different profit strategies.

## Quick Start

1. Install Python 3.10+.
2. Install project requirements:
  - `python -m pip install -r requirements.txt`
3. Start a local server from the project folder:
  - `python -m http.server 8090`
4. Open this URL in your browser:
  - `http://localhost:8090`
5. In the top-right corner:
   - Choose a server from `East / West / Europe`.
   - Choose your preferred mode using the `Light/Dark` toggle.
6. Use each tab based on your goal.

## Notes For Local Running

- This is a static web app, so Python is only used to host files locally.
- `requirements.txt` is included for a standard install flow, but no third-party Python package is required for the app itself.

## How To Use Each Tab

### 1) Enhancement Profit
Purpose: compare enhancement chains (`0 -> 1 -> 2 -> 3`) by city and ROI.

How to use:
- Refresh one city at a time with the city buttons.
- Adjust city/tier/category/ROI/data-status filters.
- Review top profitable rows with freshness indicators.

Cached locally:
- City equipment prices
- Enhancement material prices (Rune/Soul/Relic)

### 2) Black Market Flip
Purpose: safe arbitrage from Caerleon player market to Black Market buy orders.

How to use:
- Click `Scan Black Market Flips`.
- Filter by tier, enchantment, quality, and min ROI.
- Sort by ROI, profit, or price columns.

Cached locally:
- Flip rows
- Raw Caerleon rows
- Raw Black Market rows

### 3) Crafting Profit
Purpose: estimate crafting profit from material costs plus crafting fee against Black Market output value.

Important:
- Artifact prices are included where available, but artifact recipe coverage/quantities are still not perfect for every weapon variant.
- Because of that, crafting profit rows for artifact weapons can be inaccurate.

How to use:
- Click `Scan Crafting Profits`.
- Filter by tier/quality/category/min ROI.
- Review recipe cost breakdown and profitability.

Cached locally:
- Profitable crafting rows
- Last crafting scan timestamp

### 4) Weapon Prices
Purpose: grouped weapon price matrix with recipe summary and per-city recipe cost formulas.

How to use:
- Click `Scan Weapon Prices`.
- Filter by tier and search by weapon name.
- Inspect T4.0-T8.4 matrix and city deltas.

Cached locally:
- Weapon matrix payload and timestamps

### 5) Material Prices
Purpose: compare refined material prices by city, tier, and enchantment level.

How to use:
- Click `Fetch Prices`.
- Compare the same material across cities.
- Use this tab before crafting/weapon scans for cost context.

Cached locally:
- Material table payload (price map + timestamps)

### 6) Data Validation
Purpose: inspect what is currently cached for the active server.

How to use:
- View storage stats and cached city data.
- Inspect raw city rows with search.
- Clear local cache when you want a full clean rescan.

## Data Persistence Model

All major datasets are saved in browser cache and scoped by active server.

Current strategy:
- IndexedDB is the primary cache store for larger datasets.
- localStorage is kept only as a fallback for browsers/environments where IndexedDB is unavailable.
- Cache entries include freshness metadata so stale datasets can be detected without forcing unnecessary refetches.

Examples of cached categories:
- Enhancement city data
- Enhancement materials
- Black Market flip data
- Crafting profit data
- Weapon matrix data
- Material comparison table data

When you switch server, the app switches to that server's cache namespace.

## Tier Color Mapping

The UI tier badge colors are:
- T4: Blue
- T5: Red
- T6: Orange
- T7: Yellow
- T8: Original app color

## Notes

- Live prices come from the Albion Online Data Project API.
- Artifact prices are partially supported in crafting calculations; treat artifact-weapon profit estimates as approximate.
- If a table is empty, run the corresponding scan/fetch once for the active server.
- Caches are browser-local and not shared across browsers or devices.
- The app will warn when cached datasets are stale based on dataset-specific TTL policies.

## Project Files

- `index.html`: UI layout, tab structure, styles
- `config.js`: runtime configuration for API endpoints, servers, and refresh intervals
- `app.js`: data fetch logic, calculations, rendering, tab workflows
- `database.js`: IndexedDB-backed cache layer with server-scoped storage and fallback support
- `crafting_recipes.js`: crafting recipe definitions and mappings
- `all_equipment_items.json`: equipment id universe
- `item_names.json`: item id to display name map
- `items.txt`: reference list of item ids

## Developer Planning

- See `DEVELOPER_ROADMAP.md` for the staged to-do list covering storage, modularization, testing, validation, accessibility, and deployment improvements.
- See `INTERNAL_DOC.md` for the internal engineering reference covering stack, file structure, runtime flow, cache behavior, and maintenance notes.
