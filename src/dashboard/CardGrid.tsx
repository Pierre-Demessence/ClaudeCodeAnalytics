import type { ReactNode } from 'react';

/** Widths a cell can take, in twelfths of the row: 12 divides into halves, thirds and 2:1. */
export type Span = 4 | 6 | 12;

/**
 * A 12-column grid for cards shown side by side. Cells of a row stretch to the
 * row's height, so pair cards of similar height: a short card next to a tall
 * one leaves empty space in it. Below 900px every cell takes the full width.
 */
export function CardGrid({ children }: { children: ReactNode }) {
  return <div className="card-grid">{children}</div>;
}

export function Cell({ children, span }: { children: ReactNode; span: Span }) {
  return <div className={`card-cell span-${span}`}>{children}</div>;
}
