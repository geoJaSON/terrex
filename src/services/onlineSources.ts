import { invoke } from "@tauri-apps/api/core";
import type { SavedConnection } from "../stores/connectionStore";
import type { FeatureCollection, GeoJsonProperties, Geometry } from "geojson";

export interface FetchOptions {
  credentials?: { username?: string; password?: string; token?: string };
}

/**
 * A stable referer string. ArcGIS Online ties referer-bound tokens
 * (client=referer) to this exact value, and every subsequent request must
 * carry a matching `Referer` header. Browser `fetch` forbids setting
 * `Referer`, which is why all requests go through the Rust backend instead.
 */
const APP_REFERER = "https://terrex.app";

interface BackendHttpResponse {
  status: number;
  body: string;
}

/** True only when running inside the Tauri webview (vs. `npm run dev` in a browser). */
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Minimal response wrapper mirroring the bits of `fetch`'s Response we use,
 * but backed by the Rust `http_request` command (no CORS, controllable
 * `Referer`, credentials never touch the webview network stack).
 */
async function backendFetch(
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
): Promise<{ ok: boolean; status: number; text: () => string }> {
  if (isTauri()) {
    const res = await invoke<BackendHttpResponse>("http_request", {
      url,
      method: init?.method ?? "GET",
      headers: init?.headers ?? {},
      body: init?.body ?? null,
    });
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      text: () => res.body,
    };
  }

  // Browser dev fallback (`npm run dev`): use fetch. Note the Referer header
  // is silently dropped by browsers, so ArcGIS referer-bound tokens and
  // cross-origin requests may fail here — run the Tauri app for full support.
  const headers = { ...(init?.headers ?? {}) };
  delete headers["Referer"]; // forbidden header name; browsers reject the request otherwise
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    headers,
    body: init?.body,
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, text: () => body };
}

/**
 * Standardize an ArcGIS feature array into GeoJSON FeatureCollection
 */
function arcgisToGeoJSON(arcgisData: any): FeatureCollection<Geometry, GeoJsonProperties> {
  // If the server returns native GeoJSON (f=geojson)
  if (arcgisData.type === "FeatureCollection") {
    return arcgisData as FeatureCollection;
  }

  // If the server returns ESRI JSON
  const features = (arcgisData.features || []).map((f: any, i: number) => {
    let geom: Geometry | null = null;
    
    // Very naive ESRI geometry to GeoJSON conversion.
    // In production, better to use @esri/arcgis-to-geojson-utils, 
    // but requesting f=geojson from ArcGIS Server usually avoids this.
    if (f.geometry) {
      if (f.geometry.x !== undefined) {
        geom = { type: "Point", coordinates: [f.geometry.x, f.geometry.y] };
      } else if (f.geometry.rings) {
        geom = { type: "Polygon", coordinates: f.geometry.rings };
      } else if (f.geometry.paths) {
        geom = { type: "LineString", coordinates: f.geometry.paths[0] };
      }
    }

    return {
      type: "Feature",
      id: f.attributes?.[arcgisData.objectIdFieldName || "OBJECTID"] ?? i,
      properties: f.attributes || {},
      geometry: geom,
    };
  });

  return { type: "FeatureCollection", features };
}

/**
 * Thrown when the service has no usable ArcGIS token endpoint (e.g. it is
 * secured with web-tier / HTTP Basic auth instead). Signals the caller to
 * fall back to sending an Authorization: Basic header.
 */
class TokenEndpointUnavailable extends Error {}

/**
 * Resolve the generateToken endpoint for a given service URL.
 * - ArcGIS Online (*.arcgis.com): the portal sharing endpoint.
 * - ArcGIS Enterprise/Server: ask the REST `/info` endpoint for its
 *   advertised tokenServicesUrl, falling back to conventional guesses.
 */
async function discoverTokenUrl(serviceUrl: string): Promise<string> {
  if (serviceUrl.includes(".arcgis.com/")) {
    return "https://www.arcgis.com/sharing/rest/generateToken";
  }

  const restMatch = serviceUrl.match(/^(https?:\/\/.*?\/rest)\//i);
  const restRoot = restMatch
    ? restMatch[1]
    : `${new URL(serviceUrl).origin}/arcgis/rest`;

  // The REST info endpoint advertises the correct token service URL.
  try {
    const infoRes = await backendFetch(`${restRoot}/info?f=json`, {
      headers: { Referer: APP_REFERER },
    });
    if (infoRes.ok) {
      const info = JSON.parse(infoRes.text());
      const tokenServicesUrl: string | undefined = info?.authInfo?.tokenServicesUrl;
      if (tokenServicesUrl) return tokenServicesUrl;
    }
  } catch {
    // Discovery failed; fall through to conventional guesses.
  }

  // Conventional ArcGIS Server token endpoint.
  return `${restRoot.replace(/\/rest$/, "")}/tokens/generateToken`;
}

async function generateArcGISToken(
  serviceUrl: string,
  creds: NonNullable<FetchOptions["credentials"]>
): Promise<string> {
  const tokenUrl = await discoverTokenUrl(serviceUrl);

  const formData = new URLSearchParams();
  formData.append("username", creds.username || "");
  formData.append("password", creds.password || "");
  // Referer-bound token: every request that uses this token must carry a
  // matching Referer header (sent by the Rust backend, see APP_REFERER).
  formData.append("client", "referer");
  formData.append("referer", APP_REFERER);
  formData.append("f", "json");
  formData.append("expiration", "60");

  let res: { ok: boolean; status: number; text: () => string };
  try {
    res = await backendFetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: APP_REFERER,
      },
      body: formData.toString(),
    });
  } catch (e: any) {
    // Network error / endpoint doesn't exist -> likely web-tier Basic auth.
    throw new TokenEndpointUnavailable(
      `Could not reach token endpoint ${tokenUrl}: ${e?.message || e}`
    );
  }

  const text = res.text();

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    // Not a JSON token service (got HTML/login page) -> web-tier Basic auth.
    throw new TokenEndpointUnavailable(
      `Token endpoint (${tokenUrl}) did not return JSON; service likely uses HTTP Basic / web-tier auth.`
    );
  }

  if (!res.ok && !data?.error) {
    throw new TokenEndpointUnavailable(
      `Token endpoint (${tokenUrl}) returned HTTP ${res.status}.`
    );
  }

  // A structured ArcGIS error (e.g. bad credentials) is a genuine failure:
  // surface it instead of silently falling back to Basic.
  if (data.error) {
    const details = Array.isArray(data.error.details) ? ` (${data.error.details.join("; ")})` : "";
    throw new Error((data.error.message || "Failed to generate ArcGIS token") + details);
  }
  if (!data.token) throw new TokenEndpointUnavailable("No token returned from server.");

  return data.token;
}

export async function establishOnlineConnection(
  connection: SavedConnection,
  options?: FetchOptions
): Promise<{ name: string; geometryType: any }> {
  let { url, type, authType } = connection;
  const { credentials } = options || {};

  let activeToken = credentials?.token;
  let basicHeader: string | undefined;
  const hasBasicCreds = !!(credentials?.username && credentials?.password);

  if (type === "arcgis_feature" && authType === "basic" && hasBasicCreds) {
    try {
      activeToken = await generateArcGISToken(url, credentials!);
    } catch (e) {
      if (e instanceof TokenEndpointUnavailable) {
        basicHeader = `Basic ${btoa(`${credentials!.username}:${credentials!.password}`)}`;
        console.warn(
          "ArcGIS token endpoint unavailable; falling back to HTTP Basic auth.",
          e.message
        );
      } else {
        throw e;
      }
    }
  }

  const headers: Record<string, string> = {};
  if (basicHeader) {
    headers["Authorization"] = basicHeader;
  } else if (authType === "basic" && hasBasicCreds && type !== "arcgis_feature") {
    headers["Authorization"] = `Basic ${btoa(`${credentials!.username}:${credentials!.password}`)}`;
  } else if (authType === "token" && activeToken && type !== "arcgis_feature") {
    headers["Authorization"] = `Bearer ${activeToken}`;
  }

  if (type === "arcgis_feature") {
    headers["Referer"] = APP_REFERER;
  }

  if (type === "arcgis_feature") {
    const metaUrl = new URL(url);
    metaUrl.searchParams.set("f", "json");
    if (activeToken) metaUrl.searchParams.set("token", activeToken);
    
    const metaRes = await backendFetch(metaUrl.toString(), { headers });
    const metaText = metaRes.text();
    let meta;
    try {
      meta = JSON.parse(metaText);
    } catch (e) {
      throw new Error(`Failed to read layer metadata. Server returned HTML instead of JSON. Ensure the URL is correct. Response: ${metaText.slice(0, 100)}...`);
    }
    
    if (meta.error) throw new Error(meta.error.message || "ArcGIS Error");
    
    let geomType = "Point";
    if (meta.geometryType) {
      if (meta.geometryType === "esriGeometryPoint") geomType = "Point";
      else if (meta.geometryType === "esriGeometryMultipoint") geomType = "MultiPoint";
      else if (meta.geometryType === "esriGeometryPolyline") geomType = "LineString";
      else if (meta.geometryType === "esriGeometryPolygon") geomType = "Polygon";
    }
    return {
      name: meta.name || connection.name,
      geometryType: geomType,
    };
  } else if (type === "wfs") {
    const testUrl = new URL(url);
    testUrl.searchParams.set("service", "WFS");
    testUrl.searchParams.set("request", "GetCapabilities");
    const res = await backendFetch(testUrl.toString(), { headers });
    if (!res.ok) throw new Error(`WFS Server responded with status ${res.status}`);
    return {
      name: connection.name,
      geometryType: "Point",
    };
  } else if (type === "geojson_url") {
    const res = await backendFetch(url, { headers });
    if (!res.ok) throw new Error(`Server responded with status ${res.status}`);
    return {
      name: connection.name,
      geometryType: "Point",
    };
  }

  throw new Error(`Unsupported connection type: ${type}`);
}

export async function fetchOnlineLayer(
  connection: SavedConnection,
  options?: FetchOptions
): Promise<{ data: FeatureCollection<Geometry, GeoJsonProperties>; name: string }> {
  let { url, type, authType } = connection;
  const { credentials } = options || {};

  // Resolve auth. For ArcGIS Feature Layers with username/password we first
  // try to exchange the credentials for an ArcGIS token (AGOL / token-secured
  // Enterprise). If the service has no token endpoint (web-tier / HTTP Basic
  // auth) we fall back to sending an Authorization: Basic header instead.
  let activeToken = credentials?.token;
  let basicHeader: string | undefined;
  const hasBasicCreds = !!(credentials?.username && credentials?.password);

  if (type === "arcgis_feature" && authType === "basic" && hasBasicCreds) {
    try {
      activeToken = await generateArcGISToken(url, credentials!);
    } catch (e) {
      if (e instanceof TokenEndpointUnavailable) {
        basicHeader = `Basic ${btoa(`${credentials!.username}:${credentials!.password}`)}`;
        console.warn(
          "ArcGIS token endpoint unavailable; falling back to HTTP Basic auth.",
          e.message
        );
      } else {
        throw e; // Genuine error (e.g. invalid credentials) — surface it.
      }
    }
  }

  // Construct Authorization header for standard basic/token auth.
  const headers: Record<string, string> = {};
  if (basicHeader) {
    headers["Authorization"] = basicHeader;
  } else if (authType === "basic" && hasBasicCreds && type !== "arcgis_feature") {
    headers["Authorization"] = `Basic ${btoa(`${credentials!.username}:${credentials!.password}`)}`;
  } else if (authType === "token" && activeToken && type !== "arcgis_feature") {
    headers["Authorization"] = `Bearer ${activeToken}`;
  }

  // ArcGIS referer-bound tokens require the matching Referer on every request.
  if (type === "arcgis_feature") {
    headers["Referer"] = APP_REFERER;
  }

  let finalUrl = new URL(url);

  try {
    if (type === "arcgis_feature") {
      // 1. Fetch metadata to get name and maxRecordCount
      const metaUrl = new URL(url);
      metaUrl.searchParams.set("f", "json");
      if (activeToken) metaUrl.searchParams.set("token", activeToken);
      
      const metaRes = await backendFetch(metaUrl.toString(), { headers });
      const metaText = metaRes.text();
      let meta;
      try {
        meta = JSON.parse(metaText);
      } catch (e) {
        throw new Error(`Failed to read layer metadata. Server returned HTML instead of JSON. Ensure the URL is correct. Response: ${metaText.slice(0, 100)}...`);
      }
      
      if (meta.error) throw new Error(meta.error.message || "ArcGIS Error");
      
      const name = meta.name || connection.name;
      
      // 2. Query features, paging past the service's maxRecordCount.
      // ArcGIS caps each query (commonly 1000-2000 features); without paging
      // we'd only ever get the first batch. Page with resultOffset until the
      // server stops returning a full page / signalling exceededTransferLimit.
      const pageSize = Math.min(Math.max(Number(meta.maxRecordCount) || 1000, 1), 5000);
      // A stable sort is required for correct offset paging.
      const oidField: string = meta.objectIdField || "OBJECTID";

      const allFeatures: any[] = [];
      const seenIds = new Set<string | number>();
      let offset = 0;
      // Safety bounds so a misbehaving server can't loop forever.
      const MAX_FEATURES = 500_000;
      const MAX_PAGES = 1000;

      for (let page = 0; page < MAX_PAGES; page++) {
        const queryUrl = new URL(`${url.replace(/\/$/, "")}/query`);
        queryUrl.searchParams.set("f", "geojson");
        queryUrl.searchParams.set("where", "1=1");
        queryUrl.searchParams.set("outFields", "*");
        queryUrl.searchParams.set("returnGeometry", "true");
        queryUrl.searchParams.set("outSR", "4326");
        queryUrl.searchParams.set("orderByFields", oidField);
        queryUrl.searchParams.set("resultOffset", String(offset));
        queryUrl.searchParams.set("resultRecordCount", String(pageSize));
        if (activeToken) queryUrl.searchParams.set("token", activeToken);

        const res = await backendFetch(queryUrl.toString(), { headers });
        const dataText = res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${dataText.slice(0, 100)}`);

        let data;
        try {
          data = JSON.parse(dataText);
        } catch (e) {
          throw new Error(`Failed to read feature data. Server returned HTML instead of JSON. Response: ${dataText.slice(0, 100)}...`);
        }
        if (data.error) throw new Error(data.error.message || "ArcGIS Query Error");

        const batch = arcgisToGeoJSON(data).features;

        // Dedupe by feature id. This also detects services that ignore
        // resultOffset (they'd resend the same page) — no new ids means done.
        let added = 0;
        for (const f of batch) {
          const fid = f.id as string | number;
          if (fid !== undefined && seenIds.has(fid)) continue;
          if (fid !== undefined) seenIds.add(fid);
          allFeatures.push(f);
          added++;
        }

        const exceeded =
          data.exceededTransferLimit === true ||
          data.properties?.exceededTransferLimit === true;

        // Stop when no new features came back (short page / paging unsupported).
        if (added === 0) break;
        if (batch.length < pageSize && !exceeded) break;
        if (allFeatures.length >= MAX_FEATURES) break;

        offset += batch.length;
      }

      const geojson: FeatureCollection<Geometry, GeoJsonProperties> = {
        type: "FeatureCollection",
        features: allFeatures,
      };
      return { data: geojson, name };
    } 
    
    else if (type === "wfs") {
      // Construct WFS GetFeature request
      finalUrl.searchParams.set("service", "WFS");
      finalUrl.searchParams.set("request", "GetFeature");
      // Don't override version if specified in URL
      if (!finalUrl.searchParams.has("version")) {
        finalUrl.searchParams.set("version", "2.0.0");
      }
      finalUrl.searchParams.set("outputFormat", "application/json");

      const res = await backendFetch(finalUrl.toString(), { headers });
      const dataText = res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${dataText.slice(0, 100)}`);

      let data;
      try {
        data = JSON.parse(dataText);
      } catch (e) {
        throw new Error(`WFS server returned invalid JSON or HTML. Response: ${dataText.slice(0, 100)}...`);
      }
      
      if (data.type !== "FeatureCollection") {
        throw new Error("WFS response is not a valid FeatureCollection");
      }
      
      return { data, name: connection.name };
    } 
    
    else if (type === "geojson_url") {
      const res = await backendFetch(finalUrl.toString(), { headers });
      const dataText = res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${dataText.slice(0, 100)}`);

      let data;
      try {
        data = JSON.parse(dataText);
      } catch (e) {
        throw new Error(`URL returned invalid JSON or HTML. Response: ${dataText.slice(0, 100)}...`);
      }
      
      if (data.type !== "FeatureCollection") {
        throw new Error("URL did not return a valid FeatureCollection");
      }
      
      return { data, name: connection.name };
    }

    throw new Error(`Unsupported connection type: ${type}`);
  } catch (err) {
    console.error("Online fetch failed:", err);
    throw err;
  }
}
