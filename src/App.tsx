import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import "./styles/index.css";
import { useFileLoader } from "./hooks/useFileLoader";
import { MapView } from "./components/Map/MapView";
import { LayerPanel } from "./components/LayerPanel/LayerPanel";
import { StatusBar } from "./components/StatusBar/StatusBar";
import { AttributeTable } from "./components/AttributeTable/AttributeTable";
import { FilterBar } from "./components/FilterBar/FilterBar";
import { EditPanel } from "./components/EditPanel/EditPanel";
import { ConnectionManager } from "./components/ConnectionManager/ConnectionManager";
import { useMapStore } from "./stores/mapStore";

function App() {
  const { attributeTableVisible, toggleAttributeTable, selectedFeatureIds } = useMapStore();
  const { loadFromPath } = useFileLoader();
  const [isDragging, setIsDragging] = useState(false);
  const [tableHeight, setTableHeight] = useState(280);

  // Native file drag-and-drop (Tauri webview). Reuses the same parsing path
  // as the file dialog. No-op outside Tauri (e.g. browser `npm run dev`).
  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
    const SUPPORTED = ["geojson", "json", "zip", "kml", "csv"];
    let unlisten: (() => void) | undefined;

    getCurrentWebview()
      .onDragDropEvent(async (event) => {
        const p = event.payload;
        if (p.type === "over" || p.type === "enter") {
          setIsDragging(true);
        } else if (p.type === "leave") {
          setIsDragging(false);
        } else if (p.type === "drop") {
          setIsDragging(false);
          const paths = (p.paths || []).filter((path) =>
            SUPPORTED.includes(path.split(".").pop()?.toLowerCase() || "")
          );
          const failures: string[] = [];
          for (const path of paths) {
            try {
              await loadFromPath(path);
            } catch (err: any) {
              failures.push(`${path.split(/[\\/]/).pop()}: ${err?.message || err}`);
            }
          }
          if (failures.length > 0) {
            alert(`Some files could not be loaded:\n\n${failures.join("\n")}`);
          }
        }
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => {
      unlisten?.();
    };
  }, [loadFromPath]);
  const isResizing = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  const showEditPanel = selectedFeatureIds.size === 1;

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;
      startY.current = e.clientY;
      startHeight.current = tableHeight;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isResizing.current) return;
        const delta = startY.current - moveEvent.clientY;
        const newHeight = Math.max(120, Math.min(startHeight.current + delta, window.innerHeight - 200));
        setTableHeight(newHeight);
      };

      const handleMouseUp = () => {
        isResizing.current = false;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [tableHeight]
  );

  return (
    <div className="app-layout">
      <LayerPanel />
      <div className="app-center">
        <FilterBar />
        <div className="app-center__body">
          <div className="app-main">
            <div className="app-main__map">
              <MapView />
            </div>
            {attributeTableVisible && (
              <>
                <div
                  className="resize-handle resize-handle--horizontal"
                  onMouseDown={handleResizeStart}
                  onDoubleClick={toggleAttributeTable}
                  title="Drag to resize, double-click to close"
                />
                <div className="app-main__table" style={{ height: tableHeight }}>
                  <AttributeTable />
                </div>
              </>
            )}
          </div>
          {showEditPanel && <EditPanel />}
        </div>
      </div>
      <StatusBar />
      <ConnectionManager />

      {isDragging && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 3000,
            background: "rgba(5, 5, 5, 0.85)",
            border: "2px dashed var(--accent-primary)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "var(--space-3)",
            pointerEvents: "none",
            color: "var(--text-primary)",
          }}
        >
          <div style={{ fontSize: "2rem" }}>⬇</div>
          <div style={{ fontSize: "var(--font-size-md)", fontWeight: 600 }}>
            Drop to load
          </div>
          <div style={{ fontSize: "var(--font-size-xs)", color: "var(--text-tertiary)" }}>
            GeoJSON · Shapefile (.zip) · KML · CSV
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
