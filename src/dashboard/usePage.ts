import { useState } from 'react';

/** The page of a list of `count` items, back at the first when `resetKey` changes (another range). */
export function usePage(count: number, size: number, resetKey: string) {
  const [state, setState] = useState({ key: resetKey, page: 0 });
  const pages = Math.max(1, Math.ceil(count / size));
  const page = Math.min(state.key === resetKey ? state.page : 0, pages - 1);
  return {
    end: Math.min(count, (page + 1) * size),
    page,
    pages,
    start: page * size,
    setPage: (next: number) => setState({ key: resetKey, page: next }),
  };
}
