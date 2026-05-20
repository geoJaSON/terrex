import { useMemo, useRef, useCallback, useState, useEffect } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import bbox from "@turf/bbox";
import { useMapStore } from "../../stores/mapStore";
import { ColumnStats } from "./ColumnStats";
import { BatchEditDialog } from "../EditPanel/BatchEditDialog";
import { exportToCSV } from "../../utils/exporters";

interface RowData {
  _featureIndex: number;
  [key: string]: unknown;
}

export function AttributeTable() {
  const {
    layers,
    activeLayerId,
    selectedFeatureIds,
    setSelectedFeatures,
    attributeTableVisible,
    getFilteredData,
    filters,
    flyToExtent,
  } = useMapStore();

  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({});
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [statsColumn, setStatsColumn] = useState<string | null>(null);
  const [statsPosition, setStatsPosition] = useState({ x: 0, y: 0 });
  const [showBatchEdit, setShowBatchEdit] = useState(false);
  const parentRef = useRef<HTMLDivElement>(null);

  const activeLayer = layers.find((l) => l.id === activeLayerId);

  // Use filtered data if filter is active
  const sourceData = useMemo(() => {
    if (!activeLayerId) return null;
    return getFilteredData(activeLayerId);
  }, [activeLayerId, getFilteredData, layers, filters]);

  const data = useMemo<RowData[]>(() => {
    if (!sourceData) return [];
    return sourceData.features.map((f, i) => ({
      _featureIndex: (f.id as number) ?? i,
      ...(f.properties || {}),
    }));
  }, [sourceData]);

  const selectedFeatures = useMemo(() => {
    if (!activeLayer) return [];
    return activeLayer.data.features.filter((f) => selectedFeatureIds.has(f.id as number));
  }, [activeLayer, selectedFeatureIds]);

  const columns = useMemo<ColumnDef<RowData>[]>(() => {
    if (!activeLayer) return [];
    return activeLayer.attributes.map((attr) => ({
      accessorKey: attr,
      header: attr,
      size: Math.max(100, Math.min(attr.length * 10, 250)),
      cell: (info) => {
        const val = info.getValue();
        if (val === null || val === undefined) return <span className="attr-null">NULL</span>;
        return String(val);
      },
    }));
  }, [activeLayer]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter, columnVisibility },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const { rows } = table.getRowModel();

  const handleSelectAll = useCallback(() => {
    if (!activeLayer) return;
    const allIds = rows.map((r) => r.original._featureIndex);
    setSelectedFeatures(new Set(allIds));
  }, [activeLayer, rows, setSelectedFeatures]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 30,
    overscan: 20,
  });

  const handleRowClick = useCallback(
    (featureIndex: number, e: React.MouseEvent) => {
      if (e.ctrlKey || e.metaKey) {
        const newSet = new Set(selectedFeatureIds);
        if (newSet.has(featureIndex)) newSet.delete(featureIndex);
        else newSet.add(featureIndex);
        setSelectedFeatures(newSet);
      } else if (e.shiftKey && selectedFeatureIds.size > 0) {
        const currentRows = rows.map((r) => r.original._featureIndex);
        const lastSelected = Array.from(selectedFeatureIds).pop()!;
        const lastIdx = currentRows.indexOf(lastSelected);
        const currentIdx = currentRows.indexOf(featureIndex);
        if (lastIdx >= 0 && currentIdx >= 0) {
          const start = Math.min(lastIdx, currentIdx);
          const end = Math.max(lastIdx, currentIdx);
          const newSet = new Set(selectedFeatureIds);
          for (let i = start; i <= end; i++) newSet.add(currentRows[i]);
          setSelectedFeatures(newSet);
        }
      } else {
        setSelectedFeatures(new Set([featureIndex]));
      }
    },
    [selectedFeatureIds, setSelectedFeatures, rows]
  );

  useEffect(() => {
    if (selectedFeatureIds.size === 0) return;
    const firstSelected = Array.from(selectedFeatureIds)[0];
    const rowIndex = rows.findIndex((r) => r.original._featureIndex === firstSelected);
    if (rowIndex >= 0) virtualizer.scrollToIndex(rowIndex, { align: "center" });
  }, [selectedFeatureIds, rows, virtualizer]);

  const handleHeaderContextMenu = useCallback(
    (e: React.MouseEvent, columnId: string) => {
      e.preventDefault();
      setStatsColumn(columnId);
      setStatsPosition({ x: e.clientX, y: e.clientY });
    },
    []
  );

  // Export what the table reflects: the filter result, narrowed to the
  // selection when features are selected.
  const buildExportData = useCallback(() => {
    if (!activeLayerId) return null;
    const filtered = getFilteredData(activeLayerId);
    if (selectedFeatureIds.size > 0) {
      return {
        ...filtered,
        features: filtered.features.filter((f) => selectedFeatureIds.has(f.id as number)),
      };
    }
    return filtered;
  }, [activeLayerId, getFilteredData, selectedFeatureIds]);

  const handleExportCSV = useCallback(async () => {
    if (!activeLayer) return;
    const data = buildExportData();
    try { await exportToCSV(activeLayer, data ?? undefined); } catch (err) { console.error("Export failed:", err); }
  }, [activeLayer, buildExportData]);

  const handleZoomToSelection = useCallback(() => {
    const data = buildExportData();
    if (data && data.features.length > 0) {
      flyToExtent(bbox(data) as [number, number, number, number]);
    }
  }, [buildExportData, flyToExtent]);

  if (!attributeTableVisible || !activeLayer) return null;

  const totalSize = virtualizer.getTotalSize();
  const virtualItems = virtualizer.getVirtualItems();
  const filteredCount = rows.length;
  const totalCount = activeLayer.featureCount;

  return (
    <div className="attr-table">
      <div className="attr-table__toolbar">
        <div className="attr-table__toolbar-left">
          <span className="attr-table__layer-name">{activeLayer.name}</span>
          <span className="attr-table__count">
            {filteredCount === totalCount
              ? `${totalCount.toLocaleString()} features`
              : `${filteredCount.toLocaleString()} of ${totalCount.toLocaleString()}`}
          </span>
          {selectedFeatureIds.size > 0 && (
            <span className="attr-table__selection-count">
              ({selectedFeatureIds.size} selected)
            </span>
          )}
        </div>
        <div className="attr-table__toolbar-right">
          <input
            className="attr-table__search"
            type="text"
            placeholder="Search..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
          />
          <button className="btn btn--sm" onClick={handleSelectAll} title="Select all currently visible/filtered features">
            ☑️ {filteredCount < totalCount ? "Select Filtered" : "Select All"}
          </button>
          {selectedFeatureIds.size > 0 && (
            <button className="btn btn--sm btn--ghost" onClick={() => setSelectedFeatures(new Set())} title="Clear selection">
              🧹 Clear
            </button>
          )}
          {selectedFeatureIds.size > 0 && (
            <button className="btn btn--sm" onClick={handleZoomToSelection} title="Zoom map to selected features">
              🎯 Zoom
            </button>
          )}
          <button className="btn btn--sm" onClick={() => setShowBatchEdit(true)} title="Batch edit or calculate attributes using expressions">
            ✏️ Calculator
          </button>
          <button
            className="btn btn--sm"
            onClick={handleExportCSV}
            title={
              selectedFeatureIds.size > 0
                ? `Export ${selectedFeatureIds.size} selected as CSV`
                : filteredCount !== totalCount
                ? `Export ${filteredCount.toLocaleString()} filtered as CSV`
                : "Export as CSV"
            }
          >
            📥 CSV{selectedFeatureIds.size > 0 ? ` (${selectedFeatureIds.size})` : ""}
          </button>
          <div style={{ position: "relative" }}>
            <button className="icon-btn" onClick={() => setShowColumnMenu(!showColumnMenu)} title="Toggle columns">
              ⊞
            </button>
            {showColumnMenu && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={() => setShowColumnMenu(false)} />
                <div className="attr-table__column-menu">
                  {table.getAllLeafColumns().map((col) => (
                    <label key={col.id} className="attr-table__column-toggle">
                      <input type="checkbox" checked={col.getIsVisible()} onChange={col.getToggleVisibilityHandler()} />
                      {col.id}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="attr-table__scroll" ref={parentRef}>
        <table className="attr-table__table">
          <thead className="attr-table__thead">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    className="attr-table__th"
                    style={{ width: header.getSize() }}
                    onClick={header.column.getToggleSortingHandler()}
                    onContextMenu={(e) => handleHeaderContextMenu(e, header.column.id)}
                  >
                    <div className="attr-table__th-content">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      <span className="attr-table__sort-icon">
                        {{ asc: " ↑", desc: " ↓" }[header.column.getIsSorted() as string] ?? ""}
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody style={{ height: `${totalSize}px`, position: "relative" }}>
            {virtualItems.map((virtualRow) => {
              const row = rows[virtualRow.index];
              const featureIdx = row.original._featureIndex;
              const isSelected = selectedFeatureIds.has(featureIdx);
              return (
                <tr
                  key={row.id}
                  className={`attr-table__tr ${isSelected ? "attr-table__tr--selected" : ""}`}
                  style={{
                    position: "absolute", top: 0, left: 0, width: "100%",
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  onClick={(e) => handleRowClick(featureIdx, e)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="attr-table__td" style={{ width: cell.column.getSize() }}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {statsColumn && activeLayer && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={() => setStatsColumn(null)} />
          <div style={{ position: "fixed", left: statsPosition.x, top: statsPosition.y, zIndex: 100 }}>
            <ColumnStats
              layer={activeLayer}
              attribute={statsColumn}
              filteredFeatures={sourceData?.features || []}
              selectedFeatures={selectedFeatures}
              onClose={() => setStatsColumn(null)}
            />
          </div>
        </>
      )}

      {showBatchEdit && <BatchEditDialog onClose={() => setShowBatchEdit(false)} />}
    </div>
  );
}
