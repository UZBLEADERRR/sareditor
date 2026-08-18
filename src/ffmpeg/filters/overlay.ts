import type { ImageOverlay } from '../../types/project';
import { clamp, even, round, toFfmpegSeconds } from '../../utils/format';

/** How long an overlay takes to appear and disappear. */
const FADE_MS = 260;

type Geometry = { scale: string; x: string; y: string };

/**
 * Where each style sits in the frame.
 *
 * The cutaway and corner styles deliberately stay in the upper half: captions
 * live in the lower two thirds, and an illustration that covers the words it is
 * illustrating defeats the point.
 */
function geometryFor(overlay: ImageOverlay, width: number, height: number): Geometry {
  // Hand placement from the preview wins over the style's default position.
  if (overlay.xPct !== undefined && overlay.yPct !== undefined) {
    const overlayWidth = even(Math.round((width * (overlay.widthPct ?? 60)) / 100));
    return {
      scale: overlay.style === 'fullscreen'
        ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`
        : `scale=${overlayWidth}:-2`,
      x: `${Math.round((width * overlay.xPct) / 100)}-w/2`,
      y: `${Math.round((height * overlay.yPct) / 100)}-h/2`,
    };
  }

  switch (overlay.style) {
    case 'fullscreen':
      return {
        scale: `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
        x: '0',
        y: '0',
      };
    case 'corner':
      return {
        scale: `scale=${even(Math.round(width * 0.36))}:-2`,
        x: `W-w-${Math.round(width * 0.05)}`,
        y: String(Math.round(height * 0.07)),
      };
    case 'cutaway':
    default:
      return {
        scale: `scale=${even(Math.round(width * 0.86))}:-2`,
        x: '(W-w)/2',
        y: String(Math.round(height * 0.14)),
      };
  }
}

export type OverlayStage = {
  /** Filter graph nodes to append. */
  parts: string[];
  /** Label carrying the composited video. */
  outLabel: string;
};

/**
 * Composites generated images over the video.
 *
 * Each image is a looping input, shifted so its own clock starts when it should
 * appear — that way `fade` can work on the alpha channel at the right moment,
 * while `enable` keeps it off screen the rest of the time. Doing it with
 * `enable` alone would make the picture pop in and out with a hard edge.
 */
export function overlayStage(options: {
  overlays: ImageOverlay[];
  /** ffmpeg input index of the first overlay image. */
  firstInputIndex: number;
  width: number;
  height: number;
  baseLabel: string;
  totalMs: number;
}): OverlayStage {
  const parts: string[] = [];
  let current = options.baseLabel;

  options.overlays.forEach((overlay, index) => {
    const startMs = clamp(overlay.startMs, 0, Math.max(0, options.totalMs - 200));
    const endMs = clamp(overlay.endMs, startMs + 400, options.totalMs);
    if (endMs <= startMs) return;

    const inputIndex = options.firstInputIndex + index;
    const geometry = geometryFor(overlay, options.width, options.height);
    const start = toFfmpegSeconds(startMs);
    const end = toFfmpegSeconds(endMs);
    const fade = round(Math.min(FADE_MS, (endMs - startMs) / 3) / 1000, 3);
    const opacity = clamp(overlay.opacity ?? 1, 0.05, 1);

    const shaped = `ov${index}`;
    const composed = `ovc${index}`;

    const chain = [
      geometry.scale,
      'format=rgba',
      // Move the image's own timeline so t == the moment it should appear.
      `setpts=PTS-STARTPTS+${start}/TB`,
      overlay.animation === 'none'
        ? null
        : `fade=t=in:st=${start}:d=${fade}:alpha=1`,
      overlay.animation === 'none'
        ? null
        : `fade=t=out:st=${round(Number(end) - fade, 3)}:d=${fade}:alpha=1`,
      opacity < 1 ? `colorchannelmixer=aa=${round(opacity, 3)}` : null,
    ]
      .filter(Boolean)
      .join(',');

    parts.push(`[${inputIndex}:v]${chain}[${shaped}]`);

    // A slide entry nudges the picture up into place over the fade.
    const y =
      overlay.animation === 'slide'
        ? `${geometry.y}+${Math.round(options.height * 0.04)}*(1-min(1,max(0,(t-${start})/${fade})))`
        : geometry.y;

    parts.push(
      `[${current}][${shaped}]overlay=x=${geometry.x}:y='${y}'` +
        `:enable='between(t,${start},${end})':eof_action=pass:format=auto[${composed}]`
    );
    current = composed;
  });

  return { parts, outLabel: current };
}

/** Input arguments for one overlay image, in overlay order. */
export function overlayInputArgs(overlays: ImageOverlay[], fps: number): string[] {
  return overlays.flatMap((overlay) => ['-loop', '1', '-framerate', String(fps), '-i', overlay.uri]);
}
