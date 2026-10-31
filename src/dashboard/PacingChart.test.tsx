import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { WeekPacing } from '@/core/pacing';

import { DAY_MS, WEEK_MS } from '@/core/calibration';
import { PacingChart } from '@/dashboard/PacingChart';
import { TipProvider } from '@/dashboard/Tip';

const TO = Date.parse('2026-10-28T20:00:00Z');
const FROM = TO - WEEK_MS;
const RESTART = FROM + 5.5 * DAY_MS;
const NOW = RESTART + DAY_MS;

const whole: WeekPacing = {
  from: FROM,
  points: [{ at: FROM, percent: 0 }, { at: FROM + DAY_MS, percent: 20 }, { at: NOW, percent: 50 }],
  to: TO,
};
const restarted: WeekPacing = {
  earlier: [{ plan: 'pro', points: [{ at: FROM, percent: 0 }, { at: FROM + 2 * DAY_MS, percent: 100 }] }],
  from: FROM,
  points: [{ at: RESTART, percent: 0 }, { at: NOW, percent: 5 }],
  restart: { at: RESTART, plan: 'max5', previousPlan: 'pro' },
  to: TO,
};

function renderChart(pacing: WeekPacing, usedNow: number) {
  return render(<TipProvider><PacingChart now={NOW} pacing={pacing} usedNow={usedNow} /></TipProvider>);
}

/** The x of a point of a polyline, by index. */
const pointOf = (line: Element, i: number) => line.getAttribute('points')!.split(' ')[i]!.split(',').map(Number) as [number, number];

describe('pacing chart', () => {
  afterEach(cleanup);

  it('draws nothing of a restart for a week that never restarted', () => {
    const { container } = renderChart(whole, 50);
    expect(container.querySelector('.pacing-earlier')).toBeNull();
    expect(container.querySelector('.pacing-restart')).toBeNull();
    expect(container.querySelector('.legend-earlier')).toBeNull();
    const even = container.querySelector('.pacing-even')!;
    expect(Number(even.getAttribute('x1'))).toBe(Number(pointOf(container.querySelector('.pacing-actual')!, 0)[0]));
  });

  describe('after a plan change', () => {
    it('draws the earlier part as its own line, with a legend entry', () => {
      const { container, getByText } = renderChart(restarted, 5);
      const earlier = container.querySelector('.pacing-earlier')!;
      expect(earlier.tagName).toBe('polyline');
      expect(earlier.getAttribute('points')!.split(' ')).toHaveLength(2);
      expect(container.querySelector('.legend-earlier')).not.toBeNull();
      expect(getByText('before the plan change')).toBeTruthy();
    });

    it('labels the restart with the new plan and the time', () => {
      const { container } = renderChart(restarted, 5);
      expect(container.querySelector('.pacing-restart')).not.toBeNull();
      expect(container.textContent).toMatch(/Max from \w{3} \d{2}:\d{2}/);
    });

    it('starts the actual line and the even pace at the restart, at 0%', () => {
      const { container } = renderChart(restarted, 5);
      const restartX = Number(container.querySelector('.pacing-restart')!.getAttribute('x1'));
      const [firstX, firstY] = pointOf(container.querySelector('.pacing-actual')!, 0);
      expect(firstX).toBe(restartX);
      const even = container.querySelector('.pacing-even')!;
      expect(Number(even.getAttribute('x1'))).toBe(restartX);
      // 0% sits on the bottom of the plot.
      expect(firstY).toBe(Number(even.getAttribute('y1')));
      expect(firstY).toBe(200);
    });
  });

  describe('after a reset without a plan change', () => {
    it('says the usage was reset and names the earlier part accordingly', () => {
      const reset: WeekPacing = { ...restarted, restart: { at: RESTART, plan: 'pro', previousPlan: 'pro' } };
      const { container, getByText } = renderChart(reset, 5);
      expect(container.textContent).toMatch(/usage reset \w{3} \d{2}:\d{2}/);
      expect(getByText('before the reset')).toBeTruthy();
    });
  });
});
