import type { Segment, Word } from '../types/project';

export type PlacedSegment = {
  segment: Segment;
  /** Position of this segment on the exported timeline. */
  outStartMs: number;
  outEndMs: number;
  /** Duration after the speed change, before any transition overlap. */
  playedMs: number;
};

export type Timeline = {
  totalMs: number;
  placed: PlacedSegment[];
  transitionMs: number;
};

/**
 * Lays the kept segments out on the export timeline.
 *
 * Two things shift the clock away from source time: per-segment speed, and
 * cross-transitions, which overlap neighbours and therefore shorten the whole
 * piece by `(count - 1) * transition`. Captions, beat pulses and fades all read
 * their positions from here, so getting this right is what keeps everything in
 * sync.
 */
export function buildTimeline(segments: Segment[], transitionMs = 0): Timeline {
  const usable = segments.filter((s) => s.endMs > s.startMs);
  const overlap = usable.length > 1 ? Math.max(0, transitionMs) : 0;

  let cursor = 0;
  const placed: PlacedSegment[] = usable.map((segment, index) => {
    const speed = segment.speed > 0 ? segment.speed : 1;
    const playedMs = (segment.endMs - segment.startMs) / speed;
    const outStartMs = index === 0 ? 0 : cursor - overlap;
    const outEndMs = outStartMs + playedMs;
    cursor = outEndMs;
    return { segment, outStartMs, outEndMs, playedMs };
  });

  return {
    totalMs: placed.length ? placed[placed.length - 1].outEndMs : 0,
    placed,
    transitionMs: overlap,
  };
}

/** Maps a source timestamp onto the export timeline, or null if it was cut out. */
export function sourceToOutput(timeline: Timeline, sourceMs: number): number | null {
  for (const item of timeline.placed) {
    const { segment } = item;
    if (sourceMs >= segment.startMs && sourceMs <= segment.endMs) {
      const speed = segment.speed > 0 ? segment.speed : 1;
      return item.outStartMs + (sourceMs - segment.startMs) / speed;
    }
  }
  return null;
}

/**
 * Rebases transcript words onto the export timeline and drops anything that
 * landed on the cutting room floor. Words straddling a cut are clipped rather
 * than removed, so a caption never disappears mid-syllable.
 */
export function mapWordsToTimeline(timeline: Timeline, words: Word[]): Word[] {
  const mapped: Word[] = [];

  for (const word of words) {
    for (const item of timeline.placed) {
      const { segment } = item;
      const overlapStart = Math.max(word.startMs, segment.startMs);
      const overlapEnd = Math.min(word.endMs, segment.endMs);
      if (overlapEnd <= overlapStart) continue;

      const speed = segment.speed > 0 ? segment.speed : 1;
      const start = item.outStartMs + (overlapStart - segment.startMs) / speed;
      const end = item.outStartMs + (overlapEnd - segment.startMs) / speed;
      mapped.push({ ...word, startMs: Math.round(start), endMs: Math.round(Math.max(end, start + 60)) });
      break;
    }
  }

  return mapped.sort((a, b) => a.startMs - b.startMs);
}

/** Beats live in music-file time; the mix starts at `musicStartMs`. */
export function mapBeatsToTimeline(beats: number[], musicStartMs: number, totalMs: number): number[] {
  return beats
    .map((ms) => ms - musicStartMs)
    .filter((ms) => ms >= 0 && ms <= totalMs);
}

/** Inverts the cut list: everything the user chose to remove. */
export function invertSegments(
  segments: Segment[],
  durationMs: number
): { startMs: number; endMs: number }[] {
  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs);
  const gaps: { startMs: number; endMs: number }[] = [];
  let cursor = 0;
  for (const segment of sorted) {
    if (segment.startMs > cursor) gaps.push({ startMs: cursor, endMs: segment.startMs });
    cursor = Math.max(cursor, segment.endMs);
  }
  if (cursor < durationMs) gaps.push({ startMs: cursor, endMs: durationMs });
  return gaps;
}
