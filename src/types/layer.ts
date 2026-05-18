import type { FeatureCollection, GeoJsonProperties, Geometry } from "geojson";
import type { SavedConnection } from "../stores/connectionStore";

export type GeometryType =
  | "Point"
  | "MultiPoint"
  | "LineString"
  | "MultiLineString"
  | "Polygon"
  | "MultiPolygon";

export type LayerSource = "local" | "online";

export interface LayerStyle {
  color: string;
  opacity: number;
  strokeColor: string;
  strokeWidth: number;
  pointRadius: number;
}

export interface Layer {
  id: string;
  name: string;
  fileName?: string;
  geometryType: GeometryType;
  source: LayerSource;
  visible: boolean;
  style: LayerStyle;
  data: FeatureCollection<Geometry, GeoJsonProperties>;
  featureCount: number;
  extent: [number, number, number, number] | null; // [minLng, minLat, maxLng, maxLat]
  attributes: string[]; // list of attribute/property names
  // Present for online layers: the connection they were loaded from, so the
  // layer can be re-fetched in place ("refresh").
  connection?: SavedConnection;
}

export interface ViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  bearing: number;
  pitch: number;
}
