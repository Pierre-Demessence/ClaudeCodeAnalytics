import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { HOUR_MS } from '@/core/calibration';
import { FamilyHours } from '@/dashboard/FamilyHours';
import { TipProvider } from '@/dashboard/Tip';

const items = [
  { family: 'opus', ms: 3 * HOUR_MS + 20 * 60_000 },
  { family: 'sonnet', lowConfidence: true, ms: 12 * HOUR_MS },
] as const;

describe('familyHours', () => {
  afterEach(cleanup);

  it('lists the active time left per family, named', () => {
    render(<FamilyHours items={items} />, { wrapper: TipProvider });
    const list = screen.getByRole('list', { name: 'Active use left if only one model is used' });
    expect(list.textContent).toContain('Opus');
    expect(list.textContent).toContain('3 h 20 min');
    expect(list.textContent).toContain('Sonnet');
    expect(list.textContent).toContain('12 h 0 min');
  });

  it('marks the family of the latest message with text, not only styling', () => {
    render(<FamilyHours current="sonnet" items={items} />, { wrapper: TipProvider });
    const sonnet = screen.getByText('Sonnet').closest('li')!;
    expect(sonnet.textContent).toContain('last used');
    expect(sonnet.className).toContain('current');
    expect(screen.getByText('Opus').closest('li')!.textContent).not.toContain('last used');
  });

  it('flags an estimated family and explains it on demand', () => {
    render(<FamilyHours items={items} />, { wrapper: TipProvider });
    expect(screen.getByText('Sonnet').closest('li')!.textContent).toContain('≈');
    expect(screen.getByText('Opus').closest('li')!.textContent).not.toContain('≈');
    const info = screen.getByRole('button', { name: 'About the Sonnet estimate' });
    fireEvent.focus(info);
    expect(screen.getByRole('tooltip').textContent).toContain('too little');
  });

  it('shows nothing without a family', () => {
    const { container } = render(<FamilyHours items={[]} />, { wrapper: TipProvider });
    expect(container.querySelector('ul')).toBeNull();
  });
});
