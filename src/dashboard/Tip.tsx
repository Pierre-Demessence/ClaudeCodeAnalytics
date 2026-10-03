import type { ReactNode } from 'react';

import { Info } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { TipApi } from '@/dashboard/useTip';

import { TipContext, useTip } from '@/dashboard/useTip';

/** Space between the anchor and the bubble, and between the bubble and the viewport edge. */
const GAP = 8;

/**
 * Owns the single tooltip bubble. It is positioned against the viewport, so
 * scrolling containers and `overflow: hidden` cards cannot clip it.
 */
export function TipProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<{ anchor: Element; content: ReactNode }>();
  const bubbleRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const api = useMemo<TipApi>(() => ({
    hide: anchor => setShown(current => (current?.anchor === anchor ? undefined : current)),
    show: (anchor, content) => setShown({ anchor, content }),
  }), []);

  // Above the anchor when it fits, below otherwise; always inside the viewport.
  useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    if (!shown || !bubble)
      return;
    const anchor = shown.anchor.getBoundingClientRect();
    const size = bubble.getBoundingClientRect();
    const left = Math.max(GAP, Math.min(anchor.left + anchor.width / 2 - size.width / 2, window.innerWidth - size.width - GAP));
    const above = anchor.top - GAP - size.height;
    bubble.style.left = `${left}px`;
    bubble.style.top = `${above >= GAP ? above : anchor.bottom + GAP}px`;
  }, [shown]);

  // A touch has no "leave": a tap elsewhere, Escape or scrolling closes the bubble.
  useEffect(() => {
    if (!shown)
      return;
    const { anchor } = shown;
    anchor.setAttribute('aria-describedby', id);
    const close = () => setShown(undefined);
    const onPointerDown = (e: Event) => {
      if (!(e.target instanceof Node && anchor.contains(e.target)))
        close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape')
        close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      anchor.removeAttribute('aria-describedby');
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [shown, id]);

  return (
    <TipContext value={api}>
      {children}
      {shown && createPortal(<div className="tip" id={id} ref={bubbleRef} role="tooltip">{shown.content}</div>, document.body)}
    </TipContext>
  );
}

/** An info icon explaining the label next to it. */
export function InfoTip({ children, label }: { children: ReactNode; label: string }) {
  const tip = useTip();
  return (
    <button aria-label={label} className="info-tip" type="button" {...tip(children)}>
      <Info aria-hidden="true" size={14} />
    </button>
  );
}
