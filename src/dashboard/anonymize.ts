import { useCallback, useState } from 'react';

import type { RangedSummary } from '@/core/ranged';
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

/** The masking of each kind of section, sharing one set of labels so the same project reads the same everywhere. */
function masker() {
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
    activity: (activity: Summary['activity']): Summary['activity'] => ({
      ...activity,
      messageCost: { ...activity.messageCost, outliers: maskAll(activity.messageCost.outliers) },
    }),
    breakdown: (breakdown: Summary['breakdown']): Summary['breakdown'] => ({
      ...breakdown,
      projects: maskAll(breakdown.projects),
      conversations: breakdown.conversations.map(c => ({
        ...mask(c),
        branch: c.branch === undefined ? undefined : branch(c.branch),
        title: c.title === undefined ? undefined : conversation(c.sessionId),
      })),
    }),
    sessions: (sessions: Summary['sessions']): Summary['sessions'] => ({
      ...sessions,
      windows: sessions.windows.map(w => ({ ...w, projects: maskAll(w.projects) })),
    }),
    weekHistory: (weekHistory: Summary['weekHistory']): Summary['weekHistory'] => ({
      ...weekHistory,
      weeks: weekHistory.weeks.map(w => ({ ...w, projects: maskAll(w.projects) })),
    }),
  };
}

/**
 * A copy of `summary` without project names, directories, branches or
 * conversation titles. The same project reads the same in every view. Display
 * only: the API and the data dir keep the real values.
 */
export function anonymizeSummary(summary: Summary): Summary {
  const masks = masker();
  return {
    ...summary,
    // Node file errors quote absolute paths (user name, project folders).
    activity: masks.activity(summary.activity),
    breakdown: masks.breakdown(summary.breakdown),
    sessions: masks.sessions(summary.sessions),
    status: { ...summary.status, lastError: undefined },
    weekHistory: masks.weekHistory(summary.weekHistory),
  };
}

/**
 * The same masking for the views of a range. Labels are handed out by first
 * appearance within what is masked, so a project can read differently here and
 * in the summary's own views.
 */
export function anonymizeRanged(ranged: RangedSummary): RangedSummary {
  const masks = masker();
  return {
    ...ranged,
    activity: masks.activity(ranged.activity),
    breakdown: masks.breakdown(ranged.breakdown),
    sessions: masks.sessions(ranged.sessions),
    weekHistory: masks.weekHistory(ranged.weekHistory),
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
