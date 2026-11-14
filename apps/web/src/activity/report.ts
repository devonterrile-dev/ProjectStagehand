/**
 * The Activity test's result as a block of text to copy (governance §13). It holds what was
 * found and nothing about who ran it: no Discord name, id or token. Pure.
 */
import { PROBE_IDS, PROBE_LABELS, type ProbeId, type ProbeResult } from './probes';

export interface SpeakingCounts {
  starts: number;
  stops: number;
  /** How many different people were heard. */
  people: number;
}

export interface ActivityReport {
  inFrame: boolean;
  /** "Chrome 142", from `browserName`. */
  browser: string;
  results: Partial<Record<ProbeId, ProbeResult>>;
  speaking: SpeakingCounts;
  /** The stage test's own result line, once a measurement has run. */
  stageLine: string | null;
}

const plural = (count: number, one: string, many: string): string =>
  `${String(count)} ${count === 1 ? one : many}`;

export function formatSpeaking(counts: SpeakingCounts): string {
  return (
    `${plural(counts.starts, 'start', 'starts')} and ${plural(counts.stops, 'stop', 'stops')} ` +
    `from ${plural(counts.people, 'person', 'people')}`
  );
}

export function formatActivityReport(report: ActivityReport): string {
  const lines = [
    `Activity test: ${report.inFrame ? 'inside Discord' : 'in a browser tab'}, ${report.browser}`,
  ];
  for (const id of PROBE_IDS) {
    const result = report.results[id];
    let line = `- ${PROBE_LABELS[id]}: `;
    if (result === undefined) line += 'not run';
    else {
      line += `${result.status}, ${result.detail}`;
      if (id === 'speaking' && result.status === 'ok')
        line += `; ${formatSpeaking(report.speaking)}`;
    }
    lines.push(line);
  }
  lines.push(report.stageLine ?? 'Stage test: not measured');
  return lines.join('\n');
}
