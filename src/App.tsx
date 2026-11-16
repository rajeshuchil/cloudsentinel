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
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertsTable } from './components/AlertsTable';
import { CpuLineChart } from './components/CpuLineChart';
import { MetricCard } from './components/MetricCard';
import { SecurityEventsView } from './components/SecurityEventsView';
import { SecuritySummarySection } from './components/SecuritySummarySection';
import { SystemHealthBanner } from './components/SystemHealthBanner';
import {
  INITIAL_ALERTS,
  INITIAL_SECURITY_EVENTS,
  INITIAL_UBUNTU_HOST,
  computeSystemHealth,
  stepHostTelemetrySample,
} from './data/mockTelemetry';
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

export default function App() {
  const [host, setHost] = useState<UbuntuHost>(INITIAL_UBUNTU_HOST);
  const [alerts, setAlerts] = useState<AlertItem[]>(INITIAL_ALERTS);
  const [securityEvents, setSecurityEvents] = useState<SecurityEvent[]>(
    INITIAL_SECURITY_EVENTS
  );
  const [selectedSecurityEventId, setSelectedSecurityEventId] = useState<string | null>(
    INITIAL_SECURITY_EVENTS[0]?.id ?? null
  );
  const [activeView, setActiveView] = useState<DashboardView>('overview');
  const [timeRange, setTimeRange] = useState<TimeRange>('15m');
  const [liveSimulation, setLiveSimulation] = useState<boolean>(true);
  const [darkMode, setDarkMode] = useState<boolean>(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<string>('12:40:00');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [darkMode]);

  const handleSampleTick = useCallback(() => {
    const now = new Date();
    setHost((prev) => stepHostTelemetrySample(prev, now));
    setLastUpdated(formatShortTime(now));
  }, []);

  useEffect(() => {
    if (!liveSimulation) return;
    const timer = window.setInterval(handleSampleTick, 5000);
    return () => window.clearInterval(timer);
  }, [liveSimulation, handleSampleTick]);

  const handleManualRefresh = () => {
    setIsRefreshing(true);
    handleSampleTick();
    window.setTimeout(() => setIsRefreshing(false), 300);
  };

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

  const handleUpdateAlertStatus = (id: string, status: AlertStatus) => {
    setAlerts((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status } : item))
    );
  };

  const handleUpdateSecurityStatus = (id: string, status: SecurityEventStatus) => {
    setSecurityEvents((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status } : item))
    );
  };

  const handleResetAlerts = () => {
    setAlerts(INITIAL_ALERTS);
  };

  const handleResetSecurityEvents = () => {
    setSecurityEvents(INITIAL_SECURITY_EVENTS);
    setSelectedSecurityEventId(INITIAL_SECURITY_EVENTS[0]?.id ?? null);
  };

  const handleInspectSecurityEvent = (eventId: string) => {
    setSelectedSecurityEventId(eventId);
    setActiveView('security');
  };

  const viewTitleMap: Record<DashboardView, string> = {
    overview: 'Overview',
    security: 'Security Events',
    alerts: 'Alert Log',
  };

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
          <div className="text-xs font-medium text-slate-400 dark:text-slate-500">
            Monitored Linux Host
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
        <div className="font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-300">
          DEMO DATA
        </div>
        <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
          Simulated Ubuntu host metrics &amp; auth.log events.
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
                className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 transition-transform duration-300 ${
                    isRefreshing ? 'rotate-180' : ''
                  }`}
                  aria-hidden="true"
                />
                <span>Refresh Sample</span>
              </button>
            </div>
          </header>

          {/* Main Content Viewport */}
          <main className="mx-auto w-full max-w-6xl flex-1 space-y-5 px-4 py-6 sm:px-6">
            {/* Demo Data Disclosure */}
            <div
              role="note"
              aria-label="Demo data notice"
              className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-100/70 px-4 py-2.5 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-300"
            >
              <Info
                className="mt-0.5 h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400"
                aria-hidden="true"
              />
              <p>
                <strong className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                  DEMO DATA:
                </strong>{' '}
                All resource metrics, historical CPU samples, system alerts, and security log events displayed below are simulated for demonstration on{' '}
                <span className="font-mono">{host.hostname}</span> ({host.os}) and do not reflect live host telemetry.
              </p>
            </div>

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
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setLiveSimulation((prev) => !prev)}
                  aria-pressed={liveSimulation}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 whitespace-nowrap shrink-0 cursor-pointer ${
                    liveSimulation
                      ? 'border-blue-200 bg-blue-50/70 text-blue-700 dark:border-blue-900/70 dark:bg-blue-950/30 dark:text-blue-300'
                      : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {liveSimulation ? (
                    <Pause className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <Play className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  )}
                  <span>
                    {liveSimulation ? 'Demo updates: On' : 'Demo updates: Paused'}
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
                    title="CPU Usage (Demo)"
                    percentage={host.cpuPct}
                    delta={host.cpuDelta}
                    primaryDetail={`${host.vCpuUsed.toFixed(1)} / ${host.vCpuTotal} vCPU`}
                    secondaryDetail={`Load ${host.loadAvg}`}
                    warningThreshold={75}
                    criticalThreshold={90}
                  />
                  <MetricCard
                    title="RAM Usage (Demo)"
                    percentage={host.ramPct}
                    delta={host.ramDelta}
                    primaryDetail={`${host.ramUsedGb.toFixed(1)} / ${host.ramTotalGb} GB`}
                    secondaryDetail={`${host.ramCachedGb.toFixed(1)} GB page cache`}
                    warningThreshold={80}
                    criticalThreshold={92}
                  />
                  <MetricCard
                    title="Disk Usage (Demo)"
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
                  onResetAlerts={handleResetAlerts}
                />
              </>
            )}

            {activeView === 'security' && (
              <SecurityEventsView
                events={securityEvents}
                selectedEventId={selectedSecurityEventId}
                onSelectEvent={setSelectedSecurityEventId}
                onUpdateEventStatus={handleUpdateSecurityStatus}
                onResetEvents={handleResetSecurityEvents}
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
                  onResetAlerts={handleResetAlerts}
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
