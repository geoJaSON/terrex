import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import Papa from "papaparse";
import type { FeatureCollection, Geometry, GeoJsonProperties } from "geojson";
import type { Layer } from "../types/layer";

type ExportData = FeatureCollection<Geometry, GeoJsonProperties>;

/**
 * Export a layer to GeoJSON. Pass `data` to export a subset (e.g. the active
 * filter result or the current selection); defaults to the full layer.
 */
export async function exportToGeoJSON(layer: Layer, data?: ExportData): Promise<void> {
  const path = await save({
    defaultPath: `${layer.name}.geojson`,
    filters: [{ name: "GeoJSON", extensions: ["geojson", "json"] }],
  });
  if (!path) return;

  const content = JSON.stringify(data ?? layer.data, null, 2);
  await invoke("write_file", { path, content });
}

/**
 * Export a layer's attributes to CSV. Pass `data` to export a subset
 * (filtered / selected); defaults to the full layer.
 */
export async function exportToCSV(layer: Layer, data?: ExportData): Promise<void> {
  const path = await save({
    defaultPath: `${layer.name}.csv`,
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (!path) return;

  // Flatten features to rows. Point coordinates are written as columns —
  // the CSV importer strips lat/lng columns into geometry, so omitting them
  // here would lose the coordinates on a CSV → CSV round trip.
  const rows = (data ?? layer.data).features.map((f) => {
    const row: Record<string, unknown> = { ...f.properties };
    if (f.geometry?.type === "Point") {
      const [lng, lat] = f.geometry.coordinates;
      if (!("longitude" in row)) row.longitude = lng;
      if (!("latitude" in row)) row.latitude = lat;
    }
    return row;
  });
  const content = Papa.unparse(rows);
  await invoke("write_file", { path, content });
}
