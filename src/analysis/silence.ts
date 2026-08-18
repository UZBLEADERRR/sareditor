import type { Segment } from '../types/project';
import { uid } from '../utils/id';
import { tryRun } from '../ffmpeg/engine';
import { toNativePath } from '../utils/paths';
import { parseSilenceLog, type SilenceRange } from './parse';

export { parseSilenceLog };
export type { SilenceRange };
export { segmentsFromSilence, silenceSavings, type AutoCutOptions } from './autocut';

export type SilenceOptions = {
  /** Anything quieter than this counts as silence. */
  noiseDb?: number;
  /** Ignore pauses shorter than this. */
  minSilenceMs?: number;
};

/**
 * Finds the pauses in the source audio with ffmpeg's `silencedetect`.
 *
 * This is the measurement that powers auto-montage: cut the dead air out of a
 * talking-head recording and a 3 minute take becomes a 50 second Reel without
 * anyone touching a timeline.
 */
export async function detectSilence(
  pathOrUri: string,
  options: SilenceOptions = {}
): Promise<SilenceRange[]> {
  const noiseDb = options.noiseDb ?? -32;
  const minSilenceMs = options.minSilenceMs ?? 450;

  const result = await tryRun([
    '-hide_banner',
    '-nostdin',
    '-i', toNativePath(pathOrUri),
    '-af', `silencedetect=noise=${noiseDb}dB:d=${(minSilenceMs / 1000).toFixed(3)}`,
    '-f', 'null',
    '-',
  ]);

  return parseSilenceLog(result.logs);
}
