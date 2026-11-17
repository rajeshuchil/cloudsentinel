/**
 * DemoBanner — persistent top-of-page notice displayed in Public Demo Mode.
 *
 * Communicates clearly that:
 * - The dashboard is showing simulated data.
 * - No real infrastructure or private telemetry is involved.
 * - Provides a path to log in as an administrator.
 */

import { FlaskConical, Lock } from 'lucide-react';

interface DemoBannerProps {
  onEnterAdminMode: () => void;
}

export function DemoBanner({ onEnterAdminMode }: DemoBannerProps) {
  return (
    <div
      role="banner"
      aria-label="Demo mode notice"
      className="flex items-center justify-between gap-3 bg-blue-600 px-4 py-2.5 text-white dark:bg-blue-700"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <FlaskConical
          className="h-4 w-4 shrink-0 text-blue-200"
          aria-hidden="true"
        />
        <div className="min-w-0 text-xs">
          <span className="font-bold tracking-wide uppercase mr-2">Demo Mode</span>
          <span className="font-mono text-[10px] bg-blue-500/40 border border-blue-300/40 px-1.5 py-0.5 rounded mr-2">PUBLIC-DEMO-BUILD-01</span>
          <span className="text-blue-100 hidden sm:inline">
            You&apos;re viewing simulated infrastructure monitoring data. No real systems or private credentials are involved.
          </span>
          <span className="text-blue-100 sm:hidden">Simulated data only.</span>
        </div>
      </div>

      <button
        type="button"
        onClick={onEnterAdminMode}
        className="flex shrink-0 items-center gap-1.5 rounded-md border border-blue-400 bg-blue-700/60 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white whitespace-nowrap cursor-pointer dark:border-blue-500 dark:bg-blue-800/60 dark:hover:bg-blue-600"
        aria-label="Enter administrator live monitoring mode"
      >
        <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span>Admin Login</span>
      </button>
    </div>
  );
}
