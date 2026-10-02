import type { Summary } from '@/dashboard/api';
import type { TabId } from '@/dashboard/tabs';
import type { Theme } from '@/dashboard/theme';

import { PLAN_LABELS } from '@/core/plans';
import { formatDateTime, formatRelative } from '@/dashboard/format';
import { tabHref, TABS } from '@/dashboard/tabs';
import { useNow } from '@/dashboard/useNow';

interface Props {
  busy: boolean;
  summary?: Summary;
  tab: TabId;
  theme: Theme;
  onRefresh: () => void;
  onToggleTheme: () => void;
}

function MoonIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="18">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeWidth="2" viewBox="0 0 24 24" width="18">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

export function Header({ busy, onRefresh, onToggleTheme, summary, tab, theme }: Props) {
  const now = useNow();
  const readAt = summary?.current?.readAt;
  const themeLabel = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="app-header-top">
          <h1>Claude Code usage</h1>
          {summary && (
            <span className="plan-badge" title="Plan in effect now; set it in the Calibration tab.">
              {PLAN_LABELS[summary.plan]}
            </span>
          )}
          <span className="app-header-spacer" />
          {busy && <span className="busy">Updating…</span>}
          {summary && (
            <span className="last-reading" title={readAt ? `Last plan-limit reading: ${formatDateTime(readAt)}` : 'No plan-limit reading for the current week yet.'}>
              {readAt ? `Last reading ${formatRelative(readAt, now)}` : 'No reading yet'}
            </span>
          )}
          <button
            disabled={busy}
            onClick={onRefresh}
            title="Imports transcripts and calls the usage endpoint now. The endpoint is rate-limited, so avoid repeated clicks."
            type="button"
          >
            Refresh
          </button>
          <button aria-label={themeLabel} className="icon-button" onClick={onToggleTheme} title={themeLabel} type="button">
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
        <nav aria-label="Sections" className="tabs">
          {TABS.map(({ id, label }) => (
            <a aria-current={id === tab ? 'page' : undefined} href={tabHref(id)} key={id}>{label}</a>
          ))}
        </nav>
      </div>
    </header>
  );
}
