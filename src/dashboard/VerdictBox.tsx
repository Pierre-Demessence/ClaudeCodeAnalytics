import type { ReactNode } from 'react';

import { CircleAlert, CircleArrowDown, CircleCheck, Info, TriangleAlert } from 'lucide-react';

import type { VerdictKind } from '@/dashboard/verdict';

/** `big`: more than needed. Red like `cap`, with its own icon so the two read apart without color. */
export type BoxKind = VerdictKind | 'big';

const ICONS: Record<BoxKind, ReactNode> = {
  big: <CircleArrowDown aria-hidden="true" className="icon-critical" size={18} />,
  cap: <TriangleAlert aria-hidden="true" className="icon-critical" size={18} />,
  good: <CircleCheck aria-hidden="true" className="icon-good" size={18} />,
  info: <Info aria-hidden="true" className="icon-info" size={18} />,
  tight: <CircleAlert aria-hidden="true" className="icon-warning" size={18} />,
};

/** A one-line verdict: an icon, a bold title and a detail, on a tinted background. */
export function VerdictBox({ detail, kind, title }: { detail?: ReactNode; kind: BoxKind; title: string }) {
  return (
    <p className={`verdict verdict-${kind}`}>
      {ICONS[kind]}
      <span>
        <strong>{title}</strong>
        {detail && (
          <>
            {' '}
            {detail}
          </>
        )}
      </span>
    </p>
  );
}
