import { useState, useRef } from "react";
import { useMapStore } from "../../stores/mapStore";

/**
 * Parses coordinate strings in various formats:
 *  - Decimal Degrees (DD): "41.8781, -87.6298" or "41.8781 -87.6298"
 *  - Degrees Decimal Minutes (DDM): "41°52.686'N 87°37.788'W"
 *  - Degrees Minutes Seconds (DMS): "41°52'41.1\"N 87°37'47.3\"W"
 *  - Compact DMS: "41 52 41.1 N 87 37 47.3 W"
 * Returns { lat, lng } or null if parsing fails.
 */
function parseCoordinates(input: string): { lat: number; lng: number } | null {
  const s = input.trim();
  if (!s) return null;

  // 1. Try simple decimal degree pair: "lat, lon" or "lat lon"
  const ddMatch = s.match(/^(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)$/);
  if (ddMatch) {
    const val1 = parseFloat(ddMatch[1]);
    const val2 = parseFloat(ddMatch[2]);
    // Heuristic: if val1 is within ±90 and val2 within ±180, assume lat,lon
    if (Math.abs(val1) <= 90 && Math.abs(val2) <= 180) {
      return { lat: val1, lng: val2 };
    }
    // Otherwise try lon,lat
    if (Math.abs(val2) <= 90 && Math.abs(val1) <= 180) {
      return { lat: val2, lng: val1 };
    }
    return null;
  }

  // 2. Try DMS / DDM with NSEW direction indicators
  //    Matches patterns like: 41°52'41.1"N  or  41 52 41.1 N  or  41°52.686'N
  const dmsRegex = /(\d+)[°\s]+(\d+(?:\.\d+)?)['\s]*(\d+(?:\.\d+))?["\s]*([NSEW])/gi;
  const parts = [...s.matchAll(dmsRegex)];

  if (parts.length === 2) {
    const parse = (m: RegExpMatchArray) => {
      const deg = parseFloat(m[1]);
      const min = parseFloat(m[2]);
      const sec = m[3] ? parseFloat(m[3]) : 0;
      const dir = m[4].toUpperCase();
      let dd = deg + min / 60 + sec / 3600;
      if (dir === "S" || dir === "W") dd = -dd;
      return { dd, dir };
    };

    const a = parse(parts[0]);
    const b = parse(parts[1]);

    // Determine which is lat and which is lon based on direction letters
    let lat: number, lng: number;
    if (a.dir === "N" || a.dir === "S") {
      lat = a.dd;
      lng = b.dd;
    } else {
      lng = a.dd;
      lat = b.dd;
    }

    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng };
    }
  }

  return null;
}

export function GoToSearch() {
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { setViewState, setSearchMarker, searchMarker } = useMapStore();

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;

    // Try coordinate parsing first
    const coords = parseCoordinates(q);
    if (coords) {
      setViewState({ longitude: coords.lng, latitude: coords.lat, zoom: 14 });
      setSearchMarker({ lng: coords.lng, lat: coords.lat, label: `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}` });
      return;
    }

    // Geocode with Nominatim
    setIsSearching(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`,
        { headers: { "User-Agent": "Terrex/0.1" } }
      );
      const data = await res.json();
      if (data && data.length > 0) {
        const place = data[0];
        const lat = parseFloat(place.lat);
        const lng = parseFloat(place.lon);
        setViewState({ longitude: lng, latitude: lat, zoom: 12 });
        setSearchMarker({ lng, lat, label: place.display_name.split(",")[0] });
      } else {
        // Could show a toast, but for now just do nothing
        console.warn("Location not found:", q);
      }
    } catch (err) {
      console.error("Geocoding failed:", err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleClear = () => {
    setSearchMarker(null);
    setQuery("");
  };

  return (
    <form className="goto-search-inline" onSubmit={handleSearch}>
      <span className="goto-search-inline__icon">🔍</span>
      <input
        ref={inputRef}
        type="text"
        className="goto-search-inline__input"
        placeholder="Search address or coordinate..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={isSearching}
      />
      {isSearching && <span className="goto-search-inline__spinner" />}
      {searchMarker && (
        <button type="button" className="goto-search-inline__clear" onClick={handleClear} title="Clear marker">
          ✕
        </button>
      )}
    </form>
  );
}
