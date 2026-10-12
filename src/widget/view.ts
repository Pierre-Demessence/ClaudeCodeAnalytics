import type { WidgetRow, WidgetView } from '../core/widget.ts';

import { formatResetIn } from '../core/widget.ts';

export interface WidgetState {
  /** The last request failed: the values shown are old. */
  offline: boolean;
  /** The last answer; absent until the API has answered once. */
  view?: WidgetView;
}

interface RowElements {
  bar: HTMLElement;
  fill: HTMLElement;
  percent: HTMLElement;
  reset: HTMLElement;
  root: HTMLElement;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
// Lucide `wifi-off`: the values are old because the dashboard cannot be reached.
const OFFLINE_PATHS = [
  'M12 20h.01',
  'M8.5 16.429a5 5 0 0 1 7 0',
  'M5 12.859a10 10 0 0 1 5.17-2.69',
  'M19 12.859a10 10 0 0 0-2.007-1.523',
  'M2 8.82a15 15 0 0 1 4.177-2.643',
  'M22 8.82a15 15 0 0 0-11.288-3.764',
  'm2 2 20 20',
];

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined)
    node.textContent = text;
  return node;
}

function offlineIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'offline-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const d of OFFLINE_PATHS) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

function createRow(label: string): RowElements {
  const root = element('div', 'row');
  const bar = element('span', 'bar');
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  const fill = element('span', 'fill');
  bar.append(fill);
  const percent = element('span', 'percent');
  const reset = element('span', 'reset');
  root.append(element('span', 'label', label), bar, percent, element('span', 'dot', '•'), reset);
  return { bar, fill, percent, reset, root };
}

function updateRow(row: RowElements, label: string, data: WidgetRow | undefined, now: number) {
  const percent = data?.percent;
  const clamped = percent === undefined ? 0 : Math.min(100, Math.max(0, percent));
  row.percent.textContent = percent === undefined ? '–' : `${data?.estimated ? '~' : ''}${Math.round(percent)}%`;
  row.reset.textContent = data?.resetsAt ? formatResetIn(Date.parse(data.resetsAt) - now) : '–';
  row.fill.style.width = `${clamped}%`;
  row.root.classList.toggle('at-limit', percent !== undefined && data !== undefined && data.limit > 0 && percent >= data.limit);
  if (percent === undefined)
    row.bar.removeAttribute('aria-valuenow');
  else
    row.bar.setAttribute('aria-valuenow', String(Math.round(percent)));
  row.root.setAttribute('aria-label', `${label}: ${row.percent.textContent}, resets in ${row.reset.textContent}`);
}

/** Builds the two rows inside `root`; call `update` again whenever the state or the clock moves. */
export function createWidget(root: HTMLElement) {
  const fiveHour = createRow('5h');
  const weekly = createRow('7d');
  root.replaceChildren(fiveHour.root, weekly.root, offlineIcon());
  return {
    update(state: WidgetState, now: number) {
      updateRow(fiveHour, '5-hour limit', state.view?.fiveHour, now);
      updateRow(weekly, '7-day limit', state.view?.weekly, now);
      root.classList.toggle('offline', state.offline);
    },
  };
}
