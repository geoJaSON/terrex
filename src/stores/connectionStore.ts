import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";

export type ConnectionType = "arcgis_feature" | "wfs" | "geojson_url";
export type AuthType = "none" | "basic" | "token";

export interface SavedConnection {
  id: string;
  name: string;
  type: ConnectionType;
  url: string;
  authType: AuthType;
  // Note: Passwords are not persisted to disk for security reasons.
  // They are only kept in memory during an active session if needed.
}

interface ConnectionState {
  connections: SavedConnection[];
  loadConnections: () => Promise<void>;
  saveConnection: (conn: SavedConnection) => Promise<void>;
  deleteConnection: (id: string) => Promise<void>;
  
  isManagerOpen: boolean;
  setManagerOpen: (open: boolean) => void;
}

const CONFIG_FILE = "connections.json";

async function getConfigFile(): Promise<string> {
  const dir = await appDataDir();
  return await join(dir, CONFIG_FILE);
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  connections: [],
  isManagerOpen: false,
  setManagerOpen: (open) => set({ isManagerOpen: open }),

  loadConnections: async () => {
    try {
      const path = await getConfigFile();
      const content = await invoke<string>("read_file", { path });
      const connections: SavedConnection[] = JSON.parse(content);
      set({ connections });
    } catch (err) {
      console.log("No existing connections file found or failed to load.", err);
      // It's normal if it doesn't exist yet
    }
  },

  saveConnection: async (conn) => {
    const { connections } = get();
    const existing = connections.findIndex((c) => c.id === conn.id);
    let newConnections;
    
    // Strip out any accidental credentials before saving
    const safeConn: SavedConnection = {
      id: conn.id,
      name: conn.name,
      type: conn.type,
      url: conn.url,
      authType: conn.authType,
    };

    if (existing >= 0) {
      newConnections = [...connections];
      newConnections[existing] = safeConn;
    } else {
      newConnections = [...connections, safeConn];
    }
    
    set({ connections: newConnections });

    // Persist to disk
    try {
      const path = await getConfigFile();
      await invoke("write_file", { path, content: JSON.stringify(newConnections, null, 2) });
    } catch (err) {
      console.error("Failed to save connections to disk:", err);
    }
  },

  deleteConnection: async (id) => {
    const newConnections = get().connections.filter((c) => c.id !== id);
    set({ connections: newConnections });

    // Persist to disk
    try {
      const path = await getConfigFile();
      await invoke("write_file", { path, content: JSON.stringify(newConnections, null, 2) });
    } catch (err) {
      console.error("Failed to save connections to disk:", err);
    }
  }
}));
