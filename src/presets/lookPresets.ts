import type { EffectsConfig } from '../types/project';

export type LookPreset = {
  id: string;
  label: string;
  hint: string;
  effects: Partial<EffectsConfig>;
};

/**
 * One-tap looks. Each is a complete set of the parameters that define a style,
 * so switching between them never leaves a stray setting from the previous one.
 */
export const LOOK_PRESETS: LookPreset[] = [
  {
    id: 'clean',
    label: 'Toza',
    hint: 'Ranglarga deyarli tegilmaydi',
    effects: {
      grade: 'none',
      gradeStrength: 0,
      vignette: 0,
      grain: 0,
      bloom: 0,
      sharpen: 0.2,
      chromatic: 0,
      letterbox: 0,
      zoom: 'none',
      shake: 0,
    },
  },
  {
    id: 'cinema',
    label: 'Kino',
    hint: 'Teal & orange, chetlari qorayadi, sekin zoom',
    effects: {
      grade: 'teal_orange',
      gradeStrength: 0.6,
      vignette: 0.5,
      grain: 0.12,
      bloom: 0.2,
      sharpen: 0.25,
      chromatic: 0,
      letterbox: 0.14,
      zoom: 'in',
      zoomAmount: 0.08,
      shake: 0,
      fadeInMs: 400,
      fadeOutMs: 600,
    },
  },
  {
    id: 'reels',
    label: 'Reels Pop',
    hint: 'Yorqin ranglar, o‘tkir, zarbga urish',
    effects: {
      grade: 'vibrant',
      gradeStrength: 0.7,
      vignette: 0.25,
      grain: 0,
      bloom: 0.28,
      sharpen: 0.45,
      chromatic: 0,
      letterbox: 0,
      zoom: 'pulse',
      zoomAmount: 0.06,
      shake: 0,
      fadeInMs: 120,
      fadeOutMs: 200,
    },
  },
  {
    id: 'moody',
    label: 'Qorong‘i',
    hint: 'Chuqur soyalar, sovuq ton, kuchli vinyet',
    effects: {
      grade: 'moody',
      gradeStrength: 0.75,
      vignette: 0.72,
      grain: 0.18,
      bloom: 0.1,
      sharpen: 0.2,
      chromatic: 0.08,
      letterbox: 0.18,
      zoom: 'in',
      zoomAmount: 0.06,
      shake: 0,
    },
  },
  {
    id: 'retro',
    label: 'Retro',
    hint: 'Plyonka doni, iliq ranglar, yengil silkinish',
    effects: {
      grade: 'vintage',
      gradeStrength: 0.8,
      vignette: 0.55,
      grain: 0.42,
      bloom: 0.22,
      sharpen: 0,
      chromatic: 0.2,
      letterbox: 0.1,
      zoom: 'none',
      shake: 0.12,
    },
  },
  {
    id: 'vlog',
    label: 'Vlog',
    hint: 'Iliq, tabiiy teri rangi, tiniq',
    effects: {
      grade: 'warm_film',
      gradeStrength: 0.5,
      vignette: 0.2,
      grain: 0.05,
      bloom: 0.15,
      sharpen: 0.35,
      chromatic: 0,
      letterbox: 0,
      zoom: 'none',
      shake: 0,
    },
  },
  {
    id: 'bw',
    label: 'Oq-qora',
    hint: 'Kontrastli monoxrom, plyonka doni',
    effects: {
      grade: 'bw',
      gradeStrength: 1,
      vignette: 0.45,
      grain: 0.28,
      bloom: 0.12,
      sharpen: 0.3,
      chromatic: 0,
      letterbox: 0.14,
      zoom: 'none',
      shake: 0,
    },
  },
];
