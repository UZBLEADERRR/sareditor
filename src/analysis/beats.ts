import { File } from 'expo-file-system';

import { tryRun } from '../ffmpeg/engine';
import { toNativePath, workFile } from '../utils/paths';
import { uid } from '../utils/id';
import { estimateBpm, parseRmsEnvelope, pickOnsets } from './parse';

export { estimateBpm, parseRmsEnvelope, pickOnsets };

/** 512 samples at 22.05 kHz ≈ 23 ms per analysis bucket. */
const SAMPLE_RATE = 22050;
const WINDOW_SAMPLES = 512;
const WINDOW_MS = (WINDOW_SAMPLES / SAMPLE_RATE) * 1000;

export type BeatAnalysis = {
  beats: number[];
  bpm: number;
  /** Per-window loudness envelope, kept for drawing the waveform. */
  envelope: number[];
  windowMs: number;
};

/**
 * On-device beat detection.
 *
 * ffmpeg has no beat tracker, but `astats` will report the RMS level of every
 * short window, and that envelope is enough: onsets are the sharp positive jumps
 * in energy. The result drives beat-synced zoom pulses and lets the AI place
 * cuts on the downbeat instead of mid-bar.
 */
export async function analyseBeats(pathOrUri: string, maxDurationMs = 240_000): Promise<BeatAnalysis> {
  const statsFile = workFile(`beats_${uid()}.txt`);
  if (statsFile.exists) statsFile.delete();

  const filter = [
    'aformat=channel_layouts=mono',
    `aresample=${SAMPLE_RATE}`,
    `asetnsamples=n=${WINDOW_SAMPLES}:p=0`,
    'astats=metadata=1:reset=1',
    `ametadata=print:key=lavfi.astats.Overall.RMS_level:file=${toNativePath(statsFile.uri)}`,
  ].join(',');

  await tryRun([
    '-hide_banner',
    '-nostdin',
    '-t', String(Math.round(maxDurationMs / 1000)),
    '-i', toNativePath(pathOrUri),
    '-af', filter,
    '-vn',
    '-f', 'null',
    '-',
  ]);

  let raw = '';
  try {
    raw = statsFile.exists ? statsFile.textSync() : '';
  } finally {
    if (statsFile.exists) statsFile.delete();
  }

  const envelope = parseRmsEnvelope(raw);
  const beats = pickOnsets(envelope, WINDOW_MS);
  return { beats, bpm: estimateBpm(beats), envelope, windowMs: WINDOW_MS };
}

/** Snaps a timestamp to the nearest detected beat, when one is close enough. */
export function snapToBeat(ms: number, beats: number[], toleranceMs = 180): number {
  let best = ms;
  let bestDelta = toleranceMs;
  for (const beat of beats) {
    const delta = Math.abs(beat - ms);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = beat;
    }
  }
  return best;
}
