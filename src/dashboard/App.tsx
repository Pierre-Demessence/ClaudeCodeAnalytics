import { useCallback, useEffect, useRef, useState } from 'react';

import type { Summary } from '@/dashboard/api';

import { addReading, loadSummary, refreshNow, saveSettings } from '@/dashboard/api';
import { Header } from '@/dashboard/Header';
import { PatternDefs } from '@/dashboard/Patterns';
import { PerWeek } from '@/dashboard/PerWeek';
import { RawUsage } from '@/dashboard/RawUsage';
import { SettingsPanel } from '@/dashboard/SettingsPanel';
import { useTab } from '@/dashboard/tabs';
import { useTheme } from '@/dashboard/theme';
import { ThisWeek } from '@/dashboard/ThisWeek';

const RELOAD_MS = 5 * 60_000;

export function App() {
  const [summary, setSummary] = useState<Summary>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const tab = useTab();
  const { theme, toggle: toggleTheme } = useTheme();

  // Overlapping requests (auto-reload during a save) may finish out of order: only the latest one counts.
  const latestRequestRef = useRef(0);

  const run = useCallback(async (action: () => Promise<Summary>) => {
    const request = ++latestRequestRef.current;
    setBusy(true);
    try {
      const next = await action();
      if (request === latestRequestRef.current) {
        setSummary(next);
        setError(undefined);
      }
    }
    catch (e) {
      if (request === latestRequestRef.current)
        setError(e instanceof Error ? e.message : String(e));
    }
    finally {
      if (request === latestRequestRef.current)
        setBusy(false);
    }
  }, []);

  useEffect(() => {
    void run(loadSummary);
    const timer = setInterval(() => void run(loadSummary), RELOAD_MS);
    return () => clearInterval(timer);
  }, [run]);

  return (
    <>
      <PatternDefs />
      <Header
        busy={busy}
        onRefresh={() => void run(refreshNow)}
        onToggleTheme={toggleTheme}
        summary={summary}
        tab={tab}
        theme={theme}
      />
      <main>
        {error && (
          <p className="error" role="alert">
            <span aria-hidden="true">✗ </span>
            {error}
          </p>
        )}
        {summary
          ? (
              <>
                {tab === 'overview' && (
                  <>
                    <ThisWeek summary={summary} />
                    <PerWeek summary={summary} />
                  </>
                )}
                {tab === 'usage' && <RawUsage summary={summary} />}
                {tab === 'calibration' && (
                  <SettingsPanel
                    busy={busy}
                    onAddReading={reading => run(() => addReading(reading))}
                    onSaveSettings={settings => run(() => saveSettings(settings))}
                    summary={summary}
                  />
                )}
              </>
            )
          : !error && <p className="empty">Loading…</p>}
      </main>
    </>
  );
}
