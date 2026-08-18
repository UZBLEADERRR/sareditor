import type { Segment } from '../types/project';
import { uid } from '../utils/id';
import type { SilenceRange } from './parse';

export type AutoCutOptions = {
  /** Keep this much of the pause on each side so speech does not sound clipped. */
  paddingMs?: number;
  /** Discard resulting clips shorter than this. */
  minSegmentMs?: number;
  /** Stop adding segments once the montage reaches this length. */
  targetDurationMs?: number;
};

/**
 * Turns the detected pauses into a cut list.
 *
 * Padding matters more than it looks: trimming exactly at the silence boundary
 * chops the breath before a word and the tail of the last consonant, which is
 * what makes naive auto-cuts sound robotic.
 */
export function segmentsFromSilence(
  durationMs: number,
  silences: SilenceRange[],
  options: AutoCutOptions = {}
): Segment[] {
  const padding = options.paddingMs ?? 120;
  const minSegment = options.minSegmentMs ?? 350;

  const segments: Segment[] = [];
  let cursor = 0;

  for (const silence of silences) {
    const end = Math.min(durationMs, silence.startMs + padding);
    if (end - cursor >= minSegment) {
      segments.push({ id: uid('seg_'), startMs: Math.max(0, cursor), endMs: end, speed: 1 });
    }
    cursor = Math.max(cursor, silence.endMs - padding);
  }

  if (durationMs - cursor >= minSegment) {
    segments.push({ id: uid('seg_'), startMs: Math.max(0, cursor), endMs: durationMs, speed: 1 });
  }

  if (!segments.length) {
    return [{ id: uid('seg_'), startMs: 0, endMs: durationMs, speed: 1 }];
  }

  if (options.targetDurationMs) {
    return trimToTarget(segments, options.targetDurationMs);
  }
  return segments;
}

/** Drops the tail once the montage is long enough for the target platform. */
function trimToTarget(segments: Segment[], targetMs: number): Segment[] {
  const kept: Segment[] = [];
  let total = 0;
  for (const segment of segments) {
    const length = segment.endMs - segment.startMs;
    if (total + length <= targetMs) {
      kept.push(segment);
      total += length;
      continue;
    }
    const remaining = targetMs - total;
    if (remaining > 800) {
      kept.push({ ...segment, endMs: segment.startMs + remaining });
    }
    break;
  }
  return kept.length ? kept : segments.slice(0, 1);
}

/** How much shorter the montage is compared with the untouched take. */
export function silenceSavings(durationMs: number, segments: Segment[]): number {
  const kept = segments.reduce((total, s) => total + (s.endMs - s.startMs), 0);
  return Math.max(0, durationMs - kept);
}
