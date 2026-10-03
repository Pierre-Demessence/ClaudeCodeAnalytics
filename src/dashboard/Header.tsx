import { Moon, Sun } from 'lucide-react';

import type { Summary } from '@/dashboard/api';
import type { TabId } from '@/dashboard/tabs';
import type { Theme } from '@/dashboard/theme';

import { PLAN_LABELS } from '@/core/plans';
import { formatDateTime, formatRelative } from '@/dashboard/format';
import { tabHref, TABS } from '@/dashboard/tabs';
import { useNow } from '@/dashboard/useNow';
import { useTip } from '@/dashboard/useTip';

interface Props {
  busy: boolean;
  summary?: Summary;
  tab: TabId;
  theme: Theme;
  onRefresh: () => void;
  onToggleTheme: () => void;
}

export function Header({ busy, onRefresh, onToggleTheme, summary, tab, theme }: Props) {
  const now = useNow();
  const tip = useTip();
  const readAt = summary?.current?.readAt;
  const themeLabel = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="app-header-top">
          <h1>Claude Code usage</h1>
          {summary && (
            <span className="plan-badge">
              {PLAN_LABELS[summary.plan]}
            </span>
          )}
          <span className="app-header-spacer" />
          {busy && <span className="busy">Updating…</span>}
          {summary && (
            <span className="last-reading" {...tip(readAt ? `Last plan-limit reading: ${formatDateTime(readAt)}` : 'No plan-limit reading for the current week yet.')}>
              {readAt ? `Last reading ${formatRelative(readAt, now)}` : 'No reading yet'}
            </span>
          )}
          <button
            disabled={busy}
            onClick={onRefresh}
            {...tip('Imports transcripts and calls the usage endpoint now. The endpoint is rate-limited, so avoid repeated clicks.')}
            type="button"
          >
            Refresh
          </button>
          <button aria-label={themeLabel} className="icon-button" onClick={onToggleTheme} type="button" {...tip(themeLabel)}>
            {theme === 'dark' ? <Sun aria-hidden="true" size={18} /> : <Moon aria-hidden="true" size={18} />}
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
