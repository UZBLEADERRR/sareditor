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

/**
 * Preview frame rate.
 *
 * Phones shoot 60 fps as a matter of course, and every one of those frames has
 * to be decoded, scaled and re-encoded. Half of them do not survive to the
 * screen anyway — dropping them up front is the single biggest saving
 * available, and the export still reads the original at its own rate.
 */
export const PROXY_FPS = 30;

/** True when the clip is already small enough to play back directly. */
export function needsProxy(source: Pick<SourceClip, 'width' | 'height'>): boolean {
  const shortestSide = Math.min(source.width, source.height);
  return shortestSide > PROXY_HEIGHT;
}

/**
 * The hardware decoder for a codec, when the phone is likely to have one.
 *
 * Software-decoding 4K sixty times a second is what makes building the proxy
 * take minutes; the chip in the phone does it in real time. Only the two codecs
 * every Android device ships a decoder for are worth asking for — anything else
 * falls back to software, which is what would have happened regardless.
 */
export function hardwareDecoder(videoCodec?: string): string | null {
  switch (videoCodec?.toLowerCase()) {
    case 'h264':
    case 'avc':
    case 'avc1':
      return 'h264_mediacodec';
    case 'hevc':
    case 'h265':
    case 'hvc1':
      return 'hevc_mediacodec';
    default:
      return null;
  }
}

export type ProxyOptions = {
  /** Codec name from ffprobe, used to pick a hardware decoder. */
  videoCodec?: string;
  /** Set false for the retry after a hardware decode failed. */
  hardware?: boolean;
};

/**
 * The re-encode arguments, kept separate so they can be run against real
 * ffmpeg in the tests rather than only being read.
 */
export function proxyArgs(
  source: Pick<SourceClip, 'uri' | 'width' | 'height' | 'hasAudio' | 'fps'>,
  outputPath: string,
  options: ProxyOptions = {}
): string[] {
  // Scale on the shorter side so both portrait and landscape land at 720.
  const scale =
    source.width >= source.height
      ? `scale=-2:${PROXY_HEIGHT}`
      : `scale=${even(PROXY_HEIGHT)}:-2`;

  const decoder = options.hardware === false ? null : hardwareDecoder(options.videoCodec);
  // Only worth asking for when there is something to throw away.
  const capFps = !source.fps || source.fps > PROXY_FPS * 1.1;

  return [
    '-hide_banner', '-nostdin', '-y',
    ...(decoder ? ['-c:v', decoder] : []),
    '-i', source.uri,
    '-vf', `${scale},format=yuv420p`,
    ...(capFps ? ['-r', String(PROXY_FPS)] : []),
    // Baseline H.264 is the one profile every Android decoder handles, and the
    // fastest preset is the right trade for a file nobody keeps.
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
    '-profile:v', 'baseline', '-level', '3.1',
    '-g', String(PROXY_FPS * 2),
    ...(source.hasAudio ? ['-c:a', 'aac', '-b:a', '96k', '-ac', '2'] : ['-an']),
    '-movflags', '+faststart',
    outputPath,
  ];
}
