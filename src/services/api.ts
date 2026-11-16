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

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, '') ||
  'http://127.0.0.1:8000';

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
  const url = `${API_BASE_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

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
      throw new ApiError(errorDetail, response.status, data);
    }

    return (await response.json()) as T;
  } catch (err: unknown) {
    if (err instanceof ApiError) {
      throw err;
    }
    const message = err instanceof Error ? err.message : 'Network request failed';
    throw new ApiError(`Failed to connect to CloudSentinel backend (${message})`, 0);
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
  const ipOriginNote =
    attempts > 1
      ? `${attempts} consecutive attempts detected`
      : 'Standard authentication failure';

  return {
    id: apiEvent.id,
    severity,
    category,
    timestamp,
    epochMs,
    sourceIp: apiEvent.source_ip || 'N/A',
    ipOriginNote,
    targetUser: apiEvent.target_user || 'unknown',
    service: apiEvent.service || 'sshd',
    attempts,
    description: apiEvent.description,
    rawLogLine: apiEvent.description,
    status: 'open' as SecurityEventStatus,
  };
}
