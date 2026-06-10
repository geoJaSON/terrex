import { useState, useEffect } from "react";
import {
  getCachedCredentials,
  setCachedCredentials,
  clearCachedCredentials,
} from "../../services/credentialCache";
import { useConnectionStore, type SavedConnection, type ConnectionType, type AuthType } from "../../stores/connectionStore";
import { useMapStore } from "../../stores/mapStore";
import { fetchOnlineLayer, establishOnlineConnection } from "../../services/onlineSources";
import type { Layer } from "../../types/layer";

export function ConnectionManager() {
  const {
    connections,
    isManagerOpen,
    setManagerOpen,
    loadConnections,
    saveConnection,
    deleteConnection
  } = useConnectionStore();

  const { addLayer, getNextColor } = useMapStore();

  const [activeTab, setActiveTab] = useState<"saved" | "new">("saved");
  
  // New Connection Form State
  const [name, setName] = useState("");
  const [type, setType] = useState<ConnectionType>("arcgis_feature");
  const [url, setUrl] = useState("");
  const [typeNames, setTypeNames] = useState("");
  const [authType, setAuthType] = useState<AuthType>("none");
  
  // Ephemeral credentials (not saved)
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Credentials are cached in memory for the session via credentialCache
  // (shared with the layer-refresh action), keyed by connection id.

  // When set, we show a credential prompt before connecting to this connection.
  const [authPromptConn, setAuthPromptConn] = useState<SavedConnection | null>(null);
  const [promptUsername, setPromptUsername] = useState("");
  const [promptPassword, setPromptPassword] = useState("");
  const [promptToken, setPromptToken] = useState("");

  // Load connections on mount
  useEffect(() => {
    if (isManagerOpen) {
      loadConnections();
      if (connections.length === 0) setActiveTab("new");
    }
  }, [isManagerOpen, loadConnections, connections.length]);

  if (!isManagerOpen) return null;

  const handleClose = () => {
    setManagerOpen(false);
    setError(null);
  };

  const getCredentials = () => {
    if (authType === "basic") return { username, password };
    if (authType === "token") return { token };
    return undefined;
  };

  const handleTestAndSave = async () => {
    setError(null);
    if (!name || !url) {
      setError("Name and URL are required.");
      return;
    }

    setIsLoading(true);
    const conn: SavedConnection = {
      id: `conn_${Date.now()}`,
      name,
      type,
      url,
      authType,
      ...(type === "wfs" && typeNames.trim() ? { typeNames: typeNames.trim() } : {}),
    };

    try {
      // Test fetch
      const creds = getCredentials();
      await fetchOnlineLayer(conn, { credentials: creds });
      await saveConnection(conn);
      // Cache the working credentials for this session so Connect doesn't
      // immediately re-prompt for what was just entered.
      if (creds) setCachedCredentials(conn.id, creds);
      setActiveTab("saved");
      // Reset form
      setName(""); setUrl(""); setTypeNames(""); setAuthType("none");
      setUsername(""); setPassword(""); setToken("");
    } catch (err: any) {
      setError(err.message || "Connection test failed.");
    } finally {
      setIsLoading(false);
    }
  };

  // Decide whether we can connect immediately or must prompt for credentials.
  // Credentials are never persisted, so a saved connection that needs auth
  // requires re-entry once per session (then cached in memory).
  const handleConnect = (conn: SavedConnection) => {
    setError(null);
    if (conn.authType === "none") {
      doConnect(conn, undefined);
      return;
    }
    const cached = getCachedCredentials(conn.id);
    if (cached) {
      doConnect(conn, cached);
      return;
    }
    // Need credentials: open the prompt.
    setPromptUsername("");
    setPromptPassword("");
    setPromptToken("");
    setAuthPromptConn(conn);
  };

  const submitAuthPrompt = () => {
    if (!authPromptConn) return;
    const conn = authPromptConn;
    const creds =
      conn.authType === "basic"
        ? { username: promptUsername, password: promptPassword }
        : { token: promptToken };
    setCachedCredentials(conn.id, creds);
    setAuthPromptConn(null);
    doConnect(conn, creds);
  };

  const doConnect = async (
    conn: SavedConnection,
    creds: { username?: string; password?: string; token?: string } | undefined
  ) => {
    setError(null);
    setIsLoading(true);
    try {
      // 1. Quick handshake
      const meta = await establishOnlineConnection(conn, { credentials: creds });

      const layerId = `layer_${Date.now()}`;

      // 2. Add loading layer to map store
      const layer: Layer = {
        id: layerId,
        name: meta.name || conn.name,
        source: "online",
        data: { type: "FeatureCollection", features: [] },
        geometryType: meta.geometryType || "Point",
        attributes: [],
        featureCount: 0,
        extent: null,
        connection: conn,
        visible: true,
        loading: true, // Mark layer as loading!
        style: {
          color: getNextColor(),
          opacity: 0.8,
          strokeColor: "#ffffff",
          strokeWidth: 1,
          pointRadius: 4,
        },
      };

      addLayer(layer);
      handleClose(); // Close connection dialog immediately!

      // 3. Background fetch (non-blocking)
      (async () => {
        try {
          const result = await fetchOnlineLayer(conn, { credentials: creds });
          useMapStore.getState().replaceLayerData(layerId, result.data);
        } catch (err: any) {
          console.error(`Background layer load failed: ${err.message || err}`);
          useMapStore.getState().setLayerLoading(layerId, false);
          alert(`Background load failed for layer "${meta.name || conn.name}":\n${err.message || err}`);
        }
      })();

    } catch (err: any) {
      if (conn.authType !== "none") clearCachedCredentials(conn.id);
      setError(err.message || "Failed to establish connection.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: "500px" }}>
        <div className="modal__header">
          <span className="modal__title">Online Data Connections</span>
          <button className="icon-btn" onClick={handleClose}>✕</button>
        </div>

        <div className="modal__tabs">
          <button 
            className={`modal__tab ${activeTab === "saved" ? "modal__tab--active" : ""}`}
            onClick={() => setActiveTab("saved")}
          >
            Saved Connections
          </button>
          <button 
            className={`modal__tab ${activeTab === "new" ? "modal__tab--active" : ""}`}
            onClick={() => setActiveTab("new")}
          >
            New Connection
          </button>
        </div>

        <div className="modal__body" style={{ minHeight: "300px", maxHeight: "60vh", overflowY: "auto" }}>
          {error && <div className="modal__error" style={{ color: "#ef4444", marginBottom: "1rem", fontSize: "12px", background: "#ef444422", padding: "8px", borderRadius: "4px" }}>{error}</div>}

          {activeTab === "saved" && (
            <div className="connection-list">
              {connections.length === 0 ? (
                <div className="sidebar__empty">
                  <div className="sidebar__empty-text">No saved connections.</div>
                </div>
              ) : (
                connections.map(c => (
                  <div key={c.id} className="connection-item" style={{ border: "1px solid var(--border-default)", borderRadius: "var(--radius-md)", padding: "var(--space-3)", marginBottom: "var(--space-2)", background: "var(--bg-secondary)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ flex: 1, minWidth: 0, marginRight: "var(--space-3)" }}>
                      <div style={{ fontWeight: 600, fontSize: "var(--font-size-sm)", color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
                      <div style={{ fontSize: "10px", color: "var(--text-tertiary)", marginTop: "4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={c.url}>{c.type} • {c.url}</div>
                    </div>
                    <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
                      <button className="btn btn--sm btn--primary" onClick={() => handleConnect(c)} disabled={isLoading}>
                        {isLoading ? "Connecting..." : "Connect"}
                      </button>
                      <button className="icon-btn icon-btn--sm icon-btn--danger" onClick={() => deleteConnection(c.id)}>🗑</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === "new" && (
            <div className="connection-form">
              <div className="modal__field">
                <label className="modal__label">Connection Name</label>
                <input className="edit-panel__field-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. USGS Earthquakes" />
              </div>
              <div className="modal__field">
                <label className="modal__label">Service Type</label>
                <select className="filter-bar__select" style={{width: "100%"}} value={type} onChange={e => setType(e.target.value as ConnectionType)}>
                  <option value="arcgis_feature">ArcGIS Feature Layer</option>
                  <option value="wfs">OGC WFS 2.0</option>
                  <option value="geojson_url">GeoJSON URL</option>
                </select>
              </div>
              <div className="modal__field">
                <label className="modal__label">Service URL</label>
                <input className="edit-panel__field-input" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..." />
              </div>
              {type === "wfs" && (
                <div className="modal__field">
                  <label className="modal__label">Feature Type (optional)</label>
                  <input
                    className="edit-panel__field-input"
                    value={typeNames}
                    onChange={e => setTypeNames(e.target.value)}
                    placeholder="e.g. namespace:layername"
                  />
                  <div style={{ fontSize: "10px", color: "var(--text-tertiary)", marginTop: "4px" }}>
                    Leave empty to auto-detect — works when the service has exactly one feature type.
                  </div>
                </div>
              )}

              <div style={{ borderTop: "1px solid var(--border-subtle)", margin: "1rem 0", paddingTop: "1rem" }}>
                <div className="modal__field">
                  <label className="modal__label">Authentication</label>
                  <select className="filter-bar__select" style={{width: "100%"}} value={authType} onChange={e => setAuthType(e.target.value as AuthType)}>
                    <option value="none">None</option>
                    <option value="basic">Basic (Username/Password)</option>
                    <option value="token">Token / Bearer</option>
                  </select>
                </div>

                {authType === "basic" && (
                  <>
                    <div className="modal__field">
                      <label className="modal__label">Username</label>
                      <input className="edit-panel__field-input" value={username} onChange={e => setUsername(e.target.value)} />
                    </div>
                    <div className="modal__field">
                      <label className="modal__label">Password</label>
                      <input className="edit-panel__field-input" type="password" value={password} onChange={e => setPassword(e.target.value)} />
                    </div>
                  </>
                )}

                {authType === "token" && (
                  <div className="modal__field">
                    <label className="modal__label">Token</label>
                    <input className="edit-panel__field-input" type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="Paste token here" />
                  </div>
                )}
                
                {authType !== "none" && (
                  <div style={{ fontSize: "10px", color: "var(--text-tertiary)", fontStyle: "italic", marginTop: "8px" }}>
                    Note: Credentials are NOT saved to disk. You will need to re-enter them in future sessions.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {activeTab === "new" && (
          <div className="modal__footer">
            <button className="btn btn--sm" onClick={handleClose}>Cancel</button>
            <button className="btn btn--primary btn--sm" onClick={handleTestAndSave} disabled={isLoading || !name || !url}>
              {isLoading ? "Testing..." : "Save Connection"}
            </button>
          </div>
        )}
      </div>
    </div>

    {authPromptConn && (
      <div className="modal-overlay" onClick={() => setAuthPromptConn(null)}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: "400px" }}>
          <div className="modal__header">
            <span className="modal__title">Authenticate — {authPromptConn.name}</span>
            <button className="icon-btn" onClick={() => setAuthPromptConn(null)}>✕</button>
          </div>
          <div className="modal__body" style={{ padding: "var(--space-4)" }}>
            <div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginBottom: "1rem" }}>
              This connection requires credentials. They are kept in memory for this session only.
            </div>
            {authPromptConn.authType === "basic" && (
              <>
                <div className="modal__field">
                  <label className="modal__label">Username</label>
                  <input
                    className="edit-panel__field-input"
                    value={promptUsername}
                    onChange={(e) => setPromptUsername(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="modal__field">
                  <label className="modal__label">Password</label>
                  <input
                    className="edit-panel__field-input"
                    type="password"
                    value={promptPassword}
                    onChange={(e) => setPromptPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submitAuthPrompt()}
                  />
                </div>
              </>
            )}
            {authPromptConn.authType === "token" && (
              <div className="modal__field">
                <label className="modal__label">Token</label>
                <input
                  className="edit-panel__field-input"
                  type="password"
                  value={promptToken}
                  onChange={(e) => setPromptToken(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitAuthPrompt()}
                  autoFocus
                />
              </div>
            )}
          </div>
          <div className="modal__footer">
            <button className="btn btn--sm" onClick={() => setAuthPromptConn(null)}>Cancel</button>
            <button className="btn btn--primary btn--sm" onClick={submitAuthPrompt}>
              Connect
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
