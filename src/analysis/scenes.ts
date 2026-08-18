import { tryRun } from '../ffmpeg/engine';
import { toNativePath } from '../utils/paths';
import { parseSceneLog } from './parse';

export { parseSceneLog };

/**
 * Detects hard cuts in the source using ffmpeg's scene score.
 *
 * Used to offer "kadr almashgan joylardan kes" and to snap manual trim handles
 * onto real cuts instead of arbitrary timestamps.
 */
export async function detectScenes(pathOrUri: string, threshold = 0.35): Promise<number[]> {
  const result = await tryRun([
    '-hide_banner',
    '-nostdin',
    '-i', toNativePath(pathOrUri),
    '-filter:v', `select='gt(scene,${threshold})',showinfo`,
    '-an',
    '-f', 'null',
    '-',
  ]);
  return parseSceneLog(result.logs);
}
