# Requirements & Setup

## System Requirements

### Minimum
- **Browser**: Chrome 90+, Firefox 88+, Safari 14+, Edge 90+
- **OS**: Windows, macOS, Linux (any system with a modern web browser)
- **RAM**: 256 MB
- **Storage**: 30 MB (for all files)
- **Network**: 1 Mbps (for API calls)

### Recommended
- **Browser**: Latest version of Chrome, Firefox, Safari, or Edge
- **RAM**: 1 GB+
- **Network**: 5+ Mbps (for faster data loading)

## Browser Compatibility

| Browser | Version | Support |
|---------|---------|---------|
| Chrome | 90+ | ✅ Full Support |
| Firefox | 88+ | ✅ Full Support |
| Safari | 14+ | ✅ Full Support |
| Edge | 90+ | ✅ Full Support |
| Opera | 76+ | ✅ Full Support |
| Internet Explorer | All | ❌ Not Supported |

## Required APIs & Services

### Albion Online Data Project API
- **Endpoint**: `https://east.albion-online-data.com/api/v2/stats/prices`
- **Method**: GET
- **Rate Limit**: 180 requests/minute
- **Response Format**: JSON
- **Availability**: Must be online for data fetching
- **Free**: Yes, no authentication required

### Browser APIs Used
- **LocalStorage**: For caching market data (10 MB limit)
- **Fetch API**: For HTTP requests to Albion API
- **JSON**: For data serialization
- **Date Object**: For timestamp handling

## File Requirements

### Core Files (Required)
- `index.html` - User interface
- `app.js` - Application logic (~1500 lines)
- `database.js` - Data persistence layer (~175 lines)

### Data Files (Required)
- `item_names.json` - Item ID to display name mappings (~60 KB)
- `all_equipment_items.json` - Complete equipment database (~30 KB)

### Reference Files (Optional but Included)
- `items.txt` - Full item reference database (1 MB)
- `LICENSE` - MIT License
- `README.md` - Documentation

### Total Size
- **Core Application**: ~90 KB
- **Data Files**: ~90 KB
- **Optional Files**: 1 MB+
- **Total**: ~200 KB to 1 MB (depending on included files)

## Data Storage Requirements

### LocalStorage
- **Equipment Data**: ~500 KB per city (when fully populated)
- **Material Prices**: ~50 KB
- **Metadata**: ~5 KB
- **Total Possible**: ~2.5 MB (across 5 cities)
- **Browser Limit**: Typically 5-10 MB per origin

### Cache Invalidation
- Data persists indefinitely until manually cleared
- Old data (>24 hours) is flagged but not automatically deleted
- User can clear all data via "Clear All Data" button

## Performance Specifications

### Load Times
- **Initial Page Load**: 1-2 seconds
- **First City Fetch**: 10-30 seconds (depends on internet speed)
- **Subsequent Fetches**: 5-15 seconds
- **Data Validation Tab**: Instant (uses cached data)

### Memory Usage
- **Initial Load**: ~20 MB
- **With 1 City Cached**: ~30-50 MB
- **With 5 Cities Cached**: ~100-150 MB

### Network Usage (Per Fetch)
- **Equipment Prices**: ~1-2 MB (single city, all items)
- **Material Prices**: ~50 KB (per city)
- **Total Per City**: ~1-2.5 MB

## API Rate Limiting

### Albion Data Project Limits
- **Rate**: 180 requests per minute
- **Per-City Strategy**: Spreads requests over time
- **Recommended**: Fetch one city at a time
- **Wait Time**: 200ms between API chunks (automatic)

### Best Practices
1. Fetch cities sequentially, not in parallel
2. Wait 30+ seconds between multiple city fetches
3. Reuse cached data when possible
4. Clear old data periodically to free storage space

## Configuration Requirements

### Default Configuration (hardcoded in app.js)
```javascript
API_BASE: 'https://east.albion-online-data.com/api/v2/stats/prices'
QUALITY_EXCELLENT: 4              // Quality level (1-4)
MIN_ROI: 15                       // Minimum ROI threshold (%)
TAX_RATE: 0.1                     // 10% marketplace tax
CITIES: [5 royal cities]          // Fixed list
TIERS: [4, 5, 6, 7]              // Equipment tiers
```

### Customizable Via UI
- Minimum ROI slider (5-100%)
- Tier filter dropdown
- Category filter dropdown
- Data refresh per city

## Internet Connectivity

### Required
- Stable connection for initial API fetch
- Works offline after data is cached
- Must be online to refresh/update data

### Connection Types Supported
- Broadband (Recommended)
- Mobile 4G/5G
- WiFi
- Tethered Mobile Connection

### Bandwidth
- **Per City Fetch**: 1-2 MB download
- **Ongoing**: Only when manually refreshing

## Disk Space (Installation)

### Minimum Installation
- Core files only: ~90 KB

### Full Installation
- All files: ~1-2 MB (with items.txt reference data)

### With Browser Cache
- Browser will cache downloaded files: ~500 KB
- LocalStorage data: Up to 2.5 MB

## Browser Storage Quota

LocalStorage Limits by Browser:
| Browser | Limit | Notes |
|---------|-------|-------|
| Chrome | 10 MB | Per origin |
| Firefox | 10 MB | Per origin |
| Safari | 5 MB | Per domain |
| Edge | 10 MB | Per origin |
| Opera | 10 MB | Per origin |

Current usage: ~100-200 KB per city (well within limits)

## Privacy & Data

### Stored Locally
- All market data stored in browser only
- No data sent to external servers except Albion API
- LocalStorage is origin-specific (cannot be read by other sites)

### Cleared When
- Browser localStorage is cleared
- Using private/incognito mode (temporary)
- User clicks "Clear All Data" button
- Browser cookies/storage settings cleared

## Accessibility

### Keyboard Navigation
- Tab through all buttons and inputs
- Enter/Space to activate buttons
- Sliders adjustable via arrow keys

### Screen Readers
- ARIA labels on interactive elements
- Semantic HTML structure
- Color-coded data has text alternatives

### Mobile Devices
- **Responsive Design**: Works on tablets and phones
- **Touch Support**: All buttons touch-friendly
- **Recommended Minimum**: 5" screen

## Browser Console Access

For debugging:
- **Chrome/Edge**: Press `F12` or `Ctrl+Shift+I`
- **Firefox**: Press `F12` or `Ctrl+Shift+I`
- **Safari**: Press `Cmd+Option+I` (enable in Preferences first)

Console shows:
- API request logs
- Data parsing status
- Error messages
- Debug information

## Troubleshooting Requirements

To troubleshoot, have ready:
- Browser name and version
- Console error messages (F12)
- LocalStorage contents (F12 → Application → LocalStorage)
- Browser console logs during fetch

---

**Last Updated**: March 3, 2026
