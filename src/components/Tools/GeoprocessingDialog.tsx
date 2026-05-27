import React, { useState } from "react";
import { useMapStore } from "../../stores/mapStore";
import * as turf from "@turf/turf";
import type { FeatureCollection, Feature, Geometry, GeoJsonProperties } from "geojson";
import type { Layer } from "../../types/layer";

interface GeoprocessingDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type Operation = "buffer" | "dissolve" | "envelope" | "convex" | "center" | "simplify" | "voronoi" | "pointsWithinPolygon";

export function GeoprocessingDialog({ isOpen, onClose }: GeoprocessingDialogProps) {
  const { layers, addLayer, getNextColor } = useMapStore();
  
  const [selectedLayerId, setSelectedLayerId] = useState<string>("");
  const [secondaryLayerId, setSecondaryLayerId] = useState<string>("");
  const [operation, setOperation] = useState<Operation>("buffer");
  const [bufferRadius, setBufferRadius] = useState<number>(100);
  const [bufferUnit, setBufferUnit] = useState<turf.Units>("meters");
  const [dissolveProperty, setDissolveProperty] = useState<string>("");
  const [simplifyTolerance, setSimplifyTolerance] = useState<number>(0.01);

  if (!isOpen) return null;

  const vectorLayers = layers.filter(l => l.geometryType !== "Raster");
  const selectedLayer = layers.find(l => l.id === selectedLayerId);
  const secondaryLayer = layers.find(l => l.id === secondaryLayerId);
  
  const generateId = () => `layer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const detectGeometryType = (fc: FeatureCollection<Geometry, GeoJsonProperties>) => {
    for (const feature of fc.features) {
      if (feature.geometry) return feature.geometry.type;
    }
    return "Point";
  };

  const computeExtent = (fc: FeatureCollection<Geometry, GeoJsonProperties>) => {
    try {
      if (!fc.features || fc.features.length === 0) return null;
      return turf.bbox(fc) as [number, number, number, number];
    } catch {
      return null;
    }
  };

  const handleRun = () => {
    if (!selectedLayer) return;
    
    try {
      let resultData: FeatureCollection<Geometry, GeoJsonProperties> | Feature<Geometry, GeoJsonProperties> | null = null;
      const data = selectedLayer.data;

      switch (operation) {
        case "buffer":
          resultData = turf.buffer(data, bufferRadius, { units: bufferUnit });
          break;
        case "dissolve":
          if (selectedLayer.geometryType !== "Polygon" && selectedLayer.geometryType !== "MultiPolygon") {
            alert("Dissolve only works on Polygon layers.");
            return;
          }
          resultData = turf.dissolve(data as any, { propertyName: dissolveProperty });
          break;
        case "envelope":
          resultData = turf.envelope(data);
          break;
        case "convex":
          resultData = turf.convex(data);
          break;
        case "center":
          const centers = data.features.map(f => turf.center(f));
          resultData = turf.featureCollection(centers);
          break;
        case "simplify":
          resultData = turf.simplify(data, { tolerance: simplifyTolerance, highQuality: true, mutate: false });
          break;
        case "voronoi":
          const bbox = turf.bbox(data);
          resultData = turf.voronoi(data, { bbox });
          break;
        case "pointsWithinPolygon":
          if (!secondaryLayer) {
            alert("Please select a polygon layer to filter points.");
            return;
          }
          if (secondaryLayer.geometryType !== "Polygon" && secondaryLayer.geometryType !== "MultiPolygon") {
            alert("The secondary layer must be a Polygon or MultiPolygon.");
            return;
          }
          resultData = turf.pointsWithinPolygon(data as any, secondaryLayer.data as any);
          break;
      }

      if (!resultData) {
        alert("Operation resulted in empty output.");
        return;
      }

      // Convert Feature to FeatureCollection if needed
      const resultFC: FeatureCollection<Geometry, GeoJsonProperties> = 
        resultData.type === "Feature" ? turf.featureCollection([resultData as any]) : resultData as FeatureCollection;
      
      // Re-assign IDs
      resultFC.features = resultFC.features.map((f, i) => ({ ...f, id: i }));
      
      const newLayerName = `${selectedLayer.name} - ${operation}`;
      const color = getNextColor();

      const newLayer: Layer = {
        id: generateId(),
        name: newLayerName,
        geometryType: detectGeometryType(resultFC) as any,
        source: "local",
        visible: true,
        style: {
          color,
          opacity: 0.7,
          strokeColor: color,
          strokeWidth: 2,
          pointRadius: 6,
        },
        data: resultFC,
        featureCount: resultFC.features.length,
        extent: computeExtent(resultFC),
        attributes: selectedLayer.attributes,
      };

      addLayer(newLayer);
      onClose();
    } catch (err: any) {
      console.error(err);
      alert(`Geoprocessing failed: ${err.message || err}`);
    }
  };

  return (
    <div className="dialog-overlay" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000 }}>
      <div className="dialog-content" style={{ background: "var(--bg-primary)", padding: "16px", borderRadius: "8px", width: "400px", border: "1px solid var(--border-subtle)" }}>
        <h3 style={{ marginTop: 0, marginBottom: "16px", fontSize: "16px" }}>Geoprocessing Tools</h3>
        
        <div style={{ marginBottom: "12px" }}>
          <label style={{ display: "block", marginBottom: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>Input Layer</label>
          <select 
            className="input" 
            value={selectedLayerId} 
            onChange={e => setSelectedLayerId(e.target.value)}
            style={{ width: "100%" }}
          >
            <option value="">Select a layer...</option>
            {vectorLayers.map(l => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: "12px" }}>
          <label style={{ display: "block", marginBottom: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>Operation</label>
          <select 
            className="input" 
            value={operation} 
            onChange={e => setOperation(e.target.value as Operation)}
            style={{ width: "100%" }}
          >
            <option value="buffer">Buffer</option>
            <option value="dissolve">Dissolve</option>
            <option value="envelope">Envelope (Bounding Box)</option>
            <option value="convex">Convex Hull</option>
            <option value="center">Center Points</option>
            <option value="simplify">Simplify</option>
            <option value="voronoi">Voronoi Polygons</option>
            <option value="pointsWithinPolygon">Points Within Polygon (Spatial Join)</option>
          </select>
        </div>

        {operation === "pointsWithinPolygon" && (
          <div style={{ marginBottom: "12px" }}>
            <label style={{ display: "block", marginBottom: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>Secondary Layer (Polygon)</label>
            <select 
              className="input" 
              value={secondaryLayerId} 
              onChange={e => setSecondaryLayerId(e.target.value)}
              style={{ width: "100%" }}
            >
              <option value="">Select a polygon layer...</option>
              {vectorLayers.filter(l => l.geometryType === "Polygon" || l.geometryType === "MultiPolygon").map(l => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
        )}

        {operation === "buffer" && (
          <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", marginBottom: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>Distance</label>
              <input 
                type="number" 
                className="input" 
                value={bufferRadius} 
                onChange={e => setBufferRadius(parseFloat(e.target.value))}
                style={{ width: "100%" }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", marginBottom: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>Unit</label>
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
            <label style={{ display: "block", marginBottom: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>Tolerance (degrees)</label>
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
            <label style={{ display: "block", marginBottom: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>Dissolve Field (Optional)</label>
            <select 
              className="input" 
              value={dissolveProperty} 
              onChange={e => setDissolveProperty(e.target.value)}
              style={{ width: "100%" }}
            >
              <option value="">-- None (Dissolve All) --</option>
              {selectedLayer?.attributes.map(attr => (
                <option key={attr} value={attr}>{attr}</option>
              ))}
            </select>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "24px" }}>
          <button className="btn btn--outline" onClick={onClose}>Cancel</button>
          <button 
            className="btn btn--primary" 
            onClick={handleRun}
            disabled={!selectedLayerId || (operation === "pointsWithinPolygon" && !secondaryLayerId)}
          >
            Run
          </button>
        </div>
      </div>
    </div>
  );
}