import { useCallback, useEffect, useState } from 'react';

import type { Summary } from '@/dashboard/api';

import { addReading, loadSummary, refreshNow, saveSettings } from '@/dashboard/api';
import { PatternDefs } from '@/dashboard/Patterns';
import { PerWeek } from '@/dashboard/PerWeek';
import { RawUsage } from '@/dashboard/RawUsage';
import { SettingsPanel } from '@/dashboard/SettingsPanel';
import { ThisWeek } from '@/dashboard/ThisWeek';

const RELOAD_MS = 5 * 60_000;

export function App() {
  const [summary, setSummary] = useState<Summary>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (action: () => Promise<Summary>) => {
    setBusy(true);
    try {
      setSummary(await action());
      setError(undefined);
    }
    catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void run(loadSummary);
    const timer = setInterval(() => void run(loadSummary), RELOAD_MS);
    return () => clearInterval(timer);
  }, [run]);

  return (
    <main>
      <PatternDefs />
      <header className="page-header">
        <h1>Claude Code usage</h1>
        {busy && <span className="busy">Updating…</span>}
      </header>
      {error && (
        <p className="error" role="alert">
          <span aria-hidden="true">✗ </span>
          {error}
        </p>
      )}
      {summary
        ? (
            <>
              <ThisWeek summary={summary} />
              <PerWeek summary={summary} />
              <RawUsage summary={summary} />
              <SettingsPanel
                busy={busy}
                onAddReading={reading => run(() => addReading(reading))}
                onRefresh={() => run(refreshNow)}
                onSaveSettings={settings => run(() => saveSettings(settings))}
                summary={summary}
              />
            </>
          )
        : !error && <p className="empty">Loading…</p>}
    </main>
  );
}
