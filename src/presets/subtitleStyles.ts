import type { SubtitleConfig, SubtitleStyleId } from '../types/project';

export type SubtitleStylePreset = {
  id: SubtitleStyleId;
  label: string;
  hint: string;
  /** Extra ASS override tags injected at the start of every event. */
  defaultTags?: string;
  /** BorderStyle 3 draws an opaque plate behind the text instead of an outline. */
  borderStyle?: 1 | 3;
  config: Omit<SubtitleConfig, 'enabled' | 'language' | 'emphasisWords' | 'fontFileUri'>;
};

const base = {
  fontFamily: 'Roboto',
  outlineColor: '#000000',
  emphasisColor: '#FF4D8D',
  uppercase: false,
  maxCharsPerLine: 22,
  /** Horizontal centre by default; dragging in the preview changes it. */
  positionXPct: 50,
};

export const SUBTITLE_STYLES: Record<SubtitleStyleId, SubtitleStylePreset> = {
  hormozi: {
    id: 'hormozi',
    label: 'Hormozi',
    hint: 'Yirik, qalin, so‘z sakraydi — Reels/TikTok uchun eng kuchli',
    config: {
      ...base,
      styleId: 'hormozi',
      fontFamily: 'Roboto',
      fontSizePct: 8.2,
      primaryColor: '#FFFFFF',
      highlightColor: '#FFE81F',
      outlineWidth: 6,
      shadowDepth: 3,
      bgOpacity: 0,
      uppercase: true,
      maxWordsPerLine: 3,
      maxCharsPerLine: 16,
      positionPct: 62,
      animation: 'pop',
      karaoke: true,
      emphasisColor: '#3ED598',
    },
  },

  karaoke: {
    id: 'karaoke',
    label: 'Karaoke',
    hint: 'Aytilayotgan so‘z rangi bilan yonadi',
    config: {
      ...base,
      styleId: 'karaoke',
      fontSizePct: 6.2,
      primaryColor: '#FFFFFF',
      highlightColor: '#7C5CFF',
      outlineWidth: 4,
      shadowDepth: 2,
      bgOpacity: 0,
      maxWordsPerLine: 5,
      maxCharsPerLine: 24,
      positionPct: 74,
      animation: 'none',
      karaoke: true,
    },
  },

  clean: {
    id: 'clean',
    label: 'Toza',
    hint: 'Oddiy, chalg‘itmaydigan pastki yozuv',
    config: {
      ...base,
      styleId: 'clean',
      fontSizePct: 4.6,
      primaryColor: '#FFFFFF',
      highlightColor: '#FFFFFF',
      outlineWidth: 2.5,
      shadowDepth: 1,
      bgOpacity: 0,
      maxWordsPerLine: 7,
      maxCharsPerLine: 30,
      positionPct: 84,
      animation: 'fade',
      karaoke: false,
    },
  },

  neon: {
    id: 'neon',
    label: 'Neon',
    hint: 'Rangli nur bilan yorituvchi kontur',
    defaultTags: '\\blur5',
    config: {
      ...base,
      styleId: 'neon',
      fontSizePct: 6.6,
      primaryColor: '#FFFFFF',
      highlightColor: '#38E0C8',
      outlineColor: '#7C5CFF',
      outlineWidth: 6,
      shadowDepth: 0,
      bgOpacity: 0,
      uppercase: true,
      maxWordsPerLine: 4,
      maxCharsPerLine: 18,
      positionPct: 68,
      animation: 'pop',
      karaoke: true,
      emphasisColor: '#FF4D8D',
    },
  },

  boxed: {
    id: 'boxed',
    label: 'Plashka',
    hint: 'Matn orqasida to‘q fon — har qanday kadrda o‘qiladi',
    borderStyle: 3,
    config: {
      ...base,
      styleId: 'boxed',
      fontSizePct: 5.2,
      primaryColor: '#FFFFFF',
      highlightColor: '#FFE81F',
      outlineColor: '#0B0B10',
      outlineWidth: 10,
      shadowDepth: 0,
      bgOpacity: 0.78,
      maxWordsPerLine: 5,
      maxCharsPerLine: 24,
      positionPct: 78,
      animation: 'fade',
      karaoke: true,
    },
  },

  typewriter: {
    id: 'typewriter',
    label: 'Mashinka',
    hint: 'So‘zlar birin-ketin paydo bo‘ladi',
    config: {
      ...base,
      styleId: 'typewriter',
      fontFamily: 'Roboto Mono',
      fontSizePct: 5.0,
      primaryColor: '#FFFFFF',
      highlightColor: '#FFB65C',
      outlineWidth: 3,
      shadowDepth: 2,
      bgOpacity: 0,
      maxWordsPerLine: 6,
      maxCharsPerLine: 26,
      positionPct: 76,
      animation: 'typewriter',
      karaoke: false,
    },
  },

  bounce: {
    id: 'bounce',
    label: 'Sakrash',
    hint: 'Har bir so‘z energiya bilan sakraydi',
    config: {
      ...base,
      styleId: 'bounce',
      fontSizePct: 7.4,
      primaryColor: '#FFFFFF',
      highlightColor: '#FF4D8D',
      outlineWidth: 5,
      shadowDepth: 3,
      bgOpacity: 0,
      uppercase: true,
      maxWordsPerLine: 3,
      maxCharsPerLine: 16,
      positionPct: 60,
      animation: 'bounce',
      karaoke: true,
      emphasisColor: '#FFE81F',
    },
  },

  cinema: {
    id: 'cinema',
    label: 'Kino',
    hint: 'Nozik, kinoga o‘xshash pastki subtitr',
    config: {
      ...base,
      styleId: 'cinema',
      fontFamily: 'Noto Serif',
      fontSizePct: 4.0,
      primaryColor: '#F2EFE6',
      highlightColor: '#F2EFE6',
      outlineWidth: 1.6,
      shadowDepth: 2,
      bgOpacity: 0,
      maxWordsPerLine: 8,
      maxCharsPerLine: 34,
      positionPct: 88,
      animation: 'fade',
      karaoke: false,
    },
  },
};

export const SUBTITLE_STYLE_ORDER: SubtitleStyleId[] = [
  'hormozi',
  'karaoke',
  'bounce',
  'neon',
  'boxed',
  'clean',
  'typewriter',
  'cinema',
];

/** Applies a preset while keeping the user's language, font import and emphasis list. */
export function applySubtitleStyle(current: SubtitleConfig, styleId: SubtitleStyleId): SubtitleConfig {
  const preset = SUBTITLE_STYLES[styleId];
  return {
    ...current,
    ...preset.config,
    styleId,
    enabled: current.enabled,
    language: current.language,
    emphasisWords: current.emphasisWords,
    fontFileUri: current.fontFileUri,
  };
}

/** Font families that Android ships in /system/fonts on essentially every device. */
export const SYSTEM_FONTS = [
  'Roboto',
  'Roboto Condensed',
  'Roboto Mono',
  'Noto Sans',
  'Noto Serif',
  'Noto Sans Mono',
] as const;
