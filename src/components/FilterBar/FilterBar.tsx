import { useState, useCallback, useMemo } from "react";
import { useMapStore, type FilterCondition } from "../../stores/mapStore";
import { FilterRow } from "./FilterRow";

function newCondition(): FilterCondition {
  return { id: `c_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`, attribute: "", operator: "=", value: "" };
}

export function FilterBar() {
  const {
    layers,
    activeLayerId,
    setActiveLayer,
    filters,
    setFilter,
    clearFilter,
    filterBarVisible,
    getFilteredData,
  } = useMapStore();

  const [conditions, setConditions] = useState<FilterCondition[]>([newCondition()]);
  const [matchMode, setMatchMode] = useState<"all" | "any">("all");
  const [selectedLayerId, setSelectedLayerId] = useState<string | "">(activeLayerId || "");

  const selectedLayer = layers.find((l) => l.id === selectedLayerId);
  const attributes = selectedLayer?.attributes || [];

  // Sync selectedLayerId when activeLayerId changes
  useMemo(() => {
    if (activeLayerId && !selectedLayerId) {
      setSelectedLayerId(activeLayerId);
    }
  }, [activeLayerId, selectedLayerId]);

  // Load existing filter when switching layers
  useMemo(() => {
    if (selectedLayerId && filters[selectedLayerId]) {
      const f = filters[selectedLayerId];
      setConditions(f.conditions.length > 0 ? f.conditions : [newCondition()]);
      setMatchMode(f.matchMode);
    } else {
      setConditions([newCondition()]);
      setMatchMode("all");
    }
  }, [selectedLayerId, filters]);

  const handleLayerChange = useCallback((id: string) => {
    setSelectedLayerId(id);
    setActiveLayer(id);
  }, [setActiveLayer]);

  const handleAddCondition = useCallback(() => {
    setConditions((prev) => [...prev, newCondition()]);
  }, []);

  const handleRemoveCondition = useCallback((id: string) => {
    setConditions((prev) => {
      const next = prev.filter((c) => c.id !== id);
      return next.length === 0 ? [newCondition()] : next;
    });
  }, []);

  const handleUpdateCondition = useCallback(
    (id: string, updates: Partial<FilterCondition>) => {
      setConditions((prev) =>
        prev.map((c) => (c.id === id ? { ...c, ...updates } : c))
      );
    },
    []
  );

  const handleApply = useCallback(() => {
    if (!selectedLayerId) return;
    setFilter(selectedLayerId, {
      conditions,
      matchMode,
      active: true,
    });
  }, [selectedLayerId, conditions, matchMode, setFilter]);

  const handleClear = useCallback(() => {
    if (!selectedLayerId) return;
    clearFilter(selectedLayerId);
    setConditions([newCondition()]);
    setMatchMode("all");
  }, [selectedLayerId, clearFilter]);

  const activeFilter = selectedLayerId ? filters[selectedLayerId] : null;

  // Compute filtered count
  const filteredData = selectedLayerId ? getFilteredData(selectedLayerId) : null;
  const totalCount = selectedLayer?.featureCount || 0;
  const filteredCount = filteredData?.features.length ?? totalCount;
  const isFiltered = activeFilter?.active && filteredCount !== totalCount;

  if (!filterBarVisible) return null;

  return (
    <div className="filter-bar">
      <div className="filter-bar__header">
        <div className="filter-bar__header-left">
          <span className="filter-bar__icon">🔍</span>
          <span className="filter-bar__label">Filter</span>

          <select
            className="filter-bar__select filter-bar__layer-select"
            value={selectedLayerId}
            onChange={(e) => handleLayerChange(e.target.value)}
          >
            <option value="">Select layer...</option>
            {layers.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>

          {isFiltered && (
            <span className="filter-bar__result-count">
              Showing <strong>{filteredCount.toLocaleString()}</strong> of{" "}
              {totalCount.toLocaleString()} features
            </span>
          )}
        </div>

        <div className="filter-bar__header-right">
          <div className="filter-bar__match-toggle">
            <span className="filter-bar__match-label">Match:</span>
            <button
              className={`filter-bar__match-btn ${matchMode === "all" ? "filter-bar__match-btn--active" : ""}`}
              onClick={() => setMatchMode("all")}
            >
              All (AND)
            </button>
            <button
              className={`filter-bar__match-btn ${matchMode === "any" ? "filter-bar__match-btn--active" : ""}`}
              onClick={() => setMatchMode("any")}
            >
              Any (OR)
            </button>
          </div>

          <button className="btn btn--primary btn--sm" onClick={handleApply} disabled={!selectedLayerId}>
            Apply
          </button>
          <button className="btn btn--sm" onClick={handleClear}>
            Clear
          </button>
        </div>
      </div>

      <div className="filter-bar__conditions">
        {conditions.map((cond, i) => (
          <FilterRow
            key={cond.id}
            condition={cond}
            attributes={attributes}
            layerId={selectedLayerId}
            onUpdate={(updates) => handleUpdateCondition(cond.id, updates)}
            onRemove={() => handleRemoveCondition(cond.id)}
            onAdd={handleAddCondition}
            showAdd={i === conditions.length - 1}
            showRemove={conditions.length > 1}
          />
        ))}
      </div>
    </div>
  );
}
