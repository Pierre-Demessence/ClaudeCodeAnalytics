import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Meter } from '@/dashboard/ThisWeek';

const measure = { trackPx: 500, labelPx: (text: string) => text.length * 7 };

describe('meter', () => {
  // Testing Library only cleans up automatically with Vitest globals, which this project does not use.
  afterEach(cleanup);

  it('labels segments inside and the range under its bracket', () => {
    const { container } = render(
      <Meter estimated={false} forecast={{ high: 93, low: 76, median: 84, method: 'calibrated' }} measure={measure} title="t" used={62} />,
    );
    expect(container.querySelector('.meter-fill')?.textContent).toBe('used 62%');
    expect(container.querySelector('.meter-projection')?.textContent).toBe('projected 84%');
    expect(container.querySelector('.meter-range-label')?.textContent).toBe('likely 76–93%');
    expect(container.querySelector('.meter-outside')).toBeNull();
  });

  it('marks the part past the limit', () => {
    const { container } = render(
      <Meter estimated={false} forecast={{ high: 131, low: 104, median: 118, method: 'calibrated' }} measure={measure} title="t" used={81} />,
    );
    expect(container.querySelector('.meter-over')?.textContent).toBe('▲ +18%');
    expect(container.querySelector('.meter-outside')?.textContent).toBe('projected 118%');
  });

  it('labels an empty used segment above the bar', () => {
    const { container } = render(<Meter estimated={false} measure={measure} title="t" used={0} />);
    expect(container.querySelector('.meter-outside')?.textContent).toBe('used 0%');
  });
});
