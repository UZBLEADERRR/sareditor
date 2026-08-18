import { clamp, even, round } from '../../utils/format';

/**
 * Cinematic edge darkening.
 *
 * ffmpeg's `vignette` takes a lens angle: bigger angle, heavier falloff. A
 * single pass tops out fairly gently, so a really strong setting stacks a
 * second, softer pass on top.
 */
export function vignetteFilter(strength: number): string {
  const s = clamp(strength, 0, 1);
  if (s < 0.02) return '';
  const angle = round(0.45 + s * 1.0, 4);
  const primary = `vignette=angle=${angle}:mode=forward:eval=init`;
  if (s <= 0.8) return primary;
  const extra = round(0.35 + (s - 0.8) * 1.6, 4);
  return `${primary},vignette=angle=${extra}:mode=forward:eval=init`;
}

/** Film grain. Temporal + uniform noise reads as emulsion rather than as compression. */
export function grainFilter(strength: number): string {
  const s = clamp(strength, 0, 1);
  if (s < 0.02) return '';
  return `noise=alls=${Math.max(1, Math.round(s * 22))}:allf=t+u`;
}

export function sharpenFilter(strength: number): string {
  const s = clamp(strength, 0, 1);
  if (s < 0.02) return '';
  return `unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount=${round(s * 1.4, 3)}:chroma_amount=0`;
}

/** Subtle RGB split — a little goes a long way, so the range is deliberately small. */
export function chromaticFilter(strength: number): string {
  const s = clamp(strength, 0, 1);
  if (s < 0.05) return '';
  const shift = Math.max(1, Math.round(s * 6));
  return `rgbashift=rh=${shift}:bh=${-shift}`;
}

/**
 * Highlight bloom. Pulls the bright end of the luma range out, blurs it, and
 * screens it back over the picture — the glow that makes phone footage read as
 * "shot on something expensive".
 */
export function bloomSegment(inLabel: string, outLabel: string, strength: number): string | null {
  const s = clamp(strength, 0, 1);
  if (s < 0.03) return null;
  const sigma = round(8 + s * 22, 2);
  const opacity = round(s * 0.55, 3);
  const a = `${inLabel}_ba`;
  const b = `${inLabel}_bb`;
  return [
    `[${inLabel}]split=2[${a}][${b}]`,
    `[${b}]lutyuv=y='if(gt(val,180),val,16)',gblur=sigma=${sigma}[${b}g]`,
    `[${a}][${b}g]blend=all_mode=screen:all_opacity=${opacity}[${outLabel}]`,
  ].join(';');
}

/** Black cinema bars. `amount` is the share of the frame height they cover in total. */
export function letterboxFilter(amount: number, height: number): string {
  const a = clamp(amount, 0, 0.4);
  if (a < 0.01) return '';
  const bar = even(Math.round((height * a) / 2));
  if (bar < 2) return '';
  return [
    `drawbox=x=0:y=0:w=iw:h=${bar}:color=black@1:t=fill`,
    `drawbox=x=0:y=ih-${bar}:w=iw:h=${bar}:color=black@1:t=fill`,
  ].join(',');
}

export function fadeFilters(fadeInMs: number, fadeOutMs: number, totalMs: number): string {
  const parts: string[] = [];
  if (fadeInMs > 0) {
    parts.push(`fade=t=in:st=0:d=${round(fadeInMs / 1000, 3)}`);
  }
  if (fadeOutMs > 0 && totalMs > fadeOutMs) {
    const start = round((totalMs - fadeOutMs) / 1000, 3);
    parts.push(`fade=t=out:st=${start}:d=${round(fadeOutMs / 1000, 3)}`);
  }
  return parts.join(',');
}

export function audioFadeFilters(fadeInMs: number, fadeOutMs: number, totalMs: number): string {
  const parts: string[] = [];
  if (fadeInMs > 0) parts.push(`afade=t=in:st=0:d=${round(fadeInMs / 1000, 3)}`);
  if (fadeOutMs > 0 && totalMs > fadeOutMs) {
    parts.push(`afade=t=out:st=${round((totalMs - fadeOutMs) / 1000, 3)}:d=${round(fadeOutMs / 1000, 3)}`);
  }
  return parts.join(',');
}
