import {
  Activity,
  Bell,
  Info,
  Menu,
  Moon,
  Pause,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sun,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertsTable } from './components/AlertsTable';
import { CpuLineChart } from './components/CpuLineChart';
import { MetricCard } from './components/MetricCard';
import { SecurityEventsView } from './components/SecurityEventsView';
import { SecuritySummarySection } from './components/SecuritySummarySection';
import { SystemHealthBanner } from './components/SystemHealthBanner';
import { INITIAL_UBUNTU_HOST, computeSystemHealth } from './data/mockTelemetry';
import {
  API_BASE_URL,
  ApiError,
  acknowledgeAlert,
  evaluateAlerts,
  formatUptime,
  getAlerts,
  getSecurityEvents,
  getSystemMetrics,
  mapApiAlertToAlertItem,
  mapApiSecurityEventToUi,
  reopenAlert,
  resolveAlert,
  resolveApiBaseUrl,
  selectPrimaryNetworkInterface,
} from './services/api';
import {
  AlertItem,
  AlertStatus,
  CpuPoint,
  DashboardView,
  SecurityEvent,
  SecurityEventStatus,
  TimeRange,
  UbuntuHost,
} from './types/monitoring';

function formatShortTime(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/** How many real-time CPU samples to retain per time-range bucket */
const CPU_SERIES_MAX_POINTS: Record<TimeRange, number> = {
  '15m': 18,  // one per ~50s
  '1h': 60,
  '6h': 72,
  '24h': 96,
};

export default function App() {
  const [host, setHost] = useState<UbuntuHost>(INITIAL_UBUNTU_HOST);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [securityEvents, setSecurityEvents] = useState<SecurityEvent[]>([]);
  const [selectedSecurityEventId, setSelectedSecurityEventId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<DashboardView>('overview');
  const [timeRange, setTimeRange] = useState<TimeRange>('15m');
  const [darkMode, setDarkMode] = useState<boolean>(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<string>('—');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isLive, setIsLive] = useState<boolean>(true);

  // Connection state
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [isWakingUp, setIsWakingUp] = useState<boolean>(false);
  const [isAuthError, setIsAuthError] = useState<boolean>(false);

  // Loading / action state
  const [initialLoading, setInitialLoading] = useState<boolean>(true);
  const [isEvaluating, setIsEvaluating] = useState<boolean>(false);
  const [pendingAlertId, setPendingAlertId] = useState<string | null>(null);

  // Ref to detect if component is still mounted
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Dark-mode class toggle
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add('dark');
    else root.classList.remove('dark');
  }, [darkMode]);

  // ----------------------------------------------------------------
  // Helpers for updating host state from an API system response
  // ----------------------------------------------------------------
  const applySystemMetrics = useCallback(
    (data: Awaited<ReturnType<typeof getSystemMetrics>>, prevHost: UbuntuHost): UbuntuHost => {
      const { system, cpu, memory, disk, network } = data;

      const cpuPct = cpu.usage_percent ?? prevHost.cpuPct;
      const cpuDelta = Number((cpuPct - prevHost.cpuPct).toFixed(1));

      const ramPct = memory.usage_percent ?? prevHost.ramPct;
      const ramDelta = Number((ramPct - prevHost.ramPct).toFixed(1));
      const ramTotalGb = memory.total_bytes ? Number((memory.total_bytes / 1_073_741_824).toFixed(1)) : prevHost.ramTotalGb;
      const ramUsedGb = memory.used_bytes ? Number((memory.used_bytes / 1_073_741_824).toFixed(2)) : prevHost.ramUsedGb;
      const ramCachedGb = memory.available_bytes
        ? Number(((memory.total_bytes ?? 0) - (memory.used_bytes ?? 0) - (memory.available_bytes ?? 0)) / 1_073_741_824)
        : prevHost.ramCachedGb;

      const diskPct = disk.usage_percent ?? prevHost.diskPct;
      const diskDelta = Number((diskPct - prevHost.diskPct).toFixed(1));
      const diskTotalGb = disk.total_bytes ? Number((disk.total_bytes / 1_073_741_824).toFixed(1)) : prevHost.diskTotalGb;
      const diskUsedGb = disk.used_bytes ? Number((disk.used_bytes / 1_073_741_824).toFixed(1)) : prevHost.diskUsedGb;
      const diskMount = disk.mount_point || prevHost.diskMount;

      // Determine primary interface + IP using priority scoring (Wi-Fi/Ethernet > bridge > loopback)
      const { networkInterface, ipAddress } = selectPrimaryNetworkInterface(
        network?.interfaces ?? [],
        prevHost.networkInterface,
        prevHost.ipAddress
      );

      const deviceStatus = data.device_status ?? 'online';

      // Build a new CPU series point
      const now = new Date();
      const newPoint: CpuPoint = {
        timestamp: now.toISOString(),
        label: formatShortTime(now),
        usage: cpuPct,
        userPct: Number((cpuPct * 0.72).toFixed(1)),
        systemPct: Number((cpuPct * 0.28).toFixed(1)),
      };

      // Accumulate series per time range only when host is actively online
      const updatedSeries: Record<TimeRange, CpuPoint[]> = {} as Record<TimeRange, CpuPoint[]>;
      for (const tr of ['15m', '1h', '6h', '24h'] as TimeRange[]) {
        const existing = prevHost.cpuSeries[tr] ?? [];
        if (deviceStatus === 'online') {
          const max = CPU_SERIES_MAX_POINTS[tr];
          const appended = [...existing, newPoint];
          updatedSeries[tr] = appended.length > max ? appended.slice(appended.length - max) : appended;
        } else {
          updatedSeries[tr] = existing;
        }
      }

      // Build load average string
      let loadAvg = prevHost.loadAvg;
      if (cpu.load_average) {
        loadAvg = `${cpu.load_average['1m']} / ${cpu.load_average['5m']} / ${cpu.load_average['15m']}`;
      }

      return {
        ...prevHost,
        hostname: system.hostname || prevHost.hostname,
        os: system.os_release || system.os || prevHost.os,
        kernel: system.kernel_version || prevHost.kernel,
        arch: system.architecture || prevHost.arch,
        uptime: formatUptime(system.uptime_seconds),
        ipAddress,
        networkInterface,
        deviceStatus,
        cpuPct,
        cpuDelta,
        vCpuTotal: cpu.logical_cores ?? prevHost.vCpuTotal,
        vCpuUsed: Number(((cpuPct / 100) * (cpu.logical_cores ?? prevHost.vCpuTotal)).toFixed(1)),
        loadAvg,
        ramPct,
        ramDelta,
        ramTotalGb,
        ramUsedGb,
        ramCachedGb: Math.max(0, ramCachedGb),
        diskPct,
        diskDelta,
        diskTotalGb,
        diskUsedGb,
        diskMount,
        diskDevice: prevHost.diskDevice,
        cpuSeries: updatedSeries,
      };
    },
    []
  );

  // ----------------------------------------------------------------
  // Fetch: system metrics
  // ----------------------------------------------------------------
  const fetchSystemMetrics = useCallback(async () => {
    const currentBaseUrl = resolveApiBaseUrl();
    console.info(`[CloudSentinel] Polling system metrics from: ${currentBaseUrl}/api/system`);
    try {
      const data = await getSystemMetrics();
      if (!mountedRef.current) return;
      console.info('[CloudSentinel] Successfully received system metrics:', data);
      setBackendOnline(true);
      setConnectError(null);
      setIsWakingUp(false);
      setIsAuthError(false);
      setHost((prev) => applySystemMetrics(data, prev));
      setLastUpdated(formatShortTime(new Date()));
    } catch (err) {
      if (!mountedRef.current) return;
      const isRender = currentBaseUrl.includes('onrender.com');
      console.error(`[CloudSentinel] Error fetching system metrics from ${currentBaseUrl}:`, err);
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setIsAuthError(true);
          setIsWakingUp(false);
          setConnectError(err.message || 'Invalid or missing dashboard API authentication key');
        } else if (err.status === 0 || err.status === 502 || err.status === 503 || err.status === 504) {
          if (isRender) {
            setIsWakingUp(true);
          }
          setIsAuthError(false);
          setConnectError(err.message);
        } else {
          setIsAuthError(false);
          setIsWakingUp(false);
          setConnectError(err.message);
        }
      } else {
        const msg = err instanceof Error ? err.message : 'Connection failed';
        setIsAuthError(false);
        if (isRender) {
          setIsWakingUp(true);
        }
        setConnectError(msg);
      }
      setBackendOnline(false);
    }
  }, [applySystemMetrics]);

  // ----------------------------------------------------------------
  // Fetch: security events
  // ----------------------------------------------------------------
  const fetchSecurityEvents = useCallback(async () => {
    try {
      const data = await getSecurityEvents({ limit: 100 });
      if (!mountedRef.current) return;
      const mapped = data.events.map(mapApiSecurityEventToUi);
      setSecurityEvents(mapped);
      if (mapped.length > 0 && selectedSecurityEventId === null) {
        setSelectedSecurityEventId(mapped[0].id);
      }
    } catch (err) {
      console.error('[CloudSentinel] Error fetching security events:', err);
      // Security events are non-critical — keep existing state
    }
  }, [selectedSecurityEventId]);

  // ----------------------------------------------------------------
  // Fetch: alerts
  // ----------------------------------------------------------------
  const fetchAlerts = useCallback(async () => {
    try {
      const data = await getAlerts({ limit: 100 });
      if (!mountedRef.current) return;
      setAlerts(data.alerts.map(mapApiAlertToAlertItem));
    } catch (err) {
      console.error('[CloudSentinel] Error fetching alerts:', err);
      // Keep existing alerts
    }
  }, []);

  // ----------------------------------------------------------------
  // Run alert evaluation engine then refresh alerts + security
  // ----------------------------------------------------------------
  const runEvaluateAlerts = useCallback(async () => {
    if (isEvaluating) return;
    setIsEvaluating(true);
    try {
      await evaluateAlerts();
      await Promise.all([fetchAlerts(), fetchSecurityEvents()]);
    } catch {
      // Evaluation is best-effort
    } finally {
      if (mountedRef.current) setIsEvaluating(false);
    }
  }, [isEvaluating, fetchAlerts, fetchSecurityEvents]);

  // ----------------------------------------------------------------
  // Initial load on mount
  // ----------------------------------------------------------------
  useEffect(() => {
    let alive = true;
    async function initialLoad() {
      await Promise.all([
        fetchSystemMetrics(),
        fetchSecurityEvents(),
        fetchAlerts(),
      ]);
      if (!alive) return;
      setInitialLoading(false);
      // Run evaluation after initial data is loaded
      runEvaluateAlerts();
    }
    initialLoad();
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----------------------------------------------------------------
  // Polling: system metrics every 10 s while live (every 4 s if waking up)
  // ----------------------------------------------------------------
  useEffect(() => {
    if (!isLive) return;
    const interval = isWakingUp ? 4_000 : 10_000;
    const timer = window.setInterval(fetchSystemMetrics, interval);
    return () => window.clearInterval(timer);
  }, [isLive, isWakingUp, fetchSystemMetrics]);

  // ----------------------------------------------------------------
  // Polling: alert evaluation + refresh every 60 s
  // ----------------------------------------------------------------
  useEffect(() => {
    if (!isLive) return;
    const timer = window.setInterval(runEvaluateAlerts, 60_000);
    return () => window.clearInterval(timer);
  }, [isLive, runEvaluateAlerts]);

  // ----------------------------------------------------------------
  // Manual refresh
  // ----------------------------------------------------------------
  const handleManualRefresh = useCallback(async () => {
    const currentBaseUrl = resolveApiBaseUrl();
    console.info(`[CloudSentinel] "Refresh Metrics" clicked. Fetching from ${currentBaseUrl}...`);
    setIsRefreshing(true);
    try {
      await Promise.allSettled([
        fetchSystemMetrics(),
        fetchAlerts(),
        fetchSecurityEvents(),
      ]);
      console.info('[CloudSentinel] "Refresh Metrics" completed successfully.');
    } catch (refreshErr) {
      console.error('[CloudSentinel] Manual refresh encountered an error:', refreshErr);
    } finally {
      if (mountedRef.current) {
        setIsRefreshing(false);
      }
    }
  }, [fetchSystemMetrics, fetchAlerts, fetchSecurityEvents]);

  // ----------------------------------------------------------------
  // Alert status actions (hit the backend PATCH endpoints)
  // ----------------------------------------------------------------
  const handleUpdateAlertStatus = useCallback(
    async (id: string, status: AlertStatus) => {
      if (pendingAlertId !== null) return; // prevent concurrent submissions
      setPendingAlertId(id);
      try {
        if (status === 'acknowledged') {
          await acknowledgeAlert(id);
        } else if (status === 'resolved') {
          await resolveAlert(id);
        } else if (status === 'active') {
          await reopenAlert(id);
        }
        // Optimistic UI update
        setAlerts((prev) =>
          prev.map((item) => (item.id === id ? { ...item, status } : item))
        );
      } catch {
        // If PATCH fails, do a fresh fetch to resync
        await fetchAlerts();
      } finally {
        if (mountedRef.current) setPendingAlertId(null);
      }
    },
    [pendingAlertId, fetchAlerts]
  );

  // ----------------------------------------------------------------
  // Security event status (local-only until backend exposes PATCH)
  // ----------------------------------------------------------------
  const handleUpdateSecurityStatus = (id: string, status: SecurityEventStatus) => {
    setSecurityEvents((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status } : item))
    );
  };

  // ----------------------------------------------------------------
  // Callback: re-fetch alerts (used by onResetAlerts prop)
  // ----------------------------------------------------------------
  const handleRefreshAlerts = useCallback(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  // ----------------------------------------------------------------
  // Callback: re-fetch security events (used by onResetEvents prop)
  // ----------------------------------------------------------------
  const handleRefreshSecurityEvents = useCallback(() => {
    fetchSecurityEvents();
    setSelectedSecurityEventId(securityEvents[0]?.id ?? null);
  }, [fetchSecurityEvents, securityEvents]);

  const handleInspectSecurityEvent = (eventId: string) => {
    setSelectedSecurityEventId(eventId);
    setActiveView('security');
  };

  // ----------------------------------------------------------------
  // Derived state
  // ----------------------------------------------------------------
  const openAlertsCount = useMemo(
    () => alerts.filter((a) => a.status !== 'resolved').length,
    [alerts]
  );

  const openSecurityCount = useMemo(
    () => securityEvents.filter((e) => e.status !== 'mitigated').length,
    [securityEvents]
  );

  const health = useMemo(
    () => computeSystemHealth(host, alerts, securityEvents),
    [host, alerts, securityEvents]
  );

  const viewTitleMap: Record<DashboardView, string> = {
    overview: 'Overview',
    security: 'Security Events',
    alerts: 'Alert Log',
  };

  // ----------------------------------------------------------------
  // Sidebar content
  // ----------------------------------------------------------------
  const sidebarContent = (
    <div className="flex h-full flex-col justify-between px-4 py-5">
      <div>
        <div className="flex items-center justify-between px-2">
          <a
            href="#overview"
            onClick={(e) => {
              e.preventDefault();
              setActiveView('overview');
              setMobileMenuOpen(false);
            }}
            className="inline-flex items-center gap-2.5 text-base font-bold tracking-tight text-slate-900 dark:text-slate-50 whitespace-nowrap shrink-0"
          >
            <ShieldCheck
              className="h-5 w-5 text-blue-600 dark:text-blue-500"
              aria-hidden="true"
            />
            <span>CloudSentinel</span>
          </a>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close navigation menu"
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 lg:hidden cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <nav aria-label="Primary navigation" className="mt-7 space-y-1">
          <button
            type="button"
            onClick={() => {
              setActiveView('overview');
              setMobileMenuOpen(false);
            }}
            className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeView === 'overview'
                ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/50 dark:hover:text-slate-200'
            }`}
          >
            <span className="inline-flex items-center gap-2.5">
              <Activity className="h-4 w-4 shrink-0" aria-hidden="true" />
              Overview
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveView('security');
              setMobileMenuOpen(false);
            }}
            className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeView === 'security'
                ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/50 dark:hover:text-slate-200'
            }`}
          >
            <span className="inline-flex items-center gap-2.5">
              <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
              Security Events
            </span>
            <span
              className={`font-mono text-xs tabular-nums ${
                openSecurityCount > 0
                  ? 'font-semibold text-red-600 dark:text-red-400'
                  : 'text-slate-400 dark:text-slate-500'
              }`}
            >
              {openSecurityCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveView('alerts');
              setMobileMenuOpen(false);
            }}
            className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeView === 'alerts'
                ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/50 dark:hover:text-slate-200'
            }`}
          >
            <span className="inline-flex items-center gap-2.5">
              <Bell className="h-4 w-4 shrink-0" aria-hidden="true" />
              Alert Log
            </span>
            <span
              className={`font-mono text-xs tabular-nums ${
                openAlertsCount > 0
                  ? 'font-semibold text-amber-600 dark:text-amber-400'
                  : 'text-slate-400 dark:text-slate-500'
              }`}
            >
              {openAlertsCount}
            </span>
          </button>
        </nav>

        <div className="mt-8 border-t border-slate-200 pt-5 px-2.5 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-slate-400 dark:text-slate-500">
              Monitored Linux Host
            </div>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase ${
                host.deviceStatus === 'offline'
                  ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400'
                  : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  host.deviceStatus === 'offline' ? 'bg-rose-500' : 'bg-emerald-500'
                }`}
              />
              {host.deviceStatus === 'offline' ? 'OFFLINE' : 'ONLINE'}
            </span>
          </div>
          <dl className="mt-3 space-y-2 text-xs">
            <div>
              <dt className="text-slate-400 dark:text-slate-500">Hostname</dt>
              <dd className="font-mono font-medium text-slate-800 dark:text-slate-200">
                {host.hostname}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400 dark:text-slate-500">Distribution</dt>
              <dd className="text-slate-700 dark:text-slate-300">{host.os}</dd>
            </div>
            <div>
              <dt className="text-slate-400 dark:text-slate-500">Kernel</dt>
              <dd className="font-mono text-[11px] text-slate-600 dark:text-slate-400">
                {host.kernel} ({host.arch})
              </dd>
            </div>
            <div>
              <dt className="text-slate-400 dark:text-slate-500">Interface</dt>
              <dd className="font-mono text-[11px] text-slate-600 tabular-nums dark:text-slate-400">
                {host.networkInterface} · {host.ipAddress}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400 dark:text-slate-500">Hardware</dt>
              <dd className="font-mono text-[11px] text-slate-600 tabular-nums dark:text-slate-400">
                {host.vCpuTotal} vCPU · {host.ramTotalGb} GB · {host.diskTotalGb} GB
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="border-t border-slate-200 px-2.5 pt-4 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        {/* Backend connection status indicator */}
        <div className="flex items-center gap-1.5">
          {backendOnline === null ? (
            <span className="inline-block h-2 w-2 rounded-full bg-slate-300 dark:bg-slate-600 animate-pulse" />
          ) : backendOnline ? (
            <Wifi className="h-3.5 w-3.5 text-emerald-500" />
          ) : isWakingUp ? (
            <RefreshCw className="h-3.5 w-3.5 text-amber-500 animate-spin" />
          ) : isAuthError ? (
            <ShieldAlert className="h-3.5 w-3.5 text-red-500" />
          ) : (
            <WifiOff className="h-3.5 w-3.5 text-red-500" />
          )}
          <span className="font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-300">
            {backendOnline === null
              ? 'CONNECTING…'
              : backendOnline
              ? 'LIVE HOST DATA'
              : isWakingUp
              ? 'WAKING UP (RENDER)…'
              : isAuthError
              ? 'AUTH ERROR (401)'
              : 'BACKEND OFFLINE'}
          </span>
        </div>
        <div className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400" title={API_BASE_URL}>
          {backendOnline
            ? 'Real psutil metrics · auth.log events'
            : isWakingUp
            ? 'Cold start in progress (~30-50s)'
            : isAuthError
            ? 'Invalid DASHBOARD_API_KEY'
            : API_BASE_URL}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 transition-colors duration-150 dark:bg-slate-950 dark:text-slate-100">
      <div className="flex min-h-screen">
        {/* Desktop Sidebar */}
        <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:block">
          <div className="sticky top-0 h-screen overflow-y-auto">
            {sidebarContent}
          </div>
        </aside>

        {/* Mobile Drawer */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 flex lg:hidden">
            <div
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs"
              onClick={() => setMobileMenuOpen(false)}
              aria-hidden="true"
            />
            <aside className="relative z-10 w-68 max-w-[82vw] border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              {sidebarContent}
            </aside>
          </div>
        )}

        {/* Main Workspace */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top Bar */}
          <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-slate-200 bg-white/95 px-4 backdrop-blur-xs dark:border-slate-800 dark:bg-slate-900/95 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Open navigation menu"
                className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 lg:hidden cursor-pointer"
              >
                <Menu className="h-4 w-4" aria-hidden="true" />
              </button>

              <nav
                aria-label="Breadcrumb"
                className="flex min-w-0 items-center gap-2 text-sm text-slate-500 dark:text-slate-400"
              >
                <span className="hidden font-medium text-slate-700 dark:text-slate-300 sm:inline">
                  CloudSentinel
                </span>
                <span
                  className="hidden text-slate-300 dark:text-slate-700 sm:inline"
                  aria-hidden="true"
                >
                  /
                </span>
                <span className="truncate font-mono text-xs text-slate-500 dark:text-slate-400">
                  {host.hostname}
                </span>
                <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
                  /
                </span>
                <span className="truncate font-medium text-slate-900 dark:text-slate-100">
                  {viewTitleMap[activeView]}
                </span>
              </nav>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={handleManualRefresh}
                disabled={isRefreshing}
                aria-label="Refresh Metrics"
                title="Refresh Metrics"
                className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 transition-transform duration-300 ${
                    isRefreshing ? 'rotate-180' : ''
                  }`}
                  aria-hidden="true"
                />
                <span>Refresh Metrics</span>
              </button>
            </div>
          </header>

          {/* Main Content Viewport */}
          <main className="mx-auto w-full max-w-6xl flex-1 space-y-5 px-4 py-6 sm:px-6">

            {/* Authentication Failure Banner */}
            {backendOnline === false && isAuthError && (
              <div
                role="alert"
                aria-label="Authentication error"
                className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50/70 px-4 py-2.5 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
              >
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <strong className="font-semibold">Authentication Failed (HTTP 401) — </strong>
                  The configured <code className="font-mono">VITE_API_KEY</code> was rejected by the backend at{' '}
                  <code className="font-mono">{API_BASE_URL}</code>. Ensure the key matches{' '}
                  <code className="font-mono">DASHBOARD_API_KEY</code> configured in your Render service settings.
                </div>
                <button
                  type="button"
                  onClick={handleManualRefresh}
                  className="shrink-0 rounded border border-red-300 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:bg-red-950 dark:text-red-300 dark:hover:bg-red-900 cursor-pointer"
                >
                  Retry
                </button>
              </div>
            )}

            {/* Render Free-Tier Waking Up Banner */}
            {backendOnline === false && !isAuthError && isWakingUp && (
              <div
                role="status"
                aria-label="Backend waking up"
                className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-2.5 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300"
              >
                <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 animate-spin" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <strong className="font-semibold">Waking Up Render Backend — </strong>
                  Free-tier web services on Render spin down after 15 minutes of inactivity. Initial cold-start takes approximately 30–50 seconds.
                  Automatically polling <code className="font-mono">{API_BASE_URL}</code>…
                </div>
                <button
                  type="button"
                  onClick={handleManualRefresh}
                  disabled={isRefreshing}
                  className="shrink-0 rounded border border-amber-300 bg-white px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900 cursor-pointer disabled:opacity-50"
                >
                  {isRefreshing ? 'Checking…' : 'Check Now'}
                </button>
              </div>
            )}

            {/* Backend Offline Banner */}
            {backendOnline === false && !isAuthError && !isWakingUp && (
              <div
                role="alert"
                aria-label="Backend connection error"
                className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50/70 px-4 py-2.5 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
              >
                <WifiOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <strong className="font-semibold">Backend Offline — </strong>
                  {connectError || `Cannot connect to CloudSentinel backend at ${API_BASE_URL}.`}{' '}
                  {API_BASE_URL.includes('127.0.0.1') || API_BASE_URL.includes('localhost') ? (
                    <>
                      Ensure the local backend is running:{' '}
                      <code className="font-mono">uvicorn backend.app.main:app --reload --port 8000</code>
                    </>
                  ) : (
                    <>
                      Verify that the backend service at <code className="font-mono">{API_BASE_URL}</code> is deployed and healthy.
                    </>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleManualRefresh}
                  className="shrink-0 rounded border border-red-300 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:bg-red-950 dark:text-red-300 dark:hover:bg-red-900 cursor-pointer"
                >
                  Retry
                </button>
              </div>
            )}

            {/* Initial Loading Skeleton */}
            {initialLoading && backendOnline === null && (
              <div
                role="status"
                aria-label="Loading live host data"
                className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400"
              >
                <Info className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
                <span>Connecting to CloudSentinel backend…</span>
              </div>
            )}

            {/* Live data notice (shown once backend confirmed online) */}
            {backendOnline === true && (
              <div
                role="note"
                aria-label="Live data notice"
                className={`flex items-start gap-2.5 rounded-lg border px-4 py-2.5 text-xs ${
                  host.deviceStatus === 'offline'
                    ? 'border-amber-200 bg-amber-50/60 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300'
                    : 'border-emerald-200 bg-emerald-50/60 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300'
                }`}
              >
                {host.deviceStatus === 'offline' ? (
                  <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
                ) : (
                  <Wifi className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
                )}
                <p>
                  <strong className="font-mono font-semibold">
                    {host.deviceStatus === 'offline' ? 'DEVICE OFFLINE:' : 'LIVE HOST TELEMETRY:'}
                  </strong>{' '}
                  {host.deviceStatus === 'offline'
                    ? `Ubuntu host ${host.hostname} has not reported within 60s. Displaying preserved telemetry.`
                    : `Real system metrics collected via psutil from ${host.hostname} (${host.os}). Security events sourced from /var/log/auth.log · alerts persisted in database.`}
                </p>
              </div>
            )}

            {/* Workspace Toolbar */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50 sm:text-2xl">
                  {activeView === 'overview'
                    ? 'Ubuntu Server Overview'
                    : activeView === 'security'
                      ? 'Security Events & Authentication'
                      : 'Operational Alert Log'}
                </h1>
                <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-mono">{host.hostname}</span>
                  <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
                    ·
                  </span>
                  <span>{host.os}</span>
                  <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
                    ·
                  </span>
                  <span className="font-mono tabular-nums">
                    {host.networkInterface} {host.ipAddress}
                  </span>
                  <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
                    ·
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                      host.deviceStatus === 'offline'
                        ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400'
                        : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        host.deviceStatus === 'offline' ? 'bg-rose-500' : 'bg-emerald-500'
                      }`}
                    />
                    {host.deviceStatus === 'offline' ? 'OFFLINE' : 'ONLINE'}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsLive((prev) => !prev)}
                  aria-pressed={isLive}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 whitespace-nowrap shrink-0 cursor-pointer ${
                    isLive
                      ? 'border-blue-200 bg-blue-50/70 text-blue-700 dark:border-blue-900/70 dark:bg-blue-950/30 dark:text-blue-300'
                      : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {isLive ? (
                    <Pause className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <Play className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  )}
                  <span>
                    {isLive ? 'Live polling: On' : 'Live polling: Paused'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setDarkMode((prev) => !prev)}
                  aria-label={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {darkMode ? (
                    <Sun className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <Moon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  )}
                  <span>{darkMode ? 'Light' : 'Dark'}</span>
                </button>
              </div>
            </div>

            {activeView === 'overview' && (
              <>
                <SystemHealthBanner
                  status={health.status}
                  label={health.label}
                  summary={health.summary}
                  hostname={host.hostname}
                  os={host.os}
                  uptime={host.uptime}
                  openAlertsCount={openAlertsCount}
                  openSecurityCount={openSecurityCount}
                  lastUpdated={lastUpdated}
                  onViewAlerts={() => setActiveView('alerts')}
                  onViewSecurity={() => setActiveView('security')}
                />

                {/* Core Resource Metric Cards */}
                <section
                  aria-label="Core resource utilization"
                  className="grid grid-cols-1 gap-4 md:grid-cols-3"
                >
                  <MetricCard
                    title="CPU Usage"
                    percentage={host.cpuPct}
                    delta={host.cpuDelta}
                    primaryDetail={`${host.vCpuUsed.toFixed(1)} / ${host.vCpuTotal} vCPU`}
                    secondaryDetail={`Load ${host.loadAvg}`}
                    warningThreshold={75}
                    criticalThreshold={90}
                  />
                  <MetricCard
                    title="RAM Usage"
                    percentage={host.ramPct}
                    delta={host.ramDelta}
                    primaryDetail={`${host.ramUsedGb.toFixed(1)} / ${host.ramTotalGb} GB`}
                    secondaryDetail={`${host.ramCachedGb.toFixed(1)} GB page cache`}
                    warningThreshold={80}
                    criticalThreshold={92}
                  />
                  <MetricCard
                    title="Disk Usage"
                    percentage={host.diskPct}
                    delta={host.diskDelta}
                    primaryDetail={`${host.diskUsedGb.toFixed(1)} / ${host.diskTotalGb} GB`}
                    secondaryDetail={`${host.diskDevice} · ${host.diskMount}`}
                    warningThreshold={75}
                    criticalThreshold={90}
                  />
                </section>

                {/* CPU Usage Over Time Chart */}
                <CpuLineChart
                  series={host.cpuSeries[timeRange]}
                  nodeName={host.hostname}
                  timeRange={timeRange}
                  onTimeRangeChange={setTimeRange}
                />

                {/* Security Monitoring Summary */}
                <SecuritySummarySection
                  events={securityEvents}
                  onInspectAll={() => setActiveView('security')}
                  onInspectEvent={handleInspectSecurityEvent}
                />

                {/* Recent Alerts Table */}
                <AlertsTable
                  alerts={alerts}
                  onUpdateStatus={handleUpdateAlertStatus}
                  onResetAlerts={handleRefreshAlerts}
                />
              </>
            )}

            {activeView === 'security' && (
              <SecurityEventsView
                events={securityEvents}
                selectedEventId={selectedSecurityEventId}
                onSelectEvent={setSelectedSecurityEventId}
                onUpdateEventStatus={handleUpdateSecurityStatus}
                onResetEvents={handleRefreshSecurityEvents}
              />
            )}

            {activeView === 'alerts' && (
              <>
                <SystemHealthBanner
                  status={health.status}
                  label={health.label}
                  summary={health.summary}
                  hostname={host.hostname}
                  os={host.os}
                  uptime={host.uptime}
                  openAlertsCount={openAlertsCount}
                  openSecurityCount={openSecurityCount}
                  lastUpdated={lastUpdated}
                  onViewAlerts={() => setActiveView('alerts')}
                  onViewSecurity={() => setActiveView('security')}
                />
                <AlertsTable
                  alerts={alerts}
                  onUpdateStatus={handleUpdateAlertStatus}
                  onResetAlerts={handleRefreshAlerts}
                  title="Operational Alert Log"
                />
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
