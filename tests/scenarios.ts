import path from 'node:path';

import { exportConfigFor } from '../src/ffmpeg/presets';
import { SUBTITLE_STYLES, SUBTITLE_STYLE_ORDER } from '../src/presets/subtitleStyles';
import type { Project, SourceClip, Transcript, Word } from '../src/types/project';
import { ensureFixtures } from './helpers';

const fixtures = ensureFixtures();

export const SOURCE: SourceClip = {
  id: 'src', uri: fixtures.source, name: 'source.mp4',
  durationMs: 12_000, width: 1280, height: 720, fps: 30,
  hasAudio: true, rotation: 0, sizeBytes: 0,
};

export const SILENT_VERTICAL: SourceClip = {
  id: 'src2', uri: fixtures.silentVertical, name: 'silent.mp4',
  durationMs: 8_000, width: 1080, height: 1920, fps: 30,
  hasAudio: false, rotation: 0, sizeBytes: 0,
};

export const MUSIC = fixtures.music;
export const IMAGES = fixtures.images;

function evenlySpacedWords(fromMs: number, toMs: number, tokens: string[]): Word[] {
  const step = (toMs - fromMs) / tokens.length;
  return tokens.map((text, index) => ({
    text,
    startMs: Math.round(fromMs + index * step),
    endMs: Math.round(fromMs + (index + 1) * step - 20),
  }));
}

export const TRANSCRIPT: Transcript = {
  language: 'uz',
  provider: 'test',
  createdAt: 0,
  text: '',
  lines: [],
  words: evenlySpacedWords(300, 9000, [
    'Salom', 'bugun', 'sizga', 'juda', 'muhim', 'narsani', 'aytaman',
    'bu', 'usul', 'menga', '10', 'barobar', 'ko‘proq', 'natija', 'berdi',
    'oxirigacha', 'ko‘ring',
  ]),
};

/**
 * A deliberately plain project. Every scenario starts here and turns on exactly
 * one area, so a failure names the feature that broke.
 */
export function baseProject(overrides: Partial<Project> = {}): Project {
  const project: Project = {
    id: 'test', name: 'test', createdAt: 0, updatedAt: 0,
    source: SOURCE,
    segments: [{ id: 's1', startMs: 500, endMs: 6500, speed: 1 }],
    subtitle: {
      ...SUBTITLE_STYLES.hormozi.config,
      enabled: false,
      language: 'uz',
      emphasisWords: [],
      // A face that exists on the CI image; devices use /system/fonts instead.
      fontFamily: 'DejaVu Sans',
    },
    music: {
      enabled: false, startMs: 0, volumeDb: -16, duckEnabled: true, duckAmountDb: 12,
      fadeInMs: 600, fadeOutMs: 1200, loop: true, beatSync: false,
    },
    effects: {
      grade: 'none', gradeStrength: 0, vignette: 0, grain: 0, bloom: 0, sharpen: 0,
      chromatic: 0, letterbox: 0, zoom: 'none', zoomAmount: 0.12, shake: 0,
      stabilize: false, fadeInMs: 0, fadeOutMs: 0, transition: 'none', transitionMs: 300,
      fillMode: 'crop',
    },
    audio: {
      originalVolumeDb: 0, muteOriginal: false, voiceEnhance: false,
      normalizeLoudness: false, targetLufs: -14,
    },
    // Small frames keep the suite fast; the filter graph is resolution independent.
    export: { ...exportConfigFor('instagram_reels', 'x264'), width: 540, height: 960, videoBitrateKbps: 2500 },
    overlays: [],
    renders: [],
  };
  return { ...project, ...overrides };
}

export type Scenario = { name: string; project: Project };

export function allScenarios(): Scenario[] {
  const scenarios: Scenario[] = [
    { name: 'minimal', project: baseProject() },

    {
      name: 'effects_full',
      project: baseProject({
        effects: {
          ...baseProject().effects,
          grade: 'teal_orange', gradeStrength: 0.6, vignette: 0.75, grain: 0.2,
          bloom: 0.3, sharpen: 0.4, chromatic: 0.2, letterbox: 0.14,
          zoom: 'in', zoomAmount: 0.12, shake: 0.2,
          fadeInMs: 300, fadeOutMs: 500, fillMode: 'blurPad',
        },
        audio: {
          originalVolumeDb: -2, muteOriginal: false, voiceEnhance: true,
          normalizeLoudness: true, targetLufs: -14,
        },
      }),
    },

    {
      name: 'transitions_and_speed',
      project: baseProject({
        segments: [
          { id: 'a', startMs: 0, endMs: 3000, speed: 1 },
          { id: 'b', startMs: 4000, endMs: 7000, speed: 1.5 },
          { id: 'c', startMs: 8000, endMs: 11_500, speed: 0.75 },
        ],
        effects: {
          ...baseProject().effects,
          transition: 'fade', transitionMs: 400, grade: 'vibrant', gradeStrength: 0.7,
        },
      }),
    },

    {
      name: 'music_ducked_beatsync',
      project: baseProject({
        music: {
          enabled: true, uri: MUSIC, name: 'music.mp3', durationMs: 20_000,
          startMs: 1000, volumeDb: -14, duckEnabled: true, duckAmountDb: 14,
          fadeInMs: 500, fadeOutMs: 900, loop: true, beatSync: true,
          beats: Array.from({ length: 40 }, (_, index) => 1000 + index * 500),
        },
        effects: { ...baseProject().effects, zoom: 'pulse', zoomAmount: 0.07 },
        audio: {
          originalVolumeDb: 0, muteOriginal: false, voiceEnhance: true,
          normalizeLoudness: true, targetLufs: -14,
        },
      }),
    },

    {
      name: 'music_only_original_muted',
      project: baseProject({
        music: {
          enabled: true, uri: MUSIC, name: 'music.mp3', durationMs: 20_000,
          startMs: 0, volumeDb: -6, duckEnabled: false, duckAmountDb: 12,
          fadeInMs: 300, fadeOutMs: 600, loop: false, beatSync: false,
        },
        audio: { ...baseProject().audio, muteOriginal: true },
      }),
    },

    {
      name: 'source_without_audio',
      project: baseProject({
        source: SILENT_VERTICAL,
        segments: [{ id: 's', startMs: 0, endMs: 5000, speed: 1 }],
        effects: { ...baseProject().effects, grade: 'bw', gradeStrength: 1, vignette: 0.5, fillMode: 'fit' },
      }),
    },

    {
      name: 'hevc_four_five',
      project: baseProject({
        export: { ...exportConfigFor('instagram_feed', 'x265'), width: 432, height: 540, videoBitrateKbps: 2000 },
        effects: { ...baseProject().effects, grade: 'moody', gradeStrength: 0.8, vignette: 0.6 },
      }),
    },
  ];

  // The overlay graph shifts each image's own clock, fades its alpha and gates
  // it with `enable`; all three styles have different geometry, so all three
  // run. The last one deliberately sits under burned-in captions to prove the
  // ordering keeps text on top.
  scenarios.push({
    name: 'image_overlays',
    project: baseProject({
      transcript: TRANSCRIPT,
      segments: [{ id: 's1', startMs: 0, endMs: 9000, speed: 1 }],
      subtitle: {
        ...SUBTITLE_STYLES.hormozi.config,
        enabled: true,
        language: 'uz',
        emphasisWords: [],
        fontFamily: 'DejaVu Sans',
      },
      overlays: [
        {
          id: 'o1', uri: IMAGES[0], startMs: 800, endMs: 2600,
          phrase: 'birinchi misol', prompt: 'a', style: 'cutaway', animation: 'fade', opacity: 1,
        },
        {
          id: 'o2', uri: IMAGES[1], startMs: 3200, endMs: 5000,
          phrase: 'ikkinchi misol', prompt: 'b', style: 'fullscreen', animation: 'slide', opacity: 1,
        },
        {
          id: 'o3', uri: IMAGES[2], startMs: 5800, endMs: 7600,
          phrase: 'uchinchi misol', prompt: 'c', style: 'corner', animation: 'fade', opacity: 0.85,
        },
      ],
    }),
  });

  // Every caption style has to survive libass; they differ in border style,
  // animation tags and wrapping, which is exactly where ASS output breaks.
  for (const styleId of SUBTITLE_STYLE_ORDER) {
    scenarios.push({
      name: `captions_${styleId}`,
      project: baseProject({
        transcript: TRANSCRIPT,
        segments: [{ id: 's1', startMs: 0, endMs: 9000, speed: 1 }],
        subtitle: {
          ...SUBTITLE_STYLES[styleId].config,
          enabled: true,
          language: 'uz',
          emphasisWords: ['10', 'barobar'],
          fontFamily: 'DejaVu Sans',
        },
      }),
    });
  }

  return scenarios;
}

export const outputPathFor = (dir: string, name: string) => path.join(dir, `${name}.mp4`);
