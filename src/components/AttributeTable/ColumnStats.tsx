import { useMemo } from "react";
import type { Layer } from "../../types/layer";

interface ColumnStatsProps {
  layer: Layer;
  attribute: string;
  onClose: () => void;
}

interface Stats {
  count: number;
  nullCount: number;
  uniqueCount: number;
  isNumeric: boolean;
  min?: number;
  max?: number;
  mean?: number;
  sum?: number;
  median?: number;
  topValues?: { value: string; count: number }[];
}

export function ColumnStats({ layer, attribute, onClose }: ColumnStatsProps) {
  const stats = useMemo<Stats>(() => {
    const values: unknown[] = [];
    let nullCount = 0;

    for (const f of layer.data.features) {
      const v = f.properties?.[attribute];
      if (v === null || v === undefined || v === "") {
        nullCount++;
      } else {
        values.push(v);
      }
    }

    const unique = new Set(values.map(String));

    // Detect if numeric
    const numericValues = values.map(Number).filter((n) => !isNaN(n));
    const isNumeric = numericValues.length > values.length * 0.8 && numericValues.length > 0;

    const result: Stats = {
      count: values.length,
      nullCount,
      uniqueCount: unique.size,
      isNumeric,
    };

    if (isNumeric && numericValues.length > 0) {
      numericValues.sort((a, b) => a - b);
      result.min = numericValues[0];
      result.max = numericValues[numericValues.length - 1];
      result.sum = numericValues.reduce((a, b) => a + b, 0);
      result.mean = result.sum / numericValues.length;
      const mid = Math.floor(numericValues.length / 2);
      result.median =
        numericValues.length % 2 === 0
          ? (numericValues[mid - 1] + numericValues[mid]) / 2
          : numericValues[mid];
    }

    // Top values
    const freq: Record<string, number> = {};
    for (const v of values) {
      const key = String(v);
      freq[key] = (freq[key] || 0) + 1;
    }
    result.topValues = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([value, count]) => ({ value, count }));

    return result;
  }, [layer, attribute]);

  const fmt = (n: number | undefined) =>
    n === undefined ? "—" : Number.isInteger(n) ? n.toLocaleString() : n.toFixed(4);

  return (
    <div className="column-stats">
      <div className="column-stats__header">
        <span className="column-stats__title">{attribute}</span>
        <button className="icon-btn icon-btn--sm" onClick={onClose}>✕</button>
      </div>

      <div className="column-stats__grid">
        <div className="column-stats__stat">
          <span className="column-stats__stat-label">Count</span>
          <span className="column-stats__stat-value">{stats.count.toLocaleString()}</span>
        </div>
        <div className="column-stats__stat">
          <span className="column-stats__stat-label">Null</span>
          <span className="column-stats__stat-value">{stats.nullCount.toLocaleString()}</span>
        </div>
        <div className="column-stats__stat">
          <span className="column-stats__stat-label">Unique</span>
          <span className="column-stats__stat-value">{stats.uniqueCount.toLocaleString()}</span>
        </div>
      </div>

      {stats.isNumeric && (
        <div className="column-stats__grid">
          <div className="column-stats__stat">
            <span className="column-stats__stat-label">Min</span>
            <span className="column-stats__stat-value">{fmt(stats.min)}</span>
          </div>
          <div className="column-stats__stat">
            <span className="column-stats__stat-label">Max</span>
            <span className="column-stats__stat-value">{fmt(stats.max)}</span>
          </div>
          <div className="column-stats__stat">
            <span className="column-stats__stat-label">Mean</span>
            <span className="column-stats__stat-value">{fmt(stats.mean)}</span>
          </div>
          <div className="column-stats__stat">
            <span className="column-stats__stat-label">Median</span>
            <span className="column-stats__stat-value">{fmt(stats.median)}</span>
          </div>
          <div className="column-stats__stat">
            <span className="column-stats__stat-label">Sum</span>
            <span className="column-stats__stat-value">{fmt(stats.sum)}</span>
          </div>
        </div>
      )}

      {stats.topValues && stats.topValues.length > 0 && (
        <div className="column-stats__top-values">
          <div className="column-stats__section-label">Top Values</div>
          {stats.topValues.map((tv) => (
            <div key={tv.value} className="column-stats__top-row">
              <span className="column-stats__top-value">{tv.value}</span>
              <div className="column-stats__top-bar-wrapper">
                <div
                  className="column-stats__top-bar"
                  style={{ width: `${(tv.count / stats.count) * 100}%` }}
                />
              </div>
              <span className="column-stats__top-count">{tv.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
