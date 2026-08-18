import type { FillMode } from '../../types/project';

/**
 * Fits arbitrary source footage into the target frame.
 *
 * - `crop`    fills the frame and trims the overflow (the default for Reels)
 * - `blurPad` keeps the whole picture and fills the gaps with a blurred,
 *             darkened copy of itself — the look most vertical reposts use
 * - `fit`     keeps the whole picture on plain black bars
 */
export function frameStage(options: {
  mode: FillMode;
  width: number;
  height: number;
  inLabel: string;
  outLabel: string;
}): string {
  const { mode, width, height, inLabel, outLabel } = options;
  const size = `${width}:${height}`;

  if (mode === 'crop') {
    return `[${inLabel}]scale=${size}:force_original_aspect_ratio=increase:flags=bicubic,crop=${size},setsar=1[${outLabel}]`;
  }

  if (mode === 'fit') {
    return (
      `[${inLabel}]scale=${size}:force_original_aspect_ratio=decrease:flags=bicubic,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[${outLabel}]`
    );
  }

  const bg = `${inLabel}_bg`;
  const fg = `${inLabel}_fg`;
  return [
    `[${inLabel}]split=2[${bg}][${fg}]`,
    `[${bg}]scale=${size}:force_original_aspect_ratio=increase:flags=bicubic,crop=${size},` +
      `gblur=sigma=28,eq=brightness=-0.12:saturation=0.85,setsar=1[${bg}b]`,
    `[${fg}]scale=${size}:force_original_aspect_ratio=decrease:flags=bicubic,setsar=1[${fg}s]`,
    `[${bg}b][${fg}s]overlay=(W-w)/2:(H-h)/2:shortest=1[${outLabel}]`,
  ].join(';');
}
