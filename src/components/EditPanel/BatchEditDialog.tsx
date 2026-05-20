import { useState, useMemo, useRef, useEffect } from "react";
import { useMapStore } from "../../stores/mapStore";
import type { Feature } from "geojson";

interface BatchEditDialogProps {
  onClose: () => void;
}

export function BatchEditDialog({ onClose }: BatchEditDialogProps) {
  const {
    layers,
    activeLayerId,
    selectedFeatureIds,
    setSelectedFeatures,
    batchUpdateFeatureProperty,
    batchUpdateFeatureProperties,
    getFilteredData,
  } = useMapStore();

  const [activeTab, setActiveTab] = useState<"assign" | "calculator">("assign");
  const [attribute, setAttribute] = useState("");
  const [value, setValue] = useState("");
  const [expression, setExpression] = useState("");
  const [previewResult, setPreviewResult] = useState<{ success: boolean; value: string }>({
    success: true,
    value: "Enter an expression...",
  });

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeLayer = layers.find((l) => l.id === activeLayerId);
  const attributes = activeLayer?.attributes || [];

  // Scoping metrics
  const selectedCount = selectedFeatureIds.size;
  const filteredFeatures = useMemo(() => {
    if (!activeLayerId) return [];
    return getFilteredData(activeLayerId).features;
  }, [activeLayerId, getFilteredData, layers]);
  const filteredCount = filteredFeatures.length;
  const totalCount = activeLayer?.featureCount || 0;

  // Determine current operation scope
  const targetScope = useMemo(() => {
    if (selectedCount > 0) return "selected";
    if (filteredCount < totalCount && filteredCount > 0) return "filtered";
    return "none";
  }, [selectedCount, filteredCount, totalCount]);

  const targetCount = targetScope === "selected" ? selectedCount : filteredCount;

  // Insert helper text at the cursor position in the calculator textarea
  const insertTextAtCursor = (textToInsert: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentText = expression;

    const newExpression = currentText.substring(0, start) + textToInsert + currentText.substring(end);
    setExpression(newExpression);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + textToInsert.length, start + textToInsert.length);
    }, 0);
  };

  // Safe Javascript expression evaluation
  const evaluateExpression = (expr: string, feature: Feature, index: number): unknown => {
    if (!expr.trim()) return "";
    let jsExpr = expr;

    // Replace [FieldName] tokens with properties['FieldName']
    jsExpr = jsExpr.replace(/\[([^\]]+)\]/g, (_, name) => {
      return `properties['${name.replace(/'/g, "\\'")}']`;
    });

    // Replace helper variables
    jsExpr = jsExpr.replace(/\$id/g, `feature.id`);
    jsExpr = jsExpr.replace(/\$index/g, `${index}`);

    const fn = new Function("properties", "feature", "index", `
      try {
        return (${jsExpr});
      } catch (err) {
        throw err;
      }
    `);

    return fn(feature.properties || {}, feature, index);
  };

  // Live preview logic
  const previewFeature = useMemo(() => {
    if (selectedCount > 0) {
      return activeLayer?.data.features.find((f) => selectedFeatureIds.has(f.id as number)) || null;
    }
    if (filteredCount > 0) {
      return filteredFeatures[0] || null;
    }
    return null;
  }, [selectedCount, filteredCount, selectedFeatureIds, filteredFeatures, activeLayer]);

  useEffect(() => {
    if (!expression.trim()) {
      setPreviewResult({ success: true, value: "Enter an expression..." });
      return;
    }
    if (!previewFeature) {
      setPreviewResult({ success: true, value: "No preview feature available." });
      return;
    }

    try {
      const result = evaluateExpression(expression, previewFeature, 0);
      setPreviewResult({
        success: true,
        value: result === null ? "null" : result === undefined ? "undefined" : String(result),
      });
    } catch (err: any) {
      setPreviewResult({
        success: false,
        value: err.message || "Syntax error",
      });
    }
  }, [expression, previewFeature]);

  // Handle Select All quick-action inside warning banner
  const handleSelectAllFeatures = () => {
    if (!activeLayer) return;
    const allIds = activeLayer.data.features.map((f, i) => (f.id as number) ?? i);
    setSelectedFeatures(new Set(allIds));
  };

  // Detect attribute type of selected attribute for the Simple Assign mode UI
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

    if (activeTab === "assign") {
      const targetIds = targetScope === "selected"
        ? Array.from(selectedFeatureIds)
        : filteredFeatures.map((f) => f.id as number);

      let parsedValue: unknown = value;
      if (attrType === "number" && value !== "") parsedValue = parseFloat(value);
      if (attrType === "boolean") parsedValue = value === "true";
      if (value === "") parsedValue = null;

      batchUpdateFeatureProperty(activeLayerId, targetIds, attribute, parsedValue);
      onClose();
    } else {
      if (!expression.trim()) return;

      const targetFeatures = targetScope === "selected"
        ? activeLayer?.data.features.filter((f) => selectedFeatureIds.has(f.id as number)) || []
        : filteredFeatures;

      const featureIdValueMap: Record<number, unknown> = {};
      let index = 0;
      for (const f of targetFeatures) {
        try {
          const val = evaluateExpression(expression, f, index++);
          featureIdValueMap[f.id as number] = val;
        } catch (err: any) {
          alert(`Error evaluating expression for Feature #${f.id}: ${err.message}`);
          return;
        }
      }

      batchUpdateFeatureProperties(activeLayerId, featureIdValueMap, attribute);
      onClose();
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: "500px", maxWidth: "600px" }}>
        <div className="modal__header">
          <span className="modal__title">Batch Edit & Field Calculator</span>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        <div className="modal__tabs">
          <button
            className={`modal__tab ${activeTab === "assign" ? "modal__tab--active" : ""}`}
            onClick={() => setActiveTab("assign")}
          >
            ✏️ Simple Assign
          </button>
          <button
            className={`modal__tab ${activeTab === "calculator" ? "modal__tab--active" : ""}`}
            onClick={() => setActiveTab("calculator")}
          >
            🧮 Field Calculator
          </button>
        </div>

        <div className="modal__body">
          {/* Target features scope banner */}
          {targetScope === "none" ? (
            <div className="calculator-scope-warning">
              <p>
                ⚠️ <strong>No features are currently selected or filtered.</strong> The calculator cannot run directly on all features to prevent accidental mass-edits.
              </p>
              <button className="btn btn--sm btn--primary" onClick={handleSelectAllFeatures}>
                ☑️ Select All Features ({totalCount})
              </button>
            </div>
          ) : (
            <p className="modal__description">
              Target Scope: Modifying <strong>{targetCount.toLocaleString()}</strong> feature{targetCount !== 1 ? "s" : ""}{" "}
              via <strong>{targetScope === "selected" ? "Active Selection" : "Active Filter"}</strong>.
            </p>
          )}

          <div className="modal__field">
            <label className="modal__label">Target Attribute</label>
            <select
              className="filter-bar__select"
              value={attribute}
              onChange={(e) => setAttribute(e.target.value)}
              style={{ width: "100%" }}
            >
              <option value="">Select target attribute...</option>
              {attributes.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>

          {activeTab === "assign" ? (
            <div className="modal__field">
              <label className="modal__label">Constant Value</label>
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
                  placeholder="Enter constant value (leave empty for NULL)"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  style={{ width: "100%" }}
                />
              )}
            </div>
          ) : (
            <div className="modal__field">
              <label className="modal__label">Expression</label>
              <textarea
                ref={textareaRef}
                className="edit-panel__field-input"
                style={{
                  width: "100%",
                  height: "80px",
                  fontFamily: "var(--font-mono)",
                  fontSize: "11px",
                  resize: "vertical",
                  lineHeight: "1.4",
                  padding: "var(--space-2)",
                }}
                placeholder="E.g., [population] / [area] * 100"
                value={expression}
                onChange={(e) => setExpression(e.target.value)}
              />

              {/* Calculator Quick Helpers Panel */}
              <div className="calculator-grid">
                <div>
                  <div className="calculator-list-title">Attributes (click to insert)</div>
                  <div className="calculator-list">
                    <button className="calculator-item" onClick={() => insertTextAtCursor("$id")}>
                      $id (Feature ID)
                    </button>
                    <button className="calculator-item" onClick={() => insertTextAtCursor("$index")}>
                      $index (Target Index)
                    </button>
                    {attributes.map((attr) => (
                      <button
                        key={attr}
                        className="calculator-item"
                        onClick={() => insertTextAtCursor(`[${attr}]`)}
                        title={attr}
                      >
                        [{attr}]
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="calculator-list-title">Math & helpers (click to insert)</div>
                  <div className="calculator-list" style={{ padding: "var(--space-1)" }}>
                    <div className="calculator-ops" style={{ marginBottom: "6px" }}>
                      <button className="calculator-op-btn" onClick={() => insertTextAtCursor(" + ")}>+</button>
                      <button className="calculator-op-btn" onClick={() => insertTextAtCursor(" - ")}>-</button>
                      <button className="calculator-op-btn" onClick={() => insertTextAtCursor(" * ")}>*</button>
                      <button className="calculator-op-btn" onClick={() => insertTextAtCursor(" / ")}>/</button>
                      <button className="calculator-op-btn" onClick={() => insertTextAtCursor(" ( ")}>(</button>
                      <button className="calculator-op-btn" onClick={() => insertTextAtCursor(" ) ")}>)</button>
                      <button className="calculator-op-btn" onClick={() => insertTextAtCursor(" && ")}>AND</button>
                      <button className="calculator-op-btn" onClick={() => insertTextAtCursor(" || ")}>OR</button>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                      <button className="calculator-item" style={{ fontSize: "9px" }} onClick={() => insertTextAtCursor("Math.round()")}>
                        Math.round(x)
                      </button>
                      <button className="calculator-item" style={{ fontSize: "9px" }} onClick={() => insertTextAtCursor("Math.floor()")}>
                        Math.floor(x)
                      </button>
                      <button className="calculator-item" style={{ fontSize: "9px" }} onClick={() => insertTextAtCursor("Math.abs()")}>
                        Math.abs(x)
                      </button>
                      <button className="calculator-item" style={{ fontSize: "9px" }} onClick={() => insertTextAtCursor(".toUpperCase()")}>
                        .toUpperCase()
                      </button>
                      <button className="calculator-item" style={{ fontSize: "9px" }} onClick={() => insertTextAtCursor(".toLowerCase()")}>
                        .toLowerCase()
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Expression Preview */}
              {previewFeature && (
                <div
                  className={`calculator-preview ${
                    !expression.trim()
                      ? "calculator-preview--empty"
                      : previewResult.success
                      ? "calculator-preview--success"
                      : "calculator-preview--error"
                  }`}
                >
                  <strong style={{ display: "block", marginBottom: "2px", textTransform: "uppercase", fontSize: "9px" }}>
                    {!expression.trim()
                      ? "Preview"
                      : previewResult.success
                      ? `Live Preview (Feature #${previewFeature.id})`
                      : "Syntax/Evaluation Error"}
                  </strong>
                  {previewResult.value}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal__footer">
          <button className="btn btn--sm" onClick={onClose}>Cancel</button>
          <button
            className="btn btn--primary btn--sm"
            onClick={handleApply}
            disabled={!attribute || targetScope === "none" || (activeTab === "calculator" && !expression.trim())}
          >
            {activeTab === "assign"
              ? `Update ${targetCount.toLocaleString()} Feature${targetCount !== 1 ? "s" : ""}`
              : `Calculate for ${targetCount.toLocaleString()} Feature${targetCount !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
