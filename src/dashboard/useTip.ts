import type { FocusEvent, PointerEvent, ReactNode } from 'react';

import { createContext, use, useCallback } from 'react';

export interface TipApi {
  hide: (anchor: Element) => void;
  show: (anchor: Element, content: ReactNode) => void;
}

/** Provided by `TipProvider` (Tip.tsx); without it, tooltips are inert. */
export const TipContext = createContext<TipApi | undefined>(undefined);

/**
 * Returns `tip(content)`, the props that give an element a tooltip: shown on
 * mouse hover, keyboard focus and tap. Pass `focusable: false` for dense
 * marks (heatmap cells) that would flood the tab order.
 */
export function useTip() {
  const api = use(TipContext);
  return useCallback((content: ReactNode, { focusable = true }: { focusable?: boolean } = {}) => ({
    tabIndex: focusable ? 0 : undefined,
    onBlur: (e: FocusEvent<Element>) => api?.hide(e.currentTarget),
    onFocus: (e: FocusEvent<Element>) => api?.show(e.currentTarget, content),
    onPointerEnter: (e: PointerEvent<Element>) => {
      if (e.pointerType === 'mouse')
        api?.show(e.currentTarget, content);
    },
    onPointerLeave: (e: PointerEvent<Element>) => {
      if (e.pointerType === 'mouse')
        api?.hide(e.currentTarget);
    },
    onPointerUp: (e: PointerEvent<Element>) => {
      if (e.pointerType !== 'mouse')
        api?.show(e.currentTarget, content);
    },
  }), [api]);
}
