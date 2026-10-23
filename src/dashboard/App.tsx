import { CircleX } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Summary } from '@/dashboard/api';

import { anonymizeSummary, useAnonymize } from '@/dashboard/anonymize';
import { addReading, deleteReading, loadStoredSummary, loadSummary, refreshNow, saveSettings } from '@/dashboard/api';
import { Breakdown } from '@/dashboard/Breakdown';
import { Calibration } from '@/dashboard/Calibration';
import { Header } from '@/dashboard/Header';
import { useHistoryView } from '@/dashboard/history';
import { Overview } from '@/dashboard/Overview';
import { PatternDefs } from '@/dashboard/Patterns';
import { Plans } from '@/dashboard/Plans';
import { Sessions } from '@/dashboard/Sessions';
import { hasRange, useTab } from '@/dashboard/tabs';
import { useTheme } from '@/dashboard/theme';
import { TipProvider } from '@/dashboard/Tip';
import { Usage } from '@/dashboard/Usage';
import { Weeks } from '@/dashboard/Weeks';

const RELOAD_MS = 5 * 60_000;
const RETRY_MS = 30_000;

export function App() {
  const [summary, setSummary] = useState<Summary>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const tab = useTab();
  const { theme, toggle: toggleTheme } = useTheme();
  const { anonymous, toggle: toggleAnonymous } = useAnonymize();
  const shown = useMemo(() => summary && (anonymous ? anonymizeSummary(summary) : summary), [anonymous, summary]);
  const view = useHistoryView(shown, anonymous, hasRange(tab));

  // Overlapping requests (auto-reload during a save) may finish out of order: only the latest one counts.
  const latestRequestRef = useRef(0);

  /** Resolves to whether the action succeeded, even when a newer request supersedes its result. */
  const run = useCallback(async (action: () => Promise<Summary>): Promise<boolean> => {
    const request = ++latestRequestRef.current;
    setBusy(true);
    try {
      const next = await action();
      if (request === latestRequestRef.current) {
        setSummary(next);
        setError(undefined);
      }
      return true;
    }
    catch (e) {
      if (request === latestRequestRef.current)
        setError(e instanceof Error ? e.message : String(e));
      return false;
    }
    finally {
      if (request === latestRequestRef.current)
        setBusy(false);
    }
  }, []);

  useEffect(() => {
    // Paint the stored data at once, then import new transcripts and replace it.
    // `run` never rejects, so a failed first request still leads to the full one.
    // A refresh or save started meanwhile is newer: the full load must not supersede it.
    let cancelled = false;
    const storedRequest = latestRequestRef.current + 1;
    void run(loadStoredSummary).then(() => {
      if (!cancelled && latestRequestRef.current === storedRequest)
        void run(loadSummary);
    });
    return () => {
      cancelled = true;
    };
  }, [run]);

  // Without a usable token the collector only reads a file, so look again soon: the
  // reading should resume as soon as Claude Code has refreshed the token.
  const result = summary?.status.endpointResult;
  const waitingForToken = summary?.endpointEnabled && (result === 'expired' || result === 'no-token');
  useEffect(() => {
    const timer = setInterval(() => void run(loadSummary), waitingForToken ? RETRY_MS : RELOAD_MS);
    return () => clearInterval(timer);
  }, [run, waitingForToken]);

  return (
    <TipProvider>
      <PatternDefs />
      <Header
        anonymous={anonymous}
        busy={busy}
        onRefresh={() => void run(refreshNow)}
        onToggleAnonymous={toggleAnonymous}
        onToggleTheme={toggleTheme}
        range={view?.choice}
        summary={shown}
        tab={tab}
        theme={theme}
      />
      <main>
        {error && (
          <p className="error" role="alert">
            <CircleX aria-hidden="true" className="icon-inline" size={16} />
            {error}
          </p>
        )}
        {shown && view
          ? (
              <>
                {tab === 'overview' && <Overview summary={shown} />}
                {tab === 'usage' && <Usage summary={shown} view={view} />}
                {tab === 'breakdown' && <Breakdown summary={shown} view={view} />}
                {tab === 'sessions' && <Sessions summary={shown} view={view} />}
                {tab === 'weeks' && <Weeks summary={shown} view={view} />}
                {tab === 'plans' && <Plans summary={shown} />}
                {tab === 'calibration' && (
                  <Calibration
                    busy={busy}
                    onAddReading={reading => run(() => addReading(reading))}
                    onDeleteReading={ts => run(() => deleteReading(ts))}
                    onSaveSettings={settings => run(() => saveSettings(settings))}
                    summary={shown}
                  />
                )}
              </>
            )
          : !error && <p className="empty">Loading…</p>}
      </main>
    </TipProvider>
  );
}
