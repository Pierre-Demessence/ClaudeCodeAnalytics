import { useCallback, useState } from 'react';

import type { Summary } from '@/dashboard/api';

const STORAGE_KEY = 'cca-anonymize';

/** Hands out `<prefix> 1`, `<prefix> 2`… by first appearance, the same one for the same value. */
function labeler(prefix: string) {
  const labels = new Map<string, string>();
  return (value: string) => {
    let label = labels.get(value);
    if (label === undefined) {
      label = `${prefix} ${labels.size + 1}`;
      labels.set(value, label);
    }
    return label;
  };
}

/**
 * A copy of `summary` without project names, directories, branches or
 * conversation titles. The same project reads the same in every view. Display
 * only: the API and the data dir keep the real values.
 */
export function anonymizeSummary(summary: Summary): Summary {
  const project = labeler('Project');
  const conversation = labeler('Conversation');
  const branch = labeler('branch');
  // A project is identified by its directory; its name and path both become its label.
  const mask = <T extends { name: string; path: string }>(item: T): T => {
    const label = project(item.path);
    return { ...item, name: label, path: label };
  };
  const maskAll = <T extends { name: string; path: string }>(items: T[]): T[] => items.map(mask);

  return {
    ...summary,
    // Node file errors quote absolute paths (user name, project folders).
    status: { ...summary.status, lastError: undefined },
    activity: {
      ...summary.activity,
      messageCost: { ...summary.activity.messageCost, outliers: maskAll(summary.activity.messageCost.outliers) },
    },
    breakdown: Object.fromEntries(Object.entries(summary.breakdown).map(([period, breakdown]) => [period, {
      ...breakdown,
      projects: maskAll(breakdown.projects),
      conversations: breakdown.conversations.map(c => ({
        ...mask(c),
        branch: c.branch === undefined ? undefined : branch(c.branch),
        title: c.title === undefined ? undefined : conversation(c.sessionId),
      })),
    }])) as Summary['breakdown'],
    sessions: {
      ...summary.sessions,
      windows: summary.sessions.windows.map(w => ({ ...w, projects: maskAll(w.projects) })),
    },
    weekHistory: {
      ...summary.weekHistory,
      weeks: summary.weekHistory.weeks.map(w => ({ ...w, projects: maskAll(w.projects) })),
    },
  };
}

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on';
  }
  catch {
    return false;
  }
}

/** Whether the dashboard hides names, and a toggle; the choice survives a reload. */
export function useAnonymize(): { anonymous: boolean; toggle: () => void } {
  const [anonymous, setAnonymous] = useState(readStored);
  const toggle = useCallback(() => {
    const next = !anonymous;
    try {
      if (next)
        localStorage.setItem(STORAGE_KEY, 'on');
      else
        localStorage.removeItem(STORAGE_KEY);
    }
    catch {}
    setAnonymous(next);
  }, [anonymous]);
  return { anonymous, toggle };
}
