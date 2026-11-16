import { AlertTriangle, CheckCircle2, OctagonAlert } from 'lucide-react';
import { HealthStatus } from '../types/monitoring';

interface SystemHealthBannerProps {
  status: HealthStatus;
  label: string;
  summary: string;
  hostname: string;
  os: string;
  uptime: string;
  openAlertsCount: number;
  openSecurityCount: number;
  lastUpdated: string;
  onViewAlerts: () => void;
  onViewSecurity: () => void;
}

export function SystemHealthBanner({
  status,
  label,
  summary,
  hostname,
  os,
  uptime,
  openAlertsCount,
  openSecurityCount,
  lastUpdated,
  onViewAlerts,
  onViewSecurity,
}: SystemHealthBannerProps) {
  const statusStyles = {
    healthy: {
      container:
        'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800',
      iconWrap: 'text-emerald-600 dark:text-emerald-400',
      labelColor: 'text-emerald-700 dark:text-emerald-400',
      Icon: CheckCircle2,
    },
    degraded: {
      container:
        'bg-amber-50/40 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/60',
      iconWrap: 'text-amber-600 dark:text-amber-400',
      labelColor: 'text-amber-700 dark:text-amber-400',
      Icon: AlertTriangle,
    },
    critical: {
      container:
        'bg-red-50/40 dark:bg-red-950/20 border-red-200 dark:border-red-900/60',
      iconWrap: 'text-red-600 dark:text-red-400',
      labelColor: 'text-red-700 dark:text-red-400',
      Icon: OctagonAlert,
    },
  }[status];

  const StatusIcon = statusStyles.Icon;

  return (
    <section
      aria-label="System health status"
      className={`rounded-lg border px-5 py-4 transition-colors duration-150 ${statusStyles.container}`}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3.5">
          <div className={`mt-0.5 shrink-0 ${statusStyles.iconWrap}`}>
            <StatusIcon className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                System Health:
              </h2>
              <span className={`text-sm font-semibold ${statusStyles.labelColor}`}>
                {label}
              </span>
              <span className="text-xs text-slate-400 dark:text-slate-600" aria-hidden="true">
                ·
              </span>
              <span className="font-mono text-xs text-slate-600 dark:text-slate-300">
                {hostname}
              </span>
              <span className="text-xs text-slate-400 dark:text-slate-600" aria-hidden="true">
                ·
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {os}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              {summary}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500 dark:text-slate-400 lg:shrink-0">
          <div className="flex items-center gap-1.5 font-mono tabular-nums">
            <span className="text-slate-400 dark:text-slate-500">Uptime</span>
            <span className="font-medium text-slate-800 dark:text-slate-200">{uptime}</span>
          </div>
          <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
            ·
          </span>
          <div className="flex items-center gap-1.5 font-mono tabular-nums">
            <span className="text-slate-400 dark:text-slate-500">Sampled</span>
            <span className="font-medium text-slate-800 dark:text-slate-200">{lastUpdated}</span>
          </div>
          {openSecurityCount > 0 && (
            <>
              <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
                ·
              </span>
              <button
                type="button"
                onClick={onViewSecurity}
                className="font-medium text-red-700 underline decoration-red-300 underline-offset-4 transition-colors hover:decoration-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-red-400 dark:decoration-red-800 dark:hover:decoration-red-400 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {openSecurityCount} security event{openSecurityCount === 1 ? '' : 's'}
              </button>
            </>
          )}
          {openAlertsCount > 0 && (
            <>
              <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
                ·
              </span>
              <button
                type="button"
                onClick={onViewAlerts}
                className="font-medium text-slate-900 underline decoration-slate-300 underline-offset-4 transition-colors hover:decoration-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-slate-100 dark:decoration-slate-600 dark:hover:decoration-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {openAlertsCount} open alert{openAlertsCount === 1 ? '' : 's'}
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
