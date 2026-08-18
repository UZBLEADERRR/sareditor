import type { Project, Word } from '../types/project';
import { atempoChain, duckFilter, limiterFilter, loudnormFilter, resampleFilter, voiceEnhanceFilters, volumeFilter } from './filters/audio';
import { chain, escapeFilterPath } from './filters/escape';
import { frameStage } from './filters/frame';
import { gradeFilters, lutFilter } from './filters/grade';
import { audioFadeFilters, bloomSegment, fadeFilters, grainFilter, letterboxFilter, sharpenFilter, chromaticFilter, vignetteFilter } from './filters/look';
import { shakeStage, stabilizeTransformFilter, zoomStage } from './filters/motion';
import { overlayInputArgs, overlayStage } from './filters/overlay';
import { audioEncoderArgs, containerArgs, encoderArgs, PLATFORM_PRESETS } from './presets';
import { buildTimeline, mapBeatsToTimeline, mapWordsToTimeline, type Timeline } from './timeline';
import { toFfmpegSeconds, round } from '../utils/format';

const XFADE_TRANSITIONS: Record<string, string> = {
  fade: 'fade',
  dissolve: 'dissolve',
  slideleft: 'slideleft',
  slideup: 'slideup',
  circleopen: 'circleopen',
  pixelize: 'pixelize',
  wipeleft: 'wipeleft',
  flash: 'fadewhite',
};

/** Small helper that threads a chain of single-in/single-out filters together. */
class Graph {
  private readonly parts: string[] = [];
  private counter = 0;

  constructor(private label: string) {}

  get current(): string {
    return this.label;
  }

  next(prefix = 'v'): string {
    this.counter += 1;
    return `${prefix}${this.counter}`;
  }

  /** Appends `[current]filters[new]` and moves the cursor. Empty chains are skipped. */
  apply(filters: string, prefix = 'v'): void {
    if (!filters) return;
    const out = this.next(prefix);
    this.parts.push(`[${this.label}]${filters}[${out}]`);
    this.label = out;
  }

  /** Appends a multi-node segment that already declares its own output label. */
  applySegment(segment: string | null, outLabel: string): void {
    if (!segment) return;
    this.parts.push(segment);
    this.label = outLabel;
  }

  /** Appends a pre-built graph node verbatim. */
  raw(part: string): void {
    this.parts.push(part);
  }

  /** Moves the cursor onto a label produced by raw nodes. */
  setLabel(label: string): void {
    this.label = label;
  }

  build(): string[] {
    return this.parts;
  }
}

export type BuiltRender = {
  args: string[];
  totalMs: number;
  timeline: Timeline;
  /** Words already rebased onto the export timeline — used to write the .ass file. */
  captionWords: Word[];
};

export type BuildOptions = {
  project: Project;
  /** Absolute filesystem path (no `file://`) for the encoded result. */
  outputPath: string;
  /** Absolute path of the generated .ass file, when captions are enabled. */
  assPath?: string;
  /** Directory libass scans for fonts. */
  fontsDir?: string;
  /** Path to the vid.stab transform file when stabilisation already ran. */
  stabilizeTrfPath?: string;
};

/**
 * Turns a project into a single ffmpeg invocation.
 *
 * Everything is expressed as one `filter_complex` so the source is decoded once:
 * segments are trimmed and concatenated (or cross-faded), the frame is fitted to
 * the target aspect, the cinematic look is layered on, captions are burned in,
 * and the voice and music are mixed with sidechain ducking before a final
 * loudness pass.
 */
export function buildRender(options: BuildOptions): BuiltRender {
  const { project, outputPath } = options;
  const source = project.source;
  if (!source) throw new Error('Loyihada video yo‘q');

  const config = project.export;
  const effects = project.effects;
  const music = project.music;
  const audio = project.audio;
  const fps = config.fps;

  const timeline = buildTimeline(
    project.segments,
    effects.transition === 'none' ? 0 : effects.transitionMs
  );
  if (!timeline.placed.length) throw new Error('Kesilgan bo‘lak topilmadi');
  const totalMs = timeline.totalMs;

  const captionWords = project.transcript
    ? mapWordsToTimeline(timeline, project.transcript.words)
    : [];

  const inputs: string[] = [];
  const musicEnabled = Boolean(music.enabled && music.uri);

  if (music.loop && musicEnabled) inputs.push('-stream_loop', '-1');
  const musicInputIndex = musicEnabled ? 1 : -1;

  // Overlay images are inputs too, and they come after the video and music.
  const overlays = (project.overlays ?? []).filter((item) => item.uri && item.endMs > item.startMs);
  const firstOverlayIndex = musicEnabled ? 2 : 1;

  const graphParts: string[] = [];

  // ---------------------------------------------------------------- video ---
  const stabilized = options.stabilizeTrfPath ? 'vstab' : '0:v';
  if (options.stabilizeTrfPath) {
    graphParts.push(`[0:v]${stabilizeTransformFilter(options.stabilizeTrfPath)}[vstab]`);
  }

  const segmentLabels: string[] = [];
  timeline.placed.forEach((item, index) => {
    const { segment } = item;
    const speed = segment.speed > 0 ? segment.speed : 1;
    const label = `sv${index}`;
    segmentLabels.push(label);
    graphParts.push(
      `[${stabilized}]` +
        chain(
          `trim=start=${toFfmpegSeconds(segment.startMs)}:end=${toFfmpegSeconds(segment.endMs)}`,
          speed === 1 ? 'setpts=PTS-STARTPTS' : `setpts=(PTS-STARTPTS)/${round(speed, 5)}`,
          `fps=${fps}`,
          'format=yuv420p',
          'setsar=1'
        ) +
        `[${label}]`
    );
  });

  let videoLabel: string;
  if (segmentLabels.length === 1) {
    videoLabel = segmentLabels[0];
  } else if (effects.transition !== 'none' && effects.transitionMs > 0) {
    videoLabel = buildXfadeChain(graphParts, segmentLabels, timeline, effects.transition, effects.transitionMs);
  } else {
    videoLabel = 'vcat';
    graphParts.push(
      `${segmentLabels.map((l) => `[${l}]`).join('')}concat=n=${segmentLabels.length}:v=1:a=0[vcat]`
    );
  }

  // Fit to the export frame before anything else, so every look parameter is
  // expressed against the final resolution.
  graphParts.push(
    frameStage({
      mode: effects.fillMode,
      width: config.width,
      height: config.height,
      inLabel: videoLabel,
      outLabel: 'vfit',
    })
  );

  const graph = new Graph('vfit');

  graph.apply(chain(gradeFilters(effects.grade, effects.gradeStrength), lutFilter(effects.lutUri)));

  const bloomOut = 'vbloom';
  graph.applySegment(bloomSegment(graph.current, bloomOut, effects.bloom), bloomOut);

  graph.apply(
    chain(
      chromaticFilter(effects.chromatic),
      grainFilter(effects.grain),
      sharpenFilter(effects.sharpen),
      vignetteFilter(effects.vignette)
    )
  );

  graph.apply(shakeStage(effects.shake, config.width, config.height));

  const beats = musicEnabled && music.beatSync && music.beats?.length
    ? mapBeatsToTimeline(music.beats, music.startMs, totalMs)
    : undefined;

  graph.apply(
    zoomStage({
      mode: effects.zoom,
      amount: effects.zoomAmount,
      width: config.width,
      height: config.height,
      fps,
      durationMs: totalMs,
      beats,
    })
  );

  graph.apply(letterboxFilter(effects.letterbox, config.height));

  // Illustrations sit above the picture but below the captions, so a cutaway
  // never covers the words it was generated from.
  if (overlays.length) {
    const stage = overlayStage({
      overlays,
      firstInputIndex: firstOverlayIndex,
      width: config.width,
      height: config.height,
      baseLabel: graph.current,
      totalMs,
    });
    for (const part of stage.parts) graph.raw(part);
    graph.setLabel(stage.outLabel);
  }

  if (project.subtitle.enabled && options.assPath && captionWords.length) {
    graph.apply(assFilter(options.assPath, options.fontsDir));
  }

  graph.apply(fadeFilters(effects.fadeInMs, effects.fadeOutMs, totalMs));
  graph.apply('format=yuv420p');

  const videoOut = graph.current;
  graphParts.push(...graph.build());

  // ---------------------------------------------------------------- audio ---
  const useOriginalAudio = source.hasAudio && !audio.muteOriginal;
  const audioParts: string[] = [];
  let audioOut: string | null = null;

  if (useOriginalAudio) {
    const labels: string[] = [];
    timeline.placed.forEach((item, index) => {
      const { segment } = item;
      const speed = segment.speed > 0 ? segment.speed : 1;
      const label = `sa${index}`;
      labels.push(label);
      audioParts.push(
        `[0:a]` +
          chain(
            `atrim=start=${toFfmpegSeconds(segment.startMs)}:end=${toFfmpegSeconds(segment.endMs)}`,
            'asetpts=PTS-STARTPTS',
            atempoChain(speed),
            'aresample=48000'
          ) +
          `[${label}]`
      );
    });

    let concatLabel = labels[0];
    if (labels.length > 1) {
      if (effects.transition !== 'none' && effects.transitionMs > 0) {
        concatLabel = buildCrossfadeChain(audioParts, labels, effects.transitionMs);
      } else {
        concatLabel = 'acat';
        audioParts.push(`${labels.map((l) => `[${l}]`).join('')}concat=n=${labels.length}:v=0:a=1[acat]`);
      }
    }

    const voiceChain = chain(
      audio.voiceEnhance ? voiceEnhanceFilters() : '',
      volumeFilter(audio.originalVolumeDb)
    );
    audioParts.push(`[${concatLabel}]${voiceChain || 'anull'}[voice]`);
    audioOut = 'voice';
  }

  if (musicEnabled) {
    const musicChain = chain(
      music.startMs > 0 ? `atrim=start=${toFfmpegSeconds(music.startMs)}` : '',
      'asetpts=PTS-STARTPTS',
      'aresample=48000',
      volumeFilter(music.volumeDb),
      audioFadeFilters(music.fadeInMs, music.fadeOutMs, totalMs)
    );
    audioParts.push(`[${musicInputIndex}:a]${musicChain || 'anull'}[music]`);

    if (audioOut) {
      if (music.duckEnabled) {
        audioParts.push(`[${audioOut}]asplit=2[voiceMix][voiceKey]`);
        audioParts.push(`[music][voiceKey]${duckFilter(music.duckAmountDb)}[musicDucked]`);
        audioParts.push(
          `[voiceMix][musicDucked]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[amixed]`
        );
      } else {
        audioParts.push(
          `[${audioOut}][music]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[amixed]`
        );
      }
      audioOut = 'amixed';
    } else {
      audioOut = 'music';
    }
  }

  if (audioOut) {
    const masterChain = chain(
      audio.normalizeLoudness ? loudnormFilter(audio.targetLufs) : '',
      limiterFilter(),
      resampleFilter()
    );
    audioParts.push(`[${audioOut}]${masterChain || 'anull'}[aout]`);
    audioOut = 'aout';
  }

  // ------------------------------------------------------------- assemble ---
  const filterComplex = [...graphParts.filter(Boolean), ...audioParts].join(';');

  const args: string[] = [
    '-hide_banner',
    '-nostdin',
    '-y',
    ...inputs,
    '-i', source.uri,
  ];

  if (musicEnabled && music.uri) {
    args.push('-i', music.uri);
  }

  args.push(...overlayInputArgs(overlays, fps));

  args.push(
    '-filter_complex', filterComplex,
    '-map', `[${videoOut}]`
  );

  if (audioOut) {
    args.push('-map', `[${audioOut}]`, ...audioEncoderArgs(config));
  } else {
    args.push('-an');
  }

  args.push(
    ...encoderArgs(config),
    '-r', String(fps),
    '-fps_mode', 'cfr',
    '-t', toFfmpegSeconds(totalMs),
    ...containerArgs(),
    outputPath
  );

  return { args, totalMs, timeline, captionWords };
}

/** `ass` renders the styling exactly as authored; `subtitles` would flatten it. */
function assFilter(assPath: string, fontsDir?: string): string {
  const parts = [`f=${escapeFilterPath(assPath)}`];
  if (fontsDir) parts.push(`fontsdir=${escapeFilterPath(fontsDir)}`);
  parts.push('shaping=complex');
  return `ass=${parts.join(':')}`;
}

/**
 * Chains `xfade` across N segments. Each transition overlaps its neighbours, so
 * the offset of transition k is the accumulated playback time minus every
 * overlap consumed so far.
 */
function buildXfadeChain(
  parts: string[],
  labels: string[],
  timeline: Timeline,
  transition: string,
  transitionMs: number
): string {
  const kind = XFADE_TRANSITIONS[transition] ?? 'fade';
  const duration = round(transitionMs / 1000, 3);
  let previous = labels[0];

  for (let i = 1; i < labels.length; i += 1) {
    const out = i === labels.length - 1 ? 'vcat' : `vx${i}`;
    const offset = round(Math.max(0, timeline.placed[i].outStartMs / 1000), 3);
    parts.push(
      `[${previous}][${labels[i]}]xfade=transition=${kind}:duration=${duration}:offset=${offset}[${out}]`
    );
    previous = out;
  }
  return previous;
}

/** Audio counterpart of the xfade chain, so the two tracks stay the same length. */
function buildCrossfadeChain(parts: string[], labels: string[], transitionMs: number): string {
  const duration = round(transitionMs / 1000, 3);
  let previous = labels[0];
  for (let i = 1; i < labels.length; i += 1) {
    const out = i === labels.length - 1 ? 'acat' : `ax${i}`;
    parts.push(`[${previous}][${labels[i]}]acrossfade=d=${duration}:c1=tri:c2=tri[${out}]`);
    previous = out;
  }
  return previous;
}

/** Platform loudness target, used when the user has not overridden it. */
export function defaultLufsFor(project: Project): number {
  return PLATFORM_PRESETS[project.export.platform].targetLufs;
}
