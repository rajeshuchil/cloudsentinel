export type AlertSeverity = 'critical' | 'warning' | 'info';

export type AlertStatus = 'active' | 'acknowledged' | 'resolved';

export type TimeRange = '15m' | '1h' | '6h' | '24h';

export type HealthStatus = 'healthy' | 'degraded' | 'critical';

export type DashboardView = 'overview' | 'security' | 'alerts';

export type SecurityEventCategory =
  | 'failed_ssh'
  | 'suspicious_ip'
  | 'auth_failure'
  | 'repeated_attempt';

export type SecurityEventStatus = 'open' | 'acknowledged' | 'mitigated';

export interface CpuPoint {
  timestamp: string;
  label: string;
  usage: number;
  userPct: number;
  systemPct: number;
}

export interface UbuntuHost {
  hostname: string;
  os: string;
  kernel: string;
  arch: string;
  ipAddress: string;
  networkInterface: string;
  uptime: string;
  cpuPct: number;
  cpuDelta: number;
  vCpuUsed: number;
  vCpuTotal: number;
  loadAvg: string;
  ramPct: number;
  ramDelta: number;
  ramUsedGb: number;
  ramTotalGb: number;
  ramCachedGb: number;
  diskPct: number;
  diskDelta: number;
  diskUsedGb: number;
  diskTotalGb: number;
  diskDevice: string;
  diskMount: string;
  deviceStatus?: 'online' | 'offline';
  lastHeartbeat?: string;
  cpuSeries: Record<TimeRange, CpuPoint[]>;
}

export interface AlertItem {
  id: string;
  severity: AlertSeverity;
  timestamp: string;
  epochMs: number;
  subsystem: string;
  metric: string;
  description: string;
  status: AlertStatus;
}

export interface SecurityEvent {
  id: string;
  severity: AlertSeverity;
  category: SecurityEventCategory;
  timestamp: string;
  epochMs: number;
  sourceIp: string;
  ipOriginNote: string;
  targetUser: string;
  service: string;
  attempts: number;
  description: string;
  rawLogLine: string;
  status: SecurityEventStatus;
}

// Backend API response schemas

export interface ApiSystemInfo {
  hostname: string | null;
  os: string | null;
  os_release: string | null;
  kernel_version: string | null;
  architecture: string | null;
  uptime_seconds: number | null;
}

export interface ApiCpuMetrics {
  usage_percent: number | null;
  logical_cores: number | null;
  load_average: {
    '1m': number;
    '5m': number;
    '15m': number;
  } | null;
}

export interface ApiMemoryMetrics {
  total_bytes: number | null;
  used_bytes: number | null;
  available_bytes: number | null;
  usage_percent: number | null;
}

export interface ApiDiskMetrics {
  mount_point: string;
  total_bytes: number | null;
  used_bytes: number | null;
  free_bytes: number | null;
  usage_percent: number | null;
}

export interface ApiNetworkAddress {
  family: string;
  address: string;
  netmask: string | null;
  broadcast: string | null;
}

export interface ApiNetworkInterface {
  name: string;
  is_up: boolean | null;
  speed_mbps: number | null;
  mtu: number | null;
  addresses: ApiNetworkAddress[];
}

export interface ApiSystemResponse {
  system: ApiSystemInfo;
  cpu: ApiCpuMetrics;
  memory: ApiMemoryMetrics;
  disk: ApiDiskMetrics;
  network: {
    interfaces: ApiNetworkInterface[];
  };
  device_status?: 'online' | 'offline';
  timestamp?: string;
  last_seen?: string;
}

export interface ApiSecurityEvent {
  id: string;
  timestamp: string;
  severity: string;
  category: string;
  source_ip: string | null;
  target_user: string | null;
  service: string | null;
  attempts: number;
  description: string;
  created_at: string;
}

export interface ApiSecurityEventsResponse {
  status: string;
  log_source: string | null;
  error?: string | null;
  newly_ingested: number;
  total_events: number;
  returned_events: number;
  events: ApiSecurityEvent[];
}

export interface ApiAlert {
  id: string;
  title: string;
  description: string;
  severity: string;
  source: string;
  status: string;
  created_at: string;
  updated_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
}

export interface ApiAlertsResponse {
  status: string;
  total_returned: number;
  alerts: ApiAlert[];
}

export interface ApiEvaluateAlertsResponse {
  status: string;
  evaluated_at: string;
  metrics: {
    cpu_percent: number | null;
    memory_percent: number | null;
    disk_percent: number | null;
  };
  alerts_created: number;
  alerts_updated: number;
  alerts_resolved: number;
  active_alerts_count: number;
}
