/**
 * DemoApp — Public Demo Mode dashboard.
 *
 * Uses the SAME components as the authenticated live dashboard but feeds them
 * entirely from synthetic data (src/data/demoData.ts) updated by the
 * useDemoSimulation hook. It never contacts the Render backend, never reads
 * sessionStorage, and never exposes any credential.
 *
 * Separation guarantee:
 * - No fetch() / API calls are made in Demo Mode.
 * - No DASHBOARD_API_KEY, AGENT_API_KEY, DATABASE_URL are read.
 * - No real Ubuntu telemetry is displayed.
 */

import {
  Activity,
  Bell,
  FlaskConical,
  Menu,
  Moon,
  Pause,
  Play,
  RefreshCw,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sun,
  X,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { AlertsTable } from './components/AlertsTable';
import { CpuLineChart } from './components/CpuLineChart';
import { DemoBanner } from './components/DemoBanner';
import { MetricCard } from './components/MetricCard';
import { SecurityEventsView } from './components/SecurityEventsView';
import { SecuritySummarySection } from './components/SecuritySummarySection';
import { SystemHealthBanner } from './components/SystemHealthBanner';
import {
  DEMO_ALERTS,
  DEMO_DEVICES,
  DEMO_NODES,
  DEMO_SECURITY_EVENTS,
} from './data/demoData';
import { computeSystemHealth } from './data/mockTelemetry';
import { useDemoSimulation } from './hooks/useDemoSimulation';
import {
  AlertItem,
  AlertStatus,
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

interface DemoAppProps {
  onExitDemo: () => void;
}

export default function DemoApp({ onExitDemo }: DemoAppProps) {
  // ── Fleet state ──────────────────────────────────────────────────────────
  const [demoNodes, setDemoNodes] = useState<UbuntuHost[]>([...DEMO_NODES]);
  const [selectedNodeId, setSelectedNodeId] = useState<string>('demo-prod-api-01');

  // ── Static data (alerts + security events are pre-seeded, not re-fetched) ─
  const [alerts, setAlerts] = useState<AlertItem[]>(DEMO_ALERTS);
  const [securityEvents, setSecurityEvents] = useState<SecurityEvent[]>(DEMO_SECURITY_EVENTS);
  const [selectedSecurityEventId, setSelectedSecurityEventId] = useState<string | null>(
    DEMO_SECURITY_EVENTS[0]?.id ?? null
  );

  // ── UI state ─────────────────────────────────────────────────────────────
  const [activeView, setActiveView] = useState<DashboardView>('overview');
  const [timeRange, setTimeRange] = useState<TimeRange>('15m');
  const [darkMode, setDarkMode] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isLive, setIsLive] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>(formatShortTime(new Date()));

  // Dark mode class toggle
  const toggleDark = useCallback(() => {
    setDarkMode((prev) => {
      const next = !prev;
      if (next) document.documentElement.classList.add('dark');
      else document.documentElement.classList.remove('dark');
      return next;
    });
  }, []);

  // ── Live simulation ──────────────────────────────────────────────────────
  useDemoSimulation({
    isLive,
    intervalMs: 10_000,
    onTick: useCallback((nodes: UbuntuHost[]) => {
      setDemoNodes(nodes);
      setLastUpdated(formatShortTime(new Date()));
    }, []),
  });

  // ── Derived: selected host ───────────────────────────────────────────────
  const host = useMemo<UbuntuHost>(
    () =>
      demoNodes.find((n) => n.deviceId === selectedNodeId) ??
      demoNodes[0] ??
      DEMO_NODES[0],
    [demoNodes, selectedNodeId]
  );

  // ── Derived counts ───────────────────────────────────────────────────────
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

  // ── Alert actions (local only — no API calls) ────────────────────────────
  const handleUpdateAlertStatus = useCallback((id: string, status: AlertStatus) => {
    setAlerts((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status } : item))
    );
  }, []);

  const handleUpdateSecurityStatus = useCallback(
    (id: string, status: SecurityEventStatus) => {
      setSecurityEvents((prev) =>
        prev.map((item) => (item.id === id ? { ...item, status } : item))
      );
    },
    []
  );

  const handleRefreshAlerts = useCallback(() => {
    setAlerts(DEMO_ALERTS);
  }, []);

  const handleRefreshSecurityEvents = useCallback(() => {
    setSecurityEvents(DEMO_SECURITY_EVENTS);
    setSelectedSecurityEventId(DEMO_SECURITY_EVENTS[0]?.id ?? null);
  }, []);

  const handleInspectSecurityEvent = useCallback((eventId: string) => {
    setSelectedSecurityEventId(eventId);
    setActiveView('security');
  }, []);

  const viewTitleMap: Record<DashboardView, string> = {
    overview: 'Overview',
    security: 'Security Events',
    alerts: 'Alert Log',
  };

  // ── Sidebar ──────────────────────────────────────────────────────────────
  const sidebarContent = (
    <div className="flex h-full flex-col justify-between px-4 py-5">
      <div>
        {/* Logo + Close (mobile) */}
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

        {/* Nav */}
        <nav aria-label="Primary navigation" className="mt-7 space-y-1">
          {(
            [
              { view: 'overview' as DashboardView, Icon: Activity, label: 'Overview', count: null },
              { view: 'security' as DashboardView, Icon: ShieldAlert, label: 'Security Events', count: openSecurityCount },
              { view: 'alerts' as DashboardView, Icon: Bell, label: 'Alert Log', count: openAlertsCount },
            ] as const
          ).map(({ view, Icon, label, count }) => (
            <button
              key={view}
              type="button"
              onClick={() => { setActiveView(view); setMobileMenuOpen(false); }}
              className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeView === view
                  ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/50 dark:hover:text-slate-200'
              }`}
            >
              <span className="inline-flex items-center gap-2.5">
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {label}
              </span>
              {count !== null && (
                <span
                  className={`font-mono text-xs tabular-nums ${
                    count > 0
                      ? view === 'security'
                        ? 'font-semibold text-red-600 dark:text-red-400'
                        : 'font-semibold text-amber-600 dark:text-amber-400'
                      : 'text-slate-400 dark:text-slate-500'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Device Selector */}
        <div className="mt-8 border-t border-slate-200 pt-5 px-2.5 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-slate-400 dark:text-slate-500">
              Demo Fleet
            </div>
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
              <FlaskConical className="h-2.5 w-2.5" aria-hidden="true" />
              SIMULATED
            </span>
          </div>

          {/* Device list */}
          <div className="mt-3 space-y-1">
            {DEMO_DEVICES.map((device) => {
              const liveNode = demoNodes.find((n) => n.deviceId === device.id);
              const isOffline = liveNode?.deviceStatus === 'offline';
              const isSelected = selectedNodeId === device.id;
              return (
                <button
                  key={device.id}
                  type="button"
                  onClick={() => {
                    setSelectedNodeId(device.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800/40 dark:hover:text-slate-200'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Server className="h-3 w-3 shrink-0 text-slate-400" aria-hidden="true" />
                    <span className="font-mono truncate">{device.hostname}</span>
                  </span>
                  <span
                    className={`ml-2 h-1.5 w-1.5 shrink-0 rounded-full ${
                      isOffline ? 'bg-rose-400' : 'bg-emerald-400'
                    }`}
                    title={isOffline ? 'Offline' : 'Online'}
                  />
                </button>
              );
            })}
          </div>

          {/* Selected host detail */}
          <dl className="mt-4 space-y-2 text-xs">
            <div>
              <dt className="text-slate-400 dark:text-slate-500">Hostname</dt>
              <dd className="font-mono font-medium text-slate-800 dark:text-slate-200">{host.hostname}</dd>
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

      {/* Footer — simulation status */}
      <div className="border-t border-slate-200 px-2.5 pt-4 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <div className="flex items-center gap-1.5">
          <FlaskConical className="h-3.5 w-3.5 text-blue-500" aria-hidden="true" />
          <span className="font-mono text-[11px] font-semibold text-blue-700 dark:text-blue-300">
            {isLive ? 'SIMULATION ACTIVE' : 'SIMULATION PAUSED'}
          </span>
        </div>
        <div className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
          Synthetic data · No real hosts connected
        </div>
      </div>
    </div>
  );

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 transition-colors duration-150 dark:bg-slate-950 dark:text-slate-100">
      {/* Demo Mode Banner */}
      <DemoBanner onEnterAdminMode={onExitDemo} />

      <div className="flex min-h-[calc(100vh-42px)]">
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

        {/* Main workspace */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top bar */}
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
              <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                <span className="hidden font-medium text-slate-700 dark:text-slate-300 sm:inline">
                  CloudSentinel
                </span>
                <span className="hidden text-slate-300 dark:text-slate-700 sm:inline" aria-hidden="true">/</span>
                <span className="truncate font-mono text-xs text-slate-500 dark:text-slate-400">{host.hostname}</span>
                <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">/</span>
                <span className="truncate font-medium text-slate-900 dark:text-slate-100">{viewTitleMap[activeView]}</span>
              </nav>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              {/* Demo indicator pill */}
              <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
                <FlaskConical className="h-3 w-3" aria-hidden="true" />
                Demo Mode
              </span>

              <button
                type="button"
                onClick={toggleDark}
                aria-label={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {darkMode ? <Sun className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <Moon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                <span>{darkMode ? 'Light' : 'Dark'}</span>
              </button>
            </div>
          </header>

          {/* Main content */}
          <main className="mx-auto w-full max-w-6xl flex-1 space-y-5 px-4 py-6 sm:px-6">
            {/* Demo data notice banner */}
            <div
              role="note"
              aria-label="Demo data notice"
              className="flex items-start gap-2.5 rounded-lg border border-blue-200 bg-blue-50/60 px-4 py-2.5 text-xs text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/20 dark:text-blue-300"
            >
              <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" aria-hidden="true" />
              <p>
                <strong className="font-mono font-semibold">SIMULATED DEMO DATA:</strong>{' '}
                All metrics shown are synthetically generated for demonstration purposes.
                The 4 fleet nodes ({DEMO_DEVICES.map((d) => d.hostname).join(', ')}) do not represent real infrastructure.
                Real-time values update every 10 seconds.{' '}
                <button
                  type="button"
                  onClick={onExitDemo}
                  className="underline underline-offset-2 hover:text-blue-900 dark:hover:text-blue-100 cursor-pointer font-medium"
                >
                  Log in to view live data →
                </button>
              </p>
            </div>

            {/* Workspace toolbar */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50 sm:text-2xl">
                  {activeView === 'overview'
                    ? 'Fleet Overview'
                    : activeView === 'security'
                    ? 'Security Events & Authentication'
                    : 'Operational Alert Log'}
                </h1>
                <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-mono">{host.hostname}</span>
                  <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
                  <span>{host.os}</span>
                  <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">{host.networkInterface} {host.ipAddress}</span>
                  <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
                  <span
                    className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                      host.deviceStatus === 'offline'
                        ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400'
                        : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${host.deviceStatus === 'offline' ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                    {host.deviceStatus === 'offline' ? 'OFFLINE' : 'ONLINE'}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsLive((prev) => !prev)}
                  aria-pressed={isLive}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isLive
                      ? 'border-blue-200 bg-blue-50/70 text-blue-700 dark:border-blue-900/70 dark:bg-blue-950/30 dark:text-blue-300'
                      : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {isLive ? <Pause className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <Play className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                  <span>{isLive ? 'Simulation: On' : 'Simulation: Paused'}</span>
                </button>

                <button
                  type="button"
                  onClick={toggleDark}
                  aria-label={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer lg:hidden"
                >
                  {darkMode ? <Sun className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <Moon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                  <span>{darkMode ? 'Light' : 'Dark'}</span>
                </button>

                <div className="flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500">
                  <RefreshCw className={`h-3 w-3 ${isLive ? 'text-blue-400' : ''}`} aria-hidden="true" />
                  <span className="font-mono">{lastUpdated}</span>
                </div>
              </div>
            </div>

            {/* Overview */}
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

                <section aria-label="Core resource utilization" className="grid grid-cols-1 gap-4 md:grid-cols-3">
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

                <CpuLineChart
                  series={host.cpuSeries[timeRange]}
                  nodeName={host.hostname}
                  timeRange={timeRange}
                  onTimeRangeChange={setTimeRange}
                  isDemo={true}
                />

                <SecuritySummarySection
                  events={securityEvents}
                  onInspectAll={() => setActiveView('security')}
                  onInspectEvent={handleInspectSecurityEvent}
                />

                <AlertsTable
                  alerts={alerts}
                  onUpdateStatus={handleUpdateAlertStatus}
                  onResetAlerts={handleRefreshAlerts}
                />
              </>
            )}

            {/* Security view */}
            {activeView === 'security' && (
              <SecurityEventsView
                events={securityEvents}
                selectedEventId={selectedSecurityEventId}
                onSelectEvent={setSelectedSecurityEventId}
                onUpdateEventStatus={handleUpdateSecurityStatus}
                onResetEvents={handleRefreshSecurityEvents}
              />
            )}

            {/* Alerts view */}
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
