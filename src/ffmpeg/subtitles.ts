import type { SubtitleConfig, Word } from '../types/project';
import { SUBTITLE_STYLES } from '../presets/subtitleStyles';
import { clamp, hexToAssColor } from '../utils/format';

/** One on-screen caption: a small group of words shown together. */
export type Cue = {
  startMs: number;
  endMs: number;
  words: Word[];
  /** Indices into `words` where a manual line break goes. */
  breaks: number[];
};

const MIN_CUE_MS = 420;
/** Gaps shorter than this are absorbed so captions do not flicker between words. */
const GAP_BRIDGE_MS = 320;

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:"'`«»„“”()\[\]…]/g, '')
    .trim();
}

/** ASS timestamps are `H:MM:SS.cc` — centiseconds, single-digit hour. */
export function assTime(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const cs = Math.floor((safe % 1000) / 10);
  const totalSeconds = Math.floor(safe / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`;
}

function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, '')
    .replace(/[{}]/g, '')
    .replace(/\r?\n/g, ' ')
    .trim();
}

/**
 * How many characters actually fit on one line at a given font size.
 *
 * The style presets carry a nominal character limit, but the real constraint is
 * geometry: a 8%-of-height font on a 1080-wide frame fits far fewer characters
 * than the same percentage on a 1920-wide one. Since captions are positioned
 * with `\\pos`, ASS margins no longer bound the text, so nothing but this
 * calculation stops a line from running off the side of the frame.
 */
export function fittingCharsPerLine(
  width: number,
  fontSize: number,
  uppercase: boolean,
  marginFraction = 0.07
): number {
  const usable = width * (1 - 2 * marginFraction);
  // Average advance for a bold sans face, measured against the caption styles
  // this app ships; uppercase runs noticeably wider.
  const averageGlyph = fontSize * (uppercase ? 0.62 : 0.55);
  return Math.max(6, Math.floor(usable / averageGlyph));
}

/**
 * Groups the word stream into caption-sized chunks.
 *
 * Chunks break on the word limit, on the character limit, and on any pause
 * longer than ~700 ms — which is almost always a sentence boundary in speech and
 * keeps captions reading naturally rather than sliding across clauses.
 */
export function groupWordsIntoCues(words: Word[], config: SubtitleConfig): Cue[] {
  const cues: Cue[] = [];
  let current: Word[] = [];

  const flush = () => {
    if (!current.length) return;
    const startMs = current[0].startMs;
    const endMs = Math.max(current[current.length - 1].endMs, startMs + MIN_CUE_MS);
    cues.push({ startMs, endMs, words: current, breaks: computeBreaks(current, config) });
    current = [];
  };

  for (const word of words) {
    const text = escapeAssText(word.text);
    if (!text) continue;
    const candidate = [...current, { ...word, text }];
    const charCount = candidate.reduce((n, w) => n + w.text.length + 1, -1);
    const pause = current.length ? word.startMs - current[current.length - 1].endMs : 0;

    if (current.length && (pause > 700 || candidate.length > config.maxWordsPerLine * 2)) {
      flush();
      current = [{ ...word, text }];
      continue;
    }

    current = candidate;
    if (
      current.length >= config.maxWordsPerLine ||
      charCount >= config.maxCharsPerLine * 2
    ) {
      flush();
    }
  }
  flush();

  // Stretch each cue up to the next one when the gap is short, so the caption
  // area does not blink empty between phrases.
  for (let i = 0; i < cues.length; i += 1) {
    const next = cues[i + 1];
    if (next && next.startMs - cues[i].endMs < GAP_BRIDGE_MS) {
      cues[i].endMs = next.startMs;
    }
  }

  return cues;
}

/** Decides where a cue wraps onto a second visual line. */
function computeBreaks(words: Word[], config: SubtitleConfig): number[] {
  const breaks: number[] = [];
  let lineChars = 0;
  words.forEach((word, index) => {
    const next = lineChars + word.text.length + (lineChars ? 1 : 0);
    if (lineChars > 0 && next > config.maxCharsPerLine) {
      breaks.push(index);
      lineChars = word.text.length;
    } else {
      lineChars = next;
    }
  });
  return breaks;
}

type RenderContext = {
  config: SubtitleConfig;
  emphasis: Set<string>;
  highlight: string;
  emphasisColor: string;
};

/** Inline override block for the word currently being spoken. */
function activeWordTags(context: RenderContext, isEmphasis: boolean): string {
  const { config } = context;
  const colour = isEmphasis ? context.emphasisColor : context.highlight;
  const tags = [`\\1c${colour}`];

  switch (config.animation) {
    case 'pop':
      tags.push('\\fscx100\\fscy100\\t(0,90,\\fscx116\\fscy116)\\t(90,190,\\fscx100\\fscy100)');
      break;
    case 'bounce':
      tags.push('\\fscy100\\t(0,80,\\fscy132\\fscx108)\\t(80,220,\\fscy100\\fscx100)');
      break;
    default:
      break;
  }
  return `{${tags.join('')}}`;
}

function inactiveWordTags(context: RenderContext, isEmphasis: boolean): string {
  return isEmphasis ? `{\\1c${context.emphasisColor}}` : '';
}

/** Builds the text of one Dialogue line, marking `activeIndex` as spoken. */
function renderCueText(cue: Cue, activeIndex: number, context: RenderContext, revealUpTo?: number): string {
  const { config } = context;
  const pieces: string[] = [];

  cue.words.forEach((word, index) => {
    if (revealUpTo !== undefined && index > revealUpTo) return;
    if (cue.breaks.includes(index) && pieces.length) pieces.push('\\N');
    else if (pieces.length) pieces.push(' ');

    const text = config.uppercase ? word.text.toLocaleUpperCase() : word.text;
    const isEmphasis = context.emphasis.has(normalise(word.text));

    if (index === activeIndex) {
      pieces.push(`${activeWordTags(context, isEmphasis)}${text}{\\r}`);
    } else {
      const tags = inactiveWordTags(context, isEmphasis);
      pieces.push(tags ? `${tags}${text}{\\r}` : text);
    }
  });

  return pieces.join('');
}

/** Per-cue entry animation, applied once at the start of the cue rather than per word. */
function cueEntryTags(config: SubtitleConfig, isFirstEventOfCue: boolean, x: number, y: number): string {
  if (!isFirstEventOfCue) return `\\pos(${x},${y})`;
  switch (config.animation) {
    case 'slideUp':
      return `\\move(${x},${Math.round(y + 46)},${x},${y},0,160)\\fad(90,0)`;
    case 'fade':
      return `\\pos(${x},${y})\\fad(140,120)`;
    case 'pop':
    case 'bounce':
      return `\\pos(${x},${y})\\fad(70,0)`;
    default:
      return `\\pos(${x},${y})`;
  }
}

export type AssOptions = {
  words: Word[];
  config: SubtitleConfig;
  width: number;
  height: number;
};

/**
 * Renders the caption track as an ASS file.
 *
 * Word-level highlighting is done by emitting one Dialogue event per spoken
 * word, each containing the whole cue with a different word marked up. That is
 * how the "one word lights up at a time" look is achieved in libass without
 * relying on `\k` karaoke timing, which cannot change scale or colour per word.
 */
export function buildAss(options: AssOptions): string {
  const { config, width, height } = options;
  const preset = SUBTITLE_STYLES[config.styleId] ?? SUBTITLE_STYLES.clean;

  const fontSize = Math.max(12, Math.round((height * config.fontSizePct) / 100));
  const marginFraction = 0.07;
  const marginH = Math.round(width * marginFraction);

  // Never trust the preset's character limit over what the frame can hold.
  const layout: SubtitleConfig = {
    ...config,
    maxCharsPerLine: Math.min(
      config.maxCharsPerLine,
      fittingCharsPerLine(width, fontSize, config.uppercase, marginFraction)
    ),
  };
  const x = Math.round(width / 2);
  const y = Math.round((height * clamp(config.positionPct, 4, 96)) / 100);

  const borderStyle = preset.borderStyle ?? 1;
  const outline = borderStyle === 3
    ? Math.max(2, Math.round(fontSize * 0.16))
    : config.outlineWidth;
  const backColour = borderStyle === 3
    ? hexToAssColor(config.outlineColor, config.bgOpacity)
    : hexToAssColor('#000000', 0.6);

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'Title: SAR Editor captions',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, ' +
      'Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, ' +
      'Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    [
      'Style: Main',
      config.fontFamily,
      String(fontSize),
      hexToAssColor(config.primaryColor),
      hexToAssColor(config.highlightColor),
      hexToAssColor(config.outlineColor),
      backColour,
      config.styleId === 'cinema' ? '0' : '-1',
      '0',
      '0',
      '0',
      '100',
      '100',
      config.styleId === 'cinema' ? '1' : '0',
      '0',
      String(borderStyle),
      String(outline),
      String(config.shadowDepth),
      '5',
      String(marginH),
      String(marginH),
      '0',
      '1',
    ].join(','),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const context: RenderContext = {
    config: layout,
    emphasis: new Set(config.emphasisWords.map(normalise).filter(Boolean)),
    highlight: hexToAssColor(config.highlightColor),
    emphasisColor: hexToAssColor(config.emphasisColor),
  };

  const cues = groupWordsIntoCues(options.words, layout);
  const events: string[] = [];
  const defaultTags = preset.defaultTags ?? '';

  for (const cue of cues) {
    if (layout.animation === 'typewriter') {
      cue.words.forEach((word, index) => {
        const start = word.startMs;
        const end = index === cue.words.length - 1 ? cue.endMs : cue.words[index + 1].startMs;
        if (end <= start) return;
        const tags = `{\\an5${cueEntryTags(layout, index === 0, x, y)}${defaultTags}}`;
        events.push(dialogue(start, end, `${tags}${renderCueText(cue, -1, context, index)}`));
      });
      continue;
    }

    if (!layout.karaoke) {
      const tags = `{\\an5${cueEntryTags(layout, true, x, y)}${defaultTags}}`;
      events.push(dialogue(cue.startMs, cue.endMs, `${tags}${renderCueText(cue, -1, context)}`));
      continue;
    }

    cue.words.forEach((word, index) => {
      const start = index === 0 ? cue.startMs : word.startMs;
      const isLast = index === cue.words.length - 1;
      const end = isLast ? cue.endMs : cue.words[index + 1].startMs;
      if (end <= start) return;
      const tags = `{\\an5${cueEntryTags(layout, index === 0, x, y)}${defaultTags}}`;
      events.push(dialogue(start, end, `${tags}${renderCueText(cue, index, context)}`));
    });
  }

  return `${[...header, ...events].join('\n')}\n`;
}

function dialogue(startMs: number, endMs: number, text: string): string {
  return `Dialogue: 0,${assTime(startMs)},${assTime(endMs)},Main,,0,0,0,,${text}`;
}

/** Plain SRT export, for uploading captions separately to YouTube. */
export function buildSrt(words: Word[], config: SubtitleConfig): string {
  const cues = groupWordsIntoCues(words, config);
  return cues
    .map((cue, index) => {
      const text = cue.words
        .map((w) => (config.uppercase ? w.text.toLocaleUpperCase() : w.text))
        .join(' ');
      return `${index + 1}\n${srtTime(cue.startMs)} --> ${srtTime(cue.endMs)}\n${text}\n`;
    })
    .join('\n');
}

function srtTime(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const millis = safe % 1000;
  const totalSeconds = Math.floor(safe / 1000);
  const pad = (n: number, size = 2) => String(n).padStart(size, '0');
  return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor((totalSeconds % 3600) / 60))}:${pad(
    totalSeconds % 60
  )},${pad(millis, 3)}`;
}
