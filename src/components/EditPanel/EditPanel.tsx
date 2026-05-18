import { useState, useEffect, useMemo } from "react";
import { useMapStore } from "../../stores/mapStore";

export function EditPanel() {
  const {
    layers,
    activeLayerId,
    selectedFeatureIds,
    updateFeatureProperty,
  } = useMapStore();

  const [editMode, setEditMode] = useState(false);
  const [editedValues, setEditedValues] = useState<Record<string, unknown>>({});
  const [hasChanges, setHasChanges] = useState(false);

  const activeLayer = layers.find((l) => l.id === activeLayerId);
  const selectedId = selectedFeatureIds.size === 1 ? Array.from(selectedFeatureIds)[0] : null;

  const feature = useMemo(() => {
    if (!activeLayer || selectedId === null) return null;
    return activeLayer.data.features.find((f) => (f.id as number) === selectedId) || null;
  }, [activeLayer, selectedId]);

  // Reset edited values when feature changes
  useEffect(() => {
    if (feature?.properties) {
      setEditedValues({ ...feature.properties });
      setHasChanges(false);
    }
  }, [feature]);

  if (!activeLayer || selectedFeatureIds.size !== 1 || !feature) return null;

  const attributes = activeLayer.attributes;

  const handleValueChange = (attr: string, value: unknown) => {
    setEditedValues((prev) => ({ ...prev, [attr]: value }));
    setHasChanges(true);
  };

  const handleSave = () => {
    if (!activeLayerId || selectedId === null) return;
    for (const attr of attributes) {
      const oldVal = feature.properties?.[attr];
      const newVal = editedValues[attr];
      if (oldVal !== newVal) {
        updateFeatureProperty(activeLayerId, selectedId, attr, newVal);
      }
    }
    setHasChanges(false);
    setEditMode(false);
  };

  const handleDiscard = () => {
    if (feature?.properties) {
      setEditedValues({ ...feature.properties });
    }
    setHasChanges(false);
  };

  const inferFieldType = (value: unknown): "number" | "boolean" | "text" => {
    if (typeof value === "number") return "number";
    if (typeof value === "boolean") return "boolean";
    return "text";
  };

  return (
    <div className="edit-panel">
      <div className="edit-panel__header">
        <span className="edit-panel__title">Properties</span>
        <button
          className={`btn btn--sm ${editMode ? "btn--primary" : ""}`}
          onClick={() => setEditMode(!editMode)}
        >
          {editMode ? "🔓 Editing" : "🔒 Read Only"}
        </button>
      </div>

      <div className="edit-panel__feature-id">
        Feature #{selectedId}
      </div>

      <div className="edit-panel__fields">
        {attributes.map((attr) => {
          const value = editedValues[attr];
          const fieldType = inferFieldType(feature.properties?.[attr]);

          return (
            <div key={attr} className="edit-panel__field">
              <label className="edit-panel__field-label">{attr}</label>
              {fieldType === "boolean" ? (
                <label className="edit-panel__checkbox-label">
                  <input
                    type="checkbox"
                    checked={!!value}
                    disabled={!editMode}
                    onChange={(e) => handleValueChange(attr, e.target.checked)}
                  />
                  {value ? "true" : "false"}
                </label>
              ) : (
                <input
                  className="edit-panel__field-input"
                  type={fieldType === "number" ? "number" : "text"}
                  value={value === null || value === undefined ? "" : String(value)}
                  disabled={!editMode}
                  onChange={(e) => {
                    const v = fieldType === "number" && e.target.value !== ""
                      ? parseFloat(e.target.value)
                      : e.target.value || null;
                    handleValueChange(attr, v);
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {editMode && hasChanges && (
        <div className="edit-panel__actions">
          <button className="btn btn--primary btn--sm" onClick={handleSave}>
            Save
          </button>
          <button className="btn btn--sm" onClick={handleDiscard}>
            Discard
          </button>
        </div>
      )}
    </div>
  );
}
