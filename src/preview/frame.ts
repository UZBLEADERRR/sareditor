import { groupWordsIntoCues, type Cue } from '../ffmpeg/subtitles';
import type { FillMode, ImageOverlay, SubtitleConfig, Word, ZoomMode } from '../types/project';
import { clamp } from '../utils/format';

export type Rect = { x: number; y: number; width: number; height: number };

/**
 * Where the source frame lands inside the export frame.
 *
 * Mirrors what `frameStage` does with scale/crop/pad in the renderer, so the
 * preview crops exactly what the export will crop — the whole point of showing
 * a preview at all.
 */
export function fitRect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  mode: FillMode
): Rect {
  if (!sourceWidth || !sourceHeight) {
    return { x: 0, y: 0, width: targetWidth, height: targetHeight };
  }

  // `crop` fills and overflows; `fit` and `blurPad` both letterbox the subject.
  const scale =
    mode === 'crop'
      ? Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight)
      : Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);

  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
    width,
    height,
  };
}

/** Height of one cinema bar, matching `letterboxFilter`. */
export function letterboxBarHeight(amount: number, frameHeight: number): number {
  const a = clamp(amount, 0, 0.4);
  return a < 0.01 ? 0 : Math.round((frameHeight * a) / 2);
}

/**
 * Zoom factor at a moment, matching `zoomStage`.
 *
 * The renderer pre-scales and lets `zoompan` walk from 1 to 1+amount; on screen
 * the same walk is just a scale on the drawn image.
 */
export function zoomScaleAt(options: {
  mode: ZoomMode;
  amount: number;
  ms: number;
  totalMs: number;
  beats?: number[];
}): number {
  const amount = clamp(options.amount, 0, 0.6);
  if (options.mode === 'none' || amount < 0.01) return 1;

  const seconds = options.ms / 1000;
  const duration = Math.max(0.5, options.totalMs / 1000);

  switch (options.mode) {
    case 'in':
      return 1 + amount * Math.min(1, seconds / duration);
    case 'out':
      return 1 + amount * (1 - Math.min(1, seconds / duration));
    case 'pulse':
    default: {
      const beats = options.beats ?? [];
      if (!beats.length) {
        const phase = seconds % 0.5;
        return 1 + amount * Math.max(0, 1 - phase / 0.18) ** 2;
      }
      let peak = 0;
      for (const beat of beats) {
        const delta = (seconds - beat / 1000) / 0.085;
        if (Math.abs(delta) > 3) continue;
        peak = Math.max(peak, Math.exp(-delta * delta));
      }
      return 1 + amount * Math.min(1, peak);
    }
  }
}

/** Overall fade multiplier at a moment, matching `fadeFilters`. */
export function fadeOpacityAt(fadeInMs: number, fadeOutMs: number, ms: number, totalMs: number): number {
  let opacity = 1;
  if (fadeInMs > 0 && ms < fadeInMs) opacity = Math.min(opacity, ms / fadeInMs);
  if (fadeOutMs > 0 && ms > totalMs - fadeOutMs) {
    opacity = Math.min(opacity, Math.max(0, (totalMs - ms) / fadeOutMs));
  }
  return clamp(opacity, 0, 1);
}

export type ActiveCaption = {
  cue: Cue;
  /** Index into `cue.words`, or -1 when nothing is highlighted. */
  activeWordIndex: number;
};

/**
 * The caption on screen at a moment.
 *
 * Uses the same cue grouping as the ASS writer, so what the preview shows is
 * the same phrase, split the same way, as the burned-in result.
 */
export function captionAt(cues: Cue[], ms: number, karaoke: boolean): ActiveCaption | null {
  for (const cue of cues) {
    if (ms < cue.startMs || ms > cue.endMs) continue;
    if (!karaoke) return { cue, activeWordIndex: -1 };

    let activeWordIndex = -1;
    for (let index = 0; index < cue.words.length; index += 1) {
      const word = cue.words[index];
      const nextStart = index === cue.words.length - 1 ? cue.endMs : cue.words[index + 1].startMs;
      if (ms >= (index === 0 ? cue.startMs : word.startMs) && ms < nextStart) {
        activeWordIndex = index;
        break;
      }
    }
    return { cue, activeWordIndex };
  }
  return null;
}

export function buildCues(words: Word[], config: SubtitleConfig): Cue[] {
  return groupWordsIntoCues(words, config);
}

/** Placement of an overlay image, matching `geometryFor` in the renderer. */
export function overlayRect(
  overlay: ImageOverlay,
  frameWidth: number,
  frameHeight: number,
  imageWidth: number,
  imageHeight: number
): Rect {
  const ratio = imageWidth && imageHeight ? imageWidth / imageHeight : 1;

  // A hand-placed overlay overrides its style entirely.
  if (overlay.xPct !== undefined && overlay.yPct !== undefined) {
    const width = frameWidth * ((overlay.widthPct ?? 60) / 100);
    const height = overlay.style === 'fullscreen' ? frameHeight : width / ratio;
    return {
      x: (frameWidth * overlay.xPct) / 100 - width / 2,
      y: (frameHeight * overlay.yPct) / 100 - height / 2,
      width,
      height,
    };
  }

  switch (overlay.style) {
    case 'fullscreen': {
      const scale = Math.max(frameWidth / imageWidth, frameHeight / imageHeight);
      const width = imageWidth * scale;
      const height = imageHeight * scale;
      return { x: (frameWidth - width) / 2, y: (frameHeight - height) / 2, width, height };
    }
    case 'corner': {
      const width = frameWidth * 0.36;
      const height = width / ratio;
      return { x: frameWidth - width - frameWidth * 0.05, y: frameHeight * 0.07, width, height };
    }
    case 'cutaway':
    default: {
      const width = frameWidth * 0.86;
      const height = width / ratio;
      return { x: (frameWidth - width) / 2, y: frameHeight * 0.14, width, height };
    }
  }
}

/** Fade envelope for one overlay, matching the alpha fades in `overlayStage`. */
export function overlayOpacityAt(overlay: ImageOverlay, ms: number): number {
  if (ms < overlay.startMs || ms > overlay.endMs) return 0;
  const base = clamp(overlay.opacity ?? 1, 0, 1);
  if (overlay.animation === 'none') return base;

  const fade = Math.min(260, (overlay.endMs - overlay.startMs) / 3);
  if (fade <= 0) return base;

  const sinceStart = ms - overlay.startMs;
  const untilEnd = overlay.endMs - ms;
  const envelope = Math.min(1, sinceStart / fade, untilEnd / fade);
  return base * clamp(envelope, 0, 1);
}

/** Vertical nudge for the slide entry, matching the overlay `y` expression. */
export function overlaySlideOffset(overlay: ImageOverlay, ms: number, frameHeight: number): number {
  if (overlay.animation !== 'slide') return 0;
  const fade = Math.min(260, (overlay.endMs - overlay.startMs) / 3);
  if (fade <= 0) return 0;
  const progress = clamp((ms - overlay.startMs) / fade, 0, 1);
  return frameHeight * 0.04 * (1 - progress);
}
