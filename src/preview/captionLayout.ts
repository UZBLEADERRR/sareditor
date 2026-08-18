import type { SkFont } from '@shopify/react-native-skia';

import type { Cue } from '../ffmpeg/subtitles';
import { fittingCharsPerLine } from '../ffmpeg/subtitles';
import type { SubtitleConfig } from '../types/project';

export type LaidOutWord = {
  text: string;
  /** Index into the cue's word list, for matching the karaoke highlight. */
  index: number;
  x: number;
  y: number;
  width: number;
};

export type CaptionLayout = {
  words: LaidOutWord[];
  width: number;
  height: number;
  lineHeight: number;
};

/**
 * Lays a cue out into lines the same way the ASS writer does.
 *
 * The renderer wraps on a character budget derived from the font size; here the
 * real glyph widths are available, so the budget is used to pick the line
 * breaks and the measurements position the words. Same breaks, exact spacing.
 */
export function layoutCaption(
  cue: Cue,
  config: SubtitleConfig,
  font: SkFont,
  frameWidth: number
): CaptionLayout {
  const spaceWidth = font.getTextWidth(' ');
  const lineHeight = font.getSize() * 1.18;
  const budget = Math.min(
    config.maxCharsPerLine,
    fittingCharsPerLine(frameWidth, font.getSize(), config.uppercase)
  );

  const lines: { words: { text: string; index: number; width: number }[]; width: number }[] = [];
  let line: { text: string; index: number; width: number }[] = [];
  let lineChars = 0;
  let lineWidth = 0;

  const flush = () => {
    if (!line.length) return;
    lines.push({ words: line, width: lineWidth });
    line = [];
    lineChars = 0;
    lineWidth = 0;
  };

  cue.words.forEach((word, index) => {
    const text = config.uppercase ? word.text.toLocaleUpperCase() : word.text;
    const width = font.getTextWidth(text);
    const nextChars = lineChars + text.length + (lineChars ? 1 : 0);

    if (line.length && nextChars > budget) flush();

    lineWidth += (line.length ? spaceWidth : 0) + width;
    lineChars = line.length ? nextChars : text.length;
    line.push({ text, index, width });
  });
  flush();

  const blockWidth = lines.reduce((widest, item) => Math.max(widest, item.width), 0);
  const words: LaidOutWord[] = [];

  lines.forEach((item, lineIndex) => {
    // Every line is centred on the block, matching ASS alignment 5.
    let cursor = (blockWidth - item.width) / 2;
    const y = lineIndex * lineHeight;
    for (const word of item.words) {
      words.push({ text: word.text, index: word.index, x: cursor, y, width: word.width });
      cursor += word.width + spaceWidth;
    }
  });

  return { words, width: blockWidth, height: lines.length * lineHeight, lineHeight };
}
