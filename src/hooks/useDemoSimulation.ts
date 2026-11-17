/**
 * useDemoSimulation — drives the live "breathing" simulation of fleet metrics
 * in Public Demo Mode.
 *
 * Uses smooth, bounded random walks so that:
 * - CPU, RAM values drift slowly and realistically between polls.
 * - Occasional short spikes occur (mimicking real batch jobs).
 * - The simulation is stable — no jarring jumps.
 * - worker-batch-02 stays persistently busy (high CPU baseline).
 * - cache-redis-01 stays persistently calm (low CPU baseline).
 */

import { useCallback, useEffect, useRef } from 'react';
import { DEMO_NODES } from '../data/demoData';
import { CpuPoint, TimeRange, UbuntuHost } from '../types/monitoring';

export type DemoNodesState = UbuntuHost[];

/** Smooth random walk — clamps within [min, max] with momentum */
function drift(current: number, min: number, max: number, step: number): number {
  const jitter = (Math.random() - 0.48) * step;
  return Number(Math.max(min, Math.min(max, current + jitter)).toFixed(1));
}

/** Returns true with probability p */
function chance(p: number): boolean {
  return Math.random() < p;
}

/** Inject a new CPU point and trim old ones */
function appendCpuPoint(
  series: Record<TimeRange, CpuPoint[]>,
  usage: number,
  maxPoints: Record<TimeRange, number> = { '15m': 18, '1h': 60, '6h': 72, '24h': 96 }
): Record<TimeRange, CpuPoint[]> {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const point: CpuPoint = {
    timestamp: `${hh}:${mm}:${ss}`,
    label: `${hh}:${mm}`,
    usage,
    userPct: Number((usage * 0.73).toFixed(1)),
    systemPct: Number((usage * 0.27).toFixed(1)),
  };

  const updated: Record<TimeRange, CpuPoint[]> = {} as Record<TimeRange, CpuPoint[]>;
  for (const tr of ['15m', '1h', '6h', '24h'] as TimeRange[]) {
    const existing = series[tr] ?? [];
    const appended = [...existing, point];
    const max = maxPoints[tr];
    updated[tr] = appended.length > max ? appended.slice(appended.length - max) : appended;
  }
  return updated;
}

/** Tick one node forward — returns a new UbuntuHost with updated metrics */
function tickNode(node: UbuntuHost, tickIndex: number): UbuntuHost {
  const id = node.deviceId ?? '';

  // Per-node CPU drift ranges
  let cpuMin = 6, cpuMax = 55, cpuStep = 3.5;
  if (id.includes('worker')) { cpuMin = 55; cpuMax = 95; cpuStep = 5.0; }
  if (id.includes('redis'))  { cpuMin = 4;  cpuMax = 25; cpuStep = 2.0; }
  if (id.includes('db'))     { cpuMin = 10; cpuMax = 55; cpuStep = 3.0; }

  // Occasional spike on the worker node
  const isWorkerSpike = id.includes('worker') && chance(0.08);
  const cpuBoost = isWorkerSpike ? 10 : 0;

  const newCpu = Number(Math.min(cpuMax, drift(node.cpuPct, cpuMin, cpuMax - cpuBoost, cpuStep) + cpuBoost).toFixed(1));
  const cpuDelta = Number((newCpu - node.cpuPct).toFixed(1));

  // RAM drifts more slowly
  const newRam = drift(node.ramPct, 25, 92, 0.6);
  const ramDelta = Number((newRam - node.ramPct).toFixed(1));
  const newRamUsed = Number(((newRam / 100) * node.ramTotalGb).toFixed(2));

  // Disk barely changes
  const newDisk = drift(node.diskPct, node.diskPct - 0.5, node.diskPct + 0.8, 0.05);

  // Uptime increments by the tick interval (10 s)
  const uptimeIncrement = 10;
  const uptimeStr = incrementUptime(node.uptime, uptimeIncrement);

  // Update heartbeat time
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const heartbeat = `${hh}:${mm}:${ss}`;

  // Simulate the cache node going offline briefly every ~8 min then recovering
  const cacheOfflineCycle = tickIndex % 48; // 48 × 10s = 8 minutes
  const deviceStatus: 'online' | 'offline' =
    id.includes('redis') && cacheOfflineCycle >= 44 ? 'offline' : 'online';

  // Append CPU series point (only when online)
  const newSeries = deviceStatus === 'online'
    ? appendCpuPoint(node.cpuSeries, newCpu)
    : node.cpuSeries;

  return {
    ...node,
    cpuPct: newCpu,
    cpuDelta,
    vCpuUsed: Number(((newCpu / 100) * node.vCpuTotal).toFixed(1)),
    ramPct: newRam,
    ramDelta,
    ramUsedGb: newRamUsed,
    diskPct: newDisk,
    diskDelta: Number((newDisk - node.diskPct).toFixed(2)),
    diskUsedGb: Number(((newDisk / 100) * node.diskTotalGb).toFixed(1)),
    uptime: uptimeStr,
    lastHeartbeat: heartbeat,
    deviceStatus,
    cpuSeries: newSeries,
  };
}

/** Increment a human uptime string by seconds */
function incrementUptime(uptime: string, seconds: number): string {
  // Parse: "14d 7h 22m" or "3h 5m" or "22m"
  const dayMatch = uptime.match(/(\d+)d/);
  const hourMatch = uptime.match(/(\d+)h/);
  const minMatch = uptime.match(/(\d+)m/);

  let totalMinutes =
    (dayMatch ? parseInt(dayMatch[1], 10) * 1440 : 0) +
    (hourMatch ? parseInt(hourMatch[1], 10) * 60 : 0) +
    (minMatch ? parseInt(minMatch[1], 10) : 0);

  totalMinutes += Math.floor(seconds / 60);

  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const mins = totalMinutes % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${mins}m`);
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseDemoSimulationOptions {
  /** Polling interval in milliseconds. Default: 10 000 (10 s) */
  intervalMs?: number;
  /** Whether simulation is running */
  isLive: boolean;
  /** Callback to receive updated nodes array on each tick */
  onTick: (nodes: DemoNodesState) => void;
}

export function useDemoSimulation({
  intervalMs = 10_000,
  isLive,
  onTick,
}: UseDemoSimulationOptions): void {
  const nodesRef = useRef<DemoNodesState>([...DEMO_NODES]);
  const tickIndexRef = useRef(0);

  const tick = useCallback(() => {
    const idx = tickIndexRef.current++;
    const updated = nodesRef.current.map((node) => tickNode(node, idx));
    nodesRef.current = updated;
    onTick([...updated]);
  }, [onTick]);

  useEffect(() => {
    if (!isLive) return;
    const timer = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(timer);
  }, [isLive, intervalMs, tick]);
}
