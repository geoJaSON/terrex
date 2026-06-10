import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  base: "./",

  // Some dependencies (e.g. fgdb -> immediate) assume Node's `global`.
  // In browsers / Tauri webviews, the equivalent is `globalThis`.
  // fgdb also branches on `process.browser` at runtime; without this define
  // it throws ReferenceError in the webview and FGDB loading silently fails.
  define: {
    global: "globalThis",
    "process.browser": "true",
  },

  optimizeDeps: {
    include: ["fgdb"],
    // `define` above is not applied to pre-bundled deps in dev, so repeat it
    // for the esbuild dep optimizer.
    esbuildOptions: {
      define: {
        global: "globalThis",
        "process.browser": "true",
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
