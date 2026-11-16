import {
  AlertItem,
  CpuPoint,
  HealthStatus,
  SecurityEvent,
  TimeRange,
  UbuntuHost,
} from '../types/monitoring';

const BASE_TIME = new Date('2026-11-16T12:40:00-08:00').getTime();

function formatClock(date: Date, includeSeconds = false): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  if (!includeSeconds) {
    return `${hh}:${mm}`;
  }
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatIsoDisplay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day} ${formatClock(date, true)}`;
}

function buildSeries(
  points: number,
  stepMinutes: number,
  baseUsage: number,
  amplitude: number,
  spikeAt?: { index: number; delta: number }
): CpuPoint[] {
  const result: CpuPoint[] = [];
  for (let i = 0; i < points; i++) {
    const t = new Date(BASE_TIME - (points - 1 - i) * stepMinutes * 60_000);
    const wave =
      Math.sin(i * 0.62) * amplitude * 0.6 +
      Math.cos(i * 1.28) * amplitude * 0.4;
    const spike =
      spikeAt && Math.abs(i - spikeAt.index) <= 1
        ? spikeAt.delta * (1 - Math.abs(i - spikeAt.index) * 0.45)
        : 0;
    const usage = Number(Math.max(8, Math.min(96, baseUsage + wave + spike)).toFixed(1));
    const userPct = Number((usage * 0.72).toFixed(1));
    const systemPct = Number((usage - userPct).toFixed(1));

    result.push({
      timestamp: formatIsoDisplay(t),
      label: formatClock(t, stepMinutes < 2),
      usage,
      userPct,
      systemPct,
    });
  }
  return result;
}

export const INITIAL_UBUNTU_HOST: UbuntuHost = {
  hostname: 'ubuntu-srv-01',
  os: 'Ubuntu 24.04.1 LTS',
  kernel: 'Linux 6.8.0-45-generic',
  arch: 'x86_64',
  ipAddress: '192.168.10.24',
  networkInterface: 'eth0',
  uptime: '14d 07h 38m',
  cpuPct: 48.2,
  cpuDelta: 3.4,
  vCpuUsed: 3.9,
  vCpuTotal: 8,
  loadAvg: '1.42, 1.28, 1.15',
  ramPct: 68.5,
  ramDelta: 1.9,
  ramUsedGb: 10.96,
  ramTotalGb: 16,
  ramCachedGb: 3.4,
  diskPct: 61.4,
  diskDelta: 0.4,
  diskUsedGb: 314.4,
  diskTotalGb: 512,
  diskDevice: '/dev/nvme0n1p2',
  diskMount: '/ (ext4)',
  cpuSeries: {
    '15m': buildSeries(16, 1, 47.4, 5.8, { index: 12, delta: 14 }),
    '1h': buildSeries(24, 2.5, 45.2, 7.0, { index: 18, delta: 17 }),
    '6h': buildSeries(24, 15, 41.8, 8.4, { index: 20, delta: 19 }),
    '24h': buildSeries(24, 60, 38.6, 10.5, { index: 16, delta: 22 }),
  },
};

export const INITIAL_ALERTS: AlertItem[] = [
  {
    id: 'SYS-1042',
    severity: 'warning',
    timestamp: '2026-11-16 12:31:14',
    epochMs: new Date('2026-11-16T12:31:14-08:00').getTime(),
    subsystem: 'sshd',
    metric: 'Security',
    description: 'Elevated rate of failed SSH password attempts detected on port 22 from external IPs.',
    status: 'active',
  },
  {
    id: 'SYS-1041',
    severity: 'warning',
    timestamp: '2026-11-16 12:14:08',
    epochMs: new Date('2026-11-16T12:14:08-08:00').getTime(),
    subsystem: 'systemd-journald',
    metric: 'CPU',
    description: 'Short-lived CPU load spike (78.4%) during automated apt unattended-upgrades check.',
    status: 'acknowledged',
  },
  {
    id: 'SYS-1040',
    severity: 'info',
    timestamp: '2026-11-16 11:20:45',
    epochMs: new Date('2026-11-16T11:20:45-08:00').getTime(),
    subsystem: 'nvme0n1p2',
    metric: 'Disk',
    description: 'Daily logrotate compression completed on /var/log; 1.8 GB reclaimed on root volume.',
    status: 'resolved',
  },
  {
    id: 'SYS-1039',
    severity: 'warning',
    timestamp: '2026-11-16 09:42:19',
    epochMs: new Date('2026-11-16T09:42:19-08:00').getTime(),
    subsystem: 'postgresql',
    metric: 'Memory',
    description: 'Worker memory RSS approached 74% during scheduled pg_dump snapshot.',
    status: 'resolved',
  },
  {
    id: 'SYS-1038',
    severity: 'info',
    timestamp: '2026-11-16 06:00:04',
    epochMs: new Date('2026-11-16T06:00:04-08:00').getTime(),
    subsystem: 'certbot.timer',
    metric: 'System',
    description: 'TLS certificate renewal check passed; certificate valid for 64 days.',
    status: 'resolved',
  },
];

export const INITIAL_SECURITY_EVENTS: SecurityEvent[] = [
  {
    id: 'SEC-409',
    severity: 'critical',
    category: 'repeated_attempt',
    timestamp: '2026-11-16 12:36:42',
    epochMs: new Date('2026-11-16T12:36:42-08:00').getTime(),
    sourceIp: '185.220.101.34',
    ipOriginNote: 'Known Tor exit node · ASN 205100',
    targetUser: 'root',
    service: 'sshd',
    attempts: 47,
    description: '47 repeated failed SSH login attempts targeting root account within 6 minutes.',
    rawLogLine:
      'Nov 16 12:36:42 ubuntu-srv-01 sshd[19421]: Failed password for root from 185.220.101.34 port 54118 ssh2 (47 attempts)',
    status: 'open',
  },
  {
    id: 'SEC-408',
    severity: 'critical',
    category: 'suspicious_ip',
    timestamp: '2026-11-16 12:29:15',
    epochMs: new Date('2026-11-16T12:29:15-08:00').getTime(),
    sourceIp: '45.155.205.91',
    ipOriginNote: 'External scanner blocklist match',
    targetUser: 'admin',
    service: 'sshd',
    attempts: 29,
    description: 'Suspicious IP probing invalid usernames (admin, deploy, postgres) over SSH.',
    rawLogLine:
      'Nov 16 12:29:15 ubuntu-srv-01 sshd[19204]: Invalid user admin from 45.155.205.91 port 41902 — connection closed by authenticating user',
    status: 'open',
  },
  {
    id: 'SEC-407',
    severity: 'warning',
    category: 'failed_ssh',
    timestamp: '2026-11-16 12:18:03',
    epochMs: new Date('2026-11-16T12:18:03-08:00').getTime(),
    sourceIp: '91.240.118.172',
    ipOriginNote: 'Unrecognized external IPv4',
    targetUser: 'ubuntu',
    service: 'sshd',
    attempts: 14,
    description: 'Failed SSH publickey and password fallback attempts for user ubuntu.',
    rawLogLine:
      'Nov 16 12:18:03 ubuntu-srv-01 sshd[18940]: Failed password for ubuntu from 91.240.118.172 port 39812 ssh2',
    status: 'open',
  },
  {
    id: 'SEC-406',
    severity: 'warning',
    category: 'auth_failure',
    timestamp: '2026-11-16 11:54:27',
    epochMs: new Date('2026-11-16T11:54:27-08:00').getTime(),
    sourceIp: '192.168.10.88',
    ipOriginNote: 'Internal LAN workstation',
    targetUser: 'opsadmin',
    service: 'sudo / pam_unix',
    attempts: 3,
    description: '3 consecutive sudo authentication failures on tty pts/1 for user opsadmin.',
    rawLogLine:
      'Nov 16 11:54:27 ubuntu-srv-01 sudo: pam_unix(sudo:auth): authentication failure; logname=opsadmin uid=1002 tty=/dev/pts/1 user=opsadmin',
    status: 'acknowledged',
  },
  {
    id: 'SEC-405',
    severity: 'warning',
    category: 'repeated_attempt',
    timestamp: '2026-11-16 10:49:11',
    epochMs: new Date('2026-11-16T10:49:11-08:00').getTime(),
    sourceIp: '103.145.13.64',
    ipOriginNote: 'External VPS range',
    targetUser: 'www-data',
    service: 'sshd',
    attempts: 19,
    description: 'Repeated SSH dictionary attempts against service account www-data; throttled by fail2ban.',
    rawLogLine:
      'Nov 16 10:49:11 ubuntu-srv-01 fail2ban.actions[1124]: NOTICE [sshd] Ban 103.145.13.64 after 19 failed attempts',
    status: 'mitigated',
  },
  {
    id: 'SEC-404',
    severity: 'info',
    category: 'auth_failure',
    timestamp: '2026-11-16 08:12:50',
    epochMs: new Date('2026-11-16T08:12:50-08:00').getTime(),
    sourceIp: '192.168.10.15',
    ipOriginNote: 'Local bastion subnet',
    targetUser: 'backup',
    service: 'sshd',
    attempts: 1,
    description: 'Single rejected SSH key attempt from local subnet during backup key rotation.',
    rawLogLine:
      'Nov 16 08:12:50 ubuntu-srv-01 sshd[14018]: Connection closed by authenticating user backup 192.168.10.15 port 50214 [preauth]',
    status: 'mitigated',
  },
];

export function computeSystemHealth(
  host: UbuntuHost,
  alerts: AlertItem[],
  securityEvents: SecurityEvent[]
): {
  status: HealthStatus;
  label: string;
  summary: string;
} {
  const activeCriticalAlerts = alerts.filter(
    (a) => a.severity === 'critical' && a.status === 'active'
  ).length;
  const openCriticalSecurity = securityEvents.filter(
    (e) => e.severity === 'critical' && e.status === 'open'
  ).length;
  const activeWarningAlerts = alerts.filter(
    (a) => a.severity === 'warning' && a.status === 'active'
  ).length;
  const openWarningSecurity = securityEvents.filter(
    (e) => e.severity === 'warning' && e.status === 'open'
  ).length;

  if (
    activeCriticalAlerts > 0 ||
    openCriticalSecurity > 0 ||
    host.cpuPct >= 90 ||
    host.ramPct >= 92 ||
    host.diskPct >= 90
  ) {
    return {
      status: 'critical',
      label: 'Attention Required',
      summary:
        openCriticalSecurity > 0
          ? `${openCriticalSecurity} unmitigated critical security event${openCriticalSecurity > 1 ? 's' : ''} (repeated SSH / suspicious IP activity).`
          : 'Critical system threshold or alert triggered on Ubuntu host.',
    };
  }

  if (
    activeWarningAlerts > 0 ||
    openWarningSecurity > 0 ||
    host.cpuPct >= 75 ||
    host.ramPct >= 80 ||
    host.diskPct >= 75
  ) {
    return {
      status: 'degraded',
      label: 'Degraded',
      summary:
        activeWarningAlerts + openWarningSecurity > 0
          ? `${activeWarningAlerts + openWarningSecurity} active warning item${activeWarningAlerts + openWarningSecurity > 1 ? 's' : ''} awaiting review.`
          : 'Resource utilization is above nominal baseline.',
    };
  }

  return {
    status: 'healthy',
    label: 'Operational',
    summary: 'All Ubuntu host resources and authentication checks are within nominal bounds.',
  };
}

export function stepHostTelemetrySample(host: UbuntuHost, tickDate: Date): UbuntuHost {
  const clockShort = formatClock(tickDate, false);
  const fullStamp = formatIsoDisplay(tickDate);

  const cpuJitter = (Math.random() - 0.48) * 3.2;
  const nextCpu = Number(Math.max(12, Math.min(94, host.cpuPct + cpuJitter)).toFixed(1));
  const nextVCpuUsed = Number(((nextCpu / 100) * host.vCpuTotal).toFixed(1));

  const ramJitter = (Math.random() - 0.5) * 0.7;
  const nextRam = Number(Math.max(25, Math.min(94, host.ramPct + ramJitter)).toFixed(1));
  const nextRamUsed = Number(((nextRam / 100) * host.ramTotalGb).toFixed(2));

  const cpuDelta = Number((nextCpu - host.cpuPct).toFixed(1));
  const ramDelta = Number((nextRam - host.ramPct).toFixed(1));

  const next15m = [
    ...host.cpuSeries['15m'].slice(1),
    {
      timestamp: fullStamp,
      label: clockShort,
      usage: nextCpu,
      userPct: Number((nextCpu * 0.72).toFixed(1)),
      systemPct: Number((nextCpu * 0.28).toFixed(1)),
    },
  ];

  return {
    ...host,
    cpuPct: nextCpu,
    cpuDelta,
    vCpuUsed: nextVCpuUsed,
    ramPct: nextRam,
    ramDelta,
    ramUsedGb: nextRamUsed,
    cpuSeries: {
      ...host.cpuSeries,
      '15m': next15m,
    },
  };
}
