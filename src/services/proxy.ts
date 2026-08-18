import { File } from 'expo-file-system';

import { CancelledError, run } from '../ffmpeg/engine';
import { needsProxy, proxyArgs } from '../ffmpeg/proxy';
import type { SourceClip } from '../types/project';
import { uid } from '../utils/id';
import { mediaDir, toNativePath } from '../utils/paths';
import { trace, traced } from './diagnostics';

export type ProxyProgress = { progress: number };

/**
 * Builds the low-resolution copy the editor plays.
 *
 * The preview decodes frames on the GPU, and a 4K HEVC clip straight off a
 * phone camera is exactly the input that makes that fail — often by killing the
 * process rather than raising an error anyone can catch. Re-encoding once to a
 * modest H.264 file removes that whole class of failure, and makes scrubbing
 * and thumbnails cheap as a side effect.
 *
 * Returns the original path unchanged if the clip is already small, or if the
 * re-encode fails for any reason — a missing proxy must never block editing.
 */
export async function buildPreviewProxy(
  source: SourceClip,
  onProgress?: (progress: ProxyProgress) => void
): Promise<string> {
  if (!source.width || !source.height || !needsProxy(source)) {
    trace(`proxy skipped ${source.width}x${source.height}`);
    return source.uri;
  }

  const output = new File(mediaDir(), `proxy_${uid()}.mp4`);
  if (output.exists) output.delete();
  const outputPath = toNativePath(output.uri);

  const encode = (hardware: boolean) =>
    run(proxyArgs(source, outputPath, { videoCodec: source.videoCodec, hardware }), {
      key: `proxy_${source.id}`,
      totalMs: source.durationMs,
      onProgress: (event) => onProgress?.({ progress: event.progress }),
    });

  try {
    // The chip decodes 4K sixty times a second; the CPU takes minutes over it.
    // Not every device honours the request, so a refusal simply costs the time
    // ffmpeg needed to find out and the software path runs instead.
    await traced(`proxy ${source.width}x${source.height} hw`, () => encode(true));
  } catch (hardwareFailure) {
    if (hardwareFailure instanceof CancelledError) throw hardwareFailure;
    try {
      await traced(`proxy ${source.width}x${source.height} sw`, () => encode(false));
    } catch {
      if (output.exists) output.delete();
      return source.uri;
    }
  }

  return output.exists && (output.size ?? 0) > 1024 ? outputPath : source.uri;
}
