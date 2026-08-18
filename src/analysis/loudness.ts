import { tryRun } from '../ffmpeg/engine';
import { toNativePath } from '../utils/paths';
import { parseEbur128, type LoudnessReading } from './parse';

export { parseEbur128 };
export type { LoudnessReading };

/**
 * Measures integrated loudness with `ebur128`.
 *
 * Instagram, TikTok and YouTube all normalise uploads to roughly -14 LUFS. Going
 * in hotter just means the platform turns it down and the mix loses punch, so
 * the editor shows the measured value and targets it on export.
 */
export async function measureLoudness(pathOrUri: string): Promise<LoudnessReading | null> {
  const result = await tryRun([
    '-hide_banner',
    '-nostdin',
    '-i', toNativePath(pathOrUri),
    '-af', 'ebur128=peak=true',
    '-vn',
    '-f', 'null',
    '-',
  ]);
  return parseEbur128(result.logs);
}
