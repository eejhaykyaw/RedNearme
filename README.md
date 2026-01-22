# RedNearMe (Static Web App)

A zero-backend “near me” locator for Radius facilities (NAPs, etc.) that:
- Uses GPS **or** pasted coordinates **or** facility search as the reference point
- Filters facilities by a distance limit (0–10,000 m)
- Sorts results by straight-line (Haversine) distance
- Runs fully client-side (deploy via GitHub Pages)

## Files
- `index.html` — UI
- `app.js` — logic (parsing + distance filtering + map rendering)
- `styles.css` — styling
- `facilities.json` — facility data (generated)
- `facilities_index.json` — grid index (generated, for speed)
- `dropped_rows.csv` — rows excluded during cleanup (invalid coordinates)

## Data schema (input CSV)
Your CSV columns are expected to be:
- `Name` (facility ID / stencil)
- `Description` (property name)
- `Latitude`
- `Longitude`

## Updating the dataset (future additions)
1. Replace `Facility list.csv` with the updated file (same column names).
2. Run the generator script below to rebuild the JSON files.
3. Commit the updated `facilities.json` and `facilities_index.json` to GitHub.

## Generator (rebuild JSON + index)
See `rebuild_data.py`.

### Cleanup rules used
- Auto-swap lat/lng if lat is outside [-90..90] but lng looks like a latitude.
- Drop rows where:
  - Latitude/Longitude are out of valid ranges, or
  - Coordinates are obviously wrong for PH datasets (e.g., lat == lng in the PH latitude band).
Dropped rows are saved to `dropped_rows.csv` for review.

## Notes
- This app uses OpenStreetMap tiles via Leaflet.
- Road/walking distance is **not** computed by default (requires a routing engine / API).
