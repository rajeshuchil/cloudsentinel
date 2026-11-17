/**
 * Root — Mode router for CloudSentinel.
 *
 * Renders either:
 *   - Public Demo Mode (DemoApp) — the default for anonymous visitors.
 *     No authentication required. Uses entirely synthetic data.
 *   - Authenticated Live Mode (App) — for the administrator.
 *     Requires DASHBOARD_API_KEY entered interactively in the browser.
 *
 * Mode is tracked in React state only (no localStorage or URL parameters).
 * This guarantees the demo is the first thing every visitor sees.
 *
 * Security guarantee:
 * - Demo Mode makes ZERO API calls to the backend.
 * - Switching to Admin Mode does NOT auto-send any credential.
 *   The admin must enter their DASHBOARD_API_KEY in the in-app modal.
 * - No secrets are stored in this file or baked into any bundle.
 */

import { useEffect, useState } from 'react';
import App from './App';
import DemoApp from './DemoApp';

type AppMode = 'demo' | 'admin';

export default function Root() {
  const [mode, setMode] = useState<AppMode>('demo');

  // Persist dark-mode class across mode switches
  useEffect(() => {
    // No-op; each child app manages dark mode independently.
  }, []);

  if (mode === 'demo') {
    return (
      <DemoApp
        onExitDemo={() => setMode('admin')}
      />
    );
  }

  return (
    <App
      onExitAdmin={() => setMode('demo')}
    />
  );
}
