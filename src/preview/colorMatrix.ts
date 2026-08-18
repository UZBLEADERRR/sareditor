import { resolveGrade } from '../ffmpeg/filters/grade';
import type { GradeId } from '../types/project';
import { clamp } from '../utils/format';

/** Skia takes a 4x5 row-major colour matrix. */
export type ColorMatrix = number[];

const IDENTITY: ColorMatrix = [
  1, 0, 0, 0, 0,
  0, 1, 0, 0, 0,
  0, 0, 1, 0, 0,
  0, 0, 0, 1, 0,
];

/** Rec. 709 luma weights, matching what the renderer's filters assume. */
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

function multiply(a: ColorMatrix, b: ColorMatrix): ColorMatrix {
  const out = new Array(20).fill(0);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 5; column += 1) {
      let sum = column === 4 ? a[row * 5 + 4] : 0;
      for (let k = 0; k < 4; k += 1) {
        sum += a[row * 5 + k] * b[k * 5 + column];
      }
      out[row * 5 + column] = sum;
    }
  }
  return out;
}

function saturationMatrix(amount: number): ColorMatrix {
  const s = clamp(amount, 0, 4);
  const inverse = 1 - s;
  return [
    inverse * LUMA_R + s, inverse * LUMA_G, inverse * LUMA_B, 0, 0,
    inverse * LUMA_R, inverse * LUMA_G + s, inverse * LUMA_B, 0, 0,
    inverse * LUMA_R, inverse * LUMA_G, inverse * LUMA_B + s, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

/** Contrast pivots around mid grey, the same point ffmpeg's `eq` uses. */
function contrastMatrix(amount: number): ColorMatrix {
  const c = clamp(amount, 0, 4);
  const offset = 0.5 * (1 - c);
  return [
    c, 0, 0, 0, offset,
    0, c, 0, 0, offset,
    0, 0, c, 0, offset,
    0, 0, 0, 1, 0,
  ];
}

function brightnessMatrix(amount: number): ColorMatrix {
  return [
    1, 0, 0, 0, amount,
    0, 1, 0, 0, amount,
    0, 0, 1, 0, amount,
    0, 0, 0, 1, 0,
  ];
}

function channelMatrix(red: number, green: number, blue: number, offsets: [number, number, number]): ColorMatrix {
  return [
    red, 0, 0, 0, offsets[0],
    0, green, 0, 0, offsets[1],
    0, 0, blue, 0, offsets[2],
    0, 0, 0, 1, 0,
  ];
}

/**
 * Approximates a colour temperature shift as per-channel gain.
 *
 * ffmpeg's `colortemperature` does a proper white-point conversion; a gain pair
 * gets visually close enough for a preview, which is what this is for — the
 * render remains the authority.
 */
function temperatureMatrix(kelvin: number, mix: number): ColorMatrix {
  if (!mix) return IDENTITY;
  // Below 6500 K reads warm, above reads cool.
  const shift = clamp((6500 - kelvin) / 6500, -1, 1) * mix;
  return channelMatrix(1 + shift * 0.28, 1 + shift * 0.03, 1 - shift * 0.26, [0, 0, 0]);
}

/**
 * ffmpeg's `colorbalance` splits into shadows/midtones/highlights; a single
 * matrix cannot separate tonal ranges, so the three are averaged with the
 * midtones weighted heaviest — that is where most of a grade's character sits.
 */
function balanceMatrix(balance: ReturnType<typeof resolveGrade>['balance']): ColorMatrix {
  const blend = (shadow: number, mid: number, high: number) =>
    shadow * 0.3 + mid * 0.45 + high * 0.25;

  const red = blend(balance.rs, balance.rm, balance.rh);
  const green = blend(balance.gs, balance.gm, balance.gh);
  const blue = blend(balance.bs, balance.bm, balance.bh);

  return channelMatrix(1 + red * 0.9, 1 + green * 0.9, 1 + blue * 0.9, [red * 0.06, green * 0.06, blue * 0.06]);
}

/**
 * Builds the preview colour matrix for a grade.
 *
 * This deliberately reads the same resolved parameters the renderer uses, so
 * moving the strength slider changes both by the same amount. It is an
 * approximation of the filter chain, not a reproduction of it: `curves`
 * presets in particular have no matrix equivalent and are skipped.
 */
export function gradeColorMatrix(grade: GradeId, strength: number): ColorMatrix | null {
  const resolved = resolveGrade(grade, strength);
  const isNeutral =
    resolved.eq.contrast === 1 &&
    resolved.eq.brightness === 0 &&
    resolved.eq.saturation === 1 &&
    resolved.monochrome === 0 &&
    resolved.temperatureMix === 0 &&
    Object.values(resolved.balance).every((value) => value === 0);

  if (isNeutral) return null;

  let matrix = IDENTITY;
  const saturation = resolved.monochrome
    ? resolved.eq.saturation * (1 - resolved.monochrome)
    : resolved.eq.saturation;

  matrix = multiply(saturationMatrix(saturation), matrix);
  matrix = multiply(temperatureMatrix(resolved.temperature, resolved.temperatureMix), matrix);
  matrix = multiply(balanceMatrix(resolved.balance), matrix);
  matrix = multiply(contrastMatrix(resolved.eq.contrast), matrix);
  if (resolved.eq.brightness !== 0) {
    matrix = multiply(brightnessMatrix(resolved.eq.brightness), matrix);
  }

  return matrix.map((value) => Math.round(value * 10000) / 10000);
}

export { IDENTITY as IDENTITY_MATRIX };
