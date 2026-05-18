// In-memory credential cache for the current session. Credentials are
// intentionally never persisted to disk (see connectionStore). This module
// lets both the Connection Manager and the layer refresh action share the
// same session-scoped credentials, keyed by connection id.

export interface SessionCredentials {
  username?: string;
  password?: string;
  token?: string;
}

const cache = new Map<string, SessionCredentials>();

export function getCachedCredentials(connectionId: string): SessionCredentials | undefined {
  return cache.get(connectionId);
}

export function setCachedCredentials(connectionId: string, creds: SessionCredentials): void {
  cache.set(connectionId, creds);
}

export function clearCachedCredentials(connectionId: string): void {
  cache.delete(connectionId);
}
