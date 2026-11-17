/**
 * CloudSentinel — Public Demo Mode synthetic data
 *
 * All data in this file is entirely fictional and generated for
 * demonstration purposes. It does NOT represent real infrastructure,
 * real IP addresses, real usernames or any private telemetry.
 *
 * RFC 5737 documentation addresses (192.0.2.x, 198.51.100.x, 203.0.113.x)
 * are used for synthetic source IPs so there is zero risk of coincidentally
 * identifying a real host.
 */

import {
  AlertItem,
  CpuPoint,
  SecurityEvent,
  TimeRange,
  UbuntuHost,
} from '../types/monitoring';

// ---------------------------------------------------------------------------
// Deterministic wave generator — produces smooth, realistic-looking curves
// without any randomness so the initial render is always the same.
// ---------------------------------------------------------------------------
function buildDemoCpuSeries(
  pointCount: number,
  baseUsage: number,
  amplitude: number,
  phaseOffset: number,
  spikeAt?: { index: number; height: number }
): CpuPoint[] {
  const now = Date.now();
  const stepMs = (pointCount > 60 ? 15 : pointCount > 30 ? 5 : 1) * 60_000;
  const result: CpuPoint[] = [];

  for (let i = 0; i < pointCount; i++) {
    const t = new Date(now - (pointCount - 1 - i) * stepMs);
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    const ss = String(t.getSeconds()).padStart(2, '0');
    const label = `${hh}:${mm}`;
    const timestamp = `${hh}:${mm}:${ss}`;

    const wave =
      Math.sin(i * 0.47 + phaseOffset) * amplitude * 0.65 +
      Math.cos(i * 1.13 + phaseOffset * 0.5) * amplitude * 0.35;

    const spike =
      spikeAt && Math.abs(i - spikeAt.index) <= 2
        ? spikeAt.height * (1 - Math.abs(i - spikeAt.index) * 0.4)
        : 0;

    const usage = Number(
      Math.max(4, Math.min(97, baseUsage + wave + spike)).toFixed(1)
    );
    const userPct = Number((usage * 0.73).toFixed(1));
    const systemPct = Number((usage - userPct).toFixed(1));

    result.push({ timestamp, label, usage, userPct, systemPct });
  }

  return result;
}

function buildAllSeries(
  base: number,
  amp: number,
  phase: number,
  spike?: { index: number; height: number }
): Record<TimeRange, CpuPoint[]> {
  return {
    '15m': buildDemoCpuSeries(18, base, amp, phase, spike),
    '1h': buildDemoCpuSeries(60, base, amp, phase, spike),
    '6h': buildDemoCpuSeries(72, base, amp, phase, spike),
    '24h': buildDemoCpuSeries(96, base, amp, phase, spike),
  };
}

// ---------------------------------------------------------------------------
// Demo fleet — 4 synthetic Linux hosts
// ---------------------------------------------------------------------------

export const DEMO_NODES: UbuntuHost[] = [
  // ── prod-api-01 ──────────────────────────────────────────────────────────
  {
    deviceId: 'demo-prod-api-01',
    hostname: 'prod-api-01',
    os: 'Ubuntu 22.04.4 LTS',
    kernel: '6.5.0-41-generic',
    arch: 'x86_64',
    ipAddress: '10.0.1.21',
    networkInterface: 'eth0',
    uptime: '14d 7h 22m',
    cpuPct: 42.3,
    cpuDelta: 1.8,
    vCpuUsed: 1.7,
    vCpuTotal: 4,
    loadAvg: '1.68 / 1.74 / 1.72',
    ramPct: 61.4,
    ramDelta: 0.3,
    ramUsedGb: 4.91,
    ramTotalGb: 8.0,
    ramCachedGb: 1.2,
    diskPct: 44.7,
    diskDelta: 0.0,
    diskUsedGb: 44.7,
    diskTotalGb: 100.0,
    diskDevice: 'sda1',
    diskMount: '/',
    deviceStatus: 'online',
    lastHeartbeat: '14:03:22',
    cpuSeries: buildAllSeries(42, 12, 0.0, { index: 11, height: 24 }),
  },

  // ── prod-db-01 ───────────────────────────────────────────────────────────
  {
    deviceId: 'demo-prod-db-01',
    hostname: 'prod-db-01',
    os: 'Ubuntu 22.04.4 LTS',
    kernel: '6.5.0-41-generic',
    arch: 'x86_64',
    ipAddress: '10.0.1.22',
    networkInterface: 'eth0',
    uptime: '61d 2h 18m',
    cpuPct: 28.1,
    cpuDelta: -1.4,
    vCpuUsed: 2.2,
    vCpuTotal: 8,
    loadAvg: '2.24 / 2.17 / 2.09',
    ramPct: 79.6,
    ramDelta: 0.5,
    ramUsedGb: 25.47,
    ramTotalGb: 32.0,
    ramCachedGb: 6.8,
    diskPct: 72.3,
    diskDelta: 0.1,
    diskUsedGb: 361.5,
    diskTotalGb: 500.0,
    diskDevice: 'nvme0n1p3',
    diskMount: '/data',
    deviceStatus: 'online',
    lastHeartbeat: '14:03:18',
    cpuSeries: buildAllSeries(28, 8, 1.3),
  },

  // ── worker-batch-02 ──────────────────────────────────────────────────────
  {
    deviceId: 'demo-worker-batch-02',
    hostname: 'worker-batch-02',
    os: 'Ubuntu 20.04.6 LTS',
    kernel: '5.15.0-105-generic',
    arch: 'x86_64',
    ipAddress: '10.0.2.11',
    networkInterface: 'ens3',
    uptime: '3d 11h 44m',
    cpuPct: 83.7,
    cpuDelta: 5.2,
    vCpuUsed: 6.7,
    vCpuTotal: 8,
    loadAvg: '6.72 / 6.44 / 5.91',
    ramPct: 55.2,
    ramDelta: 2.1,
    ramUsedGb: 8.83,
    ramTotalGb: 16.0,
    ramCachedGb: 2.4,
    diskPct: 31.8,
    diskDelta: 0.5,
    diskUsedGb: 79.5,
    diskTotalGb: 250.0,
    diskDevice: 'vda1',
    diskMount: '/',
    deviceStatus: 'online',
    lastHeartbeat: '14:03:20',
    cpuSeries: buildAllSeries(82, 10, 2.6, { index: 55, height: 10 }),
  },

  // ── cache-redis-01 ───────────────────────────────────────────────────────
  {
    deviceId: 'demo-cache-redis-01',
    hostname: 'cache-redis-01',
    os: 'Ubuntu 22.04.4 LTS',
    kernel: '6.5.0-41-generic',
    arch: 'x86_64',
    ipAddress: '10.0.1.30',
    networkInterface: 'eth0',
    uptime: '28d 19h 55m',
    cpuPct: 11.9,
    cpuDelta: -0.3,
    vCpuUsed: 0.2,
    vCpuTotal: 2,
    loadAvg: '0.19 / 0.21 / 0.18',
    ramPct: 38.4,
    ramDelta: 0.1,
    ramUsedGb: 3.07,
    ramTotalGb: 8.0,
    ramCachedGb: 0.9,
    diskPct: 18.2,
    diskDelta: 0.0,
    diskUsedGb: 9.1,
    diskTotalGb: 50.0,
    diskDevice: 'sda1',
    diskMount: '/',
    deviceStatus: 'online',
    lastHeartbeat: '14:03:19',
    cpuSeries: buildAllSeries(12, 5, 4.1),
  },
];

// ---------------------------------------------------------------------------
// Demo security events — entirely synthetic, RFC 5737 IP addresses only
// ---------------------------------------------------------------------------

export const DEMO_SECURITY_EVENTS: SecurityEvent[] = [
  {
    id: 'DEMO-SEC-012',
    severity: 'critical',
    category: 'repeated_attempt',
    timestamp: '2026-11-17 13:47:09',
    epochMs: new Date('2026-11-17T13:47:09Z').getTime(),
    sourceIp: '203.0.113.47',
    ipOriginNote: 'RFC 5737 documentation range · Synthetic demo event',
    targetUser: 'root',
    service: 'sshd',
    attempts: 61,
    description:
      '61 rapid SSH login attempts against root on prod-api-01 from external address. Fail2ban triggered after threshold breach.',
    rawLogLine:
      'Nov 17 13:47:09 prod-api-01 sshd[29301]: Failed password for root from 203.0.113.47 port 51922 ssh2 (61 attempts)',
    status: 'open',
  },
  {
    id: 'DEMO-SEC-011',
    severity: 'critical',
    category: 'suspicious_ip',
    timestamp: '2026-11-17 13:31:44',
    epochMs: new Date('2026-11-17T13:31:44Z').getTime(),
    sourceIp: '198.51.100.88',
    ipOriginNote: 'RFC 5737 documentation range · Synthetic demo event',
    targetUser: 'admin',
    service: 'sshd',
    attempts: 34,
    description:
      'Scanner probing invalid usernames (admin, deploy, git, postgres) over SSH on prod-db-01. Automated threat signature matched.',
    rawLogLine:
      'Nov 17 13:31:44 prod-db-01 sshd[27812]: Invalid user admin from 198.51.100.88 port 44110 — connection closed by authenticating user',
    status: 'open',
  },
  {
    id: 'DEMO-SEC-010',
    severity: 'warning',
    category: 'failed_ssh',
    timestamp: '2026-11-17 13:14:52',
    epochMs: new Date('2026-11-17T13:14:52Z').getTime(),
    sourceIp: '192.0.2.145',
    ipOriginNote: 'RFC 5737 documentation range · Synthetic demo event',
    targetUser: 'ubuntu',
    service: 'sshd',
    attempts: 17,
    description:
      'Repeated SSH public-key and password authentication failures for user ubuntu on worker-batch-02.',
    rawLogLine:
      'Nov 17 13:14:52 worker-batch-02 sshd[26440]: Failed password for ubuntu from 192.0.2.145 port 38811 ssh2',
    status: 'open',
  },
  {
    id: 'DEMO-SEC-009',
    severity: 'warning',
    category: 'auth_failure',
    timestamp: '2026-11-17 12:58:30',
    epochMs: new Date('2026-11-17T12:58:30Z').getTime(),
    sourceIp: '10.0.1.55',
    ipOriginNote: 'Internal LAN address · Synthetic demo event',
    targetUser: 'opsadmin',
    service: 'sudo / pam_unix',
    attempts: 4,
    description:
      '4 consecutive sudo authentication failures on pts/0 for opsadmin. Possible misconfigured automation script.',
    rawLogLine:
      'Nov 17 12:58:30 prod-api-01 sudo: pam_unix(sudo:auth): authentication failure; logname=opsadmin uid=1003 tty=/dev/pts/0',
    status: 'acknowledged',
  },
  {
    id: 'DEMO-SEC-008',
    severity: 'warning',
    category: 'repeated_attempt',
    timestamp: '2026-11-17 11:39:17',
    epochMs: new Date('2026-11-17T11:39:17Z').getTime(),
    sourceIp: '203.0.113.202',
    ipOriginNote: 'RFC 5737 documentation range · Synthetic demo event',
    targetUser: 'www-data',
    service: 'sshd',
    attempts: 22,
    description:
      'SSH dictionary scan targeting service accounts on cache-redis-01. Throttled by fail2ban after 22 attempts.',
    rawLogLine:
      'Nov 17 11:39:17 cache-redis-01 fail2ban.actions[2241]: NOTICE [sshd] Ban 203.0.113.202 after 22 failed attempts',
    status: 'mitigated',
  },
  {
    id: 'DEMO-SEC-007',
    severity: 'info',
    category: 'failed_ssh',
    timestamp: '2026-11-17 09:22:04',
    epochMs: new Date('2026-11-17T09:22:04Z').getTime(),
    sourceIp: '10.0.1.10',
    ipOriginNote: 'Internal bastion host · Synthetic demo event',
    targetUser: 'backup',
    service: 'sshd',
    attempts: 1,
    description:
      'Single rejected SSH key attempt during scheduled backup key rotation from internal bastion host.',
    rawLogLine:
      'Nov 17 09:22:04 prod-db-01 sshd[18011]: Connection closed by authenticating user backup 10.0.1.10 port 50202 [preauth]',
    status: 'mitigated',
  },
  {
    id: 'DEMO-SEC-006',
    severity: 'info',
    category: 'auth_failure',
    timestamp: '2026-11-17 08:05:49',
    epochMs: new Date('2026-11-17T08:05:49Z').getTime(),
    sourceIp: '10.0.1.21',
    ipOriginNote: 'Internal application server · Synthetic demo event',
    targetUser: 'deploy',
    service: 'sshd',
    attempts: 1,
    description:
      'SSH login accepted for deploy user from internal application server during scheduled deployment pipeline.',
    rawLogLine:
      'Nov 17 08:05:49 prod-db-01 sshd[14102]: Accepted publickey for deploy from 10.0.1.21 port 42101 ssh2',
    status: 'mitigated',
  },
];

// ---------------------------------------------------------------------------
// Demo alerts — fictional operational events for the 4 fleet nodes
// ---------------------------------------------------------------------------

export const DEMO_ALERTS: AlertItem[] = [
  {
    id: 'DEMO-ALT-023',
    severity: 'critical',
    timestamp: '2026-11-17 13:51:08',
    epochMs: new Date('2026-11-17T13:51:08Z').getTime(),
    subsystem: 'sshd / fail2ban',
    metric: 'Security',
    description:
      'Brute-force SSH attack from 203.0.113.47 detected on prod-api-01. 61 failed root login attempts in under 4 minutes. Automatic IP ban applied.',
    status: 'active',
  },
  {
    id: 'DEMO-ALT-022',
    severity: 'warning',
    timestamp: '2026-11-17 13:44:19',
    epochMs: new Date('2026-11-17T13:44:19Z').getTime(),
    subsystem: 'node_exporter / batch-processor',
    metric: 'CPU',
    description:
      'worker-batch-02 CPU utilization sustained above 80% for 12 consecutive minutes during nightly ETL job run.',
    status: 'active',
  },
  {
    id: 'DEMO-ALT-021',
    severity: 'warning',
    timestamp: '2026-11-17 13:22:37',
    epochMs: new Date('2026-11-17T13:22:37Z').getTime(),
    subsystem: 'postgresql',
    metric: 'Memory',
    description:
      'prod-db-01 RAM utilization reached 79.6% during pg_dump snapshot. Shared buffers under pressure — consider increasing work_mem.',
    status: 'acknowledged',
  },
  {
    id: 'DEMO-ALT-020',
    severity: 'warning',
    timestamp: '2026-11-17 12:14:55',
    epochMs: new Date('2026-11-17T12:14:55Z').getTime(),
    subsystem: 'node_exporter',
    metric: 'Disk',
    description:
      'prod-db-01 /data partition at 72.3% utilization. Trending at +0.1% per day — estimated capacity in 278 days at current rate.',
    status: 'acknowledged',
  },
  {
    id: 'DEMO-ALT-019',
    severity: 'info',
    timestamp: '2026-11-17 10:00:04',
    epochMs: new Date('2026-11-17T10:00:04Z').getTime(),
    subsystem: 'certbot.timer',
    metric: 'System',
    description:
      'TLS certificate renewal check passed on prod-api-01. Certificate valid for 47 days. No action required.',
    status: 'resolved',
  },
  {
    id: 'DEMO-ALT-018',
    severity: 'info',
    timestamp: '2026-11-17 06:00:02',
    epochMs: new Date('2026-11-17T06:00:02Z').getTime(),
    subsystem: 'systemd / logrotate',
    metric: 'Disk',
    description:
      'Scheduled log rotation completed on worker-batch-02. 2.3 GB reclaimed on root partition. Disk usage reduced from 34.1% to 31.8%.',
    status: 'resolved',
  },
  {
    id: 'DEMO-ALT-017',
    severity: 'warning',
    timestamp: '2026-11-17 02:31:14',
    epochMs: new Date('2026-11-17T02:31:14Z').getTime(),
    subsystem: 'redis',
    metric: 'Memory',
    description:
      'cache-redis-01 maxmemory-policy eviction threshold reached during peak traffic window. 184K keys evicted. Memory usage stabilised at 38.4%.',
    status: 'resolved',
  },
];

// ---------------------------------------------------------------------------
// Demo device list for the sidebar selector
// ---------------------------------------------------------------------------

export interface DemoDevice {
  id: string;
  hostname: string;
  role: string;
  status: 'online' | 'offline';
}

export const DEMO_DEVICES: DemoDevice[] = [
  { id: 'demo-prod-api-01',      hostname: 'prod-api-01',      role: 'Production API',     status: 'online' },
  { id: 'demo-prod-db-01',       hostname: 'prod-db-01',       role: 'Production Database', status: 'online' },
  { id: 'demo-worker-batch-02',  hostname: 'worker-batch-02',  role: 'Batch Processing',    status: 'online' },
  { id: 'demo-cache-redis-01',   hostname: 'cache-redis-01',   role: 'Cache / Redis',       status: 'online' },
];
