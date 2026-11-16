import {
  AlertTriangle,
  ChevronRight,
  Info,
  OctagonAlert,
  ShieldAlert,
} from 'lucide-react';
import { AlertSeverity, SecurityEvent } from '../types/monitoring';

interface SecuritySummarySectionProps {
  events: SecurityEvent[];
  onInspectAll: () => void;
  onInspectEvent: (eventId: string) => void;
}

export function SecuritySummarySection({
  events,
  onInspectAll,
  onInspectEvent,
}: SecuritySummarySectionProps) {
  const failedSshAttempts = events
    .filter((e) => e.service === 'sshd')
    .reduce((sum, e) => sum + e.attempts, 0);

  const suspiciousIps = new Set(
    events
      .filter((e) => e.severity === 'critical' || e.category === 'suspicious_ip' || e.attempts >= 10)
      .map((e) => e.sourceIp)
  );

  const authFailureCount = events.reduce((sum, e) => sum + e.attempts, 0);

  const repeatedAttemptEvents = events.filter(
    (e) => e.category === 'repeated_attempt' || e.attempts >= 10
  );

  const openCriticalCount = events.filter(
    (e) => e.severity === 'critical' && e.status === 'open'
  ).length;

  const topEvents = [...events]
    .sort((a, b) => b.epochMs - a.epochMs)
    .slice(0, 4);

  const renderSeverity = (severity: AlertSeverity) => {
    if (severity === 'critical') {
      return (
        <span className="inline-flex items-center gap-1.5 font-medium text-red-600 dark:text-red-400">
          <OctagonAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Critical
        </span>
      );
    }
    if (severity === 'warning') {
      return (
        <span className="inline-flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Warning
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 font-medium text-blue-600 dark:text-blue-400">
        <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Info
      </span>
    );
  };

  return (
    <section
      aria-label="Security monitoring summary"
      className="rounded-lg border border-slate-200 bg-white transition-colors duration-150 dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Security Monitoring
            </h2>
            <span className="text-xs text-slate-400 dark:text-slate-600" aria-hidden="true">
              ·
            </span>
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
              /var/log/auth.log
            </span>
            <span className="text-xs text-slate-400 dark:text-slate-600" aria-hidden="true">
              ·
            </span>
            <span className="font-mono text-[11px] font-medium text-slate-500 dark:text-slate-400">
              DEMO DATA
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            SSH daemon, PAM authentication failures, and flagged external IP activity on this host.
          </p>
        </div>

        <button
          type="button"
          onClick={onInspectAll}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden="true" />
          <span>Inspect Security Events</span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        </button>
      </div>

      {/* 4-column Security Telemetry Strip */}
      <div className="grid grid-cols-1 divide-y divide-slate-200 border-b border-slate-200 dark:divide-slate-800 dark:border-slate-800 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
        <div className="p-4 sm:border-b sm:border-slate-200 sm:dark:border-slate-800 lg:border-b-0">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Failed SSH Logins
          </div>
          <div className="mt-1.5 font-mono text-2xl font-semibold text-slate-900 tabular-nums dark:text-slate-50">
            {failedSshAttempts}
          </div>
          <div className="mt-1 font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
            sshd port 22 · 24h window
          </div>
        </div>

        <div className="p-4 sm:border-b sm:border-l sm:border-slate-200 sm:dark:border-slate-800 lg:border-b-0 lg:border-l-0">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Suspicious IP Addresses
          </div>
          <div className="mt-1.5 font-mono text-2xl font-semibold text-red-600 tabular-nums dark:text-red-400">
            {suspiciousIps.size}
          </div>
          <div className="mt-1 font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
            Top: 185.220.101.34
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Authentication Failures
          </div>
          <div className="mt-1.5 font-mono text-2xl font-semibold text-slate-900 tabular-nums dark:text-slate-50">
            {authFailureCount}
          </div>
          <div className="mt-1 font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
            sshd + sudo / pam_unix
          </div>
        </div>

        <div className="p-4 sm:border-l sm:border-slate-200 sm:dark:border-slate-800 lg:border-l-0">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Repeated Login Bursts
          </div>
          <div className="mt-1.5 font-mono text-2xl font-semibold text-amber-600 tabular-nums dark:text-amber-400">
            {repeatedAttemptEvents.length}
          </div>
          <div className="mt-1 font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
            {openCriticalCount} critical unmitigated
          </div>
        </div>
      </div>

      {/* Preview Table of Latest Security Events */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
              <th scope="col" className="py-2.5 pr-3 pl-5 font-medium whitespace-nowrap">
                Severity
              </th>
              <th scope="col" className="px-3 py-2.5 font-medium whitespace-nowrap">
                Timestamp
              </th>
              <th scope="col" className="px-3 py-2.5 font-medium whitespace-nowrap">
                Source IP
              </th>
              <th scope="col" className="px-3 py-2.5 font-medium whitespace-nowrap">
                User / Service
              </th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium whitespace-nowrap">
                Attempts
              </th>
              <th scope="col" className="px-3 py-2.5 font-medium">
                Summary
              </th>
              <th scope="col" className="py-2.5 pr-5 pl-3 text-right font-medium whitespace-nowrap">
                Inspect
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {topEvents.map((event) => (
              <tr
                key={event.id}
                onClick={() => onInspectEvent(event.id)}
                className="cursor-pointer transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
              >
                <td className="py-2.5 pr-3 pl-5 whitespace-nowrap">
                  {renderSeverity(event.severity)}
                </td>
                <td className="px-3 py-2.5 font-mono text-slate-600 tabular-nums whitespace-nowrap dark:text-slate-400">
                  {event.timestamp}
                </td>
                <td className="px-3 py-2.5 font-mono font-medium text-slate-900 tabular-nums whitespace-nowrap dark:text-slate-100">
                  {event.sourceIp}
                </td>
                <td className="px-3 py-2.5 font-mono text-slate-600 whitespace-nowrap dark:text-slate-300">
                  {event.targetUser} · {event.service}
                </td>
                <td className="px-3 py-2.5 text-right font-mono font-medium text-slate-900 tabular-nums whitespace-nowrap dark:text-slate-100">
                  {event.attempts}
                </td>
                <td className="min-w-[240px] px-3 py-2.5 text-slate-600 dark:text-slate-300">
                  {event.description}
                </td>
                <td className="py-2.5 pr-5 pl-3 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onInspectEvent(event.id);
                    }}
                    className="font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 cursor-pointer"
                  >
                    Inspect
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
