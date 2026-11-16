import {
  AlertTriangle,
  ArrowUpDown,
  Check,
  Info,
  OctagonAlert,
  RotateCcw,
  Search,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { AlertItem, AlertSeverity, AlertStatus } from '../types/monitoring';

interface AlertsTableProps {
  alerts: AlertItem[];
  onUpdateStatus: (id: string, status: AlertStatus) => void;
  onResetAlerts: () => void;
  title?: string;
}

type SeverityFilter = 'all' | AlertSeverity;
type SortField = 'timestamp' | 'severity';

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  critical: 3,
  warning: 2,
  info: 1,
};

export function AlertsTable({
  alerts,
  onUpdateStatus,
  onResetAlerts,
  title = 'Recent Alerts',
}: AlertsTableProps) {
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [hideResolved, setHideResolved] = useState(false);
  const [sortField, setSortField] = useState<SortField>('timestamp');
  const [sortAsc, setSortAsc] = useState(false);

  const counts = useMemo(() => {
    return {
      all: alerts.length,
      critical: alerts.filter((a) => a.severity === 'critical').length,
      warning: alerts.filter((a) => a.severity === 'warning').length,
      info: alerts.filter((a) => a.severity === 'info').length,
    };
  }, [alerts]);

  const filteredAlerts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return alerts
      .filter((item) => {
        if (severityFilter !== 'all' && item.severity !== severityFilter) {
          return false;
        }
        if (hideResolved && item.status === 'resolved') {
          return false;
        }
        if (q) {
          return (
            item.description.toLowerCase().includes(q) ||
            item.subsystem.toLowerCase().includes(q) ||
            item.metric.toLowerCase().includes(q) ||
            item.id.toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => {
        const diff =
          sortField === 'timestamp'
            ? a.epochMs - b.epochMs
            : SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
        return sortAsc ? diff : -diff;
      });
  }, [alerts, severityFilter, hideResolved, searchQuery, sortField, sortAsc]);

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
    setSearchQuery('');
    setHideResolved(false);
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
    <section
      aria-label={title}
      className="rounded-lg border border-slate-200 bg-white transition-colors duration-150 dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {title}
          </h2>
          <span className="text-xs text-slate-400 dark:text-slate-600" aria-hidden="true">
            ·
          </span>
          <span className="font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
            {filteredAlerts.length} of {alerts.length} shown
          </span>
          <span className="text-xs text-slate-400 dark:text-slate-600" aria-hidden="true">
            ·
          </span>
          <span className="font-mono text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            SQLITE PERSISTENT
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div
            role="group"
            aria-label="Filter alerts by severity"
            className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-800 dark:bg-slate-950"
          >
            {(
              [
                { key: 'all', label: 'All' },
                { key: 'critical', label: 'Critical' },
                { key: 'warning', label: 'Warning' },
                { key: 'info', label: 'Info' },
              ] as const
            ).map((tab) => {
              const active = severityFilter === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setSeverityFilter(tab.key)}
                  aria-pressed={active}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {tab.label}{' '}
                  <span className="ml-0.5 font-mono text-[11px] text-slate-400 tabular-nums dark:text-slate-500">
                    {counts[tab.key]}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="relative min-w-[200px] flex-1 sm:flex-initial">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search subsystem or message..."
              aria-label="Search alerts"
              className="w-full rounded-md border border-slate-200 bg-white py-1.5 pr-3 pl-8 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500"
            />
          </div>

          <button
            type="button"
            onClick={() => setHideResolved((prev) => !prev)}
            aria-pressed={hideResolved}
            className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 whitespace-nowrap shrink-0 cursor-pointer ${
              hideResolved
                ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950/40 dark:text-blue-300'
                : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            Open only
          </button>
        </div>
      </div>

      {filteredAlerts.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
            No alerts match the current filters
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Clear your search query or severity filter to inspect all recorded events.
          </p>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={resetFilters}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0 cursor-pointer"
            >
              Reset Filters
            </button>
            <button
              type="button"
              onClick={onResetAlerts}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Refresh Alerts
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
                  Subsystem
                </th>
                <th scope="col" className="px-3 py-2.5 font-medium">
                  Description
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
              {filteredAlerts.map((alert) => {
                const isResolved = alert.status === 'resolved';
                return (
                  <tr
                    key={alert.id}
                    className={`transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40 ${
                      isResolved ? 'opacity-65' : ''
                    }`}
                  >
                    <td className="py-3 pr-3 pl-5 whitespace-nowrap">
                      {renderSeverity(alert.severity)}
                    </td>
                    <td className="px-3 py-3 font-mono text-slate-600 tabular-nums whitespace-nowrap dark:text-slate-400">
                      {alert.timestamp}
                    </td>
                    <td className="px-3 py-3 font-mono text-slate-800 whitespace-nowrap dark:text-slate-200">
                      {alert.subsystem}
                    </td>
                    <td className="min-w-[260px] px-3 py-3 text-slate-700 dark:text-slate-300">
                      <span className="font-mono text-[11px] text-slate-400 dark:text-slate-500">
                        {alert.id}
                      </span>{' '}
                      <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
                        ·
                      </span>{' '}
                      {alert.description}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span
                        className={`font-medium capitalize ${
                          alert.status === 'active'
                            ? 'text-slate-900 dark:text-slate-100'
                            : alert.status === 'acknowledged'
                              ? 'text-blue-600 dark:text-blue-400'
                              : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {alert.status}
                      </span>
                    </td>
                    <td className="py-3 pr-5 pl-3 text-right whitespace-nowrap">
                      {alert.status === 'active' && (
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onUpdateStatus(alert.id, 'acknowledged')}
                            className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            Acknowledge
                          </button>
                          <button
                            type="button"
                            onClick={() => onUpdateStatus(alert.id, 'resolved')}
                            className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:border-emerald-300 hover:text-emerald-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-emerald-700 dark:hover:text-emerald-400 whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            Resolve
                          </button>
                        </div>
                      )}
                      {alert.status === 'acknowledged' && (
                        <button
                          type="button"
                          onClick={() => onUpdateStatus(alert.id, 'resolved')}
                          className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:border-emerald-300 hover:text-emerald-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-emerald-700 dark:hover:text-emerald-400 whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <Check className="h-3 w-3" aria-hidden="true" />
                          Resolve
                        </button>
                      )}
                      {alert.status === 'resolved' && (
                        <button
                          type="button"
                          onClick={() => onUpdateStatus(alert.id, 'active')}
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
  );
}
