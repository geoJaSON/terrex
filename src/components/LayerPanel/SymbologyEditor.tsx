import { useState, useRef, useEffect } from "react";
import { useMapStore } from "../../stores/mapStore";
import type { Layer } from "../../types/layer";

interface SymbologyEditorProps {
  layer: Layer;
  anchorEl: HTMLElement | null;
  onClose: () => void;
}

export function SymbologyEditor({ layer, anchorEl, onClose }: SymbologyEditorProps) {
  const { updateLayerStyle } = useMapStore();
  const popoverRef = useRef<HTMLDivElement>(null);
  const [color, setColor] = useState(layer.style.color);
  const [opacity, setOpacity] = useState(layer.style.opacity);
  const [strokeWidth, setStrokeWidth] = useState(layer.style.strokeWidth);
  const [pointRadius, setPointRadius] = useState(layer.style.pointRadius);

  // Position the popover near the anchor
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      setPosition({
        top: rect.top,
        left: rect.right + 8,
      });
    }
  }, [anchorEl]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const applyStyle = (updates: Partial<Layer["style"]>) => {
    updateLayerStyle(layer.id, updates);
  };

  const isPointLayer =
    layer.geometryType === "Point" || layer.geometryType === "MultiPoint";

  return (
    <div
      ref={popoverRef}
      className="symbology-editor"
      style={{ top: position.top, left: position.left }}
    >
      <div className="symbology-editor__title">Symbology</div>

      <div className="symbology-editor__row">
        <label className="symbology-editor__label">Color</label>
        <input
          type="color"
          value={color}
          className="symbology-editor__color-input"
          onChange={(e) => {
            setColor(e.target.value);
            applyStyle({ color: e.target.value, strokeColor: e.target.value });
          }}
        />
      </div>

      <div className="symbology-editor__row">
        <label className="symbology-editor__label">
          Opacity <span className="symbology-editor__value">{(opacity * 100).toFixed(0)}%</span>
        </label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={opacity}
          className="symbology-editor__slider"
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            setOpacity(v);
            applyStyle({ opacity: v });
          }}
        />
      </div>

      <div className="symbology-editor__row">
        <label className="symbology-editor__label">
          Stroke Width <span className="symbology-editor__value">{strokeWidth}px</span>
        </label>
        <input
          type="range"
          min="0.5"
          max="8"
          step="0.5"
          value={strokeWidth}
          className="symbology-editor__slider"
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            setStrokeWidth(v);
            applyStyle({ strokeWidth: v });
          }}
        />
      </div>

      {isPointLayer && (
        <div className="symbology-editor__row">
          <label className="symbology-editor__label">
            Point Size <span className="symbology-editor__value">{pointRadius}px</span>
          </label>
          <input
            type="range"
            min="2"
            max="20"
            step="1"
            value={pointRadius}
            className="symbology-editor__slider"
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              setPointRadius(v);
              applyStyle({ pointRadius: v });
            }}
          />
        </div>
      )}
    </div>
  );
}
