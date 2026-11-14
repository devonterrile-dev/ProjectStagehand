/**
 * The one-line result of a stage performance measurement (F3.1), made to be pasted into
 * Discord: what was drawn, on what, and how smoothly. Pure.
 */
import type { FrameSummary } from './frame-stats';

/** Most specific first: every Chromium browser also says "Chrome", and Chrome says "Safari". */
const BROWSERS: readonly (readonly [string, RegExp])[] = [
  ['Discord', /discord\/(\d+(?:\.\d+)?)/i],
  ['Edge', /Edg\/(\d+)/],
  ['Opera', /OPR\/(\d+)/],
  ['Firefox', /Firefox\/(\d+)/],
  ['Chrome', /Chrome\/(\d+)/],
  ['Safari', /Version\/(\d+).*Safari/],
];

/** "Firefox 145" from a user agent string. */
export function browserName(userAgent: string): string {
  for (const [name, pattern] of BROWSERS) {
    const version = pattern.exec(userAgent)?.[1];
    if (version !== undefined) return `${name} ${version}`;
  }
  return 'Unknown browser';
}

export interface PerfReport {
  objects: number;
  browser: string;
  gpu: string;
  /** The stage's size on screen, in CSS pixels. */
  width: number;
  height: number;
  pixelRatio: number;
  summary: FrameSummary;
}

const GPU_MAX = 90;

export function formatReport(report: PerfReport): string {
  const gpu = report.gpu.length > GPU_MAX ? `${report.gpu.slice(0, GPU_MAX - 1)}…` : report.gpu;
  const ratio = Number(report.pixelRatio.toFixed(2));
  return (
    `Stage test: ${String(report.objects)} objects, ${report.browser}, ${gpu}, ` +
    `${String(Math.round(report.width))}×${String(Math.round(report.height))} at ${String(ratio)}x: ` +
    `average ${String(Math.round(report.summary.averageFps))} fps, ` +
    `slowest 1% ${String(Math.round(report.summary.lowFps))} fps`
  );
}
