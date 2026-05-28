// Line-art icons for the status bar. Sized to the 28px icon-btn, drawn with
// square caps / miter joins and crispEdges so they match the zero-radius
// phosphor-terminal theme. stroke="currentColor" lets them inherit the
// icon-btn hover (--text-primary) and --active (--accent-primary) colors.

const base = {
  width: 15,
  height: 15,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "square" as const,
  strokeLinejoin: "miter" as const,
  shapeRendering: "geometricPrecision" as const,
  "aria-hidden": true,
};

/** Query / filter: a funnel built from straight segments. */
export function FilterIcon() {
  return (
    <svg {...base}>
      <path d="M2 3 H14 L9.5 8.5 V13 L6.5 11.5 V8.5 Z" />
    </svg>
  );
}

/** Attribute table: a grid with a header row and column dividers. */
export function TableIcon() {
  return (
    <svg {...base}>
      <path d="M2 2 H14 V14 H2 Z" />
      <path d="M2 6 H14" />
      <path d="M7 2 V14" />
      <path d="M11 2 V14" />
    </svg>
  );
}

/** Wrench: open-end wrench for geoprocessing tools. */
export function WrenchIcon() {
  return (
    <svg {...base}>
      <path d="M2 14 L7 9 M7 9 L6 7 L8 5 L11 5 L13 7 L11 9 L8 9 L7 9" />
    </svg>
  );
}
