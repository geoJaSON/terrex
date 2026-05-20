import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export type ConnectionType = "arcgis_feature" | "wfs" | "geojson_url";
export type AuthType = "none" | "basic" | "token";

export interface SavedConnection {
  id: string;
  name: string;
  type: ConnectionType;
  url: string;
  authType: AuthType;
}

interface ConnectionState {
  connections: SavedConnection[];
  loadConnections: () => Promise<void>;
  saveConnection: (conn: SavedConnection) => Promise<void>;
  deleteConnection: (id: string) => Promise<void>;
  
  isManagerOpen: boolean;
  setManagerOpen: (open: boolean) => void;
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  connections: [],
  isManagerOpen: false,
  setManagerOpen: (open) => set({ isManagerOpen: open }),

  loadConnections: async () => {
    try {
      const content = await invoke<string>("load_connections");
      const connections: SavedConnection[] = JSON.parse(content);
      set({ connections });
    } catch (err) {
      console.log("No existing connections file found or failed to load.", err);
    }
  },

  saveConnection: async (conn) => {
    const { connections } = get();
    const existing = connections.findIndex((c) => c.id === conn.id);
    let newConnections;
    
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

    try {
      await invoke("save_connections", { content: JSON.stringify(newConnections, null, 2) });
    } catch (err) {
      console.error("Failed to save connections to disk:", err);
    }
  },

  deleteConnection: async (id) => {
    const newConnections = get().connections.filter((c) => c.id !== id);
    set({ connections: newConnections });

    try {
      await invoke("save_connections", { content: JSON.stringify(newConnections, null, 2) });
    } catch (err) {
      console.error("Failed to save connections to disk:", err);
    }
  }
}));
