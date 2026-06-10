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
import * as GeoTIFF from "geotiff";
import fgdb from "fgdb";

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
  if (!fc.features || fc.features.length === 0) return null;
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
  if (!fc.features) return [];
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

  if (parsed.type === "Feature") {
    return { type: "FeatureCollection", features: [parsed] };
  }
  if (parsed.type !== "FeatureCollection") {
    return {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: parsed, properties: {} }],
    };
  }
  return parsed;
}

// ── Parse Shapefile (zip) ──
async function parseShapefile(path: string): Promise<FeatureCollection | FeatureCollection[]> {
  const bytes: number[] = await invoke("read_file_binary", { path });
  const buffer = new Uint8Array(bytes).buffer;
  return await shp(buffer);
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

  const headers = parsed.meta.fields || [];
  const latCol = findColumnMatch(headers, LAT_PATTERNS);
  const lngCol = findColumnMatch(headers, LNG_PATTERNS);

  if (!latCol || !lngCol) {
    throw new Error(`Could not detect latitude/longitude columns.`);
  }

  const features: Feature[] = [];
  for (const row of parsed.data) {
    const lat = parseFloat(String(row[latCol]));
    const lng = parseFloat(String(row[lngCol]));
    if (isNaN(lat) || isNaN(lng)) continue;

    const properties: GeoJsonProperties = {};
    for (const [key, value] of Object.entries(row)) {
      if (key !== latCol && key !== lngCol) {
        properties[key] = value;
      }
    }

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties,
    });
  }

  return { type: "FeatureCollection", features };
}

// ── Parse FGDB ──
async function parseFGDB(path: string): Promise<Record<string, FeatureCollection>> {
  const bytes: number[] = await invoke("read_file_binary", { path });
  const buffer = new Uint8Array(bytes).buffer;
  const result = await fgdb(buffer);
  return result;
}

async function parseFGDBBuffer(buffer: ArrayBuffer): Promise<Record<string, FeatureCollection>> {
  const result = await fgdb(buffer);
  return result;
}

// ── Parse GeoTIFF ──
async function parseGeoTIFF(path: string): Promise<{ dataUrl: string; coordinates: [[number, number], [number, number], [number, number], [number, number]]; extent: [number, number, number, number] }> {
  const bytes: number[] = await invoke("read_file_binary", { path });
  const buffer = new Uint8Array(bytes).buffer;
  return await processGeoTIFFBuffer(buffer);
}

async function processGeoTIFFBuffer(buffer: ArrayBuffer) {
  const tiff = await GeoTIFF.fromArrayBuffer(buffer);
  const image = await tiff.getImage();

  // The map only understands geographic WGS84 — a projected GeoTIFF would
  // have its meter coordinates read as lng/lat and land nowhere near the
  // right place (or break the view entirely). Fail with guidance instead.
  const geoKeys = image.getGeoKeys?.() ?? {};
  const projectedEpsg = geoKeys.ProjectedCSTypeGeoKey;
  const geographicEpsg = geoKeys.GeographicTypeGeoKey;
  if (projectedEpsg && projectedEpsg !== 4326) {
    throw new Error(
      `This GeoTIFF uses a projected coordinate system (EPSG:${projectedEpsg}). ` +
        `Only geographic WGS84 (EPSG:4326) is supported — reproject it first, ` +
        `e.g. gdalwarp -t_srs EPSG:4326 input.tif output.tif`
    );
  }
  if (geographicEpsg && geographicEpsg !== 4326) {
    throw new Error(
      `This GeoTIFF uses EPSG:${geographicEpsg}. Only WGS84 (EPSG:4326) is supported — ` +
        `reproject it first, e.g. gdalwarp -t_srs EPSG:4326 input.tif output.tif`
    );
  }

  const bbox = image.getBoundingBox();
  const [minLng, minLat, maxLng, maxLat] = bbox;

  // No (or user-defined) geokeys: sanity-check that the bounds are plausible
  // longitude/latitude before drawing.
  if (minLng < -180 || maxLng > 180 || minLat < -90 || maxLat > 90) {
    throw new Error(
      `This GeoTIFF's bounds (${minLng.toFixed(1)}, ${minLat.toFixed(1)}) – ` +
        `(${maxLng.toFixed(1)}, ${maxLat.toFixed(1)}) are not valid longitude/latitude. ` +
        `It is likely in a projected coordinate system — reproject to EPSG:4326 first.`
    );
  }
  const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
    [minLng, maxLat], // NW
    [maxLng, maxLat], // NE
    [maxLng, minLat], // SE
    [minLng, minLat]  // SW
  ];
  
  const rgb = await image.readRGB(); 
  const width = image.getWidth();
  const height = image.getHeight();
  
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create canvas context");
  
  const imageData = ctx.createImageData(width, height);
  let j = 0;
  for (let i = 0; i < rgb.length; i += 3) {
    imageData.data[j++] = (rgb as any)[i];
    imageData.data[j++] = (rgb as any)[i + 1];
    imageData.data[j++] = (rgb as any)[i + 2];
    imageData.data[j++] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  const dataUrl = canvas.toDataURL("image/png");
  
  return {
    dataUrl,
    coordinates,
    extent: [minLng, minLat, maxLng, maxLat] as [number, number, number, number]
  };
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function useFileLoader() {
  const { addLayer, getNextColor } = useMapStore();

  const processVectorLayer = useCallback((geojson: FeatureCollection, name: string, fileName?: string): Layer => {
    geojson.features = geojson.features.map((f, i) => ({ ...f, id: i }));
    const color = getNextColor();
    return {
      id: generateId(),
      name,
      fileName,
      geometryType: detectGeometryType(geojson),
      source: "local",
      visible: true,
      style: { color, opacity: 0.7, strokeColor: color, strokeWidth: 2, pointRadius: 6 },
      data: geojson,
      featureCount: geojson.features.length,
      extent: computeExtent(geojson),
      attributes: extractAttributes(geojson),
    };
  }, [getNextColor]);

  const loadBrowserFile = useCallback(async (file: File): Promise<Layer | Layer[]> => {
    try {
      const ext = file.name.split(".").pop()?.toLowerCase();
      
      if (ext === "zip") {
        const buffer = await file.arrayBuffer();
        // Try FGDB first; a non-FGDB zip makes it throw (or yield no layers),
        // in which case the zip is treated as a shapefile archive.
        let fgdbResult: Record<string, FeatureCollection> | null = null;
        try {
          fgdbResult = await parseFGDBBuffer(buffer);
        } catch {
          fgdbResult = null;
        }
        if (fgdbResult && Object.keys(fgdbResult).length > 0) {
          const layers = Object.entries(fgdbResult).map(([name, fc]) => {
            const layer = processVectorLayer(fc, name, file.name);
            addLayer(layer);
            return layer;
          });
          return layers;
        }
        const result = await shp(buffer);
        if (Array.isArray(result)) {
          const layers = result.map((fc: FeatureCollection) => {
            const layer = processVectorLayer(fc, file.name.replace(/\.[^.]+$/, ""), file.name);
            addLayer(layer);
            return layer;
          });
          return layers;
        } else {
          const layer = processVectorLayer(result as FeatureCollection, file.name.replace(/\.[^.]+$/, ""), file.name);
          addLayer(layer);
          return layer;
        }
      } else if (ext === "tif" || ext === "tiff") {
        const buffer = await file.arrayBuffer();
        const rasterData = await processGeoTIFFBuffer(buffer);
        const layer: Layer = {
          id: generateId(),
          name: file.name.replace(/\.[^.]+$/, ""),
          fileName: file.name,
          geometryType: "Raster",
          source: "local",
          visible: true,
          style: { color: "#fff", opacity: 1, strokeColor: "#fff", strokeWidth: 0, pointRadius: 0 },
          data: { type: "FeatureCollection", features: [] },
          featureCount: 0,
          extent: rasterData.extent,
          attributes: [],
          rasterUrl: rasterData.dataUrl,
          rasterCoordinates: rasterData.coordinates,
        };
        addLayer(layer);
        return layer;
      }
      
      let geojson: FeatureCollection;
      
      if (ext === "kml") {
        const content = await file.text();
        const dom = new DOMParser().parseFromString(content, "text/xml");
        geojson = kmlToGeoJSON(dom) as FeatureCollection;
      } else if (ext === "csv") {
        const content = await file.text();
        const parsed = Papa.parse<Record<string, string>>(content, { header: true, skipEmptyLines: true, dynamicTyping: true });
        const headers = parsed.meta.fields || [];
        const latCol = findColumnMatch(headers, LAT_PATTERNS);
        const lngCol = findColumnMatch(headers, LNG_PATTERNS);
        if (!latCol || !lngCol) throw new Error(`Could not detect latitude/longitude columns.`);
        
        const features: Feature[] = [];
        for (const row of parsed.data) {
          const lat = parseFloat(String(row[latCol]));
          const lng = parseFloat(String(row[lngCol]));
          if (isNaN(lat) || isNaN(lng)) continue;
          
          const properties: GeoJsonProperties = {};
          for (const [key, value] of Object.entries(row)) {
            if (key !== latCol && key !== lngCol) properties[key] = value;
          }
          features.push({ type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties });
        }
        geojson = { type: "FeatureCollection", features };
      } else {
        const content = await file.text();
        const parsed = JSON.parse(content);
        if (parsed.type === "Feature") {
          geojson = { type: "FeatureCollection", features: [parsed] };
        } else if (parsed.type !== "FeatureCollection") {
          geojson = { type: "FeatureCollection", features: [{ type: "Feature", geometry: parsed, properties: {} }] };
        } else {
          geojson = parsed;
        }
      }

      if (!geojson.features || !Array.isArray(geojson.features)) throw new Error("Invalid data: no features found");
      
      const layer = processVectorLayer(geojson, file.name.replace(/\.[^.]+$/, ""), file.name);
      addLayer(layer);
      return layer;
    } catch (error) {
      console.error("Failed to parse browser file:", error);
      throw error;
    }
  }, [addLayer, processVectorLayer]);

  const loadFromPath = useCallback(async (filePath: string): Promise<Layer | Layer[]> => {
    try {
      const ext = getFileExtension(filePath);
      
      if (ext === "zip") {
        // Try FGDB first; a non-FGDB zip makes it throw (or yield no layers),
        // in which case the zip is treated as a shapefile archive.
        let fgdbResult: Record<string, FeatureCollection> | null = null;
        try {
          fgdbResult = await parseFGDB(filePath);
        } catch {
          fgdbResult = null;
        }
        if (fgdbResult && Object.keys(fgdbResult).length > 0) {
          const layers = Object.entries(fgdbResult).map(([name, fc]) => {
            const layer = processVectorLayer(fc, name, filePath);
            addLayer(layer);
            return layer;
          });
          return layers;
        }
        const result = await parseShapefile(filePath);
        if (Array.isArray(result)) {
          const layers = result.map((fc: FeatureCollection) => {
            const layer = processVectorLayer(fc, getFileBasename(filePath), filePath);
            addLayer(layer);
            return layer;
          });
          return layers;
        } else {
          const layer = processVectorLayer(result as FeatureCollection, getFileBasename(filePath), filePath);
          addLayer(layer);
          return layer;
        }
      } else if (ext === "tif" || ext === "tiff") {
        const rasterData = await parseGeoTIFF(filePath);
        const layer: Layer = {
          id: generateId(),
          name: getFileBasename(filePath),
          fileName: filePath,
          geometryType: "Raster",
          source: "local",
          visible: true,
          style: { color: "#fff", opacity: 1, strokeColor: "#fff", strokeWidth: 0, pointRadius: 0 },
          data: { type: "FeatureCollection", features: [] },
          featureCount: 0,
          extent: rasterData.extent,
          attributes: [],
          rasterUrl: rasterData.dataUrl,
          rasterCoordinates: rasterData.coordinates,
        };
        addLayer(layer);
        return layer;
      }
      
      let geojson: FeatureCollection;
      switch (ext) {
        case "kml": geojson = await parseKML(filePath); break;
        case "csv": geojson = await parseCSV(filePath); break;
        default: geojson = await parseGeoJSON(filePath); break;
      }

      if (!geojson.features || !Array.isArray(geojson.features)) throw new Error("Invalid data: no features found");

      const layer = processVectorLayer(geojson, getFileBasename(filePath), filePath);
      addLayer(layer);
      return layer;
    } catch (error) {
      console.error("Failed to load file:", error);
      throw error;
    }
  }, [addLayer, processVectorLayer]);

  const loadFile = useCallback(async () => {
    if (isTauri()) {
      try {
        const selected = await open({
          multiple: false,
          filters: [
            { name: "Geospatial Files", extensions: ["geojson", "json", "zip", "kml", "csv", "tif", "tiff"] },
            { name: "GeoJSON", extensions: ["geojson", "json"] },
            { name: "Shapefile/FGDB (ZIP)", extensions: ["zip"] },
            { name: "GeoTIFF", extensions: ["tif", "tiff"] },
            { name: "KML", extensions: ["kml"] },
            { name: "CSV", extensions: ["csv"] },
            { name: "All Files", extensions: ["*"] },
          ],
        });
        if (!selected) return;
        return loadFromPath(selected as string);
      } catch (err) {
        console.warn("Tauri dialog open failed, falling back to browser input:", err);
      }
    }

    return new Promise<Layer | Layer[] | undefined>((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".geojson,.json,.zip,.kml,.csv,.tif,.tiff";
      
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(undefined);
          return;
        }
        try {
          const layer = await loadBrowserFile(file);
          resolve(layer);
        } catch (err) {
          reject(err);
        }
      };
      
      input.onerror = (err) => {
        reject(err);
      };
      
      input.click();
    });
  }, [loadFromPath, loadBrowserFile]);

  return { loadFile, loadFromPath, loadBrowserFile };
}
