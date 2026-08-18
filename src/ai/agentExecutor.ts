import { keepRanges, playedMs, removeRange, setSpeedInRange } from '../editing/segments';
import { GRADES } from '../ffmpeg/filters/grade';
import { exportConfigFor } from '../ffmpeg/presets';
import { buildTimeline, outputToSource, sourceToOutput, type Timeline } from '../ffmpeg/timeline';
import { applySubtitleStyle } from '../presets/subtitleStyles';
import type {
  AspectId,
  AudioConfig,
  EffectsConfig,
  ExportConfig,
  GradeId,
  ImageOverlay,
  MusicConfig,
  OverlayStyle,
  PlatformId,
  Project,
  Segment,
  SubtitleConfig,
  SubtitleStyleId,
  Transcript,
  TransitionId,
  VoiceClip,
  Word,
  ZoomMode,
} from '../types/project';
import { formatTimecode } from '../utils/format';
import { uid } from '../utils/id';
import { translateWords } from './director';
import type { ToolCall } from './providers/toolChat';
import type { LlmConfig } from './types';

/**
 * Everything the executor needs from the outside world.
 *
 * Drawing and speaking are passed in rather than imported so this file stays
 * free of native modules: the same code then runs in the app and under the test
 * runner, which is the only way the time-anchoring logic gets covered.
 */
export type AgentServices = {
  llm: LlmConfig;
  /** Absent when no image model is configured; `add_illustration` then refuses. */
  drawImage?: (prompt: string, aspect: AspectId) => Promise<string>;
  /** Absent when no voice is configured; `add_voiceover` then refuses. */
  speak?: (text: string) => Promise<{ uri: string; durationMs: number }>;
  voiceLabel?: string;
  signal?: AbortSignal;
};

export type ToolExecution = {
  /** What the model is told. Errors go here too — it can then try something else. */
  result: string;
  /** One line for the user, in Uzbek. Read-only tools produce none. */
  change?: string;
  /** True once `finish` ran. */
  done?: boolean;
  summary?: string;
};

type AnchoredOverlay = {
  overlay: ImageOverlay;
  /** Position on the *source* clock, so a later cut can move it correctly. */
  startAnchorMs: number;
  endAnchorMs: number;
};

type AnchoredVoice = {
  clip: VoiceClip;
  anchorMs: number;
};

const GRADE_IDS = Object.keys(GRADES) as GradeId[];
const STYLE_IDS: SubtitleStyleId[] = [
  'hormozi', 'karaoke', 'clean', 'neon', 'boxed', 'typewriter', 'bounce', 'cinema',
];
const TRANSITION_IDS: TransitionId[] = [
  'none', 'fade', 'dissolve', 'flash', 'slideup', 'slideleft', 'circleopen', 'pixelize', 'wipeleft',
];
const OVERLAY_STYLES: OverlayStyle[] = ['cutaway', 'fullscreen', 'corner'];
const ZOOM_MODES: ZoomMode[] = ['none', 'in', 'out', 'pulse'];
const PLATFORMS: PlatformId[] = [
  'instagram_reels', 'instagram_feed', 'tiktok', 'youtube_shorts', 'youtube',
];
const ASPECTS: AspectId[] = ['9:16', '4:5', '1:1', '16:9'];

/**
 * Runs the agent's tool calls against a working copy of the project.
 *
 * Nothing is written to the store until `patch()` is read, so an aborted or
 * failed run leaves the project exactly as it was.
 *
 * Times are the subtle part. The model speaks in **source** time — where things
 * happen in the original file — because that clock does not move when a cut is
 * made. Overlays and voiceovers, however, play on the **export** timeline. So
 * every one of them is anchored back to source time when the run starts, and
 * converted forward again at the end, once the final cut is known. That is what
 * keeps an illustration glued to the phrase it belongs to even when the agent
 * re-cuts the whole video in the same run.
 */
export class AgentExecutor {
  private readonly project: Project;
  private readonly services: AgentServices;

  private segments: Segment[];
  private subtitle: SubtitleConfig;
  private music: MusicConfig;
  private effects: EffectsConfig;
  private audio: AudioConfig;
  private exportConfig: ExportConfig;
  private transcript: Transcript | undefined;
  private overlays: AnchoredOverlay[];
  private voices: AnchoredVoice[];

  private cutChanged = false;
  private readonly changeLog: string[] = [];
  private readonly notes: string[] = [];

  finished = false;
  summary = '';

  constructor(project: Project, services: AgentServices) {
    this.project = project;
    this.services = services;

    this.segments = project.segments.map((segment) => ({ ...segment }));
    this.subtitle = { ...project.subtitle };
    this.music = { ...project.music };
    this.effects = { ...project.effects };
    this.audio = { ...project.audio };
    this.exportConfig = { ...project.export };
    this.transcript = project.transcript;

    const before = this.timeline();
    this.overlays = project.overlays.map((overlay) => ({
      overlay: { ...overlay },
      startAnchorMs: anchor(before, overlay.startMs),
      endAnchorMs: anchor(before, overlay.endMs),
    }));
    this.voices = project.voiceovers.map((clip) => ({
      clip: { ...clip },
      anchorMs: anchor(before, clip.startMs),
    }));
  }

  get changes(): string[] {
    return this.changeLog;
  }

  get warnings(): string[] {
    return this.notes;
  }

  private timeline(): Timeline {
    return buildTimeline(
      this.segments,
      this.effects.transition === 'none' ? 0 : this.effects.transitionMs
    );
  }

  private get durationMs(): number {
    return this.project.source?.durationMs ?? 0;
  }

  async run(call: ToolCall): Promise<ToolExecution> {
    const args = call.args ?? {};
    switch (call.name) {
      case 'read_transcript':
        return { result: this.readTranscript() };
      case 'read_project':
        return { result: this.readProject() };
      case 'keep_ranges':
        return this.keepRanges(args);
      case 'remove_range':
        return this.removeRange(args);
      case 'set_speed':
        return this.setSpeed(args);
      case 'set_look':
        return this.setLook(args);
      case 'set_captions':
        return this.setCaptions(args);
      case 'translate_captions':
        return this.translateCaptions(args);
      case 'add_illustration':
        return this.addIllustration(args);
      case 'place_library_media':
        return this.placeLibraryMedia(args);
      case 'remove_overlay':
        return this.removeOverlay(args);
      case 'clear_overlays':
        return this.clearOverlays();
      case 'add_voiceover':
        return this.addVoiceover(args);
      case 'clear_voiceovers':
        return this.clearVoiceovers();
      case 'set_audio':
        return this.setAudio(args);
      case 'set_format':
        return this.setFormat(args);
      case 'finish':
        this.finished = true;
        this.summary = str(args.summary);
        return { result: 'ok', done: true, summary: this.summary };
      default:
        return { result: `Unknown tool: ${call.name}` };
    }
  }

  /* ------------------------------------------------------------- reading --- */

  private readTranscript(): string {
    const transcript = this.transcript;
    if (!transcript?.lines.length) {
      return 'No transcript yet. The creator has not run speech recognition, so there are no timings to work from. You can still change the look, the audio and the cut by time.';
    }
    const lines = transcript.lines
      .map((line) => `[${Math.round(line.startMs)}-${Math.round(line.endMs)}] ${line.text}`)
      .join('\n');
    return [
      `Language: ${transcript.language || 'unknown'}`,
      `Source duration: ${Math.round(this.durationMs)} ms`,
      '',
      lines.length > 12000 ? `${lines.slice(0, 12000)}\n…(truncated)` : lines,
    ].join('\n');
  }

  private readProject(): string {
    const timeline = this.timeline();
    return JSON.stringify(
      {
        sourceDurationMs: Math.round(this.durationMs),
        currentDurationMs: Math.round(timeline.totalMs),
        cut: this.segments.map((segment) => ({
          startMs: Math.round(segment.startMs),
          endMs: Math.round(segment.endMs),
          speed: segment.speed,
        })),
        look: {
          grade: this.effects.grade,
          gradeStrength: this.effects.gradeStrength,
          vignette: this.effects.vignette,
          grain: this.effects.grain,
          bloom: this.effects.bloom,
          letterbox: this.effects.letterbox,
          zoom: this.effects.zoom,
          transition: this.effects.transition,
        },
        captions: {
          enabled: this.subtitle.enabled,
          styleId: this.subtitle.styleId,
          language: this.subtitle.language,
          fontSizePct: this.subtitle.fontSizePct,
          positionPct: this.subtitle.positionPct,
          positionXPct: this.subtitle.positionXPct,
          karaoke: this.subtitle.karaoke,
          emphasisWords: this.subtitle.emphasisWords,
          hasWordTimings: Boolean(this.transcript?.words.length),
        },
        audio: {
          muteOriginal: this.audio.muteOriginal,
          originalVolumeDb: this.audio.originalVolumeDb,
          music: this.music.enabled
            ? { name: this.music.name, volumeDb: this.music.volumeDb, duck: this.music.duckEnabled }
            : null,
          voiceEnhance: this.audio.voiceEnhance,
        },
        format: {
          platform: this.exportConfig.platform,
          aspect: this.exportConfig.aspect,
          fillMode: this.effects.fillMode,
        },
        // Assets the creator imported for the agent to place.
        library: this.project.library.map((asset) => ({
          assetId: asset.id,
          kind: asset.kind,
          name: asset.name,
          durationMs: Math.round(asset.durationMs),
          note: asset.note,
        })),
        overlays: this.overlays.map((item) => ({
          id: item.overlay.id,
          startMs: Math.round(item.startAnchorMs),
          endMs: Math.round(item.endAnchorMs),
          phrase: item.overlay.phrase,
          prompt: item.overlay.prompt,
          style: item.overlay.style,
          fromLibrary: Boolean(item.overlay.assetId),
        })),
        voiceovers: this.voices.map((item) => ({
          id: item.clip.id,
          startMs: Math.round(item.anchorMs),
          text: item.clip.text,
        })),
      },
      null,
      1
    );
  }

  /* --------------------------------------------------------------- the cut --- */

  private keepRanges(args: Record<string, unknown>): ToolExecution {
    const raw = Array.isArray(args.ranges) ? args.ranges : [];
    const ranges = raw
      .map((item: any) => ({ startMs: num(item?.startMs), endMs: num(item?.endMs) }))
      .filter((range) => Number.isFinite(range.startMs) && Number.isFinite(range.endMs));

    if (!ranges.length) return { result: 'No usable ranges were given, nothing changed.' };

    const next = keepRanges(ranges, this.durationMs);
    if (!next.length) {
      return { result: 'Those ranges fall outside the video, so the cut was left alone.' };
    }

    this.segments = next;
    this.cutChanged = true;
    const total = Math.round(playedMs(next));
    return {
      result: `Cut replaced: ${next.length} pieces, ${total} ms total.`,
      change: `Montaj qayta yig‘ildi — ${next.length} ta bo‘lak, ${formatTimecode(total)}`,
    };
  }

  private removeRange(args: Record<string, unknown>): ToolExecution {
    const startMs = num(args.startMs);
    const endMs = num(args.endMs);
    if (!(endMs > startMs)) return { result: 'endMs must be greater than startMs; nothing changed.' };

    const before = this.segments.length;
    this.segments = removeRange(this.segments, startMs, endMs);
    if (!this.segments.length) {
      // Removing everything would leave a project that cannot render.
      this.segments = this.project.segments.map((segment) => ({ ...segment }));
      return { result: 'That would remove the whole video, so it was refused.' };
    }
    this.cutChanged = true;
    return {
      result: `Removed ${Math.round(endMs - startMs)} ms. Pieces: ${before} → ${this.segments.length}.`,
      change: `${formatTimecode(startMs)} → ${formatTimecode(endMs)} kesib tashlandi`,
    };
  }

  private setSpeed(args: Record<string, unknown>): ToolExecution {
    const startMs = num(args.startMs);
    const endMs = num(args.endMs);
    const speed = num(args.speed, 1);
    if (!(endMs > startMs)) return { result: 'endMs must be greater than startMs; nothing changed.' };
    if (!(speed > 0)) return { result: 'speed must be positive; nothing changed.' };

    const clamped = Math.min(4, Math.max(0.25, speed));
    this.segments = setSpeedInRange(this.segments, startMs, endMs, clamped);
    this.cutChanged = true;
    return {
      result: `Speed ${clamped}x applied between ${Math.round(startMs)} and ${Math.round(endMs)} ms.`,
      change: `${formatTimecode(startMs)} → ${formatTimecode(endMs)} tezligi ${clamped}x`,
    };
  }

  /* ------------------------------------------------------------------ look --- */

  private setLook(args: Record<string, unknown>): ToolExecution {
    const changed: string[] = [];

    if (args.grade !== undefined) {
      const grade = pick(args.grade, GRADE_IDS, this.effects.grade);
      this.effects.grade = grade;
      // A grade with zero strength is invisible; give it a sensible default.
      if (this.effects.gradeStrength <= 0 && grade !== 'none') this.effects.gradeStrength = 0.8;
      changed.push(`rang: ${GRADES[grade].label}`);
    }
    if (args.gradeStrength !== undefined) {
      this.effects.gradeStrength = clamp01(num(args.gradeStrength, this.effects.gradeStrength));
      changed.push(`rang kuchi ${Math.round(this.effects.gradeStrength * 100)}%`);
    }
    if (args.vignette !== undefined) {
      this.effects.vignette = clamp01(num(args.vignette, this.effects.vignette));
      changed.push(`vinyet ${Math.round(this.effects.vignette * 100)}%`);
    }
    if (args.grain !== undefined) {
      this.effects.grain = clamp01(num(args.grain, this.effects.grain));
      changed.push(`don ${Math.round(this.effects.grain * 100)}%`);
    }
    if (args.bloom !== undefined) {
      this.effects.bloom = clamp01(num(args.bloom, this.effects.bloom));
      changed.push(`nur ${Math.round(this.effects.bloom * 100)}%`);
    }
    if (args.letterbox !== undefined) {
      this.effects.letterbox = clamp(num(args.letterbox, this.effects.letterbox), 0, 0.3);
      changed.push('kino chiziqlari');
    }
    if (args.zoom !== undefined) {
      this.effects.zoom = pick(args.zoom, ZOOM_MODES, this.effects.zoom);
      changed.push(`zoom: ${this.effects.zoom}`);
    }
    if (args.zoomAmount !== undefined) {
      this.effects.zoomAmount = clamp(num(args.zoomAmount, this.effects.zoomAmount), 0.02, 0.4);
    }
    if (args.transition !== undefined) {
      this.effects.transition = pick(args.transition, TRANSITION_IDS, this.effects.transition);
      if (this.effects.transition !== 'none' && this.effects.transitionMs <= 0) {
        this.effects.transitionMs = 300;
      }
      changed.push(`o‘tish: ${this.effects.transition}`);
      // Transitions overlap neighbours, which shifts the export clock.
      this.cutChanged = true;
    }

    if (!changed.length) return { result: 'No look fields were given, nothing changed.' };
    return { result: `Look updated: ${changed.join(', ')}.`, change: `Ko‘rinish — ${changed.join(', ')}` };
  }

  private setCaptions(args: Record<string, unknown>): ToolExecution {
    const changed: string[] = [];

    if (args.styleId !== undefined) {
      const styleId = pick(args.styleId, STYLE_IDS, this.subtitle.styleId);
      this.subtitle = { ...applySubtitleStyle(this.subtitle, styleId) };
      changed.push(`uslub: ${styleId}`);
    }
    if (args.enabled !== undefined) {
      this.subtitle.enabled = Boolean(args.enabled);
      changed.push(this.subtitle.enabled ? 'yoqildi' : 'o‘chirildi');
    }
    if (args.fontSizePct !== undefined) {
      this.subtitle.fontSizePct = clamp(num(args.fontSizePct, this.subtitle.fontSizePct), 2.5, 12);
      changed.push(`hajm ${this.subtitle.fontSizePct.toFixed(1)}%`);
    }
    if (args.positionPct !== undefined) {
      this.subtitle.positionPct = clamp(num(args.positionPct, this.subtitle.positionPct), 0, 100);
      changed.push('balandlik');
    }
    if (args.positionXPct !== undefined) {
      this.subtitle.positionXPct = clamp(num(args.positionXPct, this.subtitle.positionXPct), 0, 100);
      changed.push('gorizontal joylashuv');
    }
    if (args.uppercase !== undefined) {
      this.subtitle.uppercase = Boolean(args.uppercase);
      changed.push('katta harflar');
    }
    if (args.karaoke !== undefined) {
      this.subtitle.karaoke = Boolean(args.karaoke);
      changed.push('karaoke');
    }
    if (typeof args.highlightColor === 'string' && /^#[0-9a-f]{6}$/i.test(args.highlightColor)) {
      this.subtitle.highlightColor = args.highlightColor;
      changed.push('yonish rangi');
    }
    if (Array.isArray(args.emphasisWords)) {
      const words = args.emphasisWords.map((word) => String(word).trim()).filter(Boolean);
      this.subtitle.emphasisWords = Array.from(new Set(words)).slice(0, 60);
      changed.push(`${this.subtitle.emphasisWords.length} ta muhim so‘z`);
    }

    if (!changed.length) return { result: 'No caption fields were given, nothing changed.' };
    return { result: `Captions updated: ${changed.join(', ')}.`, change: `Subtitr — ${changed.join(', ')}` };
  }

  private async translateCaptions(args: Record<string, unknown>): Promise<ToolExecution> {
    const language = str(args.language);
    if (!language) return { result: 'A target language is required.' };
    if (!this.transcript?.words.length) {
      return { result: 'There is no transcript to translate. Speech recognition has to run first.' };
    }

    const words = await translateWords(
      this.services.llm,
      this.transcript.words,
      language,
      this.services.signal
    );
    this.transcript = {
      ...this.transcript,
      words,
      lines: linesFromWords(words),
      language,
      text: words.map((word) => word.text).join(' '),
    };
    this.subtitle.language = language;

    return {
      result: `Captions translated into ${language}; every word timing was kept.`,
      change: `Subtitr ${language} tiliga tarjima qilindi`,
    };
  }

  /* -------------------------------------------------------------- overlays --- */

  private async addIllustration(args: Record<string, unknown>): Promise<ToolExecution> {
    const draw = this.services.drawImage;
    if (!draw) {
      return {
        result:
          'No image model is configured, so pictures cannot be drawn. Tell the creator to pick one in Settings, and carry on with the rest.',
      };
    }

    const startMs = num(args.startMs);
    const endMs = Math.max(num(args.endMs), startMs + 1200);
    const prompt = str(args.prompt);
    if (!prompt) return { result: 'A prompt is required.' };
    if (!Number.isFinite(startMs)) return { result: 'startMs is required.' };

    const uri = await draw(prompt, this.exportConfig.aspect);
    const overlay: ImageOverlay = {
      id: uid('ovl_'),
      uri,
      kind: 'image',
      startMs: 0,
      endMs: 0,
      phrase: str(args.phrase),
      prompt,
      style: pick(args.style, OVERLAY_STYLES, 'cutaway'),
      animation: 'fade',
      opacity: 1,
    };
    this.overlays.push({ overlay, startAnchorMs: startMs, endAnchorMs: endMs });

    return {
      result: `Illustration added at ${Math.round(startMs)}-${Math.round(endMs)} ms (id ${overlay.id}).`,
      change: `Rasm qo‘shildi: “${prompt.slice(0, 40)}” · ${formatTimecode(startMs)}`,
    };
  }

  private placeLibraryMedia(args: Record<string, unknown>): ToolExecution {
    const assetId = str(args.assetId);
    const asset = this.project.library.find((item) => item.id === assetId);
    if (!asset) {
      const ids = this.project.library.map((item) => item.id).join(', ') || '(library is empty)';
      return { result: `No asset with id ${assetId}. Available: ${ids}` };
    }

    const startMs = num(args.startMs);
    if (!Number.isFinite(startMs)) return { result: 'startMs is required.' };
    // A clip cannot be shown for longer than it lasts; a photo can hold as long as asked.
    const requestedEnd = Math.max(num(args.endMs), startMs + 800);
    const endMs =
      asset.kind === 'video' && asset.durationMs > 0
        ? Math.min(requestedEnd, startMs + asset.durationMs)
        : requestedEnd;

    const overlay: ImageOverlay = {
      id: uid('ovl_'),
      uri: asset.uri,
      kind: asset.kind,
      assetId: asset.id,
      sourceStartMs: 0,
      startMs: 0,
      endMs: 0,
      phrase: asset.note || asset.name,
      prompt: '',
      style: pick(args.style, OVERLAY_STYLES, asset.kind === 'video' ? 'fullscreen' : 'cutaway'),
      animation: 'fade',
      opacity: 1,
    };
    this.overlays.push({ overlay, startAnchorMs: startMs, endAnchorMs: endMs });

    return {
      result: `Placed "${asset.name}" at ${Math.round(startMs)}-${Math.round(endMs)} ms (id ${overlay.id}).`,
      change: `“${asset.name}” ${formatTimecode(startMs)} da qo‘yildi`,
    };
  }

  private removeOverlay(args: Record<string, unknown>): ToolExecution {
    const id = str(args.id);
    const before = this.overlays.length;
    this.overlays = this.overlays.filter((item) => item.overlay.id !== id);
    if (this.overlays.length === before) return { result: `No overlay with id ${id}.` };
    return { result: `Removed overlay ${id}.`, change: 'Ekrandagi rasm olib tashlandi' };
  }

  private clearOverlays(): ToolExecution {
    const count = this.overlays.length;
    if (!count) return { result: 'There were no overlays.' };
    this.overlays = [];
    return { result: `Removed ${count} overlays.`, change: `${count} ta rasm olib tashlandi` };
  }

  /* ------------------------------------------------------------------ voice --- */

  private async addVoiceover(args: Record<string, unknown>): Promise<ToolExecution> {
    const speak = this.services.speak;
    if (!speak) {
      return {
        result:
          'No voice is configured, so nothing can be spoken. Tell the creator to choose a voice in Settings — the phone voice is free and needs no key.',
      };
    }

    const text = str(args.text);
    const startMs = num(args.startMs);
    if (!text) return { result: 'text is required.' };
    if (!Number.isFinite(startMs)) return { result: 'startMs is required.' };

    const spoken = await speak(text);
    const clip: VoiceClip = {
      id: uid('vo_'),
      uri: spoken.uri,
      text,
      startMs: 0,
      durationMs: spoken.durationMs,
      volumeDb: 0,
      voiceLabel: this.services.voiceLabel ?? 'AI',
      duckOriginal: args.duckOriginal === undefined ? true : Boolean(args.duckOriginal),
    };
    this.voices.push({ clip, anchorMs: startMs });

    return {
      result: `Voice line added at ${Math.round(startMs)} ms, ${Math.round(spoken.durationMs)} ms long (id ${clip.id}).`,
      change: `Ovoz qo‘shildi: “${text.slice(0, 40)}” · ${formatTimecode(startMs)}`,
    };
  }

  private clearVoiceovers(): ToolExecution {
    const count = this.voices.length;
    if (!count) return { result: 'There were no voice lines.' };
    this.voices = [];
    return { result: `Removed ${count} voice lines.`, change: `${count} ta ovoz olib tashlandi` };
  }

  /* ------------------------------------------------------------------ mix --- */

  private setAudio(args: Record<string, unknown>): ToolExecution {
    const changed: string[] = [];

    if (args.muteOriginal !== undefined) {
      this.audio.muteOriginal = Boolean(args.muteOriginal);
      changed.push(this.audio.muteOriginal ? 'asl ovoz o‘chirildi' : 'asl ovoz yoqildi');
    }
    if (args.originalVolumeDb !== undefined) {
      this.audio.originalVolumeDb = clamp(num(args.originalVolumeDb, 0), -40, 12);
      changed.push(`asl ovoz ${this.audio.originalVolumeDb} dB`);
    }
    if (args.musicVolumeDb !== undefined) {
      this.music.volumeDb = clamp(num(args.musicVolumeDb, this.music.volumeDb), -40, 6);
      changed.push(`musiqa ${this.music.volumeDb} dB`);
    }
    if (args.duckMusic !== undefined) {
      this.music.duckEnabled = Boolean(args.duckMusic);
      changed.push(this.music.duckEnabled ? 'musiqa pasayadi' : 'musiqa pasaymaydi');
    }
    if (args.voiceEnhance !== undefined) {
      this.audio.voiceEnhance = Boolean(args.voiceEnhance);
      changed.push('ovoz tozalash');
    }

    if (!changed.length) return { result: 'No audio fields were given, nothing changed.' };
    return { result: `Audio updated: ${changed.join(', ')}.`, change: `Ovoz — ${changed.join(', ')}` };
  }

  private setFormat(args: Record<string, unknown>): ToolExecution {
    const changed: string[] = [];

    if (args.platform !== undefined) {
      const platform = pick(args.platform, PLATFORMS, this.exportConfig.platform);
      this.exportConfig = exportConfigFor(platform, this.exportConfig.encoder);
      changed.push(platform);
    }
    if (args.aspect !== undefined) {
      const aspect = pick(args.aspect, ASPECTS, this.exportConfig.aspect);
      if (aspect !== this.exportConfig.aspect) {
        const { width, height } = resizeForAspect(this.exportConfig, aspect);
        this.exportConfig = { ...this.exportConfig, aspect, width, height };
      }
      changed.push(aspect);
    }
    if (args.fillMode !== undefined) {
      this.effects.fillMode = pick(args.fillMode, ['crop', 'blurPad', 'fit'] as const, this.effects.fillMode);
      changed.push(`kadr: ${this.effects.fillMode}`);
    }

    if (!changed.length) return { result: 'No format fields were given, nothing changed.' };
    return { result: `Format updated: ${changed.join(', ')}.`, change: `Format — ${changed.join(', ')}` };
  }

  /* ----------------------------------------------------------------- result --- */

  /**
   * The project patch, with every overlay and voice line converted from its
   * source anchor onto the final export timeline. Anything anchored to footage
   * the agent cut away is dropped rather than left floating at the wrong moment.
   */
  patch(): Partial<Project> {
    const timeline = this.timeline();

    const overlays: ImageOverlay[] = [];
    let droppedOverlays = 0;
    for (const item of this.overlays) {
      const startMs = place(timeline, item.startAnchorMs);
      const endMs = place(timeline, item.endAnchorMs);
      if (startMs === null || endMs === null || endMs - startMs < 300) {
        droppedOverlays += 1;
        continue;
      }
      overlays.push({ ...item.overlay, startMs: Math.round(startMs), endMs: Math.round(endMs) });
    }

    const voiceovers: VoiceClip[] = [];
    let droppedVoices = 0;
    for (const item of this.voices) {
      const startMs = place(timeline, item.anchorMs);
      if (startMs === null) {
        droppedVoices += 1;
        continue;
      }
      voiceovers.push({ ...item.clip, startMs: Math.round(startMs) });
    }

    if (droppedOverlays) {
      this.notes.push(`${droppedOverlays} ta rasm kesilgan joyga tushgani uchun olib tashlandi.`);
    }
    if (droppedVoices) {
      this.notes.push(`${droppedVoices} ta ovoz kesilgan joyga tushgani uchun olib tashlandi.`);
    }

    return {
      segments: this.segments,
      subtitle: this.subtitle,
      music: this.music,
      effects: this.effects,
      audio: this.audio,
      export: this.exportConfig,
      transcript: this.transcript,
      overlays: overlays.sort((a, b) => a.startMs - b.startMs),
      voiceovers: voiceovers.sort((a, b) => a.startMs - b.startMs),
    };
  }

  /** Whether anything at all was modified — an all-questions run should not write. */
  get touched(): boolean {
    return this.changeLog.length > 0 || this.cutChanged;
  }

  record(change: string): void {
    this.changeLog.push(change);
  }
}

/** Where a moment on the export timeline sits in the original file. */
function anchor(timeline: Timeline, outputMs: number): number {
  return outputToSource(timeline, outputMs)?.sourceMs ?? outputMs;
}

/**
 * Where a moment of the original file ends up after the cut.
 *
 * A moment that landed inside a removed stretch has no honest position, so it
 * returns null and its overlay is dropped instead of being nudged somewhere the
 * words no longer match.
 */
function place(timeline: Timeline, sourceMs: number): number | null {
  const exact = sourceToOutput(timeline, sourceMs);
  if (exact !== null) return exact;

  // Just past the end of the last kept piece is still a sensible landing spot.
  const last = timeline.placed[timeline.placed.length - 1];
  if (last && sourceMs > last.segment.endMs) return last.outEndMs;
  return null;
}

function linesFromWords(words: Word[]): Transcript['lines'] {
  const lines: Transcript['lines'] = [];
  let current: Word[] = [];

  const flush = () => {
    if (!current.length) return;
    lines.push({
      startMs: current[0].startMs,
      endMs: current[current.length - 1].endMs,
      text: current.map((word) => word.text).join(' '),
      words: current,
    });
    current = [];
  };

  for (const word of words) {
    const gap = current.length ? word.startMs - current[current.length - 1].endMs : 0;
    if (current.length >= 12 || gap > 700) flush();
    current.push(word);
  }
  flush();
  return lines;
}

/** Keeps the long edge and recomputes the short one, rounded to even pixels. */
function resizeForAspect(config: ExportConfig, aspect: AspectId): { width: number; height: number } {
  const [w, h] = aspect.split(':').map(Number);
  const longEdge = Math.max(config.width, config.height);
  const width = w >= h ? longEdge : Math.round((longEdge * w) / h);
  const height = w >= h ? Math.round((longEdge * h) / w) : longEdge;
  return { width: even(width), height: even(height) };
}

const even = (value: number): number => (value % 2 === 0 ? value : value + 1);

function num(value: unknown, fallback = Number.NaN): number {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

const clamp01 = (value: number): number => clamp(value, 0, 1);

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const candidate = String(value ?? '').trim() as T;
  return allowed.includes(candidate) ? candidate : fallback;
}
