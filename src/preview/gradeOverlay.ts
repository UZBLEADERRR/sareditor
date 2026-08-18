import type { ColorMatrix } from './colorMatrix';
import { clamp } from '../utils/format';

/**
 * A grade expressed as things that can be painted *over* a picture.
 *
 * `multiply` darkens and tints, `add` lifts, and `wash` is a flat grey veil
 * that stands in for the saturation the matrix removes. Everything is in 0..1.
 */
export type GradeOverlay = {
  multiply: [number, number, number];
  add: [number, number, number];
  wash: number;
};

const LUMA = [0.2126, 0.7152, 0.0722] as const;

/**
 * Turns a 4x5 colour matrix into layers that approximate it from on top.
 *
 * The preview draws the clip with a hardware video view, which no colour matrix
 * can reach — the pixels never pass through the canvas. So the grade is
 * reconstructed from how the matrix treats two colours it *can* be evaluated
 * against: black gives the lift, white gives the gain. A grade that mostly
 * warms, cools, crushes or lifts the picture comes out close.
 *
 * Saturation is the part that genuinely cannot be reproduced this way, because
 * removing colour needs the source pixel. It is approximated by how far the
 * matrix moves a saturated primary toward its own luma — a monochrome grade
 * therefore reads as a heavy grey veil rather than as true black and white.
 *
 * The render is unaffected either way: ffmpeg applies the real filter chain,
 * and this only has to make a slider feel connected to the picture.
 */
export function gradeOverlay(matrix: ColorMatrix | null): GradeOverlay | null {
  if (!matrix) return null;

  const lift: number[] = [];
  const gain: number[] = [];

  for (let row = 0; row < 3; row += 1) {
    const offset = matrix[row * 5 + 4];
    const white = matrix[row * 5] + matrix[row * 5 + 1] + matrix[row * 5 + 2] + offset;
    lift.push(offset);
    gain.push(white - offset);
  }

  // How much of a pure primary survives as its own channel, against how much
  // has bled into the other two: identical means fully desaturated.
  const bleed = [0, 1, 2].map((channel) => {
    const own = matrix[channel * 5 + channel];
    const others = [0, 1, 2]
      .filter((other) => other !== channel)
      .map((other) => matrix[other * 5 + channel]);
    const spread = others.reduce((sum, value) => sum + Math.abs(own - value), 0) / 2;
    return clamp(1 - spread / Math.max(0.35, Math.abs(own) + 0.35), 0, 1);
  });
  const wash = clamp(bleed.reduce((sum, value, i) => sum + value * LUMA[i], 0) * 0.75, 0, 0.75);

  return {
    // Gains above 1 cannot be painted; they become additive light instead.
    multiply: gain.map((value) => clamp(value, 0, 1)) as [number, number, number],
    add: gain.map((value, i) => clamp(lift[i] + Math.max(0, value - 1) * 0.5, 0, 1)) as [
      number,
      number,
      number,
    ],
    wash,
  };
}

/** `rgba()` string for a Skia colour, since the pieces are plain numbers. */
export function rgba(color: [number, number, number], alpha = 1): string {
  const channel = (value: number) => Math.round(clamp(value, 0, 1) * 255);
  return `rgba(${channel(color[0])}, ${channel(color[1])}, ${channel(color[2])}, ${alpha})`;
}
