import { useState, useRef, useEffect, useCallback } from "react";
import { useMapStore, type FilterCondition, type FilterOperator } from "../../stores/mapStore";

const OPERATORS: { value: FilterOperator; label: string; needsValue: boolean }[] = [
  { value: "=", label: "=", needsValue: true },
  { value: "!=", label: "≠", needsValue: true },
  { value: ">", label: ">", needsValue: true },
  { value: "<", label: "<", needsValue: true },
  { value: ">=", label: "≥", needsValue: true },
  { value: "<=", label: "≤", needsValue: true },
  { value: "LIKE", label: "LIKE", needsValue: true },
  { value: "NOT LIKE", label: "NOT LIKE", needsValue: true },
  { value: "IN", label: "IN", needsValue: true },
  { value: "IS NULL", label: "IS NULL", needsValue: false },
  { value: "IS NOT NULL", label: "IS NOT NULL", needsValue: false },
];

interface FilterRowProps {
  condition: FilterCondition;
  attributes: string[];
  layerId: string;
  onUpdate: (updates: Partial<FilterCondition>) => void;
  onRemove: () => void;
  onAdd: () => void;
  showAdd: boolean;
  showRemove: boolean;
}

export function FilterRow({
  condition,
  attributes,
  layerId,
  onUpdate,
  onRemove,
  onAdd,
  showAdd,
  showRemove,
}: FilterRowProps) {
  const { getUniqueValues } = useMapStore();
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<unknown[]>([]);
  const valueRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const operatorConfig = OPERATORS.find((o) => o.value === condition.operator);
  const needsValue = operatorConfig?.needsValue ?? true;

  // Load unique values when attribute changes
  useEffect(() => {
    if (condition.attribute && layerId) {
      const vals = getUniqueValues(layerId, condition.attribute);
      setSuggestions(vals);
    } else {
      setSuggestions([]);
    }
  }, [condition.attribute, layerId, getUniqueValues]);

  // Filter suggestions based on current input
  const filteredSuggestions = suggestions.filter((s) => {
    if (!condition.value) return true;
    return String(s).toLowerCase().includes(condition.value.toLowerCase());
  }).slice(0, 30);

  // Close suggestions on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        valueRef.current &&
        !valueRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelectSuggestion = useCallback(
    (val: unknown) => {
      onUpdate({ value: String(val) });
      setShowSuggestions(false);
    },
    [onUpdate]
  );

  return (
    <div className="filter-row">
      <select
        className="filter-bar__select filter-row__attribute"
        value={condition.attribute}
        onChange={(e) => onUpdate({ attribute: e.target.value, value: "" })}
      >
        <option value="">Attribute...</option>
        {attributes.map((a) => (
          <option key={a} value={a}>{a}</option>
        ))}
      </select>

      <select
        className="filter-bar__select filter-row__operator"
        value={condition.operator}
        onChange={(e) => onUpdate({ operator: e.target.value as FilterOperator })}
      >
        {OPERATORS.map((op) => (
          <option key={op.value} value={op.value}>{op.label}</option>
        ))}
      </select>

      {needsValue ? (
        <div className="filter-row__value-wrapper">
          <input
            ref={valueRef}
            className="filter-row__value"
            type="text"
            placeholder={condition.operator === "IN" ? "val1, val2, ..." : "Value..."}
            value={condition.value}
            onChange={(e) => onUpdate({ value: e.target.value })}
            onFocus={() => setShowSuggestions(true)}
          />
          {showSuggestions && filteredSuggestions.length > 0 && (
            <div ref={suggestionsRef} className="filter-row__suggestions">
              {filteredSuggestions.map((s, i) => (
                <button
                  key={i}
                  className="filter-row__suggestion-item"
                  onClick={() => handleSelectSuggestion(s)}
                >
                  {String(s)}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="filter-row__value-placeholder" />
      )}

      <div className="filter-row__actions">
        {showRemove && (
          <button className="icon-btn icon-btn--sm icon-btn--danger" onClick={onRemove} title="Remove condition">
            −
          </button>
        )}
        {showAdd && (
          <button className="icon-btn icon-btn--sm" onClick={onAdd} title="Add condition">
            ＋
          </button>
        )}
      </div>
    </div>
  );
}
