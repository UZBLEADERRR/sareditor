import type { SourceClip } from '../types/project';
import { even } from '../utils/format';

/**
 * The playback proxy's encode settings.
 *
 * Kept apart from the service that runs it so the arguments can be executed
 * against real ffmpeg in the tests — this file is the reason the editor can
 * open a phone-camera clip at all, so "it compiles" is not enough assurance.
 */

/** Tall enough to look right on a phone, small enough for any decoder to cope. */
export const PROXY_HEIGHT = 720;

/** True when the clip is already small enough to play back directly. */
export function needsProxy(source: Pick<SourceClip, 'width' | 'height'>): boolean {
  const shortestSide = Math.min(source.width, source.height);
  return shortestSide > PROXY_HEIGHT;
}

/**
 * The re-encode arguments, kept separate so they can be run against real
 * ffmpeg in the tests rather than only being read.
 */
export function proxyArgs(
  source: Pick<SourceClip, 'uri' | 'width' | 'height' | 'hasAudio'>,
  outputPath: string
): string[] {
  // Scale on the shorter side so both portrait and landscape land at 720.
  const scale =
    source.width >= source.height
      ? `scale=-2:${PROXY_HEIGHT}`
      : `scale=${even(PROXY_HEIGHT)}:-2`;

  return [
    '-hide_banner', '-nostdin', '-y',
    '-i', source.uri,
    '-vf', `${scale},format=yuv420p`,
    // Baseline H.264 is the one profile every Android decoder handles.
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
    '-profile:v', 'baseline', '-level', '3.1',
    '-g', '60',
    ...(source.hasAudio ? ['-c:a', 'aac', '-b:a', '96k', '-ac', '2'] : ['-an']),
    '-movflags', '+faststart',
    outputPath,
  ];
}
