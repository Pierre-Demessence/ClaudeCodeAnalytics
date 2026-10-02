import { useEffect, useState } from 'react';

export const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'usage', label: 'Usage' },
  { id: 'breakdown', label: 'Breakdown' },
  { id: 'calibration', label: 'Calibration' },
] as const;

export type TabId = (typeof TABS)[number]['id'];

export const tabHref = (id: TabId) => `#/${id}`;

/** The tab named by a `#/<id>` hash; Overview for anything else. */
export function tabFromHash(hash: string): TabId {
  const id = hash.replace(/^#\/?/, '');
  return TABS.find(tab => tab.id === id)?.id ?? 'overview';
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
