import type { Segment } from '../types/project';
import { uid } from '../utils/id';

/** Shorter than this and a piece is a glitch rather than a cut. */
export const MIN_SEGMENT_MS = 120;

/**
 * Segment-list surgery, shared by the manual timeline and the AI agent.
 *
 * Every function here takes and returns a sorted, non-overlapping list — the
 * two invariants the render pipeline depends on. Doing this in one place means
 * a cut typed into the chat and a cut made with a finger produce exactly the
 * same list.
 */
export function normalise(segments: Segment[]): Segment[] {
  return [...segments]
    .map((segment) => ({ ...segment, speed: segment.speed > 0 ? segment.speed : 1 }))
    .filter((segment) => segment.endMs - segment.startMs >= MIN_SEGMENT_MS)
    .sort((a, b) => a.startMs - b.startMs);
}

export function totalSourceMs(segments: Segment[]): number {
  return segments.reduce((sum, segment) => sum + (segment.endMs - segment.startMs), 0);
}

/** Length after speed changes — what the viewer actually sits through. */
export function playedMs(segments: Segment[]): number {
  return segments.reduce(
    (sum, segment) => sum + (segment.endMs - segment.startMs) / (segment.speed > 0 ? segment.speed : 1),
    0
  );
}

/** Cuts the piece under `atMs` in two. A cut on or near a boundary changes nothing. */
export function splitAt(segments: Segment[], atMs: number): Segment[] {
  const result: Segment[] = [];
  for (const segment of segments) {
    const inside = atMs > segment.startMs + MIN_SEGMENT_MS && atMs < segment.endMs - MIN_SEGMENT_MS;
    if (!inside) {
      result.push(segment);
      continue;
    }
    const cut = Math.round(atMs);
    result.push({ ...segment, endMs: cut });
    result.push({ ...segment, id: uid('seg_'), startMs: cut });
  }
  return normalise(result);
}

/** Removes one stretch of the original video, keeping everything around it. */
export function removeRange(segments: Segment[], startMs: number, endMs: number): Segment[] {
  if (endMs <= startMs) return normalise(segments);

  const result: Segment[] = [];
  for (const segment of segments) {
    const overlapStart = Math.max(segment.startMs, startMs);
    const overlapEnd = Math.min(segment.endMs, endMs);
    if (overlapEnd <= overlapStart) {
      result.push(segment);
      continue;
    }
    if (segment.startMs < overlapStart) {
      result.push({ ...segment, endMs: Math.round(overlapStart) });
    }
    if (segment.endMs > overlapEnd) {
      result.push({ ...segment, id: uid('seg_'), startMs: Math.round(overlapEnd) });
    }
  }
  return normalise(result);
}

/** Keeps only these stretches, in the order given. Used for a full re-cut. */
export function keepRanges(
  ranges: { startMs: number; endMs: number }[],
  durationMs: number,
  speedOf?: (startMs: number, endMs: number) => number
): Segment[] {
  const cleaned = ranges
    .map((range) => ({
      startMs: Math.max(0, Math.round(range.startMs)),
      endMs: Math.min(durationMs, Math.round(range.endMs)),
    }))
    .filter((range) => range.endMs - range.startMs >= MIN_SEGMENT_MS)
    .sort((a, b) => a.startMs - b.startMs);

  // Overlapping keeps would play the same footage twice; merge them instead.
  const merged: { startMs: number; endMs: number }[] = [];
  for (const range of cleaned) {
    const previous = merged[merged.length - 1];
    if (previous && range.startMs <= previous.endMs) {
      previous.endMs = Math.max(previous.endMs, range.endMs);
      continue;
    }
    merged.push({ ...range });
  }

  return merged.map((range) => ({
    id: uid('seg_'),
    startMs: range.startMs,
    endMs: range.endMs,
    speed: speedOf ? speedOf(range.startMs, range.endMs) : 1,
  }));
}

/**
 * Applies a speed to one stretch, splitting at both ends so the rest of the
 * video keeps playing at its own pace.
 */
export function setSpeedInRange(
  segments: Segment[],
  startMs: number,
  endMs: number,
  speed: number
): Segment[] {
  if (endMs <= startMs) return normalise(segments);
  const clamped = Math.min(4, Math.max(0.25, speed));
  const cut = splitAt(splitAt(segments, startMs), endMs);

  return normalise(
    cut.map((segment) =>
      segment.startMs >= startMs - 1 && segment.endMs <= endMs + 1
        ? { ...segment, speed: clamped }
        : segment
    )
  );
}

/** Trims one boundary without letting a piece cross its neighbours. */
export function resize(
  segments: Segment[],
  id: string,
  patch: { startMs?: number; endMs?: number }
): Segment[] {
  const ordered = normalise(segments);
  const index = ordered.findIndex((segment) => segment.id === id);
  if (index < 0) return ordered;

  const previous = ordered[index - 1];
  const next = ordered[index + 1];
  const current = ordered[index];

  const startMs =
    patch.startMs === undefined
      ? current.startMs
      : Math.min(
          Math.max(patch.startMs, previous ? previous.endMs : 0),
          current.endMs - MIN_SEGMENT_MS
        );
  const endMs =
    patch.endMs === undefined
      ? current.endMs
      : Math.max(
          Math.min(patch.endMs, next ? next.startMs : Number.MAX_SAFE_INTEGER),
          startMs + MIN_SEGMENT_MS
        );

  ordered[index] = { ...current, startMs: Math.round(startMs), endMs: Math.round(endMs) };
  return normalise(ordered);
}
