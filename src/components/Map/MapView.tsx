import { useCallback, useRef, useState, useEffect } from "react";
import Map, {
  NavigationControl,
  Source,
  Layer as MapLayer,
  Marker,
  Popup,
  type MapLayerMouseEvent,
  type ViewStateChangeEvent,
  type MapRef,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { invoke } from "@tauri-apps/api/core";
import { useMapStore } from "../../stores/mapStore";
import { BasemapSwitcher } from "./BasemapSwitcher";
import type { Layer } from "../../types/layer";
import type { LngLatBoundsLike } from "maplibre-gl";
import { FilterIcon, TableIcon } from "../StatusBar/icons";

const BASEMAPS: Record<string, string> = {
  osm: "https://tiles.stadiamaps.com/styles/osm_bright.json",
  dark: "https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json",
  light: "https://tiles.stadiamaps.com/styles/alidade_smooth.json",
  satellite: "https://tiles.stadiamaps.com/styles/alidade_satellite.json",
};

// Geodesic distance (Haversine formula) in meters
function getHaversineDistance(p1: [number, number], p2: [number, number]): number {
  const R = 6371000; // Earth radius in meters
  const rad = Math.PI / 180;
  const dLat = (p2[1] - p1[1]) * rad;
  const dLng = (p2[0] - p1[0]) * rad;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(p1[1] * rad) * Math.cos(p2[1] * rad) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // distance in meters
}

// Spherical polygon area in square meters
function getSphericalArea(coords: [number, number][]): number {
  if (coords.length < 3) return 0;
  const R = 6371000; // radius of earth in meters
  const rad = Math.PI / 180;
  let totalArea = 0;
  for (let i = 0; i < coords.length; i++) {
    const p1 = coords[i];
    const p2 = coords[(i + 1) % coords.length];
    const lambda1 = p1[0] * rad;
    const lambda2 = p2[0] * rad;
    const phi1 = p1[1] * rad;
    const phi2 = p2[1] * rad;
    totalArea += (lambda2 - lambda1) * (2 + Math.sin(phi1) + Math.sin(phi2));
  }
  totalArea = Math.abs((totalArea * R * R) / 2);
  return totalArea; // area in square meters
}

type MeasureUnit = "metric" | "imperial" | "nautical";

function formatDistance(meters: number, unit: MeasureUnit): string {
  switch (unit) {
    case "imperial": {
      const feet = meters * 3.28084;
      if (feet < 5280) return `${feet.toFixed(1)} ft`;
      return `${(feet / 5280).toFixed(3)} mi`;
    }
    case "nautical": {
      const nm = meters / 1852;
      return `${nm.toFixed(3)} nmi`;
    }
    default:
      if (meters < 1000) return `${meters.toFixed(1)} m`;
      return `${(meters / 1000).toFixed(3)} km`;
  }
}

function formatArea(sqMeters: number, unit: MeasureUnit): string {
  switch (unit) {
    case "imperial": {
      const sqFt = sqMeters * 10.7639;
      if (sqFt < 43560) return `${sqFt.toFixed(1)} ft²`;
      return `${(sqFt / 43560).toFixed(3)} ac`;
    }
    case "nautical": {
      const sqNm = sqMeters / 3429904;
      return `${sqNm.toFixed(4)} nmi²`;
    }
    default:
      if (sqMeters < 1000000) return `${sqMeters.toFixed(1)} m²`;
      return `${(sqMeters / 1000000).toFixed(3)} km²`;
  }
}

function getLayerIds(layer: Layer): string[] {
  const baseId = `layer-${layer.id}`;
  if (layer.geometryType === "Polygon" || layer.geometryType === "MultiPolygon") {
    return [`${baseId}-fill`, `${baseId}-stroke`];
  } else if (layer.geometryType === "LineString" || layer.geometryType === "MultiLineString") {
    return [`${baseId}-line`];
  } else {
    return [`${baseId}-circle`];
  }
}

function getMapLayerConfig(layer: Layer, selectedIds: Set<number>) {
  const baseId = `layer-${layer.id}`;
  const layers = [];
  const hasSelection = selectedIds.size > 0;

  if (layer.geometryType === "Polygon" || layer.geometryType === "MultiPolygon") {
    layers.push({
      id: `${baseId}-fill`,
      type: "fill" as const,
      paint: {
        "fill-color": hasSelection
          ? ["case", ["in", ["id"], ["literal", Array.from(selectedIds)]], "#fbbf24", layer.style.color]
          : layer.style.color,
        "fill-opacity": layer.style.opacity * 0.3,
      },
    });
    layers.push({
      id: `${baseId}-stroke`,
      type: "line" as const,
      paint: {
        "line-color": hasSelection
          ? ["case", ["in", ["id"], ["literal", Array.from(selectedIds)]], "#fbbf24", layer.style.strokeColor]
          : layer.style.strokeColor,
        "line-width": hasSelection
          ? ["case", ["in", ["id"], ["literal", Array.from(selectedIds)]], layer.style.strokeWidth + 1.5, layer.style.strokeWidth]
          : layer.style.strokeWidth,
        "line-opacity": layer.style.opacity,
      },
    });
  } else if (layer.geometryType === "LineString" || layer.geometryType === "MultiLineString") {
    layers.push({
      id: `${baseId}-line`,
      type: "line" as const,
      paint: {
        "line-color": hasSelection
          ? ["case", ["in", ["id"], ["literal", Array.from(selectedIds)]], "#fbbf24", layer.style.color]
          : layer.style.color,
        "line-width": hasSelection
          ? ["case", ["in", ["id"], ["literal", Array.from(selectedIds)]], layer.style.strokeWidth + 2, layer.style.strokeWidth]
          : layer.style.strokeWidth,
        "line-opacity": layer.style.opacity,
      },
    });
  } else {
    layers.push({
      id: `${baseId}-circle`,
      type: "circle" as const,
      paint: {
        "circle-color": hasSelection
          ? ["case", ["in", ["id"], ["literal", Array.from(selectedIds)]], "#fbbf24", layer.style.color]
          : layer.style.color,
        "circle-radius": hasSelection
          ? ["case", ["in", ["id"], ["literal", Array.from(selectedIds)]], layer.style.pointRadius + 3, layer.style.pointRadius]
          : layer.style.pointRadius,
        "circle-opacity": layer.style.opacity,
        "circle-stroke-color": hasSelection
          ? ["case", ["in", ["id"], ["literal", Array.from(selectedIds)]], "#fbbf24", layer.style.strokeColor]
          : layer.style.strokeColor,
        "circle-stroke-width": 1.5,
      },
    });
  }

  return layers;
}

export function MapView() {
  const mapRef = useRef<MapRef>(null);
  const {
    viewState,
    setViewState,
    layers,
    activeLayerId,
    selectedFeatureIds,
    setSelectedFeatures,
    setCursorCoords,
    pendingFlyTo,
    clearPendingFlyTo,
    filters,
    getFilteredData,
    searchMarker,
    filterBarVisible,
    toggleFilterBar,
    attributeTableVisible,
    toggleAttributeTable,
  } = useMapStore();
  const [currentBasemap, setCurrentBasemap] = useState("dark");

  // Context Menu & Measurements State
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    lng: number;
    lat: number;
  } | null>(null);

  const [measureMode, setMeasureMode] = useState(false);
  const [measurePoints, setMeasurePoints] = useState<[number, number][]>([]);
  const [measureUnit, setMeasureUnit] = useState<MeasureUnit>("metric");
  const [toast, setToast] = useState<string | null>(null);

  // Auto-clear toast
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  // Handle pending flyTo from zoom-to-extent
  useEffect(() => {
    if (pendingFlyTo && mapRef.current) {
      const [minLng, minLat, maxLng, maxLat] = pendingFlyTo;
      const bounds: LngLatBoundsLike = [
        [minLng, minLat],
        [maxLng, maxLat],
      ];
      mapRef.current.fitBounds(bounds, { padding: 60, duration: 1000 });
      clearPendingFlyTo();
    }
  }, [pendingFlyTo, clearPendingFlyTo]);

  const handleMove = useCallback(
    (evt: ViewStateChangeEvent) => {
      setViewState(evt.viewState);
    },
    [setViewState]
  );

  const handleMouseMove = useCallback(
    (evt: MapLayerMouseEvent) => {
      setCursorCoords({ lng: evt.lngLat.lng, lat: evt.lngLat.lat });
    },
    [setCursorCoords]
  );

  const handleMouseLeave = useCallback(() => {
    setCursorCoords(null);
  }, [setCursorCoords]);

  const handleClick = useCallback(
    (evt: MapLayerMouseEvent) => {
      // Intercept left clicks if Measurement Mode is active
      if (measureMode) {
        setMeasurePoints((prev) => [...prev, [evt.lngLat.lng, evt.lngLat.lat]]);
        return;
      }

      if (!activeLayerId) return;
      const activeLayer = layers.find((l) => l.id === activeLayerId);
      if (!activeLayer || !activeLayer.visible) return;

      const layerIds = getLayerIds(activeLayer);
      const features = mapRef.current?.queryRenderedFeatures(evt.point, {
        layers: layerIds,
      });

      if (features && features.length > 0) {
        const clickedId = features[0].id as number;
        if (clickedId !== undefined) {
          if (evt.originalEvent.ctrlKey || evt.originalEvent.metaKey) {
            const newSet = new Set(selectedFeatureIds);
            if (newSet.has(clickedId)) {
              newSet.delete(clickedId);
            } else {
              newSet.add(clickedId);
            }
            setSelectedFeatures(newSet);
          } else {
            setSelectedFeatures(new Set([clickedId]));
          }
        }
      } else {
        setSelectedFeatures(new Set());
      }
    },
    [activeLayerId, layers, selectedFeatureIds, setSelectedFeatures, measureMode]
  );

  // Handle right-click context menu
  const handleContextMenu = useCallback(
    (evt: MapLayerMouseEvent) => {
      evt.originalEvent.preventDefault();
      evt.originalEvent.stopPropagation();
      setContextMenu({
        x: evt.point.x,
        y: evt.point.y,
        lng: evt.lngLat.lng,
        lat: evt.lngLat.lat,
      });
    },
    []
  );

  const handleCopyCoords = useCallback((lng: number, lat: number) => {
    setContextMenu(null);
    const coordsStr = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    navigator.clipboard.writeText(coordsStr);
    setToast(`📋 Coordinates copied: ${coordsStr}`);
  }, []);

  const handleDropPin = useCallback((lng: number, lat: number) => {
    setContextMenu(null);
    const label = prompt("Enter a label for this pin:", "Custom Pin");
    if (label === null) return;
    useMapStore.getState().setSearchMarker({
      lng,
      lat,
      label: label.trim() || "Dropped Pin",
    });
    setToast("📌 Pin dropped!");
  }, []);

  const handleReverseGeocode = useCallback(async (lng: number, lat: number) => {
    setContextMenu(null);
    setToast("🔍 Reversing geocode...");
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
      let address = "Unknown location";

      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        try {
          const res = await invoke<{ status: number; body: string }>("http_request", {
            url,
            method: "GET",
            headers: { "User-Agent": "Terrex/0.1" },
          });
          const data = JSON.parse(res.body);
          address = data.display_name || address;
        } catch (e) {
          console.warn("Tauri http_request failed, falling back to browser fetch:", e);
        }
      }

      if (address === "Unknown location") {
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        const data = await res.json();
        address = data.display_name || address;
      }

      useMapStore.getState().setSearchMarker({
        lng,
        lat,
        label: address,
      });
      setToast("📍 Address pinned!");
    } catch (err: any) {
      console.error(err);
      setToast("❌ Geocode failed");
    }
  }, []);

  const handleClearAll = useCallback(() => {
    setContextMenu(null);
    setMeasurePoints([]);
    useMapStore.getState().setSearchMarker(null);
    setToast("🧹 Cleared all map assets");
  }, []);

  const visibleLayers = layers.filter((l) => l.visible);

  // Compute live geodesic distance & area measurements
  let totalDistance = 0;
  for (let i = 0; i < measurePoints.length - 1; i++) {
    totalDistance += getHaversineDistance(measurePoints[i], measurePoints[i + 1]);
  }
  const totalArea = measurePoints.length >= 3 ? getSphericalArea(measurePoints) : 0;

  // Dynamic GeoJSON for real-time measurements drawing
  const measureGeoJSON = {
    type: "FeatureCollection" as const,
    features: [
      ...(measurePoints.length > 1
        ? [
            {
              type: "Feature" as const,
              geometry: {
                type: "LineString" as const,
                coordinates: measurePoints,
              },
              properties: {},
            },
          ]
        : []),
      ...(measurePoints.length >= 3
        ? [
            {
              type: "Feature" as const,
              geometry: {
                type: "Polygon" as const,
                coordinates: [[...measurePoints, measurePoints[0]]],
              },
              properties: {},
            },
          ]
        : []),
    ],
  };

  return (
    <div className="map-container" style={{ position: "relative" }}>
      <Map
        ref={mapRef}
        {...viewState}
        onMove={handleMove}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        cursor={measureMode ? "crosshair" : undefined}
        mapStyle={BASEMAPS[currentBasemap]}
        style={{ width: "100%", height: "100%" }}
      >
        <NavigationControl position="top-right" showCompass showZoom />

        {visibleLayers.map((layer) => {
          const isActive = layer.id === activeLayerId;
          const selIds = isActive ? selectedFeatureIds : new Set<number>();
          const displayData = filters[layer.id]?.active ? getFilteredData(layer.id) : layer.data;

          return (
            <Source
              key={layer.id}
              id={`source-${layer.id}`}
              type="geojson"
              data={displayData}
              promoteId={""}
            >
              {getMapLayerConfig(layer, selIds).map((layerConfig) => (
                <MapLayer key={layerConfig.id} {...(layerConfig as any)} />
              ))}
            </Source>
          );
        })}

        {/* Dynamic Measurement Drawing Layers */}
        {measureMode && measurePoints.length > 0 && (
          <Source id="measure-source" type="geojson" data={measureGeoJSON}>
            <MapLayer
              id="measure-polygon-fill"
              type="fill"
              paint={{
                "fill-color": "#a855f7",
                "fill-opacity": 0.18,
              }}
            />
            <MapLayer
              id="measure-line-stroke"
              type="line"
              paint={{
                "line-color": "#a855f7",
                "line-width": 3,
                "line-dasharray": [2, 2],
              }}
            />
          </Source>
        )}

        {/* Measurement Nodes */}
        {measureMode &&
          measurePoints.map((pt, idx) => (
            <Marker key={`measure-pt-${idx}`} longitude={pt[0]} latitude={pt[1]} anchor="center">
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  backgroundColor: "#a855f7",
                  border: "2px solid #ffffff",
                  boxShadow: "0 0 6px rgba(168,85,247,0.7)",
                }}
              />
            </Marker>
          ))}

        {/* Location Markers & Custom Labeled CRT Tooltips */}
        {searchMarker && (
          <>
            <Marker longitude={searchMarker.lng} latitude={searchMarker.lat} color="#ef4444" />
            {searchMarker.label && (
              <Popup
                longitude={searchMarker.lng}
                latitude={searchMarker.lat}
                anchor="bottom"
                closeOnClick={false}
                onClose={() => useMapStore.getState().setSearchMarker(null)}
                offset={30}
              >
                <div className="popup-content">
                  <div className="popup-title">📍 Location Pin</div>
                  <div className="popup-address">{searchMarker.label}</div>
                  <button
                    className="btn btn--xs btn--block"
                    style={{ marginTop: "var(--space-2)", fontSize: "10px" }}
                    onClick={() => {
                      navigator.clipboard.writeText(searchMarker.label!);
                      setToast("📋 Address copied!");
                    }}
                  >
                    Copy Address
                  </button>
                </div>
              </Popup>
            )}
          </>
        )}
      </Map>

      {/* Map Right-Click Context Menu */}
      {contextMenu && (
        <>
          <div
            className="context-menu-backdrop"
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 998,
            }}
            onClick={() => setContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu(null);
            }}
          />
          <div
            className="context-menu"
            style={{
              position: "absolute",
              left: contextMenu.x,
              top: contextMenu.y,
              zIndex: 999,
            }}
          >
            <button className="context-menu__item" onClick={() => handleCopyCoords(contextMenu.lng, contextMenu.lat)}>
              📍 Copy Coordinates
            </button>
            <button
              className="context-menu__item"
              onClick={() => {
                setContextMenu(null);
                setMeasureMode(true);
                setMeasurePoints([[contextMenu.lng, contextMenu.lat]]);
                setToast("📏 Measurement Mode active. Left-click map to add path points.");
              }}
            >
              📏 Measure Distance & Area
            </button>
            <button className="context-menu__item" onClick={() => handleReverseGeocode(contextMenu.lng, contextMenu.lat)}>
              🔍 Reverse Geocode Address
            </button>
            <button className="context-menu__item" onClick={() => handleDropPin(contextMenu.lng, contextMenu.lat)}>
              📌 Drop Custom Pin
            </button>
            <div className="context-menu__separator" />
            <button className="context-menu__item context-menu__item--danger" onClick={handleClearAll}>
              🗑️ Clear Measurements & Pins
            </button>
          </div>
        </>
      )}

      {/* Floating Measurement HUD */}
      {measureMode && (
        <div className="measure-hud">
          <div className="measure-hud__header">
            <span className="measure-hud__title">📏 GEODESIC MEASURE</span>
            <span className="measure-hud__status">ACTIVE</span>
          </div>
          <div className="measure-hud__body">
            <div className="measure-hud__stat">
              <span className="measure-hud__label">Units:</span>
              <select
                className="measure-hud__select"
                value={measureUnit}
                onChange={(e) => setMeasureUnit(e.target.value as MeasureUnit)}
              >
                <option value="metric">Metric (m / km)</option>
                <option value="imperial">Imperial (ft / mi)</option>
                <option value="nautical">Nautical (nmi)</option>
              </select>
            </div>
            <div className="measure-hud__stat">
              <span className="measure-hud__label">Total Distance:</span>
              <span className="measure-hud__value">{formatDistance(totalDistance, measureUnit)}</span>
            </div>
            {measurePoints.length >= 3 && (
              <div className="measure-hud__stat">
                <span className="measure-hud__label">Enclosed Area:</span>
                <span className="measure-hud__value">{formatArea(totalArea, measureUnit)}</span>
              </div>
            )}
            <div className="measure-hud__help">
              Left-click on the map to add vertex points.
            </div>
          </div>
          <div className="measure-hud__actions">
            <button
              className="btn btn--xs btn--outline"
              onClick={() => {
                setMeasurePoints([]);
                setToast("🧹 Measurement reset");
              }}
              disabled={measurePoints.length === 0}
            >
              Reset
            </button>
            <button
              className="btn btn--xs btn--danger"
              onClick={() => {
                setMeasureMode(false);
                setMeasurePoints([]);
                setToast("❌ Measurement closed");
              }}
            >
              Stop
            </button>
          </div>
        </div>
      )}

      {/* Floating HUD Copy/Status Toast */}
      {toast && <div className="map-toast">{toast}</div>}

      {/* Floating map tools positioned adjacent to BasemapSwitcher */}
      <div className="map-floating-tools">
        <button
          className={`icon-btn ${filterBarVisible ? "icon-btn--active" : ""}`}
          onClick={toggleFilterBar}
          title="Toggle Filter Bar"
          aria-label="Toggle query filter bar"
        >
          <FilterIcon />
        </button>
        <button
          className={`icon-btn ${attributeTableVisible ? "icon-btn--active" : ""}`}
          onClick={toggleAttributeTable}
          title="Toggle Attribute Table"
          aria-label="Toggle attribute table"
        >
          <TableIcon />
        </button>
      </div>

      <BasemapSwitcher
        current={currentBasemap}
        onChange={setCurrentBasemap}
        options={Object.keys(BASEMAPS)}
      />
    </div>
  );
}
