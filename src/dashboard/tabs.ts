import { useCallback, useEffect, useState } from 'react';

import type { RangeChoice } from '@/core/range';

import { formatRangeQuery, parseRangeQuery } from '@/core/range';

export const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'usage', label: 'Usage' },
  { id: 'breakdown', label: 'Breakdown' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'weeks', label: 'Weeks' },
  { id: 'plans', label: 'Plans' },
  { id: 'calibration', label: 'Calibration' },
] as const;

export type TabId = (typeof TABS)[number]['id'];

/** The tabs that read the shared history range; their links and hashes carry it. */
const HISTORY_TABS: readonly TabId[] = ['usage', 'breakdown', 'sessions', 'weeks'];

export const hasRange = (id: TabId) => HISTORY_TABS.includes(id);

/** `#/<id>`, followed by the range for a history tab. */
export function tabHref(id: TabId, range?: RangeChoice): string {
  return range && hasRange(id) ? `#/${id}?${formatRangeQuery(range)}` : `#/${id}`;
}

/** The path and the query of a hash, without the `#/` and the `?`. */
function splitHash(hash: string): { path: string; query: string } {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?');
  return { path, query };
}

/** The tab named by a `#/<id>` hash, whatever follows a `?`; Overview for anything else. */
export function tabFromHash(hash: string): TabId {
  const id = splitHash(hash).path;
  return TABS.find(tab => tab.id === id)?.id ?? 'overview';
}

/** The range named by the hash's query; undefined for none or an invalid one. */
export function rangeFromHash(hash: string): RangeChoice | undefined {
  return parseRangeQuery(splitHash(hash).query);
}

/** Active tab, kept in the URL hash so the back button and bookmarks work. */
export function useTab(): TabId {
  const [tab, setTab] = useState(() => tabFromHash(location.hash));
  useEffect(() => {
    const onChange = () => setTab(tabFromHash(location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return tab;
}

/**
 * The history range, kept in the hash's query (`#/usage?range=week`) so back,
 * reload and bookmarks restore it. Choosing a range writes it into the current
 * tab's hash, and the tab links carry it from there; the other tabs have none
 * in their hash, so it is kept while they are open. Undefined shows each
 * view's default window.
 */
export function useRangeChoice(): [RangeChoice | undefined, (choice: RangeChoice | undefined) => void] {
  const [choice, setChoice] = useState(() => rangeFromHash(location.hash));
  useEffect(() => {
    const onChange = () => {
      if (hasRange(tabFromHash(location.hash)))
        setChoice(rangeFromHash(location.hash));
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const choose = useCallback((next: RangeChoice | undefined) => {
    // A hashchange event is what updates the state, so the back button follows the same path.
    location.hash = tabHref(tabFromHash(location.hash), next).slice(1);
  }, []);
  return [choice, choose];
}
