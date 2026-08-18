/**
 * Pure parsers for ffmpeg's diagnostic output.
 *
 * These live apart from the modules that run ffmpeg so they can be exercised
 * directly against real ffmpeg logs in tests — the regexes here are the part
 * most likely to rot silently when a filter changes its wording.
 */

export type SilenceRange = { startMs: number; endMs: number };

export function parseSilenceLog(logs: string): SilenceRange[] {
  const ranges: SilenceRange[] = [];
  let pendingStart: number | null = null;

  for (const line of logs.split('\n')) {
    const start = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (start) {
      pendingStart = Math.max(0, Number(start[1]) * 1000);
      continue;
    }
    const end = line.match(/silence_end:\s*(-?[\d.]+)/);
    if (end && pendingStart !== null) {
      const endMs = Number(end[1]) * 1000;
      if (endMs > pendingStart) ranges.push({ startMs: pendingStart, endMs });
      pendingStart = null;
    }
  }
  return ranges;
}

export function parseSceneLog(logs: string): number[] {
  const times: number[] = [];
  const matcher = /pts_time:([\d.]+)/g;
  for (const line of logs.split('\n')) {
    if (!line.includes('showinfo')) continue;
    let match: RegExpExecArray | null;
    matcher.lastIndex = 0;
    while ((match = matcher.exec(line))) {
      const ms = Number(match[1]) * 1000;
      if (Number.isFinite(ms) && ms > 0) times.push(Math.round(ms));
    }
  }
  return Array.from(new Set(times)).sort((a, b) => a - b);
}

/** `ametadata=print` writes one `key=value` line per analysis window. */
export function parseRmsEnvelope(raw: string): number[] {
  const values: number[] = [];
  for (const line of raw.split('\n')) {
    const match = line.match(/lavfi\.astats\.Overall\.RMS_level=(-?[\d.]+|-inf)/);
    if (!match) continue;
    const db = match[1] === '-inf' ? -90 : Number(match[1]);
    // dBFS -> linear amplitude, floored so digital silence does not skew the mean.
    values.push(10 ** (Math.max(-90, db) / 20));
  }
  return values;
}

/**
 * Adaptive peak picking over the energy envelope.
 *
 * A fixed threshold fails the moment a track has a quiet intro, so each window
 * is compared against a rolling mean of its neighbourhood. A minimum spacing of
 * 220 ms keeps a single kick from registering three times.
 */
export function pickOnsets(envelope: number[], windowMs: number): number[] {
  if (envelope.length < 8) return [];

  // Half-wave rectified difference: only rising energy counts as an onset.
  const flux = envelope.map((value, index) =>
    index === 0 ? 0 : Math.max(0, value - envelope[index - 1])
  );

  const neighbourhood = Math.max(6, Math.round(400 / windowMs));
  const minSpacing = Math.max(1, Math.round(220 / windowMs));

  const beats: number[] = [];
  let lastIndex = -minSpacing;

  for (let i = 1; i < flux.length - 1; i += 1) {
    const from = Math.max(0, i - neighbourhood);
    const to = Math.min(flux.length, i + neighbourhood + 1);
    let sum = 0;
    for (let j = from; j < to; j += 1) sum += flux[j];
    const mean = sum / (to - from);
    const threshold = mean * 1.6 + 0.0025;

    if (
      flux[i] > threshold &&
      flux[i] >= flux[i - 1] &&
      flux[i] >= flux[i + 1] &&
      i - lastIndex >= minSpacing
    ) {
      beats.push(Math.round(i * windowMs));
      lastIndex = i;
    }
  }
  return beats;
}

/** Tempo from the most common inter-onset interval, folded into a musical range. */
export function estimateBpm(beats: number[]): number {
  if (beats.length < 4) return 0;

  const intervals: number[] = [];
  for (let i = 1; i < beats.length; i += 1) {
    const delta = beats[i] - beats[i - 1];
    if (delta > 200 && delta < 2000) intervals.push(delta);
  }
  if (!intervals.length) return 0;

  // 10 ms histogram bins: precise enough to separate tempos, coarse enough to
  // survive the jitter of an amplitude-based detector.
  const histogram = new Map<number, number>();
  for (const interval of intervals) {
    const bin = Math.round(interval / 10);
    histogram.set(bin, (histogram.get(bin) ?? 0) + 1);
  }
  const [bestBin] = [...histogram.entries()].sort((a, b) => b[1] - a[1])[0];
  let bpm = 60000 / (bestBin * 10);
  while (bpm < 70) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  return Math.round(bpm);
}

export type LoudnessReading = {
  integratedLufs: number;
  truePeakDb: number;
  loudnessRange: number;
};

/**
 * `ebur128` prints a running `I:` on every progress line, so only the block
 * after the final "Integrated loudness" header holds the real measurement.
 */
export function parseEbur128(logs: string): LoudnessReading | null {
  const summaryIndex = logs.lastIndexOf('Integrated loudness');
  if (summaryIndex === -1) return null;
  const tail = logs.slice(summaryIndex);

  const integrated = tail.match(/I:\s*(-?[\d.]+)\s*LUFS/);
  const range = tail.match(/LRA:\s*(-?[\d.]+)\s*LU/);
  const peak = tail.match(/Peak:\s*(-?[\d.]+)\s*dBFS/);

  if (!integrated) return null;
  return {
    integratedLufs: Number(integrated[1]),
    truePeakDb: peak ? Number(peak[1]) : 0,
    loudnessRange: range ? Number(range[1]) : 0,
  };
}
