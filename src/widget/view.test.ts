import { beforeEach, describe, expect, it } from 'vitest';

import type { WidgetView } from '../core/widget.ts';

import { createWidget } from './view.ts';

const now = Date.parse('2026-10-12T15:00:00Z');
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

const view: WidgetView = {
  fiveHour: { estimated: false, limit: 95, percent: 42, resetsAt: iso(now + 2 * HOUR + 59 * 60_000) },
  generatedAt: iso(now),
  weekly: { estimated: false, limit: 98, percent: 7, resetsAt: iso(now + 53 * HOUR) },
};

describe('taskbar widget', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('div');
  });

  const text = (row: number, cell: string) => root.querySelectorAll('.row')[row]!.querySelector(cell)!.textContent;

  it('shows the percent and the time left of both windows', () => {
    createWidget(root).update({ offline: false, view }, now);
    expect(text(0, '.label')).toBe('5h');
    expect(text(0, '.percent')).toBe('42%');
    expect(text(0, '.reset')).toBe('2h59m');
    expect(text(1, '.label')).toBe('7d');
    expect(text(1, '.percent')).toBe('7%');
    expect(text(1, '.reset')).toBe('2d05h');
  });

  it('fills the bar by the percent and exposes it as a progress bar', () => {
    createWidget(root).update({ offline: false, view }, now);
    const bar = root.querySelector('.bar')!;
    expect(bar.getAttribute('role')).toBe('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('42');
    expect((bar.querySelector('.fill') as HTMLElement).style.width).toBe('42%');
  });

  it('counts the time down between two fetches', () => {
    const widget = createWidget(root);
    widget.update({ offline: false, view }, now);
    widget.update({ offline: false, view }, now + 30 * 60_000);
    expect(text(0, '.reset')).toBe('2h29m');
  });

  it('prefixes an estimate with ~', () => {
    createWidget(root).update({ offline: false, view: { ...view, weekly: { ...view.weekly, estimated: true, percent: 61 } } }, now);
    expect(text(1, '.percent')).toBe('~61%');
  });

  it('marks a window at its limit with a class the stylesheet hatches', () => {
    createWidget(root).update({ offline: false, view: { ...view, fiveHour: { ...view.fiveHour, percent: 96 } } }, now);
    const rows = root.querySelectorAll('.row');
    expect(rows[0]!.classList.contains('at-limit')).toBe(true);
    expect(rows[1]!.classList.contains('at-limit')).toBe(false);
  });

  it('shows an idle window as 0% with a dash for the reset', () => {
    createWidget(root).update({ offline: false, view: { ...view, fiveHour: { estimated: false, limit: 95, percent: 0 } } }, now);
    expect(text(0, '.percent')).toBe('0%');
    expect(text(0, '.reset')).toBe('–');
  });

  it('shows dashes before the API has ever answered, and flags it offline', () => {
    createWidget(root).update({ offline: true }, now);
    expect(text(0, '.percent')).toBe('–');
    expect(text(1, '.reset')).toBe('–');
    expect(root.querySelector('.bar')!.hasAttribute('aria-valuenow')).toBe(false);
    expect(root.classList.contains('offline')).toBe(true);
    expect(root.querySelector('.offline-icon')).not.toBeNull();
  });

  it('keeps the last values when it goes offline', () => {
    const widget = createWidget(root);
    widget.update({ offline: false, view }, now);
    widget.update({ offline: true, view }, now);
    expect(text(0, '.percent')).toBe('42%');
    expect(root.classList.contains('offline')).toBe(true);
  });
});
