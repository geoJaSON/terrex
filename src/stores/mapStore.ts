import { create } from "zustand";
import bbox from "@turf/bbox";
import type { Layer, ViewState } from "../types/layer";
import type { FeatureCollection, Geometry, GeoJsonProperties, Feature } from "geojson";

const LAYER_COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#3b82f6",
  "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#84cc16",
];

// ── Filter types ──
export type FilterOperator =
  | "=" | "!=" | ">" | "<" | ">=" | "<="
  | "LIKE" | "NOT LIKE" | "IN" | "IS NULL" | "IS NOT NULL";

export interface FilterCondition {
  id: string;
  attribute: string;
  operator: FilterOperator;
  value: string;
}

export interface LayerFilter {
  conditions: FilterCondition[];
  matchMode: "all" | "any"; // AND / OR
  active: boolean;
}

// ── Edit history ──
interface EditEntry {
  layerId: string;
  featureId: number;
  attribute: string;
  oldValue: unknown;
  newValue: unknown;
}

interface MapState {
  // View
  viewState: ViewState;
  setViewState: (vs: Partial<ViewState>) => void;
  flyToExtent: (bbox: [number, number, number, number]) => void;

  // Layers
  layers: Layer[];
  activeLayerId: string | null;
  addLayer: (layer: Layer) => void;
  removeLayer: (id: string) => void;
  toggleLayerVisibility: (id: string) => void;
  setActiveLayer: (id: string | null) => void;
  updateLayerStyle: (id: string, style: Partial<Layer["style"]>) => void;
  reorderLayers: (fromIndex: number, toIndex: number) => void;
  // Replace a layer's features in place (used by online-layer refresh),
  // recomputing featureCount / extent / attributes and keeping style & order.
  replaceLayerData: (id: string, data: FeatureCollection<Geometry, GeoJsonProperties>) => void;
  setLayerLoading: (id: string, loading: boolean) => void;

  // Selection
  selectedFeatureIds: Set<number>;
  setSelectedFeatures: (ids: Set<number>) => void;
  clearSelection: () => void;

  // Cursor coordinates
  cursorCoords: { lng: number; lat: number } | null;
  setCursorCoords: (coords: { lng: number; lat: number } | null) => void;

  // Search marker
  searchMarker: { lng: number; lat: number; label?: string } | null;
  setSearchMarker: (marker: { lng: number; lat: number; label?: string } | null) => void;

  // Attribute table
  attributeTableVisible: boolean;
  toggleAttributeTable: () => void;
  setAttributeTableVisible: (v: boolean) => void;

  // Geoprocessing drawer
  geoprocessingDrawerOpen: boolean;
  toggleGeoprocessingDrawer: () => void;

  // Filter
  filters: Record<string, LayerFilter>;
  filterBarVisible: boolean;
  setFilterBarVisible: (v: boolean) => void;
  toggleFilterBar: () => void;
  setFilter: (layerId: string, filter: LayerFilter) => void;
  clearFilter: (layerId: string) => void;
  getFilteredData: (layerId: string) => FeatureCollection<Geometry, GeoJsonProperties>;
  getUniqueValues: (layerId: string, attribute: string) => unknown[];

  // Editing
  updateFeatureProperty: (layerId: string, featureId: number, attr: string, value: unknown) => void;
  batchUpdateFeatureProperty: (layerId: string, featureIds: number[], attr: string, value: unknown) => void;
  batchUpdateFeatureProperties: (layerId: string, featureIdValueMap: Record<number, unknown>, attr: string) => void;
  editHistory: EditEntry[];
  editHistoryIndex: number;
  undo: () => void;
  redo: () => void;

  // Color assignment
  getNextColor: () => string;

  // Pending flyTo
  pendingFlyTo: [number, number, number, number] | null;
  clearPendingFlyTo: () => void;
}

// ── Filter evaluation ──
function evaluateCondition(
  value: unknown,
  operator: FilterOperator,
  filterValue: string
): boolean {
  if (operator === "IS NULL") return value === null || value === undefined || value === "";
  if (operator === "IS NOT NULL") return value !== null && value !== undefined && value !== "";

  const strVal = String(value ?? "");
  const numVal = Number(value);
  const filterNum = Number(filterValue);
  const bothNumeric = !isNaN(numVal) && !isNaN(filterNum) && filterValue !== "";

  switch (operator) {
    case "=":
      return bothNumeric ? numVal === filterNum : strVal.toLowerCase() === filterValue.toLowerCase();
    case "!=":
      return bothNumeric ? numVal !== filterNum : strVal.toLowerCase() !== filterValue.toLowerCase();
    case ">":
      return bothNumeric ? numVal > filterNum : strVal > filterValue;
    case "<":
      return bothNumeric ? numVal < filterNum : strVal < filterValue;
    case ">=":
      return bothNumeric ? numVal >= filterNum : strVal >= filterValue;
    case "<=":
      return bothNumeric ? numVal <= filterNum : strVal <= filterValue;
    case "LIKE":
      // Simple wildcard: % at start/end
      const pattern = filterValue.toLowerCase().replace(/%/g, ".*");
      return new RegExp(`^${pattern}$`, "i").test(strVal);
    case "NOT LIKE":
      const patternNot = filterValue.toLowerCase().replace(/%/g, ".*");
      return !new RegExp(`^${patternNot}$`, "i").test(strVal);
    case "IN": {
      const values = filterValue.split(",").map((v) => v.trim().toLowerCase());
      return values.includes(strVal.toLowerCase());
    }
    default:
      return true;
  }
}

function applyFilter(
  data: FeatureCollection<Geometry, GeoJsonProperties>,
  filter: LayerFilter
): FeatureCollection<Geometry, GeoJsonProperties> {
  if (!filter.active || filter.conditions.length === 0) return data;

  const validConditions = filter.conditions.filter(
    (c) => c.attribute && (c.operator === "IS NULL" || c.operator === "IS NOT NULL" || c.value !== "")
  );
  if (validConditions.length === 0) return data;

  const features = data.features.filter((feature) => {
    const results = validConditions.map((cond) => {
      const val = feature.properties?.[cond.attribute];
      return evaluateCondition(val, cond.operator, cond.value);
    });
    return filter.matchMode === "all"
      ? results.every(Boolean)
      : results.some(Boolean);
  });

  return { ...data, features };
}

export const useMapStore = create<MapState>((set, get) => ({
  // View
  viewState: { longitude: -98.5, latitude: 39.8, zoom: 4, bearing: 0, pitch: 0 },
  setViewState: (vs) => set((state) => ({ viewState: { ...state.viewState, ...vs } })),
  flyToExtent: (bbox) => set({ pendingFlyTo: bbox }),

  // Layers
  layers: [],
  activeLayerId: null,
  addLayer: (layer) => set((state) => ({ layers: [...state.layers, layer], activeLayerId: layer.id })),
  removeLayer: (id) =>
    set((state) => ({
      layers: state.layers.filter((l) => l.id !== id),
      activeLayerId: state.activeLayerId === id ? null : state.activeLayerId,
      selectedFeatureIds: state.activeLayerId === id ? new Set() : state.selectedFeatureIds,
    })),
  toggleLayerVisibility: (id) =>
    set((state) => ({ layers: state.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)) })),
  setActiveLayer: (id) => set({ activeLayerId: id }),
  updateLayerStyle: (id, style) =>
    set((state) => ({ layers: state.layers.map((l) => (l.id === id ? { ...l, style: { ...l.style, ...style } } : l)) })),
  reorderLayers: (fromIndex, toIndex) =>
    set((state) => {
      const nl = [...state.layers];
      const [m] = nl.splice(fromIndex, 1);
      nl.splice(toIndex, 0, m);
      return { layers: nl };
    }),
  replaceLayerData: (id, data) =>
    set((state) => {
      const features = data.features.map((f, i) => ({ ...f, id: i }));
      const attrs = new Set<string>();
      let geomType: Layer["geometryType"] = "Point";
      let geomFound = false;
      for (const f of features) {
        if (f.properties) for (const k of Object.keys(f.properties)) attrs.add(k);
        if (!geomFound && f.geometry?.type) {
          geomType = f.geometry.type as Layer["geometryType"];
          geomFound = true;
        }
      }
      const fc = { type: "FeatureCollection", features } as FeatureCollection<Geometry, GeoJsonProperties>;
      const extent =
        features.length > 0 ? (bbox(fc) as [number, number, number, number]) : null;
      return {
        layers: state.layers.map((l) =>
          l.id === id
            ? {
                ...l,
                data: fc,
                featureCount: features.length,
                extent,
                attributes: Array.from(attrs).sort(),
                geometryType: geomType,
                loading: false,
              }
            : l
        ),
        // Stale selection no longer maps to refreshed feature ids.
        selectedFeatureIds: state.activeLayerId === id ? new Set<number>() : state.selectedFeatureIds,
      };
    }),
  setLayerLoading: (id, loading) =>
    set((state) => ({
      layers: state.layers.map((l) => (l.id === id ? { ...l, loading } : l)),
    })),

  // Selection
  selectedFeatureIds: new Set(),
  setSelectedFeatures: (ids) => set({ selectedFeatureIds: ids }),
  clearSelection: () => set({ selectedFeatureIds: new Set() }),

  // Cursor
  cursorCoords: null,
  setCursorCoords: (coords) => set({ cursorCoords: coords }),

  // Search marker
  searchMarker: null,
  setSearchMarker: (marker) => set({ searchMarker: marker }),

  // Attribute table
  attributeTableVisible: false,
  toggleAttributeTable: () => set((s) => ({ attributeTableVisible: !s.attributeTableVisible })),
  setAttributeTableVisible: (v) => set({ attributeTableVisible: v }),

  // Geoprocessing drawer
  geoprocessingDrawerOpen: false,
  toggleGeoprocessingDrawer: () => set((s) => ({ geoprocessingDrawerOpen: !s.geoprocessingDrawerOpen })),

  // Filters
  filters: {},
  filterBarVisible: false,
  setFilterBarVisible: (v) => set({ filterBarVisible: v }),
  toggleFilterBar: () => set((s) => ({ filterBarVisible: !s.filterBarVisible })),
  setFilter: (layerId, filter) =>
    set((s) => ({ filters: { ...s.filters, [layerId]: filter } })),
  clearFilter: (layerId) =>
    set((s) => {
      const f = { ...s.filters };
      delete f[layerId];
      return { filters: f };
    }),
  getFilteredData: (layerId) => {
    const { layers, filters } = get();
    const layer = layers.find((l) => l.id === layerId);
    if (!layer) return { type: "FeatureCollection", features: [] };
    const filter = filters[layerId];
    if (!filter) return layer.data;
    return applyFilter(layer.data, filter);
  },
  getUniqueValues: (layerId, attribute) => {
    const { layers } = get();
    const layer = layers.find((l) => l.id === layerId);
    if (!layer) return [];
    const vals = new Set<unknown>();
    for (const f of layer.data.features) {
      if (f.properties && f.properties[attribute] !== undefined && f.properties[attribute] !== null) {
        vals.add(f.properties[attribute]);
      }
    }
    return Array.from(vals).sort().slice(0, 200);
  },

  // Editing
  editHistory: [],
  editHistoryIndex: -1,
  updateFeatureProperty: (layerId, featureId, attr, value) => {
    set((state) => {
      const layers = state.layers.map((l) => {
        if (l.id !== layerId) return l;
        const features = l.data.features.map((f) => {
          if ((f.id as number) !== featureId) return f;
          const newProps = { ...f.properties, [attr]: value };
          return { ...f, properties: newProps } as Feature<Geometry, GeoJsonProperties>;
        });
        return { ...l, data: { ...l.data, features } };
      });
      // Find old value for history
      const layer = state.layers.find((l) => l.id === layerId);
      const feature = layer?.data.features.find((f) => (f.id as number) === featureId);
      const oldValue = feature?.properties?.[attr];
      const newHistory = [...state.editHistory.slice(0, state.editHistoryIndex + 1), { layerId, featureId, attribute: attr, oldValue, newValue: value }];
      return { layers, editHistory: newHistory, editHistoryIndex: newHistory.length - 1 };
    });
  },
  batchUpdateFeatureProperty: (layerId, featureIds, attr, value) => {
    set((state) => {
      const idSet = new Set(featureIds);
      const entries: EditEntry[] = [];
      const layers = state.layers.map((l) => {
        if (l.id !== layerId) return l;
        const features = l.data.features.map((f) => {
          if (!idSet.has(f.id as number)) return f;
          entries.push({ layerId, featureId: f.id as number, attribute: attr, oldValue: f.properties?.[attr], newValue: value });
          return { ...f, properties: { ...f.properties, [attr]: value } } as Feature<Geometry, GeoJsonProperties>;
        });
        return { ...l, data: { ...l.data, features } };
      });
      const newHistory = [...state.editHistory.slice(0, state.editHistoryIndex + 1), ...entries];
      return { layers, editHistory: newHistory, editHistoryIndex: newHistory.length - 1 };
    });
  },
  batchUpdateFeatureProperties: (layerId, featureIdValueMap, attr) => {
    set((state) => {
      const entries: EditEntry[] = [];
      const layers = state.layers.map((l) => {
        if (l.id !== layerId) return l;
        const features = l.data.features.map((f) => {
          const fid = f.id as number;
          if (!(fid in featureIdValueMap)) return f;
          const newValue = featureIdValueMap[fid];
          entries.push({ layerId, featureId: fid, attribute: attr, oldValue: f.properties?.[attr], newValue });
          return { ...f, properties: { ...f.properties, [attr]: newValue } } as Feature<Geometry, GeoJsonProperties>;
        });
        return { ...l, data: { ...l.data, features } };
      });
      const newHistory = [...state.editHistory.slice(0, state.editHistoryIndex + 1), ...entries];
      return { layers, editHistory: newHistory, editHistoryIndex: newHistory.length - 1 };
    });
  },
  undo: () => {
    const { editHistory, editHistoryIndex } = get();
    if (editHistoryIndex < 0) return;
    const entry = editHistory[editHistoryIndex];
    set((state) => {
      const layers = state.layers.map((l) => {
        if (l.id !== entry.layerId) return l;
        const features = l.data.features.map((f) => {
          if ((f.id as number) !== entry.featureId) return f;
          return { ...f, properties: { ...f.properties, [entry.attribute]: entry.oldValue } } as Feature<Geometry, GeoJsonProperties>;
        });
        return { ...l, data: { ...l.data, features } };
      });
      return { layers, editHistoryIndex: state.editHistoryIndex - 1 };
    });
  },
  redo: () => {
    const { editHistory, editHistoryIndex } = get();
    if (editHistoryIndex >= editHistory.length - 1) return;
    const entry = editHistory[editHistoryIndex + 1];
    set((state) => {
      const layers = state.layers.map((l) => {
        if (l.id !== entry.layerId) return l;
        const features = l.data.features.map((f) => {
          if ((f.id as number) !== entry.featureId) return f;
          return { ...f, properties: { ...f.properties, [entry.attribute]: entry.newValue } } as Feature<Geometry, GeoJsonProperties>;
        });
        return { ...l, data: { ...l.data, features } };
      });
      return { layers, editHistoryIndex: state.editHistoryIndex + 1 };
    });
  },

  // Color
  getNextColor: () => { const { layers } = get(); return LAYER_COLORS[layers.length % LAYER_COLORS.length]; },

  // FlyTo
  pendingFlyTo: null,
  clearPendingFlyTo: () => set({ pendingFlyTo: null }),
}));
