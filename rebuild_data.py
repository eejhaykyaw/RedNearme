#!/usr/bin/env python3
import json, math, pandas as pd

INPUT_CSV = "Facility list.csv"
OUT_FACILITIES = "facilities.json"
OUT_INDEX = "facilities_index.json"
OUT_DROPPED = "dropped_rows.csv"

CELL_SIZE_DEG = 0.01  # ~1.1km latitude. Good for radius searches up to 10km.

def main():
    df = pd.read_csv(INPUT_CSV)

    # Auto-swap obvious lat/lng swaps
    swap_mask = (df["Latitude"].abs() > 90) & (df["Longitude"].abs() <= 90)
    df.loc[swap_mask, ["Latitude", "Longitude"]] = df.loc[swap_mask, ["Longitude", "Latitude"]].values

    # Invalid range
    invalid_range = ~(
        df["Latitude"].between(-90, 90) &
        df["Longitude"].between(-180, 180)
    )

    # PH-oriented heuristic for obvious bad rows (lat==lng within PH-lat band but lng not PH-like)
    ph_bbox = df["Latitude"].between(0, 30) & df["Longitude"].between(100, 140)
    sus_equal = (df["Latitude"].round(6) == df["Longitude"].round(6)) & df["Latitude"].between(0, 30) & df["Longitude"].between(-90, 90)

    drop_mask = invalid_range | (sus_equal & ~ph_bbox)

    dropped = df[drop_mask].copy()
    cleaned = df[~drop_mask].copy()

    # Build facilities list
    facilities = []
    for _, r in cleaned.iterrows():
        facilities.append({
            "id": str(r["Name"]).strip(),
            "property": str(r["Description"]).strip(),
            "lat": float(r["Latitude"]),
            "lng": float(r["Longitude"]),
        })

    # Build grid index: key -> list[int indices into facilities]
    idx = {}
    for i, f in enumerate(facilities):
        lat_i = int(math.floor(f["lat"] / CELL_SIZE_DEG))
        lng_i = int(math.floor(f["lng"] / CELL_SIZE_DEG))
        key = f"{lat_i}_{lng_i}"
        idx.setdefault(key, []).append(i)

    # Write outputs
    with open(OUT_FACILITIES, "w", encoding="utf-8") as fp:
        json.dump(facilities, fp, ensure_ascii=False, separators=(",", ":"))

    with open(OUT_INDEX, "w", encoding="utf-8") as fp:
        json.dump({"cell_size_deg": CELL_SIZE_DEG, "index": idx}, fp, ensure_ascii=False, separators=(",", ":"))

    dropped.to_csv(OUT_DROPPED, index=False)

    print(f"Facilities: {len(facilities)}")
    print(f"Index cells: {len(idx)}")
    print(f"Dropped rows: {len(dropped)} (see {OUT_DROPPED})")

if __name__ == "__main__":
    main()
