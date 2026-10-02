import type { Series } from '@/dashboard/models';

import { SERIES } from '@/dashboard/models';

const INK = 'var(--pattern-ink)';

/** Overlay drawn on top of each series color, so series differ in texture too. */
function Texture({ family }: { family: Series['family'] }) {
  switch (family) {
    case 'opus':
      return null;
    case 'sonnet':
      return <path d="M-1,1 l2,-2 M0,6 l6,-6 M5,7 l2,-2" stroke={INK} strokeWidth="1.5" />;
    case 'haiku':
      return <circle cx="3" cy="3" fill={INK} r="1.2" />;
    case 'fable':
      return <path d="M-1,5 l2,2 M0,0 l6,6 M5,-1 l2,2" stroke={INK} strokeWidth="1.5" />;
    case 'other':
      return <path d="M0,3 h6 M3,0 v6" stroke={INK} strokeWidth="1.2" />;
  }
}

/** Shared SVG pattern definitions; render once per page. */
export function PatternDefs() {
  return (
    <svg aria-hidden="true" height="0" style={{ position: 'absolute' }} width="0">
      <defs>
        {SERIES.map(series => (
          <pattern height="6" id={series.pattern} key={series.family} patternUnits="userSpaceOnUse" width="6">
            <rect height="6" style={{ fill: series.color }} width="6" />
            <Texture family={series.family} />
          </pattern>
        ))}
        <pattern height="6" id="pattern-estimate" patternTransform="rotate(45)" patternUnits="userSpaceOnUse" width="6">
          <rect height="6" style={{ fill: 'var(--estimate-fill)' }} width="6" />
          <line stroke="var(--accent)" strokeWidth="2" x1="0" x2="0" y1="0" y2="6" />
        </pattern>
      </defs>
    </svg>
  );
}

export function Swatch({ series }: { series: Series }) {
  return (
    <svg aria-hidden="true" className="swatch" height="14" width="14">
      <rect fill={`url(#${series.pattern})`} height="14" rx="3" width="14" />
    </svg>
  );
}

export function Legend({ series }: { series: readonly Series[] }) {
  return (
    <ul className="legend">
      {series.map(s => (
        <li key={s.family}>
          <Swatch series={s} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}
