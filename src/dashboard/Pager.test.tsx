import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Pager } from '@/dashboard/Pager';
import { usePage } from '@/dashboard/usePage';

describe('pager', () => {
  afterEach(cleanup);

  it('shows its text and calls back, with the unavailable direction disabled', () => {
    const onNext = vi.fn();
    const onPrevious = vi.fn();
    render(<Pager canNext canPrevious={false} label="Pages" onNext={onNext} onPrevious={onPrevious} text="Page 1 of 3" />);
    expect(screen.getByRole('navigation', { name: 'Pages' }).textContent).toBe('Page 1 of 3');
    expect((screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onNext).toHaveBeenCalledOnce();
    expect(onPrevious).not.toHaveBeenCalled();
  });
});

describe('usePage', () => {
  it('slices a list by page and clamps to the last page', () => {
    const { rerender, result } = renderHook(({ count }) => usePage(count, 25, 'a'), { initialProps: { count: 60 } });
    expect(result.current).toMatchObject({ end: 25, page: 0, pages: 3, start: 0 });
    act(() => result.current.setPage(2));
    expect(result.current).toMatchObject({ end: 60, page: 2, start: 50 });
    rerender({ count: 30 });
    expect(result.current).toMatchObject({ end: 30, page: 1, pages: 2, start: 25 });
  });

  it('goes back to the first page when the key changes', () => {
    const { rerender, result } = renderHook(({ key }) => usePage(60, 25, key), { initialProps: { key: 'a' } });
    act(() => result.current.setPage(1));
    expect(result.current.page).toBe(1);
    rerender({ key: 'b' });
    expect(result.current.page).toBe(0);
  });

  it('has one empty page without items', () => {
    const { result } = renderHook(() => usePage(0, 25, 'a'));
    expect(result.current).toMatchObject({ end: 0, page: 0, pages: 1, start: 0 });
  });
});
