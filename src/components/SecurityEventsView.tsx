import {
  AlertTriangle,
  ArrowUpDown,
  Check,
  Info,
  OctagonAlert,
  RotateCcw,
  Search,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  AlertSeverity,
  SecurityEvent,
  SecurityEventCategory,
  SecurityEventStatus,
} from '../types/monitoring';

interface SecurityEventsViewProps {
  events: SecurityEvent[];
  selectedEventId: string | null;
  onSelectEvent: (eventId: string) => void;
  onUpdateEventStatus: (eventId: string, status: SecurityEventStatus) => void;
  onResetEvents: () => void;
}

type CategoryFilter = 'all' | SecurityEventCategory;
type SeverityFilter = 'all' | AlertSeverity;
type SortField = 'timestamp' | 'severity' | 'attempts';

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  critical: 3,
  warning: 2,
  info: 1,
};

const CATEGORY_LABELS: Record<SecurityEventCategory, string> = {
  failed_ssh: 'Failed SSH Login',
  suspicious_ip: 'Suspicious IP',
  auth_failure: 'Auth Failure',
  repeated_attempt: 'Repeated Login',
};

export function SecurityEventsView({
  events,
  selectedEventId,
  onSelectEvent,
  onUpdateEventStatus,
  onResetEvents,
}: SecurityEventsViewProps) {
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [openOnly, setOpenOnly] = useState(false);
  const [sortField, setSortField] = useState<SortField>('timestamp');
  const [sortAsc, setSortAsc] = useState(false);

  const summary = useMemo(() => {
    const failedSsh = events
      .filter((e) => e.service === 'sshd')
      .reduce((sum, e) => sum + e.attempts, 0);
    const suspiciousIps = new Set(
      events
        .filter((e) => e.severity === 'critical' || e.category === 'suspicious_ip' || e.attempts >= 10)
        .map((e) => e.sourceIp)
    ).size;
    const totalAuthFailures = events.reduce((sum, e) => sum + e.attempts, 0);
    const repeatedBursts = events.filter(
      (e) => e.category === 'repeated_attempt' || e.attempts >= 10
    ).length;

    return { failedSsh, suspiciousIps, totalAuthFailures, repeatedBursts };
  }, [events]);

  const filteredEvents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return events
      .filter((item) => {
        if (severityFilter !== 'all' && item.severity !== severityFilter) {
          return false;
        }
        if (categoryFilter !== 'all' && item.category !== categoryFilter) {
          return false;
        }
        if (openOnly && item.status === 'mitigated') {
          return false;
        }
        if (q) {
          return (
            item.sourceIp.toLowerCase().includes(q) ||
            item.targetUser.toLowerCase().includes(q) ||
            item.service.toLowerCase().includes(q) ||
            item.description.toLowerCase().includes(q) ||
            item.id.toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => {
        const diff =
          sortField === 'timestamp'
            ? a.epochMs - b.epochMs
            : sortField === 'attempts'
              ? a.attempts - b.attempts
              : SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
        return sortAsc ? diff : -diff;
      });
  }, [events, severityFilter, categoryFilter, openOnly, searchQuery, sortField, sortAsc]);

  const activeEvent = useMemo(() => {
    if (selectedEventId) {
      const match = events.find((e) => e.id === selectedEventId);
      if (match) return match;
    }
    return filteredEvents[0] ?? events[0] ?? null;
  }, [events, filteredEvents, selectedEventId]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc((prev) => !prev);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const resetFilters = () => {
    setSeverityFilter('all');
    setCategoryFilter('all');
    setSearchQuery('');
    setOpenOnly(false);
  };

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
    <div className="space-y-5">
      {/* Security Metrics Strip */}
      <section
        aria-label="Security metrics overview"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Failed SSH Login Attempts
          </div>
          <div className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums dark:text-slate-50">
            {summary.failedSsh}
          </div>
          <div className="mt-1 font-mono text-[11px] text-slate-500 dark:text-slate-400">
            DEMO DATA · sshd port 22
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Suspicious IP Addresses
          </div>
          <div className="mt-2 font-mono text-2xl font-semibold text-red-600 tabular-nums dark:text-red-400">
            {summary.suspiciousIps}
          </div>
          <div className="mt-1 font-mono text-[11px] text-slate-500 dark:text-slate-400">
            DEMO DATA · External sources
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Authentication Failures
          </div>
          <div className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums dark:text-slate-50">
            {summary.totalAuthFailures}
          </div>
          <div className="mt-1 font-mono text-[11px] text-slate-500 dark:text-slate-400">
            DEMO DATA · sshd &amp; pam_unix
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Repeated Login Attempts
          </div>
          <div className="mt-2 font-mono text-2xl font-semibold text-amber-600 tabular-nums dark:text-amber-400">
            {summary.repeatedBursts}
          </div>
          <div className="mt-1 font-mono text-[11px] text-slate-500 dark:text-slate-400">
            DEMO DATA · Burst events (&ge;10 tries)
          </div>
        </div>
      </section>

      {/* Main Security Events Table */}
      <section
        aria-label="Security events log"
        className="rounded-lg border border-slate-200 bg-white transition-colors duration-150 dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Security Event Log
              </h2>
              <span className="text-xs text-slate-400 dark:text-slate-600" aria-hidden="true">
                ·
              </span>
              <span className="font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
                {filteredEvents.length} of {events.length} events
              </span>
              <span className="text-xs text-slate-400 dark:text-slate-600" aria-hidden="true">
                ·
              </span>
              <span className="font-mono text-[11px] font-medium text-slate-500 dark:text-slate-400">
                DEMO DATA
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Filter by event category"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as CategoryFilter)}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
              >
                <option value="all">All Categories</option>
                <option value="failed_ssh">Failed SSH Login</option>
                <option value="suspicious_ip">Suspicious IP</option>
                <option value="auth_failure">Auth Failure</option>
                <option value="repeated_attempt">Repeated Login</option>
              </select>

              <button
                type="button"
                onClick={() => setOpenOnly((prev) => !prev)}
                aria-pressed={openOnly}
                className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  openOnly
                    ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950/40 dark:text-blue-300'
                    : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                Unmitigated only
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div
              role="group"
              aria-label="Filter security events by severity"
              className="inline-flex items-center self-start rounded-md border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-800 dark:bg-slate-950"
            >
              {(['all', 'critical', 'warning', 'info'] as const).map((sev) => {
                const active = severityFilter === sev;
                const label = sev.charAt(0).toUpperCase() + sev.slice(1);
                return (
                  <button
                    key={sev}
                    type="button"
                    onClick={() => setSeverityFilter(sev)}
                    aria-pressed={active}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      active
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <div className="relative min-w-[240px]">
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search IP, user, service, or log..."
                aria-label="Search security events"
                className="w-full rounded-md border border-slate-200 bg-white py-1.5 pr-3 pl-8 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500"
              />
            </div>
          </div>
        </div>

        {filteredEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
              No security events match your filters
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Reset filters or restore the demo security log entries.
            </p>
            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={resetFilters}
                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Reset Filters
              </button>
              <button
                type="button"
                onClick={onResetEvents}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Restore Demo Events
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                  <th scope="col" className="py-2.5 pr-3 pl-5 font-medium whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => toggleSort('severity')}
                      className="inline-flex items-center gap-1 font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 cursor-pointer"
                    >
                      Severity
                      <ArrowUpDown className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => toggleSort('timestamp')}
                      className="inline-flex items-center gap-1 font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 cursor-pointer"
                    >
                      Timestamp
                      <ArrowUpDown className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium whitespace-nowrap">
                    Category
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium whitespace-nowrap">
                    Source IP
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium whitespace-nowrap">
                    Target / Service
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => toggleSort('attempts')}
                      className="inline-flex items-center gap-1 font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 cursor-pointer"
                    >
                      Attempts
                      <ArrowUpDown className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium whitespace-nowrap">
                    State
                  </th>
                  <th scope="col" className="py-2.5 pr-5 pl-3 text-right font-medium whitespace-nowrap">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {filteredEvents.map((event) => {
                  const isSelected = activeEvent?.id === event.id;
                  const isMitigated = event.status === 'mitigated';
                  return (
                    <tr
                      key={event.id}
                      onClick={() => onSelectEvent(event.id)}
                      className={`cursor-pointer transition-colors hover:bg-slate-50/90 dark:hover:bg-slate-800/40 ${
                        isSelected ? 'bg-blue-50/40 dark:bg-blue-950/20' : ''
                      } ${isMitigated ? 'opacity-65' : ''}`}
                    >
                      <td className="py-3 pr-3 pl-5 whitespace-nowrap">
                        {renderSeverity(event.severity)}
                      </td>
                      <td className="px-3 py-3 font-mono text-slate-600 tabular-nums whitespace-nowrap dark:text-slate-400">
                        {event.timestamp}
                      </td>
                      <td className="px-3 py-3 text-slate-700 whitespace-nowrap dark:text-slate-300">
                        {CATEGORY_LABELS[event.category]}
                      </td>
                      <td className="px-3 py-3 font-mono font-medium text-slate-900 tabular-nums whitespace-nowrap dark:text-slate-100">
                        {event.sourceIp}
                      </td>
                      <td className="px-3 py-3 font-mono text-slate-600 whitespace-nowrap dark:text-slate-300">
                        {event.targetUser} · {event.service}
                      </td>
                      <td className="px-3 py-3 text-right font-mono font-medium text-slate-900 tabular-nums whitespace-nowrap dark:text-slate-100">
                        {event.attempts}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span
                          className={`font-medium capitalize ${
                            event.status === 'open'
                              ? 'text-slate-900 dark:text-slate-100'
                              : event.status === 'acknowledged'
                                ? 'text-blue-600 dark:text-blue-400'
                                : 'text-emerald-700 dark:text-emerald-400'
                          }`}
                        >
                          {event.status}
                        </span>
                      </td>
                      <td
                        className="py-3 pr-5 pl-3 text-right whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {event.status === 'open' && (
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => onUpdateEventStatus(event.id, 'acknowledged')}
                              className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              Acknowledge
                            </button>
                            <button
                              type="button"
                              onClick={() => onUpdateEventStatus(event.id, 'mitigated')}
                              className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:border-emerald-300 hover:text-emerald-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-emerald-700 dark:hover:text-emerald-400 whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              Mark Mitigated
                            </button>
                          </div>
                        )}
                        {event.status === 'acknowledged' && (
                          <button
                            type="button"
                            onClick={() => onUpdateEventStatus(event.id, 'mitigated')}
                            className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:border-emerald-300 hover:text-emerald-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-emerald-700 dark:hover:text-emerald-400 whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <Check className="h-3 w-3" aria-hidden="true" />
                            Mark Mitigated
                          </button>
                        )}
                        {event.status === 'mitigated' && (
                          <button
                            type="button"
                            onClick={() => onUpdateEventStatus(event.id, 'open')}
                            className="text-[11px] font-medium text-slate-400 transition-colors hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-300 whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            Reopen
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Selected Event Inspection Panel */}
      {activeEvent && (
        <section
          aria-label="Selected security event inspector"
          className="rounded-lg border border-slate-200 bg-white p-5 transition-colors duration-150 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Event Inspector
              </h3>
              <span className="text-xs text-slate-400 dark:text-slate-600" aria-hidden="true">
                ·
              </span>
              <span className="font-mono text-xs font-medium text-slate-600 dark:text-slate-300">
                {activeEvent.id}
              </span>
              <span className="text-xs text-slate-400 dark:text-slate-600" aria-hidden="true">
                ·
              </span>
              {renderSeverity(activeEvent.severity)}
              <span className="text-xs text-slate-400 dark:text-slate-600" aria-hidden="true">
                ·
              </span>
              <span className="font-mono text-[11px] font-medium text-slate-500 dark:text-slate-400">
                DEMO DATA
              </span>
            </div>

            <div className="flex items-center gap-2">
              {activeEvent.status !== 'acknowledged' && activeEvent.status !== 'mitigated' && (
                <button
                  type="button"
                  onClick={() => onUpdateEventStatus(activeEvent.id, 'acknowledged')}
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Acknowledge
                </button>
              )}
              {activeEvent.status !== 'mitigated' ? (
                <button
                  type="button"
                  onClick={() => onUpdateEventStatus(activeEvent.id, 'mitigated')}
                  className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50/70 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100/70 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300 dark:hover:bg-emerald-950/50 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Mark Mitigated
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onUpdateEventStatus(activeEvent.id, 'open')}
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Reopen Event
                </button>
              )}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="text-slate-400 dark:text-slate-500">Source IP</div>
              <div className="mt-1 font-mono font-medium text-slate-900 tabular-nums dark:text-slate-100">
                {activeEvent.sourceIp}
              </div>
              <div className="mt-0.5 text-slate-500 dark:text-slate-400">
                {activeEvent.ipOriginNote}
              </div>
            </div>
            <div>
              <div className="text-slate-400 dark:text-slate-500">Target Account &amp; Service</div>
              <div className="mt-1 font-mono font-medium text-slate-900 dark:text-slate-100">
                {activeEvent.targetUser} · {activeEvent.service}
              </div>
              <div className="mt-0.5 text-slate-500 dark:text-slate-400">
                {CATEGORY_LABELS[activeEvent.category]}
              </div>
            </div>
            <div>
              <div className="text-slate-400 dark:text-slate-500">Observed Attempts</div>
              <div className="mt-1 font-mono font-medium text-slate-900 tabular-nums dark:text-slate-100">
                {activeEvent.attempts} failed attempt{activeEvent.attempts === 1 ? '' : 's'}
              </div>
              <div className="mt-0.5 font-mono text-slate-500 tabular-nums dark:text-slate-400">
                {activeEvent.timestamp}
              </div>
            </div>
            <div>
              <div className="text-slate-400 dark:text-slate-500">Current State</div>
              <div className="mt-1 font-medium capitalize text-slate-900 dark:text-slate-100">
                {activeEvent.status}
              </div>
              <div className="mt-0.5 text-slate-500 dark:text-slate-400">
                Simulated fail2ban / ufw review
              </div>
            </div>
          </div>

          <p className="mt-4 text-xs text-slate-700 dark:text-slate-300">
            {activeEvent.description}
          </p>

          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3.5 py-2.5 dark:border-slate-800 dark:bg-slate-950">
            <div className="mb-1 flex items-center gap-1.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">
              <Terminal className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>/var/log/auth.log (Simulated Sample)</span>
            </div>
            <pre className="overflow-x-auto font-mono text-xs leading-relaxed text-slate-800 dark:text-slate-200">
              {activeEvent.rawLogLine}
            </pre>
          </div>
        </section>
      )}
    </div>
  );
}
