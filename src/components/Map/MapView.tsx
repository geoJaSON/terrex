import { useCallback, useRef, useState, useEffect } from "react";
import Map, {
  NavigationControl,
  Source,
  Layer as MapLayer,
  Marker,
  type MapLayerMouseEvent,
  type ViewStateChangeEvent,
  type MapRef,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { useMapStore } from "../../stores/mapStore";
import { BasemapSwitcher } from "./BasemapSwitcher";
import type { Layer } from "../../types/layer";
import type { LngLatBoundsLike } from "maplibre-gl";

const BASEMAPS: Record<string, string> = {
  osm: "https://tiles.stadiamaps.com/styles/osm_bright.json",
  dark: "https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json",
  light: "https://tiles.stadiamaps.com/styles/alidade_smooth.json",
  satellite: "https://tiles.stadiamaps.com/styles/alidade_satellite.json",
};

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
  } = useMapStore();
  const [currentBasemap, setCurrentBasemap] = useState("dark");

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
    [activeLayerId, layers, selectedFeatureIds, setSelectedFeatures]
  );

  const visibleLayers = layers.filter((l) => l.visible);

  return (
    <div className="map-container">
      <Map
        ref={mapRef}
        {...viewState}
        onMove={handleMove}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
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

        {searchMarker && (
          <Marker longitude={searchMarker.lng} latitude={searchMarker.lat} color="#ef4444" />
        )}
      </Map>

      <BasemapSwitcher
        current={currentBasemap}
        onChange={setCurrentBasemap}
        options={Object.keys(BASEMAPS)}
      />
    </div>
  );
}
