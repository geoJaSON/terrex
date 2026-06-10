# Terrex

Terrex is an experimental lightweight, cross-platform desktop GIS data management application
for quickly inspecting, querying, editing, and converting geospatial data —
without the weight of a full desktop GIS suite. It's built with
[Tauri](https://tauri.app/) (Rust) + React, so it ships as a small native
binary with a fast web-based UI.

## NOTE:
Geoprocessing and attribute editing tools are still a work-in-progress and may not function correctly for all datasets.
Geometry editing is still on the todo list.

## Features

### Data sources

- **Local files** — load GeoJSON/JSON, Shapefile (`.zip`), KML, CSV, GeoTIFF,
  and File Geodatabases (FGDB, `.zip`).
  - CSV files auto-detect latitude/longitude columns (`lat`/`latitude`/`y`,
    `lon`/`lng`/`longitude`/`x`, and common variants) and become point layers.
  - Shapefiles and FGDBs are detected automatically from `.zip` — FGDB is tried
    first and each layer in the geodatabase loads as a separate map layer.
  - GeoTIFF files are rendered as georeferenced image overlays on the map
    (EPSG:4326 / WGS84 only — reproject projected rasters first).
  - Native drag-and-drop: drop supported files anywhere on the window.
- **Online services** via the Connection Manager:
  - **ArcGIS Feature Layers** — ArcGIS Online and Enterprise/Server, with
    automatic token exchange (referer-bound tokens) and a fallback to HTTP
    Basic / web-tier auth. Large layers are paged past the service's
    `maxRecordCount` automatically.
  - **WFS** (`GetFeature`, GeoJSON output) — the feature type can be set on
    the connection, or is auto-detected when the service has exactly one.
  - **GeoJSON URL** — any HTTP(S) endpoint returning a FeatureCollection.
  - Saved connections with cached credentials. All network requests go
    through the Rust backend, so there are no CORS limitations and the
    `Referer` header can be set correctly for ArcGIS.

### Layer management

- **Layer panel** (left sidebar) — toggle visibility, reorder by dragging,
  right-click context menu: zoom to extent, open attribute table, zoom to
  selection, refresh (online layers), hide/show, export, and remove.
- **Symbology editor** — click the color swatch on any layer to edit color,
  opacity, stroke width, and point radius.
- **Active layer** — click a layer to make it active; the attribute table,
  filter bar, and geoprocessing tools all operate on the active layer.

### Map

- **MapLibre GL** rendering with hardware-accelerated vector and raster display.
- **Basemaps** — switch between Voyager (OSM), Dark, Light, and Satellite
  (Esri World Imagery) with the basemap switcher in the bottom-right corner.
- **Go-to search** — geocode an address or enter coordinates to fly the view.
- **Right-click context menu** — copy coordinates, drop a labeled pin, or start
  a measurement.
- **Measurement tool** — click points on the map to measure distance and area;
  toggle between metric, imperial, and nautical units in the HUD.
- **Floating toolbar** (bottom-right) — one-click toggles for the filter bar,
  attribute table, and geoprocessing drawer.

### Attribute table & querying

- **Attribute table** — virtualized table that handles large datasets without
  performance loss. Resize it by dragging the divider, double-click the divider
  to close.
- **Per-column statistics** — right-click any column header to see min, max,
  mean, median, and top values (click toggles sorting).
- **Selection** — click rows or use Select All / Select Filtered; zoom to
  selected features; selections carry through to export and batch edit.
- **Query / filter bar** — build multi-condition attribute filters (=, !=, >,
  LIKE, IN, IS NULL, …) with AND/OR matching; the map and table update to the
  filtered result in real time.

### Editing

- **Attribute editing** — click any row in the attribute table to edit field
  values directly.
- **Batch edit** — assign a constant value to a field across all selected or
  filtered features.
- **Field calculator** — write JavaScript expressions referencing field names
  (e.g. `[POPULATION] / [AREA]`) with a live preview; applies to selected or
  filtered features.
- **Undo / redo** — full edit history for attribute changes.

### Geoprocessing

Select a layer in the layer panel, then click the wrench button in the floating
toolbar to open the Geoprocessing drawer. Click any tool to configure its
parameters and run it — the result is added as a new layer.

Available tools:

| Tool | Description |
|---|---|
| Buffer | Expand features outward by a distance (meters, km, feet, miles) |
| Dissolve | Merge features sharing a common field value |
| Envelope | Bounding box of all features |
| Convex Hull | Minimum convex polygon around all features |
| Center Points | Centroid of each feature |
| Simplify | Reduce vertex count with a configurable tolerance |
| Voronoi Polygons | Voronoi diagram generated from point features |
| Points Within Polygon | Filter point features that fall inside a polygon layer |

### Export

Write any layer — or just the filtered or selected subset — to GeoJSON or CSV
via the layer context menu or the attribute table toolbar.

## Tech stack

- **Shell:** Tauri 2 (Rust) — file I/O, binary reads, and a backend HTTP proxy
  command.
- **UI:** React 19 + TypeScript, bundled with Vite 7.
- **Map:** MapLibre GL via react-map-gl.
- **State:** Zustand.
- **Table:** TanStack Table + TanStack Virtual.
- **Geoprocessing:** Turf.js (`@turf/turf`).
- **Parsers:** shpjs (Shapefile), fgdb (File Geodatabase), geotiff (GeoTIFF),
  @tmcw/togeojson (KML), PapaParse (CSV).

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS) and npm
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
- Platform-specific Tauri prerequisites — see the
  [Tauri prerequisites guide](https://tauri.app/start/prerequisites/).
  On Windows this means the WebView2 runtime (preinstalled on Windows 11)
  and the MSVC build tools.

## Getting started

Install dependencies:

```bash
npm install
```

Run in development (starts Vite + a live Tauri window with hot reload):

```bash
npm run tauri dev
```

> Running the built debug `.exe` directly will show a blank
> "page can't be displayed" window — the debug binary loads its UI from the
> Vite dev server. Use `npm run tauri dev` for development, or build a release
> binary (below) for a standalone app.

## Building a release

```bash
npm run tauri build
```

This type-checks and bundles the frontend, compiles the Rust binary in
release mode, and produces a standalone executable plus platform installers
under `src-tauri/target/release/` (binary) and
`src-tauri/target/release/bundle/` (installers).

To build just the web frontend (output in `dist/`):

```bash
npm run build
```

## Project structure

```
src/                      React + TypeScript frontend
  components/
    LayerPanel/           Layer list, drag-and-drop reorder, symbology editor
    Map/                  MapLibre view, basemap switcher, go-to search,
                          measurement tool, context menu
    AttributeTable/       Virtualized attribute table, column stats
    FilterBar/            Multi-condition query / filter builder
    EditPanel/            Single-feature attribute editor, batch edit,
                          field calculator
    ConnectionManager/    Online data source connections
    Tools/                Geoprocessing drawer and tool parameter dialogs
    StatusBar/            Status bar (cursor coords, zoom, CRS, filter
                          status, layer count) + toolbar icons
  hooks/useFileLoader.ts  Local file parsing (GeoJSON/SHP/FGDB/KML/CSV/GeoTIFF)
  services/               Online sources, credential cache
  stores/                 Zustand state (map, connections)
  utils/exporters.ts      GeoJSON / CSV export
  types/                  Shared TypeScript types
src-tauri/                Rust backend (file I/O, HTTP proxy), Tauri config
```

## Recommended IDE setup

- [VS Code](https://code.visualstudio.com/) +
  [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) +
  [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
