import { useEffect, useMemo, useRef, useState } from 'react';
import { CpuPoint, TimeRange } from '../types/monitoring';

interface CpuLineChartProps {
  series: CpuPoint[];
  nodeName: string;
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
}

const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: '15m', label: '15m' },
  { value: '1h', label: '1h' },
  { value: '6h', label: '6h' },
  { value: '24h', label: '24h' },
];

const Y_TICKS = [0, 25, 50, 75, 100];

export function CpuLineChart({
  series,
  nodeName,
  timeRange,
  onTimeRangeChange,
}: CpuLineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(820);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [showThreshold, setShowThreshold] = useState(true);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateWidth = () => {
      const next = Math.max(300, Math.floor(el.getBoundingClientRect().width));
      setChartWidth(next);
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const height = 256;
  const pad = { top: 16, right: 16, bottom: 28, left: 42 };
  const plotW = Math.max(120, chartWidth - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;

  const stats = useMemo(() => {
    if (series.length === 0) {
      return { current: 0, avg: 0, peak: 0 };
    }
    const current = series[series.length - 1].usage;
    const sum = series.reduce((acc, p) => acc + p.usage, 0);
    const peak = Math.max(...series.map((p) => p.usage));
    return {
      current,
      avg: Number((sum / series.length).toFixed(1)),
      peak: Number(peak.toFixed(1)),
    };
  }, [series]);

  const coordinates = useMemo(() => {
    if (series.length === 0) return [];
    const denom = Math.max(1, series.length - 1);
    return series.map((point, index) => {
      const x = pad.left + (index / denom) * plotW;
      const y = pad.top + ((100 - point.usage) / 100) * plotH;
      return { x, y, point, index };
    });
  }, [series, plotW, plotH, pad.left, pad.top]);

  const linePath = useMemo(() => {
    if (coordinates.length === 0) return '';
    return coordinates
      .map((c, idx) => `${idx === 0 ? 'M' : 'L'} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`)
      .join(' ');
  }, [coordinates]);

  const areaPath = useMemo(() => {
    if (coordinates.length === 0) return '';
    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    const baseY = pad.top + plotH;
    return `${linePath} L ${last.x.toFixed(2)} ${baseY.toFixed(2)} L ${first.x.toFixed(2)} ${baseY.toFixed(2)} Z`;
  }, [coordinates, linePath, pad.top, plotH]);

  const xTickIndices = useMemo(() => {
    if (series.length <= 2) return series.map((_, i) => i);
    const desiredCount = chartWidth < 520 ? 4 : 6;
    const step = Math.max(1, Math.floor((series.length - 1) / (desiredCount - 1)));
    const indices: number[] = [];
    for (let i = 0; i < series.length; i += step) {
      indices.push(i);
    }
    if (indices[indices.length - 1] !== series.length - 1) {
      indices.push(series.length - 1);
    }
    return indices;
  }, [series, chartWidth]);

  const thresholdY = pad.top + ((100 - 80) / 100) * plotH;

  const activePoint =
    hoveredIndex !== null && coordinates[hoveredIndex]
      ? coordinates[hoveredIndex]
      : null;

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (coordinates.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const clampedX = Math.max(pad.left, Math.min(pad.left + plotW, relX));
    const ratio = (clampedX - pad.left) / Math.max(1, plotW);
    const idx = Math.round(ratio * (coordinates.length - 1));
    setHoveredIndex(Math.max(0, Math.min(coordinates.length - 1, idx)));
  };

  return (
    <section
      aria-label="CPU usage over time"
      className="rounded-lg border border-slate-200 bg-white p-5 transition-colors duration-150 dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex flex-col gap-4 border-b border-slate-100 pb-4 dark:border-slate-800/80 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              CPU Utilization Over Time
            </h2>
            <span className="text-xs text-slate-400 dark:text-slate-600" aria-hidden="true">
              ·
            </span>
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
              {nodeName}
            </span>
            <span className="text-xs text-slate-400 dark:text-slate-600" aria-hidden="true">
              ·
            </span>
            <span className="font-mono text-[11px] font-medium text-slate-500 dark:text-slate-400">
              DEMO DATA
            </span>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
            <span>
              Current:{' '}
              <strong className="font-semibold text-slate-900 dark:text-slate-100">
                {stats.current.toFixed(1)}%
              </strong>
            </span>
            <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
              ·
            </span>
            <span>
              Avg:{' '}
              <strong className="font-medium text-slate-800 dark:text-slate-200">
                {stats.avg.toFixed(1)}%
              </strong>
            </span>
            <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
              ·
            </span>
            <span>
              Peak:{' '}
              <strong className="font-medium text-slate-800 dark:text-slate-200">
                {stats.peak.toFixed(1)}%
              </strong>
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setShowThreshold((prev) => !prev)}
            aria-pressed={showThreshold}
            className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 whitespace-nowrap shrink-0 cursor-pointer ${
              showThreshold
                ? 'border-amber-300 bg-amber-50/70 text-amber-800 dark:border-amber-800/80 dark:bg-amber-950/30 dark:text-amber-300'
                : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <span
              className="inline-block w-3 border-t border-dashed border-current"
              aria-hidden="true"
            />
            80% threshold
          </button>

          <div
            role="group"
            aria-label="Chart time range"
            className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-800 dark:bg-slate-950"
          >
            {TIME_RANGES.map((item) => {
              const active = item.value === timeRange;
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => {
                    setHoveredIndex(null);
                    onTimeRangeChange(item.value);
                  }}
                  aria-pressed={active}
                  className={`rounded px-2.5 py-1 font-mono text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div ref={containerRef} className="relative mt-4 w-full select-none">
        <svg
          width={chartWidth}
          height={height}
          viewBox={`0 0 ${chartWidth} ${height}`}
          className="block w-full overflow-visible"
          role="img"
          aria-label={`Line chart of CPU usage for ${nodeName} over the past ${timeRange}`}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHoveredIndex(null)}
        >
          <defs>
            <linearGradient id="cpuAreaFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563EB" stopOpacity="0.14" />
              <stop offset="100%" stopColor="#2563EB" stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {Y_TICKS.map((tick) => {
            const y = pad.top + ((100 - tick) / 100) * plotH;
            return (
              <g key={tick}>
                <line
                  x1={pad.left}
                  y1={y}
                  x2={pad.left + plotW}
                  y2={y}
                  className="stroke-slate-100 dark:stroke-slate-800"
                  strokeWidth={1}
                />
                <text
                  x={pad.left - 8}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-slate-400 font-mono text-[11px] tabular-nums dark:fill-slate-500"
                >
                  {tick}%
                </text>
              </g>
            );
          })}

          {showThreshold && (
            <g>
              <line
                x1={pad.left}
                y1={thresholdY}
                x2={pad.left + plotW}
                y2={thresholdY}
                stroke="#D97706"
                strokeWidth={1.25}
                strokeDasharray="4 4"
              />
              <text
                x={pad.left + plotW - 4}
                y={thresholdY - 6}
                textAnchor="end"
                className="fill-amber-600 font-mono text-[10px] font-medium dark:fill-amber-400"
              >
                80% alert threshold
              </text>
            </g>
          )}

          {areaPath && <path d={areaPath} fill="url(#cpuAreaFill)" />}

          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke="#2563EB"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}

          {xTickIndices.map((idx) => {
            const item = coordinates[idx];
            if (!item) return null;
            return (
              <text
                key={idx}
                x={item.x}
                y={height - 6}
                textAnchor={
                  idx === 0 ? 'start' : idx === series.length - 1 ? 'end' : 'middle'
                }
                className="fill-slate-400 font-mono text-[11px] tabular-nums dark:fill-slate-500"
              >
                {item.point.label}
              </text>
            );
          })}

          {activePoint && (
            <g>
              <line
                x1={activePoint.x}
                y1={pad.top}
                x2={activePoint.x}
                y2={pad.top + plotH}
                className="stroke-slate-300 dark:stroke-slate-600"
                strokeWidth={1}
              />
              <circle
                cx={activePoint.x}
                cy={activePoint.y}
                r={4.5}
                className="fill-blue-600 stroke-white dark:stroke-slate-900"
                strokeWidth={2}
              />
            </g>
          )}
        </svg>

        {activePoint && (
          <div
            role="status"
            className="pointer-events-none absolute top-2 z-10 rounded-md border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-sm backdrop-blur-xs dark:border-slate-700 dark:bg-slate-900/95"
            style={{
              left:
                activePoint.x > chartWidth * 0.65
                  ? `${Math.max(pad.left, activePoint.x - 188)}px`
                  : `${Math.min(chartWidth - 184, activePoint.x + 12)}px`,
            }}
          >
            <div className="font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
              {activePoint.point.timestamp}
            </div>
            <div className="mt-1 flex items-center justify-between gap-4 font-mono tabular-nums">
              <span className="text-slate-600 dark:text-slate-300">Total CPU</span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {activePoint.point.usage.toFixed(1)}%
              </span>
            </div>
            <div className="mt-0.5 flex items-center justify-between gap-4 font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
              <span>User / Sys</span>
              <span>
                {activePoint.point.userPct.toFixed(1)}% / {activePoint.point.systemPct.toFixed(1)}%
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
