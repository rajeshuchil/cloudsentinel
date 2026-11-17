import {
  AlertItem,
  AlertSeverity,
  AlertStatus,
  ApiAlert,
  ApiAlertsResponse,
  ApiEvaluateAlertsResponse,
  ApiSecurityEvent,
  ApiSecurityEventsResponse,
  ApiSystemResponse,
  SecurityEvent,
  SecurityEventCategory,
  SecurityEventStatus,
} from '../types/monitoring';

export const DEFAULT_API_BASE_URL = 'https://cloudsentinel-backend-a76u.onrender.com';
export const DEFAULT_API_KEY = '71b3cffb19514d0d9bfcec37355ad173ece837aed7710e4d';

/**
 * Dynamically resolves the API base URL with graceful production fallbacks:
 * 1. Vite environment variable (VITE_API_BASE_URL from .env or build flags)
 * 2. Window runtime global (__CLOUDSENTINEL_API_URL__)
 * 3. URL query parameter (?api_url=https://...)
 * 4. LocalStorage ('CLOUDSENTINEL_API_BASE_URL')
 * 5. Production Render backend fallback (ensures HTTPS deployments do not attempt blocked localhost calls)
 */
export function resolveApiBaseUrl(): string {
  const envUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();

  if (typeof window !== 'undefined') {
    const win = window as unknown as { __CLOUDSENTINEL_API_URL__?: string };
    if (win.__CLOUDSENTINEL_API_URL__) {
      return win.__CLOUDSENTINEL_API_URL__.trim().replace(/\/+$/, '');
    }

    try {
      const urlParams = new URLSearchParams(window.location.search);
      const queryApiUrl = urlParams.get('api_url');
      if (queryApiUrl) {
        return queryApiUrl.trim().replace(/\/+$/, '');
      }
    } catch {
      // non-browser or URL parsing failure
    }

    try {
      const storedUrl = window.localStorage.getItem('CLOUDSENTINEL_API_BASE_URL');
      if (storedUrl) {
        return storedUrl.trim().replace(/\/+$/, '');
      }
    } catch {
      // storage unavailable
    }

    // If served over HTTPS, avoid insecure http://127.0.0.1 or localhost (blocked by Chrome mixed-content policy)
    if (
      window.location.protocol === 'https:' &&
      (!envUrl || envUrl.includes('127.0.0.1') || envUrl.includes('localhost'))
    ) {
      return DEFAULT_RENDER_BACKEND_URL;
    }
  }

  if (envUrl && envUrl.length > 0) {
    return envUrl.replace(/\/+$/, '');
  }

  return DEFAULT_RENDER_BACKEND_URL;
}

const DEFAULT_RENDER_BACKEND_URL = DEFAULT_API_BASE_URL;

/**
 * Dynamically resolves the Dashboard API Key with fallbacks:
 * 1. Vite environment variable (VITE_API_KEY)
 * 2. Window runtime global (__CLOUDSENTINEL_API_KEY__)
 * 3. URL query parameter (?api_key=...)
 * 4. LocalStorage ('CLOUDSENTINEL_API_KEY')
 * 5. Production Render key fallback
 */
export function resolveDashboardApiKey(): string | undefined {
  const envKey = (import.meta.env.VITE_API_KEY as string | undefined)?.trim();
  if (envKey) return envKey;

  if (typeof window !== 'undefined') {
    const win = window as unknown as { __CLOUDSENTINEL_API_KEY__?: string };
    if (win.__CLOUDSENTINEL_API_KEY__) return win.__CLOUDSENTINEL_API_KEY__.trim();

    try {
      const urlParams = new URLSearchParams(window.location.search);
      const queryKey = urlParams.get('api_key');
      if (queryKey) return queryKey.trim();
    } catch {
      // ignore
    }

    try {
      const storedKey = window.localStorage.getItem('CLOUDSENTINEL_API_KEY');
      if (storedKey) return storedKey.trim();
    } catch {
      // ignore
    }
  }

  return DEFAULT_API_KEY;
}

export const API_BASE_URL = resolveApiBaseUrl();
export const DASHBOARD_API_KEY = resolveDashboardApiKey();

export class ApiError extends Error {
  status: number;
  data?: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const baseUrl = resolveApiBaseUrl();
  const apiKey = resolveDashboardApiKey();
  const url = `${baseUrl}${endpoint}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }

  const method = options.method || 'GET';
  console.info(`[CloudSentinel API] ${method} ${url}`, { headers });

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      let errorDetail = `HTTP ${response.status} ${response.statusText}`;
      let data: unknown;
      try {
        data = await response.json();
        if (data && typeof data === 'object' && 'detail' in data) {
          errorDetail = String((data as { detail: unknown }).detail);
        }
      } catch {
        // Response was not JSON
      }
      console.error(`[CloudSentinel API Error] ${method} ${url} failed with HTTP ${response.status}:`, errorDetail);
      throw new ApiError(errorDetail, response.status, data);
    }

    const result = (await response.json()) as T;
    console.info(`[CloudSentinel API Response] ${method} ${url} returned 200 OK`);
    return result;
  } catch (err: unknown) {
    if (err instanceof ApiError) {
      throw err;
    }
    const message = err instanceof Error ? err.message : 'Network request failed';
    console.error(`[CloudSentinel API Network Failure] ${method} ${url}:`, err);
    throw new ApiError(`Failed to connect to CloudSentinel backend at ${baseUrl} (${message})`, 0);
  }
}

/**
 * Health check endpoint.
 */
export async function getHealth(): Promise<{ status: string; service: string }> {
  return request<{ status: string; service: string }>('/api/health');
}

/**
 * Collect live host telemetry from psutil.
 */
export async function getSystemMetrics(): Promise<ApiSystemResponse> {
  return request<ApiSystemResponse>('/api/system');
}

/**
 * Fetch analyzed security events from persistent SQLite database.
 */
export async function getSecurityEvents(params?: {
  limit?: number;
  offset?: number;
  category?: string;
  severity?: string;
}): Promise<ApiSecurityEventsResponse> {
  const searchParams = new URLSearchParams();
  if (params?.limit !== undefined) searchParams.set('limit', String(params.limit));
  if (params?.offset !== undefined) searchParams.set('offset', String(params.offset));
  if (params?.category) searchParams.set('category', params.category);
  if (params?.severity) searchParams.set('severity', params.severity);

  const query = searchParams.toString();
  return request<ApiSecurityEventsResponse>(`/api/security/events${query ? `?${query}` : ''}`);
}

/**
 * Fetch persistent alert records from SQLite database.
 */
export async function getAlerts(params?: {
  limit?: number;
  offset?: number;
  status?: string;
  severity?: string;
}): Promise<ApiAlertsResponse> {
  const searchParams = new URLSearchParams();
  if (params?.limit !== undefined) searchParams.set('limit', String(params.limit));
  if (params?.offset !== undefined) searchParams.set('offset', String(params.offset));
  if (params?.status) searchParams.set('status', params.status);
  if (params?.severity) searchParams.set('severity', params.severity);

  const query = searchParams.toString();
  return request<ApiAlertsResponse>(`/api/alerts${query ? `?${query}` : ''}`);
}

/**
 * Trigger metric threshold & security correlation evaluation engine.
 */
export async function evaluateAlerts(): Promise<ApiEvaluateAlertsResponse> {
  return request<ApiEvaluateAlertsResponse>('/api/alerts/evaluate', {
    method: 'POST',
  });
}

/**
 * Acknowledge an active alert.
 */
export async function acknowledgeAlert(alertId: string): Promise<ApiAlert> {
  return request<ApiAlert>(`/api/alerts/${encodeURIComponent(alertId)}/acknowledge`, {
    method: 'PATCH',
  });
}

/**
 * Resolve an active or acknowledged alert.
 */
export async function resolveAlert(alertId: string): Promise<ApiAlert> {
  return request<ApiAlert>(`/api/alerts/${encodeURIComponent(alertId)}/resolve`, {
    method: 'PATCH',
  });
}

/**
 * Reopen an acknowledged or resolved alert back to active.
 * Best-effort: if the backend deployment does not yet support the reopen endpoint,
 * returns null gracefully so the UI updates optimistically.
 */
export async function reopenAlert(alertId: string): Promise<ApiAlert | null> {
  try {
    return await request<ApiAlert>(`/api/alerts/${encodeURIComponent(alertId)}/reopen`, {
      method: 'PATCH',
    });
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 405)) {
      return null;
    }
    throw err;
  }
}

// -------------------------------------------------------------
// Helper Mappers: Backend API models -> Dashboard UI models
// -------------------------------------------------------------

export function formatUptime(seconds: number | null): string {
  if (seconds === null || seconds === undefined || isNaN(seconds)) {
    return 'Unknown';
  }
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

export function mapApiAlertToAlertItem(apiAlert: ApiAlert): AlertItem {
  // Normalize severity
  let severity: AlertSeverity = 'info';
  const rawSev = (apiAlert.severity || '').toLowerCase();
  if (rawSev === 'critical' || rawSev === 'high') {
    severity = 'critical';
  } else if (rawSev === 'warning' || rawSev === 'medium') {
    severity = 'warning';
  }

  // Derive metric category from source
  let metric = 'System';
  const src = (apiAlert.source || '').toLowerCase();
  if (src.includes('cpu')) {
    metric = 'CPU';
  } else if (src.includes('mem') || src.includes('ram')) {
    metric = 'Memory';
  } else if (src.includes('disk') || src.includes('storage')) {
    metric = 'Disk';
  } else if (src.includes('ssh') || src.includes('auth') || src.includes('security')) {
    metric = 'Security';
  }

  const epochMs = Date.parse(apiAlert.created_at) || Date.now();
  const dateObj = new Date(epochMs);
  const formattedTime = dateObj.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const formattedDate = dateObj.toLocaleDateString('en-CA'); // YYYY-MM-DD
  const timestamp = `${formattedDate} ${formattedTime}`;

  const status: AlertStatus =
    apiAlert.status === 'resolved'
      ? 'resolved'
      : apiAlert.status === 'acknowledged'
      ? 'acknowledged'
      : 'active';

  return {
    id: apiAlert.id,
    severity,
    timestamp,
    epochMs,
    subsystem: apiAlert.source || 'system',
    metric,
    description: apiAlert.description || apiAlert.title,
    status,
  };
}

export function mapApiSecurityEventToUi(apiEvent: ApiSecurityEvent): SecurityEvent {
  let severity: AlertSeverity = 'info';
  const rawSev = (apiEvent.severity || '').toLowerCase();
  if (rawSev === 'critical' || rawSev === 'high') {
    severity = 'critical';
  } else if (rawSev === 'warning' || rawSev === 'medium') {
    severity = 'warning';
  }

  let category: SecurityEventCategory = 'failed_ssh';
  const rawCat = (apiEvent.category || '').toLowerCase();
  if (rawCat === 'repeated_attempt') {
    category = 'repeated_attempt';
  } else if (rawCat === 'suspicious_ip') {
    category = 'suspicious_ip';
  } else if (rawCat === 'auth_failure') {
    category = 'auth_failure';
  } else {
    category = 'failed_ssh';
  }

  const epochMs = Date.parse(apiEvent.timestamp) || Date.now();
  const dateObj = new Date(epochMs);
  const formattedTime = dateObj.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const formattedDate = dateObj.toLocaleDateString('en-CA');
  const timestamp = `${formattedDate} ${formattedTime}`;

  const attempts = apiEvent.attempts || 1;
  const sourceIp = apiEvent.source_ip || 'N/A';

  // Neutral wording for IP provenance and test/documentation ranges
  let ipOriginNote: string;
  if (sourceIp.startsWith('198.51.100.')) {
    ipOriginNote = 'Historical record (TEST-NET-2 · Unverified provenance)';
  } else if (sourceIp.startsWith('192.0.2.') || sourceIp.startsWith('203.0.113.')) {
    ipOriginNote = 'Documentation range (RFC 5737 · Unverified provenance)';
  } else if (
    sourceIp.startsWith('10.') ||
    sourceIp.startsWith('192.168.') ||
    sourceIp.startsWith('172.16.') ||
    sourceIp.startsWith('172.17.') ||
    sourceIp.startsWith('172.18.') ||
    sourceIp.startsWith('127.')
  ) {
    ipOriginNote = 'Local / internal network address';
  } else if (attempts > 1) {
    ipOriginNote = `${attempts} repeated failure records`;
  } else {
    ipOriginNote = 'Authentication failure record';
  }

  return {
    id: apiEvent.id,
    severity,
    category,
    timestamp,
    epochMs,
    sourceIp,
    ipOriginNote,
    targetUser: apiEvent.target_user || 'unknown',
    service: apiEvent.service || 'sshd',
    attempts,
    description: apiEvent.description,
    rawLogLine: apiEvent.description,
    status: 'open' as SecurityEventStatus,
  };
}

/**
 * Intelligent network interface selector.
 * Prioritizes physical Wi-Fi (wl*) and Ethernet (en*, eth*) interfaces over
 * virtual bridges (docker*, br-*, veth*, virbr*) and loopback (lo).
 * Does not hardcode any specific interface name.
 */
export function selectPrimaryNetworkInterface(
  interfaces: { name: string; is_up: boolean | null; addresses: { family: string; address: string }[] }[],
  fallbackInterface = 'eth0',
  fallbackIp = '127.0.0.1'
): { networkInterface: string; ipAddress: string } {
  if (!interfaces || interfaces.length === 0) {
    return { networkInterface: fallbackInterface, ipAddress: fallbackIp };
  }

  function getInterfaceScore(name: string, isUp: boolean, ipv4: string): number {
    const lower = name.toLowerCase();

    // Loopback
    if (ipv4.startsWith('127.') || lower === 'lo') {
      return 1;
    }

    // Virtual / container bridges / tunnels
    const isVirtual =
      lower.startsWith('docker') ||
      lower.startsWith('br-') ||
      lower.startsWith('veth') ||
      lower.startsWith('virbr') ||
      lower.startsWith('vmnet') ||
      lower.startsWith('vbox') ||
      lower.startsWith('tun') ||
      lower.startsWith('tap') ||
      lower.startsWith('tailscale') ||
      lower.startsWith('wg');

    let score = 20;

    if (isVirtual) {
      score = 10;
    } else if (
      lower.startsWith('wl') || // Wireless (wlo1, wlan0, wlp...)
      lower.startsWith('en') || // Ethernet (eno1, enp3s0, ens33, enx...)
      lower.startsWith('eth')   // Traditional ethernet (eth0, eth1...)
    ) {
      score = 100;
    } else {
      score = 50;
    }

    if (isUp) {
      score += 20;
    }

    // Deprioritize link-local 169.254.x.x
    if (!ipv4.startsWith('169.254.')) {
      score += 5;
    }

    return score;
  }

  let best: { name: string; ip: string; score: number } | null = null;

  for (const iface of interfaces) {
    const isUp = Boolean(iface.is_up);
    const ipv4List = (iface.addresses || [])
      .filter((a) => a.family === 'IPv4' && a.address)
      .map((a) => a.address);

    for (const ip of ipv4List) {
      const score = getInterfaceScore(iface.name, isUp, ip);
      if (!best || score > best.score) {
        best = { name: iface.name, ip, score };
      }
    }
  }

  if (best && best.score > 0) {
    return { networkInterface: best.name, ipAddress: best.ip };
  }

  return { networkInterface: fallbackInterface, ipAddress: fallbackIp };
}

