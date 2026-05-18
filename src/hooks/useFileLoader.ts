import { useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useMapStore } from "../stores/mapStore";
import type { GeometryType, Layer } from "../types/layer";
import type {
  FeatureCollection,
  GeoJsonProperties,
  Geometry,
  Feature,
  Position,
} from "geojson";

// Format parsers
import shp from "shpjs";
import { kml as kmlToGeoJSON } from "@tmcw/togeojson";
import { DOMParser } from "@xmldom/xmldom";
import Papa from "papaparse";

function generateId(): string {
  return `layer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function detectGeometryType(
  fc: FeatureCollection<Geometry, GeoJsonProperties>
): GeometryType {
  for (const feature of fc.features) {
    if (feature.geometry) {
      return feature.geometry.type as GeometryType;
    }
  }
  return "Point";
}

function computeExtent(
  fc: FeatureCollection<Geometry, GeoJsonProperties>
): [number, number, number, number] | null {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  function processCoord(coord: Position) {
    const [lng, lat] = coord;
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }

  function processCoords(coords: Position[] | Position[][] | Position[][][]) {
    for (const item of coords) {
      if (typeof item[0] === "number") {
        processCoord(item as Position);
      } else {
        processCoords(item as Position[][] | Position[][][]);
      }
    }
  }

  for (const feature of fc.features) {
    if (!feature.geometry) continue;
    const geom = feature.geometry;
    switch (geom.type) {
      case "Point":
        processCoord(geom.coordinates);
        break;
      case "MultiPoint":
      case "LineString":
        processCoords(geom.coordinates);
        break;
      case "MultiLineString":
      case "Polygon":
        processCoords(geom.coordinates);
        break;
      case "MultiPolygon":
        processCoords(geom.coordinates);
        break;
    }
  }

  if (!isFinite(minLng)) return null;
  return [minLng, minLat, maxLng, maxLat];
}

function extractAttributes(
  fc: FeatureCollection<Geometry, GeoJsonProperties>
): string[] {
  const attrs = new Set<string>();
  for (const feature of fc.features) {
    if (feature.properties) {
      for (const key of Object.keys(feature.properties)) {
        attrs.add(key);
      }
    }
  }
  return Array.from(attrs).sort();
}

function getFileBasename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  const filename = parts[parts.length - 1];
  return filename.replace(/\.[^.]+$/, "");
}

function getFileExtension(path: string): string {
  const parts = path.split(".");
  return parts[parts.length - 1].toLowerCase();
}

// ── Lat/Lon column detection for CSV ──
const LAT_PATTERNS = [
  /^lat$/i, /^latitude$/i, /^y$/i, /^lat_dd$/i, /^point_y$/i,
  /^lat_wgs84$/i, /^lat_deg$/i,
];
const LNG_PATTERNS = [
  /^lon$/i, /^lng$/i, /^longitude$/i, /^long$/i, /^x$/i, /^lon_dd$/i,
  /^point_x$/i, /^lng_wgs84$/i, /^lon_wgs84$/i, /^lon_deg$/i,
];

function findColumnMatch(
  headers: string[],
  patterns: RegExp[]
): string | null {
  for (const pattern of patterns) {
    const match = headers.find((h) => pattern.test(h.trim()));
    if (match) return match.trim();
  }
  return null;
}

// ── Parse GeoJSON ──
async function parseGeoJSON(path: string): Promise<FeatureCollection> {
  const content: string = await invoke("read_file", { path });
  const parsed = JSON.parse(content);

  // Handle bare geometry or single feature
  if (parsed.type === "Feature") {
    return { type: "FeatureCollection", features: [parsed] };
  }
  if (parsed.type !== "FeatureCollection") {
    // Might be bare geometry
    return {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: parsed, properties: {} }],
    };
  }
  return parsed;
}

// ── Parse Shapefile (zip) ──
async function parseShapefile(path: string): Promise<FeatureCollection> {
  const bytes: number[] = await invoke("read_file_binary", { path });
  const buffer = new Uint8Array(bytes).buffer;
  const result = await shp(buffer);

  // shpjs can return an array if the zip has multiple shapefiles
  if (Array.isArray(result)) {
    return result[0] as FeatureCollection;
  }
  return result as FeatureCollection;
}

// ── Parse KML ──
async function parseKML(path: string): Promise<FeatureCollection> {
  const content: string = await invoke("read_file", { path });
  const dom = new DOMParser().parseFromString(content, "text/xml");
  return kmlToGeoJSON(dom) as FeatureCollection;
}

// ── Parse CSV ──
async function parseCSV(path: string): Promise<FeatureCollection> {
  const content: string = await invoke("read_file", { path });

  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
  });

  if (parsed.errors.length > 0) {
    console.warn("CSV parse warnings:", parsed.errors);
  }

  const headers = parsed.meta.fields || [];
  const latCol = findColumnMatch(headers, LAT_PATTERNS);
  const lngCol = findColumnMatch(headers, LNG_PATTERNS);

  if (!latCol || !lngCol) {
    throw new Error(
      `Could not detect latitude/longitude columns. Found headers: ${headers.join(", ")}. ` +
      `Expected columns matching lat/latitude/y and lon/lng/longitude/x.`
    );
  }

  const features: Feature[] = [];
  for (const row of parsed.data) {
    const lat = parseFloat(String(row[latCol]));
    const lng = parseFloat(String(row[lngCol]));

    if (isNaN(lat) || isNaN(lng)) continue;

    // Build properties excluding the coordinate columns
    const properties: GeoJsonProperties = {};
    for (const [key, value] of Object.entries(row)) {
      if (key !== latCol && key !== lngCol) {
        properties[key] = value;
      }
    }

    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [lng, lat],
      },
      properties,
    });
  }

  return { type: "FeatureCollection", features };
}

// ── Main file loader hook ──
export function useFileLoader() {
  const { addLayer, getNextColor } = useMapStore();

  const loadFromPath = useCallback(async (filePath: string) => {
    try {
      const ext = getFileExtension(filePath);

      let geojson: FeatureCollection<Geometry, GeoJsonProperties>;

      switch (ext) {
        case "zip":
          geojson = await parseShapefile(filePath);
          break;
        case "kml":
          geojson = await parseKML(filePath);
          break;
        case "csv":
          geojson = await parseCSV(filePath);
          break;
        default:
          geojson = await parseGeoJSON(filePath);
          break;
      }

      if (!geojson.features || !Array.isArray(geojson.features)) {
        throw new Error("Invalid data: no features found after parsing");
      }

      // Assign stable IDs for selection tracking
      geojson.features = geojson.features.map((f, i) => ({
        ...f,
        id: i,
      }));

      const color = getNextColor();
      const layer: Layer = {
        id: generateId(),
        name: getFileBasename(filePath),
        fileName: filePath,
        geometryType: detectGeometryType(geojson),
        source: "local",
        visible: true,
        style: {
          color,
          opacity: 0.7,
          strokeColor: color,
          strokeWidth: 2,
          pointRadius: 6,
        },
        data: geojson,
        featureCount: geojson.features.length,
        extent: computeExtent(geojson),
        attributes: extractAttributes(geojson),
      };

      addLayer(layer);
      return layer;
    } catch (error) {
      console.error("Failed to load file:", error);
      throw error;
    }
  }, [addLayer, getNextColor]);

  const loadFile = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [
        { name: "Geospatial Files", extensions: ["geojson", "json", "zip", "kml", "csv"] },
        { name: "GeoJSON", extensions: ["geojson", "json"] },
        { name: "Shapefile (ZIP)", extensions: ["zip"] },
        { name: "KML", extensions: ["kml"] },
        { name: "CSV", extensions: ["csv"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (!selected) return;
    return loadFromPath(selected as string);
  }, [loadFromPath]);

  return { loadFile, loadFromPath };
}
