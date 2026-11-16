import { AlertTriangle, ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';

interface MetricCardProps {
  title: string;
  percentage: number;
  delta: number;
  primaryDetail: string;
  secondaryDetail: string;
  warningThreshold?: number;
  criticalThreshold?: number;
}

export function MetricCard({
  title,
  percentage,
  delta,
  primaryDetail,
  secondaryDetail,
  warningThreshold = 75,
  criticalThreshold = 90,
}: MetricCardProps) {
  const clamped = Math.max(0, Math.min(100, percentage));

  const severity =
    clamped >= criticalThreshold
      ? 'critical'
      : clamped >= warningThreshold
        ? 'warning'
        : 'nominal';

  const barColor =
    severity === 'critical'
      ? 'bg-red-600 dark:bg-red-500'
      : severity === 'warning'
        ? 'bg-amber-500 dark:bg-amber-400'
        : 'bg-blue-600 dark:bg-blue-500';

  const stateLabel =
    severity === 'critical'
      ? 'Critical load'
      : severity === 'warning'
        ? 'Elevated'
        : 'Nominal';

  const stateTextColor =
    severity === 'critical'
      ? 'text-red-600 dark:text-red-400'
      : severity === 'warning'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-emerald-700 dark:text-emerald-400';

  const DeltaIcon =
    delta > 0.2 ? ArrowUpRight : delta < -0.2 ? ArrowDownRight : Minus;

  const deltaColor =
    delta > 5
      ? 'text-amber-600 dark:text-amber-400'
      : delta < -0.2
        ? 'text-emerald-700 dark:text-emerald-400'
        : 'text-slate-500 dark:text-slate-400';

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-5 transition-colors duration-150 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-slate-600 dark:text-slate-400">
          {title}
        </h3>
        <span className={`inline-flex items-center gap-1 text-xs font-medium ${stateTextColor}`}>
          {severity !== 'nominal' && (
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          )}
          {stateLabel}
        </span>
      </div>

      <div className="mt-3 flex items-baseline justify-between gap-4">
        <div className="font-mono text-3xl font-semibold tracking-tight text-slate-900 tabular-nums dark:text-slate-50">
          {clamped.toFixed(1)}
          <span className="ml-0.5 text-lg font-medium text-slate-400 dark:text-slate-500">
            %
          </span>
        </div>

        <div
          className={`inline-flex items-center gap-0.5 font-mono text-xs font-medium tabular-nums ${deltaColor}`}
          title="Change since previous sampling window"
        >
          <DeltaIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            {delta > 0 ? '+' : ''}
            {delta.toFixed(1)}%
          </span>
        </div>
      </div>

      <div
        className="mt-4 h-1.5 w-full overflow-hidden rounded-sm bg-slate-100 dark:bg-slate-800"
        role="progressbar"
        aria-label={`${title} utilization`}
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-full transition-[width] duration-300 ease-out ${barColor}`}
          style={{ width: `${clamped}%` }}
        />
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
        <span className="text-slate-700 dark:text-slate-300">{primaryDetail}</span>
        <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
          ·
        </span>
        <span className="truncate">{secondaryDetail}</span>
      </div>
    </article>
  );
}
