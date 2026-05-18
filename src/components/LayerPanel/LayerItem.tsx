import { useState, useCallback, useRef } from "react";
import bbox from "@turf/bbox";
import { useMapStore } from "../../stores/mapStore";
import type { Layer } from "../../types/layer";
import type { FeatureCollection, Geometry, GeoJsonProperties } from "geojson";
import { SymbologyEditor } from "./SymbologyEditor";
import { exportToGeoJSON, exportToCSV } from "../../utils/exporters";
import { fetchOnlineLayer } from "../../services/onlineSources";
import { getCachedCredentials } from "../../services/credentialCache";

interface LayerItemProps {
  layer: Layer;
  index: number;
  onDragStart: (index: number) => void;
  onDragOver: (index: number) => void;
  onDragEnd: () => void;
}

export function LayerItem({
  layer,
  index,
  onDragStart,
  onDragOver,
  onDragEnd,
}: LayerItemProps) {
  const {
    activeLayerId,
    setActiveLayer,
    toggleLayerVisibility,
    removeLayer,
    flyToExtent,
    setAttributeTableVisible,
    getFilteredData,
    selectedFeatureIds,
    replaceLayerData,
  } = useMapStore();
  const [showContext, setShowContext] = useState(false);
  const [contextPos, setContextPos] = useState({ x: 0, y: 0 });
  const [showSymbology, setShowSymbology] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const swatchRef = useRef<HTMLDivElement>(null);

  const isActive = activeLayerId === layer.id;

  // What an export/zoom should act on: selection (when this is the active
  // layer and features are selected) → filter result → full layer.
  const hasSelection = isActive && selectedFeatureIds.size > 0;
  const filteredCount = getFilteredData(layer.id).features.length;
  const isFiltered = filteredCount !== layer.featureCount;

  const getExportData = useCallback((): FeatureCollection<Geometry, GeoJsonProperties> => {
    const filtered = getFilteredData(layer.id);
    if (hasSelection) {
      return {
        ...filtered,
        features: filtered.features.filter((f) => selectedFeatureIds.has(f.id as number)),
      };
    }
    return filtered;
  }, [getFilteredData, layer.id, hasSelection, selectedFeatureIds]);

  const exportSuffix = hasSelection
    ? ` (${selectedFeatureIds.size} selected)`
    : isFiltered
    ? ` (${filteredCount.toLocaleString()} filtered)`
    : "";

  const handleClick = useCallback(() => {
    setActiveLayer(layer.id);
  }, [layer.id, setActiveLayer]);

  const handleVisibilityToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      toggleLayerVisibility(layer.id);
    },
    [layer.id, toggleLayerVisibility]
  );

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextPos({ x: e.clientX, y: e.clientY });
    setShowContext(true);
  }, []);

  const handleRemove = useCallback(() => {
    removeLayer(layer.id);
    setShowContext(false);
  }, [layer.id, removeLayer]);

  const handleZoomToExtent = useCallback(() => {
    if (layer.extent) {
      flyToExtent(layer.extent);
    }
    setShowContext(false);
  }, [layer.extent, flyToExtent]);

  const handleZoomToSelected = useCallback(() => {
    const sel = getExportData();
    if (sel.features.length > 0) {
      flyToExtent(bbox(sel) as [number, number, number, number]);
    }
    setShowContext(false);
  }, [getExportData, flyToExtent]);

  const handleRefresh = useCallback(async () => {
    setShowContext(false);
    if (!layer.connection) return;
    setIsRefreshing(true);
    try {
      const creds = getCachedCredentials(layer.connection.id);
      const result = await fetchOnlineLayer(layer.connection, { credentials: creds });
      replaceLayerData(layer.id, result.data);
    } catch (err: any) {
      // No inline error surface on the layer row; a dialog is the least-bad
      // option for a background refresh failure in this lightweight tool.
      alert(`Refresh failed for "${layer.name}":\n${err?.message || err}`);
    } finally {
      setIsRefreshing(false);
    }
  }, [layer.connection, layer.id, layer.name, replaceLayerData]);

  const handleOpenTable = useCallback(() => {
    setActiveLayer(layer.id);
    setAttributeTableVisible(true);
    setShowContext(false);
  }, [layer.id, setActiveLayer, setAttributeTableVisible]);

  const handleSwatchClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setShowSymbology(!showSymbology);
    },
    [showSymbology]
  );

  return (
    <>
      <div
        className={`layer-item ${isActive ? "layer-item--active" : ""} ${!layer.visible ? "layer-item--hidden" : ""}`}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        draggable
        onDragStart={() => onDragStart(index)}
        onDragOver={(e) => {
          e.preventDefault();
          onDragOver(index);
        }}
        onDragEnd={onDragEnd}
      >
        <div
          ref={swatchRef}
          className="layer-item__swatch"
          style={{ backgroundColor: layer.style.color }}
          onClick={handleSwatchClick}
          title="Edit symbology"
        />

        <span className="layer-item__name" title={layer.name}>
          {layer.name}
        </span>

        <span className="layer-item__count">
          {layer.featureCount.toLocaleString()}
        </span>

        <span className="layer-item__source-badge" title={isRefreshing ? "Refreshing…" : undefined}>
          {isRefreshing ? "⏳" : layer.source === "local" ? "📁" : "🌐"}
        </span>

        <button
          className={`icon-btn icon-btn--sm ${layer.visible ? "" : "icon-btn--active"}`}
          onClick={handleVisibilityToggle}
          title={layer.visible ? "Hide layer" : "Show layer"}
        >
          {layer.visible ? "👁" : "👁‍🗨"}
        </button>
      </div>

      {showSymbology && (
        <SymbologyEditor
          layer={layer}
          anchorEl={swatchRef.current}
          onClose={() => setShowSymbology(false)}
        />
      )}

      {showContext && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 999 }}
            onClick={() => setShowContext(false)}
          />
          <div
            className="context-menu"
            style={{ left: contextPos.x, top: contextPos.y }}
          >
            <button className="context-menu__item" onClick={handleZoomToExtent}>
              🔍 Zoom to Extent
            </button>
            {hasSelection && (
              <button className="context-menu__item" onClick={handleZoomToSelected}>
                🎯 Zoom to Selected ({selectedFeatureIds.size})
              </button>
            )}
            {layer.source === "online" && layer.connection && (
              <button className="context-menu__item" onClick={handleRefresh}>
                🔄 Refresh Data
              </button>
            )}
            <button className="context-menu__item" onClick={handleOpenTable}>
              📊 Open Attribute Table
            </button>
            <button
              className="context-menu__item"
              onClick={() => {
                toggleLayerVisibility(layer.id);
                setShowContext(false);
              }}
            >
              {layer.visible ? "👁 Hide" : "👁 Show"}
            </button>
            <div className="context-menu__separator" />
            <button className="context-menu__item" onClick={() => { exportToGeoJSON(layer, getExportData()); setShowContext(false); }}>
              💾 Export GeoJSON{exportSuffix}
            </button>
            <button className="context-menu__item" onClick={() => { exportToCSV(layer, getExportData()); setShowContext(false); }}>
              📄 Export CSV{exportSuffix}
            </button>
            <div className="context-menu__separator" />
            <button
              className="context-menu__item context-menu__item--danger"
              onClick={handleRemove}
            >
              🗑 Remove
            </button>
          </div>
        </>
      )}
    </>
  );
}
