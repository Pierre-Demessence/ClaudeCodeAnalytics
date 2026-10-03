import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { InfoTip, TipProvider } from '@/dashboard/Tip';
import { useTip } from '@/dashboard/useTip';

function Target({ label }: { label: string }) {
  const tip = useTip();
  return <span {...tip(`About ${label}`)}>{label}</span>;
}

function renderTargets() {
  render(
    <TipProvider>
      <Target label="one" />
      <Target label="two" />
      <p>elsewhere</p>
    </TipProvider>,
  );
}

describe('tip', () => {
  afterEach(cleanup);

  it('shows on mouse hover and hides on leave', () => {
    renderTargets();
    fireEvent.pointerEnter(screen.getByText('one'), { pointerType: 'mouse' });
    expect(screen.getByRole('tooltip').textContent).toBe('About one');
    fireEvent.pointerLeave(screen.getByText('one'), { pointerType: 'mouse' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('describes the focused element and hides on blur', () => {
    renderTargets();
    const one = screen.getByText('one');
    fireEvent.focus(one);
    expect(one.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id);
    fireEvent.blur(one);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(one.getAttribute('aria-describedby')).toBeNull();
  });

  it('shows on tap and closes on a tap elsewhere', () => {
    renderTargets();
    fireEvent.pointerUp(screen.getByText('one'), { pointerType: 'touch' });
    expect(screen.getByRole('tooltip').textContent).toBe('About one');
    fireEvent.pointerDown(screen.getByText('elsewhere'));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('moves to another target and closes with Escape', () => {
    renderTargets();
    fireEvent.focus(screen.getByText('one'));
    fireEvent.focus(screen.getByText('two'));
    expect(screen.getByRole('tooltip').textContent).toBe('About two');
    // The previous target's blur must not hide the new one.
    fireEvent.blur(screen.getByText('one'));
    expect(screen.getByRole('tooltip').textContent).toBe('About two');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('gives the info icon an accessible name and its tooltip', () => {
    render(<TipProvider><InfoTip label="About cache">Share of input from cache.</InfoTip></TipProvider>);
    fireEvent.focus(screen.getByRole('button', { name: 'About cache' }));
    expect(screen.getByRole('tooltip').textContent).toBe('Share of input from cache.');
  });
});
