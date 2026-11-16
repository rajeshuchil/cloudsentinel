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
