import type { GradeId } from '../../types/project';
import { lerp, round } from '../../utils/format';
import { chain, escapeFilterPath } from './escape';

type EqParams = { contrast: number; brightness: number; saturation: number; gamma: number };
type BalanceParams = {
  rs: number; gs: number; bs: number;
  rm: number; gm: number; bm: number;
  rh: number; gh: number; bh: number;
};

type GradeSpec = {
  label: string;
  description: string;
  eq: Partial<EqParams>;
  balance?: Partial<BalanceParams>;
  /** Kelvin; 6500 is neutral daylight. */
  temperature?: number;
  /** Applied only once strength passes the given threshold. */
  curves?: { preset: string; minStrength: number };
  /** Full desaturation for the monochrome look. */
  monochrome?: boolean;
};

const NEUTRAL_EQ: EqParams = { contrast: 1, brightness: 0, saturation: 1, gamma: 1 };
const NEUTRAL_BALANCE: BalanceParams = {
  rs: 0, gs: 0, bs: 0,
  rm: 0, gm: 0, bm: 0,
  rh: 0, gh: 0, bh: 0,
};

/**
 * Looks are stored as the *fully applied* parameter set; the strength slider
 * interpolates each parameter back toward neutral. That keeps a 30% teal-orange
 * genuinely subtle instead of "the same grade, slightly transparent".
 */
export const GRADES: Record<GradeId, GradeSpec> = {
  none: { label: 'Tabiiy', description: 'Ranglarga tegilmaydi', eq: {} },

  teal_orange: {
    label: 'Teal & Orange',
    description: 'Klassik kino ranglari — teri iliq, soyalar ko‘k',
    eq: { contrast: 1.12, saturation: 1.14 },
    balance: { rs: -0.09, bs: 0.12, rm: 0.07, bm: -0.05, rh: 0.11, bh: -0.11 },
  },

  warm_film: {
    label: 'Iliq plyonka',
    description: 'Oltin soatdagi yumshoq, iliq kadr',
    eq: { contrast: 1.06, saturation: 1.08, brightness: 0.02 },
    temperature: 5000,
    curves: { preset: 'lighter', minStrength: 0.65 },
  },

  cold_cinema: {
    label: 'Sovuq kino',
    description: 'Ko‘kish, jiddiy, triller kayfiyati',
    eq: { contrast: 1.15, saturation: 0.9 },
    temperature: 8200,
    balance: { bs: 0.08, bm: 0.04 },
  },

  vibrant: {
    label: 'Yorqin',
    description: 'Reels uchun to‘yingan, e’tibor tortadigan ranglar',
    eq: { contrast: 1.1, saturation: 1.38, gamma: 1.03 },
  },

  moody: {
    label: 'Qorong‘i',
    description: 'Chuqur soyalar, past to‘yinganlik',
    eq: { contrast: 1.2, saturation: 0.84, brightness: -0.045 },
    balance: { rm: -0.04, bm: 0.06 },
  },

  vintage: {
    label: 'Vintaj',
    description: 'Eskirgan plyonka, yuvilgan qora ranglar',
    eq: { contrast: 0.95, saturation: 0.88 },
    curves: { preset: 'vintage', minStrength: 0.35 },
    temperature: 5400,
  },

  bw: {
    label: 'Oq-qora',
    description: 'Kontrastli monoxrom',
    eq: { contrast: 1.24, gamma: 1.02 },
    monochrome: true,
  },
};

export const GRADE_ORDER: GradeId[] = [
  'none',
  'teal_orange',
  'warm_film',
  'cold_cinema',
  'vibrant',
  'moody',
  'vintage',
  'bw',
];

function eqFilter(spec: GradeSpec, strength: number): string | null {
  const target: EqParams = { ...NEUTRAL_EQ, ...spec.eq };
  const parts: string[] = [];
  const push = (key: keyof EqParams, neutral: number) => {
    const value = round(lerp(neutral, target[key], strength), 4);
    if (Math.abs(value - neutral) > 0.001) parts.push(`${key}=${value}`);
  };
  push('contrast', 1);
  push('brightness', 0);
  push('saturation', 1);
  push('gamma', 1);
  return parts.length ? `eq=${parts.join(':')}` : null;
}

function balanceFilter(spec: GradeSpec, strength: number): string | null {
  if (!spec.balance) return null;
  const target: BalanceParams = { ...NEUTRAL_BALANCE, ...spec.balance };
  const parts = (Object.keys(NEUTRAL_BALANCE) as (keyof BalanceParams)[])
    .map((key) => ({ key, value: round(lerp(0, target[key], strength), 4) }))
    .filter(({ value }) => Math.abs(value) > 0.002)
    .map(({ key, value }) => `${key}=${value}`);
  return parts.length ? `colorbalance=${parts.join(':')}` : null;
}

function temperatureFilter(spec: GradeSpec, strength: number): string | null {
  if (!spec.temperature) return null;
  const mix = round(strength, 3);
  if (mix < 0.02) return null;
  return `colortemperature=temperature=${spec.temperature}:mix=${mix}:pl=0.4`;
}

/** Builds the colour half of the look for a given grade + strength. */
export function gradeFilters(grade: GradeId, strength: number): string {
  const spec = GRADES[grade];
  if (!spec || grade === 'none' || strength <= 0.01) return '';
  const clamped = Math.min(1, Math.max(0, strength));

  return chain(
    spec.monochrome ? `hue=s=${round(1 - clamped, 3)}` : null,
    spec.curves && clamped >= spec.curves.minStrength ? `curves=preset=${spec.curves.preset}` : null,
    temperatureFilter(spec, clamped),
    balanceFilter(spec, clamped),
    eqFilter(spec, clamped)
  );
}

/** Applies a user supplied `.cube` LUT after the preset grade. */
export function lutFilter(lutPath?: string): string {
  if (!lutPath) return '';
  return `lut3d=file='${escapeFilterPath(lutPath)}':interp=tetrahedral`;
}
