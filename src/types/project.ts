export type AspectId = '9:16' | '4:5' | '1:1' | '16:9';

export type PlatformId =
  | 'instagram_reels'
  | 'instagram_feed'
  | 'tiktok'
  | 'youtube_shorts'
  | 'youtube';

export type SourceClip = {
  id: string;
  uri: string;
  name: string;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  /** Rotation metadata in degrees; 90/270 means width/height are swapped on screen. */
  rotation: number;
  sizeBytes: number;
};

/** A slice of the source that survives into the final cut. */
export type Segment = {
  id: string;
  startMs: number;
  endMs: number;
  /** 1 = realtime, 2 = twice as fast, 0.5 = slow motion. */
  speed: number;
  label?: string;
};

export type Word = {
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
};

export type TranscriptLine = {
  startMs: number;
  endMs: number;
  text: string;
  words: Word[];
};

export type Transcript = {
  language: string;
  text: string;
  words: Word[];
  lines: TranscriptLine[];
  createdAt: number;
  provider: string;
};

export type SubtitleStyleId =
  | 'hormozi'
  | 'karaoke'
  | 'clean'
  | 'neon'
  | 'boxed'
  | 'typewriter'
  | 'bounce'
  | 'cinema';

export type SubtitleAnimation = 'none' | 'pop' | 'slideUp' | 'fade' | 'typewriter' | 'bounce';

export type SubtitleConfig = {
  enabled: boolean;
  styleId: SubtitleStyleId;
  fontFamily: string;
  /** Absolute path of an imported .ttf/.otf, if the user brought their own. */
  fontFileUri?: string;
  /** Cap height as a percentage of video height — resolution independent. */
  fontSizePct: number;
  primaryColor: string;
  highlightColor: string;
  outlineColor: string;
  outlineWidth: number;
  shadowDepth: number;
  /** 0 = no plate behind the text, 1 = solid box. */
  bgOpacity: number;
  uppercase: boolean;
  maxWordsPerLine: number;
  maxCharsPerLine: number;
  /** 0 = top of frame, 100 = bottom. */
  positionPct: number;
  animation: SubtitleAnimation;
  /** Highlight the word currently being spoken. */
  karaoke: boolean;
  emphasisWords: string[];
  emphasisColor: string;
  language: string;
};

export type MusicConfig = {
  enabled: boolean;
  uri?: string;
  name?: string;
  durationMs?: number;
  /** Offset into the music file where playback starts. */
  startMs: number;
  volumeDb: number;
  duckEnabled: boolean;
  duckAmountDb: number;
  fadeInMs: number;
  fadeOutMs: number;
  loop: boolean;
  beatSync: boolean;
  /** Detected onset positions in ms, relative to the music file. */
  beats?: number[];
  bpm?: number;
};

export type GradeId =
  | 'none'
  | 'teal_orange'
  | 'warm_film'
  | 'cold_cinema'
  | 'vibrant'
  | 'moody'
  | 'vintage'
  | 'bw';

export type ZoomMode = 'none' | 'in' | 'out' | 'pulse';

export type TransitionId =
  | 'none'
  | 'fade'
  | 'dissolve'
  | 'slideleft'
  | 'slideup'
  | 'circleopen'
  | 'pixelize'
  | 'wipeleft'
  | 'flash';

export type FillMode = 'crop' | 'blurPad' | 'fit';

export type EffectsConfig = {
  grade: GradeId;
  gradeStrength: number;
  /** Cinematic edge darkening. */
  vignette: number;
  grain: number;
  bloom: number;
  sharpen: number;
  chromatic: number;
  /** Height of the black cinema bars, as a fraction of the frame. */
  letterbox: number;
  zoom: ZoomMode;
  zoomAmount: number;
  shake: number;
  stabilize: boolean;
  fadeInMs: number;
  fadeOutMs: number;
  transition: TransitionId;
  transitionMs: number;
  lutUri?: string;
  fillMode: FillMode;
};

export type AudioConfig = {
  originalVolumeDb: number;
  muteOriginal: boolean;
  voiceEnhance: boolean;
  normalizeLoudness: boolean;
  targetLufs: number;
};

export type EncoderId = 'hardware' | 'x264' | 'x265';

export type ExportConfig = {
  platform: PlatformId;
  aspect: AspectId;
  width: number;
  height: number;
  fps: number;
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  encoder: EncoderId;
};

export type OverlayStyle = 'fullscreen' | 'cutaway' | 'corner';
export type OverlayAnimation = 'none' | 'fade' | 'slide';

/**
 * A picture dropped over the video while the speaker talks about something.
 *
 * Times are on the *export* timeline, because that is where the viewer hears
 * the phrase — a cut made later would otherwise slide the image off its words.
 */
export type ImageOverlay = {
  id: string;
  /** Local file path of the generated image. */
  uri: string;
  startMs: number;
  endMs: number;
  /** The words this illustrates, kept so the user can see why it is here. */
  phrase: string;
  /** The prompt the image was generated from; editable and re-runnable. */
  prompt: string;
  style: OverlayStyle;
  animation: OverlayAnimation;
  opacity: number;
};

export type AiPlan = {
  hook: string;
  title: string;
  description: string;
  hashtags: string[];
  /** Ranked highlights the model thinks should survive the cut. */
  keepRanges: { startMs: number; endMs: number; score: number; reason: string }[];
  emphasisWords: string[];
  suggestedGrade: GradeId;
  suggestedSubtitleStyle: SubtitleStyleId;
  suggestedTransition: TransitionId;
  musicMood: string;
  notes: string;
  /** Moments the model thinks deserve an illustration, before any are made. */
  imageIdeas: { startMs: number; endMs: number; phrase: string; prompt: string; style: OverlayStyle }[];
  createdAt: number;
  model: string;
};

export type RenderRecord = {
  id: string;
  uri: string;
  createdAt: number;
  durationMs: number;
  sizeBytes: number;
  platform: PlatformId;
  savedToGallery: boolean;
};

export type Project = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  source?: SourceClip;
  segments: Segment[];
  transcript?: Transcript;
  subtitle: SubtitleConfig;
  music: MusicConfig;
  effects: EffectsConfig;
  audio: AudioConfig;
  export: ExportConfig;
  overlays: ImageOverlay[];
  aiPlan?: AiPlan;
  /** Cached analysis so a re-render does not redo the expensive passes. */
  analysis?: {
    silences?: { startMs: number; endMs: number }[];
    scenes?: number[];
    loudnessLufs?: number;
    stabilizeTrfPath?: string;
  };
  renders: RenderRecord[];
};
