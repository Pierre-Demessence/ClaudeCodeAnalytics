import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { ModelRatio } from '@/core/modelRatio';

import { ModelRatioLine, ModelRatiosCard } from '@/dashboard/ModelRatios';
import { TipProvider } from '@/dashboard/Tip';

const opusSonnet: ModelRatio = { days: 12, from: 'opus', high: 2.1, hours: 1.7, low: 1.4, price: 2, to: 'sonnet', volume: 0.85 };
const opusHaiku: ModelRatio = { days: 9, from: 'opus', high: 2.9, hours: 2.3, low: 1.8, price: 4, to: 'haiku', volume: 0.575 };
const sonnetHaiku: ModelRatio = { days: 9, from: 'sonnet', high: 1.9, hours: 1.4, low: 1.1, price: 2, to: 'haiku', volume: 0.7 };

describe('modelRatioLine', () => {
  afterEach(cleanup);

  it('chains the lighter models from the heaviest one', () => {
    const { container } = render(<ModelRatioLine ratios={[opusSonnet, opusHaiku, sonnetHaiku]} />, { wrapper: TipProvider });
    const text = container.textContent ?? '';
    expect(text).toContain('1 h of Opus');
    expect(text).toContain('1.7 h of Sonnet');
    expect(text).toContain('2.3 h of Haiku');
    expect(text.indexOf('1.7 h of Sonnet')).toBeLessThan(text.indexOf('2.3 h of Haiku'));
  });

  it('links to the details', () => {
    render(<ModelRatioLine ratios={[opusSonnet]} />, { wrapper: TipProvider });
    expect(screen.getByRole('link', { name: 'Details' }).getAttribute('href')).toBe('#/breakdown');
  });

  it('says when a ratio is rough', () => {
    const { container } = render(<ModelRatioLine ratios={[{ ...opusSonnet, lowConfidence: true }]} />, { wrapper: TipProvider });
    expect(container.textContent).toContain('(rough)');
    fireEvent.focus(screen.getByRole('button', { name: 'About these ratios' }));
    expect(screen.getByRole('tooltip').textContent).toContain('rough');
  });

  it('shows nothing without a ratio', () => {
    const { container } = render(<ModelRatioLine ratios={[]} />, { wrapper: TipProvider });
    expect(container.textContent).toBe('');
  });
});

describe('modelRatiosCard', () => {
  afterEach(cleanup);

  it('lists each pair with its range, price and token split', () => {
    render(<ModelRatiosCard ratios={[opusSonnet, opusHaiku]} />, { wrapper: TipProvider });
    const row = screen.getByText('Sonnet').closest('tr')!;
    expect(row.textContent).toContain('1.7 h');
    expect(row.textContent).toContain('1.4–2.1');
    expect(row.textContent).toContain('range');
    expect(row.textContent).toContain('× 2.0');
    expect(row.textContent).toContain('× 0.85');
    expect(row.textContent).toContain('12');
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });

  it('states that the ratios describe the user\'s usage, not the models', () => {
    render(<ModelRatiosCard ratios={[opusSonnet]} />, { wrapper: TipProvider });
    expect(screen.getByText(/in your usage/i)).toBeTruthy();
  });

  it('marks a rough ratio and explains it on demand', () => {
    render(<ModelRatiosCard ratios={[{ ...opusSonnet, lowConfidence: true }]} />, { wrapper: TipProvider });
    expect(screen.getByText('Sonnet').closest('tr')!.textContent).toContain('≈ 1.7 h');
    fireEvent.focus(screen.getByRole('button', { name: 'About this rough ratio' }));
    expect(screen.getByRole('tooltip').textContent).toContain('same days');
  });

  it('explains what is needed when there is nothing to show', () => {
    render(<ModelRatiosCard ratios={[]} />, { wrapper: TipProvider });
    expect(screen.getByText(/at least 2 hours/)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
