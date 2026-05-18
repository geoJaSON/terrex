import { useMapStore } from "../../stores/mapStore";
import { GoToSearch } from "../Map/GoToSearch";
import { FilterIcon, TableIcon } from "./icons";

export function StatusBar() {
  const {
    cursorCoords,
    viewState,
    layers,
    activeLayerId,
    selectedFeatureIds,
    attributeTableVisible,
    toggleAttributeTable,
    filterBarVisible,
    toggleFilterBar,
    filters,
    editHistoryIndex,
    editHistory,
    undo,
    redo,
  } = useMapStore();
  const activeLayer = layers.find((l) => l.id === activeLayerId);
  const activeFilter = activeLayerId ? filters[activeLayerId] : null;

  const formatCoord = (n: number, decimals: number = 6) => n.toFixed(decimals);

  return (
    <div className="status-bar">
      <div className="status-bar__item">
        <span className="status-bar__label">📍</span>
        <span className="status-bar__value">
          {cursorCoords ? `${formatCoord(cursorCoords.lat)}°, ${formatCoord(cursorCoords.lng)}°` : "—"}
        </span>
      </div>

      <div className="status-bar__separator" />

      <div className="status-bar__item">
        <span className="status-bar__label">Zoom</span>
        <span className="status-bar__value">{viewState.zoom.toFixed(1)}</span>
      </div>

      <div className="status-bar__separator" />

      <div className="status-bar__item">
        <span className="status-bar__label">CRS</span>
        <span className="status-bar__value">EPSG:4326</span>
      </div>

      <div className="status-bar__separator" />

      <GoToSearch />

      <div className="status-bar__spacer" />

      {activeFilter?.active && (
        <>
          <div className="status-bar__item">
            <span className="status-bar__value" style={{ color: "#f59e0b" }}>
              🔍 Filter active
            </span>
          </div>
          <div className="status-bar__separator" />
        </>
      )}

      {selectedFeatureIds.size > 0 && (
        <>
          <div className="status-bar__item">
            <span className="status-bar__value" style={{ color: "#fbbf24" }}>
              {selectedFeatureIds.size} selected
            </span>
          </div>
          <div className="status-bar__separator" />
        </>
      )}

      {activeLayer && (
        <>
          <div className="status-bar__item">
            <span className="status-bar__label">Features</span>
            <span className="status-bar__value">{activeLayer.featureCount.toLocaleString()}</span>
          </div>
          <div className="status-bar__separator" />
        </>
      )}

      <div className="status-bar__item">
        <span className="status-bar__label">Layers</span>
        <span className="status-bar__value">{layers.length}</span>
      </div>

      <div className="status-bar__separator" />

      <button
        className="icon-btn icon-btn--sm"
        onClick={undo}
        disabled={editHistoryIndex < 0}
        title="Undo (Ctrl+Z)"
      >↩</button>
      <button
        className="icon-btn icon-btn--sm"
        onClick={redo}
        disabled={editHistoryIndex >= editHistory.length - 1}
        title="Redo (Ctrl+Y)"
      >↪</button>

      <div className="status-bar__separator" />

      <button
        className={`icon-btn icon-btn--sm ${filterBarVisible ? "icon-btn--active" : ""}`}
        onClick={toggleFilterBar}
        title="Toggle Filter Bar"
        aria-label="Toggle query filter bar"
      ><FilterIcon /></button>
      <button
        className={`icon-btn icon-btn--sm ${attributeTableVisible ? "icon-btn--active" : ""}`}
        onClick={toggleAttributeTable}
        title="Toggle Attribute Table"
        aria-label="Toggle attribute table"
      ><TableIcon /></button>
    </div>
  );
}
