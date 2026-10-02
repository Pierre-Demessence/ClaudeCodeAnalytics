import { useCallback, useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'cca-theme';

// Storage can throw (private mode, blocked site data): the theme then lasts for the page only.
function readStored(): Theme | undefined {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'dark' || value === 'light' ? value : undefined;
  }
  catch {
    return undefined;
  }
}

function store(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  }
  catch {}
}

function osTheme(): Theme {
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Effective theme and a toggle. Until the user picks one, no `data-theme` is
 * set and the stylesheet follows the OS scheme.
 */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [chosen, setChosen] = useState(readStored);
  const [os, setOs] = useState(osTheme);

  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setOs(osTheme());
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (chosen)
      document.documentElement.dataset.theme = chosen;
    else
      delete document.documentElement.dataset.theme;
  }, [chosen]);

  const theme = chosen ?? os;
  const toggle = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    store(next);
    setChosen(next);
  }, [theme]);

  return { theme, toggle };
}
