# Terrex

Terrex is a lightweight, cross-platform desktop GIS data management application
for quickly inspecting, querying, editing, and converting geospatial data —
without the weight of a full desktop GIS suite. It's built with
[Tauri](https://tauri.app/) (Rust) + React, so it ships as a small native
binary with a fast web-based UI.

## Features

### Data sources

- **Local files** — load GeoJSON/JSON, Shapefile (`.zip`), KML, and CSV.
  - CSV files auto-detect latitude/longitude columns (`lat`/`latitude`/`y`,
    `lon`/`lng`/`longitude`/`x`, and common variants) and become point layers.
  - Native drag-and-drop: drop supported files anywhere on the window.
- **Online services** via the Connection Manager:
  - **ArcGIS Feature Layers** — ArcGIS Online and Enterprise/Server, with
    automatic token exchange (referer-bound tokens) and a fallback to HTTP
    Basic / web-tier auth. Large layers are paged past the service's
    `maxRecordCount` automatically.
  - **WFS** (`GetFeature`, GeoJSON output).
  - **GeoJSON URL** — any HTTP(S) endpoint returning a FeatureCollection.
  - Saved connections with cached credentials. All network requests go
    through the Rust backend, so there are no CORS limitations and the
    `Referer` header can be set correctly for ArcGIS.

### Working with data

- **Layer panel** — toggle visibility, reorder, and remove layers.
- **Symbology editor** — fill color, opacity, stroke color/width, and point
  radius per layer.
- **Attribute table** — virtualized table (handles large datasets), with
  per-column statistics.
- **Query / filter bar** — build multi-condition attribute filters; the map
  and table update to the filtered result.
- **Editing** — edit feature attributes, batch-edit across multiple features,
  with full undo/redo history.
- **Map** — MapLibre GL rendering, switchable basemaps, and a "go to"
  coordinate search. Working CRS is EPSG:4326.
- **Export** — write a layer (or just the filtered/selected subset) to
  GeoJSON or CSV.

## Tech stack

- **Shell:** Tauri 2 (Rust) — file I/O and a backend HTTP proxy command.
- **UI:** React 19 + TypeScript, bundled with Vite 7.
- **Map:** MapLibre GL via react-map-gl.
- **State:** Zustand.
- **Table:** TanStack Table + TanStack Virtual.
- **Parsers:** shpjs (Shapefile), @tmcw/togeojson (KML), PapaParse (CSV).

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
    LayerPanel/           Layer list, symbology editor
    Map/                  MapLibre view, basemap switcher, go-to search
    AttributeTable/       Virtualized attribute table + column stats
    FilterBar/            Query / filter builder
    EditPanel/            Attribute editing + batch edit
    ConnectionManager/    Online data source connections
    StatusBar/            Status bar + toolbar icons
  hooks/useFileLoader.ts  Local file parsing (GeoJSON/SHP/KML/CSV)
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
