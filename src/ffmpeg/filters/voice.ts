import type { VoiceClip } from '../../types/project';
import { clamp, round, toFfmpegSeconds } from '../../utils/format';

/** Input arguments for the voiceover files, in clip order. */
export function voiceInputArgs(clips: VoiceClip[]): string[] {
  return clips.flatMap((clip) => ['-i', clip.uri]);
}

export type VoiceStage = {
  parts: string[];
  /** Labels to feed into the final mix, in order. */
  labels: string[];
};

/**
 * Positions each spoken line on the timeline.
 *
 * `adelay` shifts a clip to its moment; without it every line would start at
 * zero and stack on top of each other.
 */
export function voiceStage(clips: VoiceClip[], firstInputIndex: number, totalMs: number): VoiceStage {
  const parts: string[] = [];
  const labels: string[] = [];

  clips.forEach((clip, index) => {
    const startMs = clamp(clip.startMs, 0, Math.max(0, totalMs));
    const label = `vo${index}`;
    const delay = Math.round(startMs);

    parts.push(
      `[${firstInputIndex + index}:a]` +
        [
          'aresample=48000',
          'aformat=channel_layouts=stereo',
          `adelay=${delay}|${delay}`,
          Math.abs(clip.volumeDb) > 0.05 ? `volume=${round(clip.volumeDb, 2)}dB` : null,
        ]
          .filter(Boolean)
          .join(',') +
        `[${label}]`
    );
    labels.push(label);
  });

  return { parts, labels };
}

/**
 * Volume envelope that pulls the original audio down under each spoken line.
 *
 * A sidechain compressor would need one instance per line and would react to
 * the mix rather than to the schedule; the schedule is known exactly here, so a
 * time-gated `volume` is both simpler and more predictable.
 */
export function voiceDuckFilter(clips: VoiceClip[], duckDb = -11): string {
  const ducking = clips.filter((clip) => clip.duckOriginal && clip.durationMs > 0);
  if (!ducking.length) return '';

  const gain = round(10 ** (duckDb / 20), 4);
  // Cross-fade the duck over 150 ms so it does not click on and off.
  const fade = 0.15;

  const terms = ducking.map((clip) => {
    const start = Number(toFfmpegSeconds(clip.startMs));
    const end = Number(toFfmpegSeconds(clip.startMs + clip.durationMs));
    return (
      `min(1,max(0,(t-${round(start - fade, 3)})/${fade}))*` +
      `min(1,max(0,(${round(end + fade, 3)}-t)/${fade}))`
    );
  });

  const envelope = terms.length === 1 ? terms[0] : `max(${terms.join(',')})`;
  return `volume='1-(1-${gain})*min(1,${envelope})':eval=frame`;
}
