import { useEffect, useState } from 'react';

/** Current time, updated every `intervalMs`, so countdowns and "x minutes ago" stay live between data reloads. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
