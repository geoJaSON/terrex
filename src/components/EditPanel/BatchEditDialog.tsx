import { useState, useMemo } from "react";
import { useMapStore } from "../../stores/mapStore";

interface BatchEditDialogProps {
  onClose: () => void;
}

export function BatchEditDialog({ onClose }: BatchEditDialogProps) {
  const {
    layers,
    activeLayerId,
    selectedFeatureIds,
    batchUpdateFeatureProperty,
  } = useMapStore();

  const [attribute, setAttribute] = useState("");
  const [value, setValue] = useState("");

  const activeLayer = layers.find((l) => l.id === activeLayerId);
  const attributes = activeLayer?.attributes || [];
  const count = selectedFeatureIds.size;

  // Detect type of selected attribute
  const attrType = useMemo(() => {
    if (!activeLayer || !attribute) return "text";
    for (const f of activeLayer.data.features) {
      const v = f.properties?.[attribute];
      if (v !== null && v !== undefined) {
        if (typeof v === "number") return "number";
        if (typeof v === "boolean") return "boolean";
        return "text";
      }
    }
    return "text";
  }, [activeLayer, attribute]);

  const handleApply = () => {
    if (!activeLayerId || !attribute) return;
    const ids = Array.from(selectedFeatureIds);
    let parsedValue: unknown = value;
    if (attrType === "number" && value !== "") parsedValue = parseFloat(value);
    if (attrType === "boolean") parsedValue = value === "true";
    if (value === "") parsedValue = null;
    batchUpdateFeatureProperty(activeLayerId, ids, attribute, parsedValue);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <span className="modal__title">Batch Edit Attributes</span>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        <div className="modal__body">
          <p className="modal__description">
            Update an attribute for <strong>{count}</strong> selected feature{count !== 1 ? "s" : ""}.
          </p>

          <div className="modal__field">
            <label className="modal__label">Attribute</label>
            <select
              className="filter-bar__select"
              value={attribute}
              onChange={(e) => setAttribute(e.target.value)}
              style={{ width: "100%" }}
            >
              <option value="">Select attribute...</option>
              {attributes.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>

          <div className="modal__field">
            <label className="modal__label">New Value</label>
            {attrType === "boolean" ? (
              <select
                className="filter-bar__select"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                style={{ width: "100%" }}
              >
                <option value="">NULL</option>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : (
              <input
                className="edit-panel__field-input"
                type={attrType === "number" ? "number" : "text"}
                placeholder="Enter new value (leave empty for NULL)"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                style={{ width: "100%" }}
              />
            )}
          </div>
        </div>

        <div className="modal__footer">
          <button className="btn btn--sm" onClick={onClose}>Cancel</button>
          <button
            className="btn btn--primary btn--sm"
            onClick={handleApply}
            disabled={!attribute}
          >
            Update {count} Feature{count !== 1 ? "s" : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
