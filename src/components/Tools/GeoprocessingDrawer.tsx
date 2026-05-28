import { useState } from "react";
import * as turf from "@turf/turf";
import type { FeatureCollection, Feature, Geometry, GeoJsonProperties } from "geojson";
import { useMapStore } from "../../stores/mapStore";
import type { Layer } from "../../types/layer";

// ── Tool definitions ────────────────────────────────────────────────────────

type Operation =
  | "buffer" | "dissolve" | "envelope" | "convex"
  | "center" | "simplify" | "voronoi" | "pointsWithinPolygon";

const TOOLS: { id: Operation; name: string; icon: string; desc: string }[] = [
  { id: "buffer",               name: "Buffer",                icon: "⭕", desc: "Expand features by a distance" },
  { id: "dissolve",             name: "Dissolve",              icon: "🔗", desc: "Merge features by a field value" },
  { id: "envelope",             name: "Envelope",              icon: "📦", desc: "Bounding box of all features" },
  { id: "convex",               name: "Convex Hull",           icon: "🔷", desc: "Minimum convex polygon" },
  { id: "center",               name: "Center Points",         icon: "📍", desc: "Centroid of each feature" },
  { id: "simplify",             name: "Simplify",              icon: "〰",  desc: "Reduce vertex count" },
  { id: "voronoi",              name: "Voronoi Polygons",      icon: "🕸",  desc: "Voronoi diagram from points" },
  { id: "pointsWithinPolygon",  name: "Points Within Polygon", icon: "🎯", desc: "Filter points inside polygons" },
];

const OP_NAMES: Record<Operation, string> = {
  buffer: "Buffer",
  dissolve: "Dissolve",
  envelope: "Envelope",
  convex: "Convex Hull",
  center: "Center Points",
  simplify: "Simplify",
  voronoi: "Voronoi Polygons",
  pointsWithinPolygon: "Points Within Polygon",
};

// ── Tool parameter dialog ────────────────────────────────────────────────────

interface ToolParamDialogProps {
  operation: Operation;
  layer: Layer;
  onClose: () => void;
}

function ToolParamDialog({ operation, layer, onClose }: ToolParamDialogProps) {
  const { layers, addLayer, getNextColor } = useMapStore();

  const [bufferRadius, setBufferRadius] = useState(100);
  const [bufferUnit, setBufferUnit] = useState<turf.Units>("meters");
  const [dissolveProperty, setDissolveProperty] = useState("");
  const [simplifyTolerance, setSimplifyTolerance] = useState(0.01);
  const [secondaryLayerId, setSecondaryLayerId] = useState("");

  const polygonLayers = layers.filter(
    l => l.id !== layer.id && (l.geometryType === "Polygon" || l.geometryType === "MultiPolygon")
  );
  const secondaryLayer = layers.find(l => l.id === secondaryLayerId);

  const generateId = () => `layer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const detectGeometryType = (fc: FeatureCollection<Geometry, GeoJsonProperties>) => {
    for (const f of fc.features) {
      if (f.geometry) return f.geometry.type;
    }
    return "Point";
  };

  const computeExtent = (fc: FeatureCollection<Geometry, GeoJsonProperties>) => {
    try {
      if (!fc.features.length) return null;
      return turf.bbox(fc) as [number, number, number, number];
    } catch {
      return null;
    }
  };

  const handleRun = () => {
    try {
      let result: FeatureCollection<Geometry, GeoJsonProperties> | Feature<Geometry, GeoJsonProperties> | null = null;
      const data = layer.data;

      switch (operation) {
        case "buffer":
          result = turf.buffer(data, bufferRadius, { units: bufferUnit }) ?? null;
          break;
        case "dissolve":
          if (layer.geometryType !== "Polygon" && layer.geometryType !== "MultiPolygon") {
            alert("Dissolve only works on polygon layers.");
            return;
          }
          result = turf.dissolve(data as any, { propertyName: dissolveProperty });
          break;
        case "envelope":
          result = turf.envelope(data);
          break;
        case "convex":
          result = turf.convex(data);
          break;
        case "center": {
          const centers = data.features.map(f => turf.center(f));
          result = turf.featureCollection(centers);
          break;
        }
        case "simplify":
          result = turf.simplify(data, { tolerance: simplifyTolerance, highQuality: true, mutate: false });
          break;
        case "voronoi": {
          const bb = turf.bbox(data);
          result = turf.voronoi(data as any, { bbox: bb });
          break;
        }
        case "pointsWithinPolygon":
          if (!secondaryLayer) {
            alert("Please select a polygon layer.");
            return;
          }
          result = turf.pointsWithinPolygon(data as any, secondaryLayer.data as any);
          break;
      }

      if (!result) {
        alert("Operation produced no output.");
        return;
      }

      const resultFC: FeatureCollection<Geometry, GeoJsonProperties> =
        result.type === "Feature"
          ? turf.featureCollection([result as any])
          : result as FeatureCollection;

      resultFC.features = resultFC.features.map((f, i) => ({ ...f, id: i }));

      const color = getNextColor();
      addLayer({
        id: generateId(),
        name: `${layer.name} – ${OP_NAMES[operation]}`,
        geometryType: detectGeometryType(resultFC) as any,
        source: "local",
        visible: true,
        style: { color, opacity: 0.7, strokeColor: color, strokeWidth: 2, pointRadius: 6 },
        data: resultFC,
        featureCount: resultFC.features.length,
        extent: computeExtent(resultFC),
        attributes: layer.attributes,
      });

      onClose();
    } catch (err: any) {
      console.error(err);
      alert(`Geoprocessing failed: ${err.message || err}`);
    }
  };

  const noParams = ["envelope", "convex", "center", "voronoi"].includes(operation);

  return (
    <div
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex", justifyContent: "center", alignItems: "center",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: "var(--bg-primary)",
          padding: "16px",
          borderRadius: "8px",
          width: "340px",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: "4px", fontSize: "15px" }}>
          {OP_NAMES[operation]}
        </h3>
        <div style={{ marginBottom: "16px", fontSize: "12px", color: "var(--text-secondary)" }}>
          Input: <strong>{layer.name}</strong>
        </div>

        {operation === "buffer" && (
          <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", marginBottom: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                Distance
              </label>
              <input
                type="number"
                className="input"
                value={bufferRadius}
                onChange={e => setBufferRadius(parseFloat(e.target.value))}
                style={{ width: "100%" }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", marginBottom: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                Unit
              </label>
              <select
                className="input"
                value={bufferUnit}
                onChange={e => setBufferUnit(e.target.value as turf.Units)}
                style={{ width: "100%" }}
              >
                <option value="meters">Meters</option>
                <option value="kilometers">Kilometers</option>
                <option value="feet">Feet</option>
                <option value="miles">Miles</option>
              </select>
            </div>
          </div>
        )}

        {operation === "simplify" && (
          <div style={{ marginBottom: "12px" }}>
            <label style={{ display: "block", marginBottom: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
              Tolerance (degrees)
            </label>
            <input
              type="number"
              step="0.001"
              className="input"
              value={simplifyTolerance}
              onChange={e => setSimplifyTolerance(parseFloat(e.target.value))}
              style={{ width: "100%" }}
            />
          </div>
        )}

        {operation === "dissolve" && (
          <div style={{ marginBottom: "12px" }}>
            <label style={{ display: "block", marginBottom: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
              Dissolve Field (optional)
            </label>
            <select
              className="input"
              value={dissolveProperty}
              onChange={e => setDissolveProperty(e.target.value)}
              style={{ width: "100%" }}
            >
              <option value="">— Dissolve all —</option>
              {layer.attributes.map(attr => (
                <option key={attr} value={attr}>{attr}</option>
              ))}
            </select>
          </div>
        )}

        {operation === "pointsWithinPolygon" && (
          <div style={{ marginBottom: "12px" }}>
            <label style={{ display: "block", marginBottom: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
              Polygon Layer
            </label>
            <select
              className="input"
              value={secondaryLayerId}
              onChange={e => setSecondaryLayerId(e.target.value)}
              style={{ width: "100%" }}
            >
              <option value="">Select polygon layer…</option>
              {polygonLayers.map(l => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
        )}

        {noParams && (
          <div
            style={{
              marginBottom: "12px", fontSize: "12px",
              color: "var(--text-secondary)",
              padding: "8px", background: "var(--bg-tertiary)", borderRadius: "4px",
            }}
          >
            No parameters needed. Click Run to create the result layer.
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }}>
          <button className="btn btn--outline" onClick={onClose}>Cancel</button>
          <button
            className="btn btn--primary"
            onClick={handleRun}
            disabled={operation === "pointsWithinPolygon" && !secondaryLayerId}
          >
            Run
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Geoprocessing drawer ─────────────────────────────────────────────────────

export function GeoprocessingDrawer() {
  const { geoprocessingDrawerOpen, toggleGeoprocessingDrawer, layers, activeLayerId } = useMapStore();
  const [activeTool, setActiveTool] = useState<Operation | null>(null);

  const activeLayer = layers.find(l => l.id === activeLayerId && l.geometryType !== "Raster");

  if (!geoprocessingDrawerOpen) return null;

  return (
    <>
      <div className="edit-panel">
        <div className="edit-panel__header">
          <span className="edit-panel__title">Geoprocessing</span>
          <button
            className="icon-btn icon-btn--sm"
            onClick={toggleGeoprocessingDrawer}
            title="Close"
          >
            ✕
          </button>
        </div>

        {activeLayer ? (
          <>
            <div className="geo-drawer__layer-badge">
              <span style={{ color: activeLayer.style.color, fontSize: "10px" }}>■</span>
              <span className="geo-drawer__layer-name">{activeLayer.name}</span>
            </div>
            <div className="edit-panel__fields" style={{ padding: "var(--space-2)" }}>
              {TOOLS.map(tool => (
                <button
                  key={tool.id}
                  className="geo-tool-card"
                  onClick={() => setActiveTool(tool.id)}
                >
                  <span className="geo-tool-card__icon">{tool.icon}</span>
                  <div className="geo-tool-card__text">
                    <div className="geo-tool-card__name">{tool.name}</div>
                    <div className="geo-tool-card__desc">{tool.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="geo-drawer__empty">
            <div style={{ fontSize: "1.5rem" }}>🛠</div>
            <div>Select a layer in the layer list to use geoprocessing tools.</div>
          </div>
        )}
      </div>

      {activeTool && activeLayer && (
        <ToolParamDialog
          operation={activeTool}
          layer={activeLayer}
          onClose={() => setActiveTool(null)}
        />
      )}
    </>
  );
}
