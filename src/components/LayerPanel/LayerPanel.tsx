import { useState, useCallback } from "react";
import { useMapStore } from "../../stores/mapStore";
import { useFileLoader } from "../../hooks/useFileLoader";
import { useConnectionStore } from "../../stores/connectionStore";
import { LayerItem } from "./LayerItem";
import { GeoprocessingDialog } from "../Tools/GeoprocessingDialog";

export function LayerPanel() {
  const { layers, reorderLayers } = useMapStore();
  const { setManagerOpen } = useConnectionStore();
  const { loadFile } = useFileLoader();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [geoprocessingOpen, setGeoprocessingOpen] = useState(false);

  const handleAddLayer = async () => {
    try {
      await loadFile();
    } catch (err) {
      console.error("Failed to load file:", err);
    }
  };

  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index);
  }, []);

  const handleDragOver = useCallback((index: number) => {
    setOverIndex(index);
  }, []);

  const handleDragEnd = useCallback(() => {
    if (dragIndex !== null && overIndex !== null && dragIndex !== overIndex) {
      reorderLayers(dragIndex, overIndex);
    }
    setDragIndex(null);
    setOverIndex(null);
  }, [dragIndex, overIndex, reorderLayers]);

  return (
    <>
      <div className="sidebar">
        <div className="sidebar__header">
          <span className="sidebar__title">Layers</span>
          <div style={{ display: "flex", gap: "4px" }}>
            <button
              className="icon-btn"
              onClick={() => setGeoprocessingOpen(true)}
              title="Geoprocessing Tools"
            >
              🛠️
            </button>
            <button
              className="icon-btn"
              onClick={() => setManagerOpen(true)}
              title="Add Online Data"
            >
              🌐
            </button>
            <button
              className="icon-btn"
              onClick={handleAddLayer}
              title="Add Local File"
            >
              ＋
            </button>
          </div>
        </div>

        <div className="sidebar__content">
          {layers.length === 0 ? (
            <div className="sidebar__empty">
              <div className="sidebar__empty-icon">🗺️</div>
              <div className="sidebar__empty-text">
                No layers loaded.
                <br />
                Click <strong>+</strong> or drag a file to add data.
              </div>
              <div style={{ display: "flex", gap: "8px", flexDirection: "column", marginTop: "8px" }}>
                <button
                  className="btn btn--primary btn--sm"
                  onClick={handleAddLayer}
                >
                  Open File
                </button>
                <button
                  className="btn btn--ghost btn--sm"
                  style={{ border: "1px solid var(--border-subtle)" }}
                  onClick={() => setManagerOpen(true)}
                >
                  🌐 Online Data
                </button>
              </div>
            </div>
          ) : (
            layers.map((layer, i) => (
              <LayerItem
                key={layer.id}
                layer={layer}
                index={i}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
              />
            ))
          )}
        </div>
      </div>
      
      <GeoprocessingDialog 
        isOpen={geoprocessingOpen} 
        onClose={() => setGeoprocessingOpen(false)} 
      />
    </>
  );
}
