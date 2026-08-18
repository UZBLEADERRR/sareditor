import { exportConfigFor, PLATFORM_PRESETS } from '../ffmpeg/presets';
import { SUBTITLE_STYLES } from '../presets/subtitleStyles';
import type {
  AudioConfig,
  EffectsConfig,
  MusicConfig,
  PlatformId,
  Project,
  SourceClip,
  SubtitleConfig,
} from '../types/project';
import { uid } from '../utils/id';

export function defaultSubtitleConfig(language = 'auto'): SubtitleConfig {
  return {
    ...SUBTITLE_STYLES.hormozi.config,
    enabled: true,
    language,
    emphasisWords: [],
  };
}

export function defaultMusicConfig(): MusicConfig {
  return {
    enabled: false,
    startMs: 0,
    // Sits under a voice without fighting it; the ducking does the rest.
    volumeDb: -16,
    duckEnabled: true,
    duckAmountDb: 12,
    fadeInMs: 600,
    fadeOutMs: 1200,
    loop: true,
    beatSync: false,
  };
}

/**
 * A deliberately restrained default look. Strong enough to read as graded,
 * subtle enough that a first render never looks like a filter demo.
 */
export function defaultEffectsConfig(): EffectsConfig {
  return {
    grade: 'teal_orange',
    gradeStrength: 0.45,
    vignette: 0.35,
    grain: 0.08,
    bloom: 0.15,
    sharpen: 0.25,
    chromatic: 0,
    letterbox: 0,
    zoom: 'none',
    zoomAmount: 0.12,
    shake: 0,
    stabilize: false,
    fadeInMs: 250,
    fadeOutMs: 400,
    transition: 'none',
    transitionMs: 300,
    fillMode: 'crop',
  };
}

export function defaultAudioConfig(platform: PlatformId): AudioConfig {
  return {
    originalVolumeDb: 0,
    muteOriginal: false,
    voiceEnhance: true,
    normalizeLoudness: true,
    targetLufs: PLATFORM_PRESETS[platform].targetLufs,
  };
}

export function createProject(name: string, platform: PlatformId = 'instagram_reels'): Project {
  const now = Date.now();
  return {
    id: uid('prj_'),
    name: name.trim() || 'Yangi loyiha',
    createdAt: now,
    updatedAt: now,
    segments: [],
    subtitle: defaultSubtitleConfig(),
    music: defaultMusicConfig(),
    effects: defaultEffectsConfig(),
    audio: defaultAudioConfig(platform),
    export: exportConfigFor(platform),
    renders: [],
  };
}

/** Attaches a freshly imported clip and seeds a single full-length segment. */
export function withSource(project: Project, source: SourceClip): Project {
  return {
    ...project,
    source,
    segments: [{ id: uid('seg_'), startMs: 0, endMs: source.durationMs, speed: 1 }],
    analysis: undefined,
    transcript: undefined,
    aiPlan: undefined,
    updatedAt: Date.now(),
  };
}
