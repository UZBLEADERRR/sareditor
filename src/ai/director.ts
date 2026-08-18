import { GRADES } from '../ffmpeg/filters/grade';
import { SUBTITLE_STYLES } from '../presets/subtitleStyles';
import type { AiPlan, GradeId, OverlayStyle, SubtitleStyleId, TransitionId, Transcript, Word } from '../types/project';
import { formatTimecode } from '../utils/format';
import { extractJson } from './json';
import { completeText } from './providers/llm';
import { AiRequestError, type DirectorInput, type DirectorOutput, type LlmConfig } from './types';

const GRADE_IDS = Object.keys(GRADES) as GradeId[];
const STYLE_IDS = Object.keys(SUBTITLE_STYLES) as SubtitleStyleId[];
const TRANSITION_IDS: TransitionId[] = [
  'none', 'fade', 'dissolve', 'flash', 'slideup', 'slideleft', 'circleopen', 'pixelize', 'wipeleft',
];
const OVERLAY_STYLES: OverlayStyle[] = ['cutaway', 'fullscreen', 'corner'];
/** Enough to illustrate a short video without turning it into a slideshow. */
const MAX_IMAGE_IDEAS = 10;

const DIRECTOR_SYSTEM = `You are a short-form video editor who cuts Instagram Reels, TikToks and YouTube Shorts.

You are given a transcript with timings, the detected pauses, and a target length.
Decide what survives the cut and how the piece should look.

Rules:
- Open on the strongest moment. The first 2 seconds decide whether anyone watches.
- Cut dead air, filler, false starts and repeated takes.
- Never cut mid-sentence. Ranges must land on natural speech boundaries.
- Keep ranges in chronological order and non-overlapping.
- Stay within the target duration; going slightly under is better than over.
- Write the hook, title and description in the same language the speaker uses.
- Choose emphasis words that carry the meaning — numbers, outcomes, contrasts. Not filler.

Also pick the cut-to-cut transition. Most short-form video wants none — hard cuts keep the pace.
Choose a transition only when the piece changes subject or location.

Finally, propose illustrations. Whenever the speaker names something concrete the viewer cannot
see — an example, an object, a place, a comparison, a result — an image can appear on screen
while they say it. Rules for these:
- Only for things that are genuinely visual. Never for abstract talk.
- Anchor each one to the exact moment the phrase is spoken.
- 1.5 to 3 seconds each, and never overlapping.
- At most one every eight seconds; a wall of images is worse than none.
- Write the prompt as a standalone description of a photograph or illustration. No text in the
  image, no watermarks, no captions.
- style: "cutaway" for a card over the upper frame, "fullscreen" to replace the shot entirely,
  "corner" for a small aside.

Reply with JSON only. No prose, no code fences.`;

type RawPlan = Partial<DirectorOutput> & Record<string, unknown>;

/**
 * Asks the configured model to plan the edit.
 *
 * Everything it returns is treated as a suggestion and clamped against the real
 * clip: ranges are sorted, de-overlapped and bounded by the source duration, and
 * unknown grade or caption style names fall back to safe defaults. A confused
 * model should produce a mediocre edit, never a broken project.
 */
export async function planEdit(
  config: LlmConfig,
  input: DirectorInput,
  signal?: AbortSignal
): Promise<AiPlan> {
  const prompt = buildDirectorPrompt(input);
  const raw = await completeText(config, {
    system: DIRECTOR_SYSTEM,
    user: prompt,
    maxTokens: 8000,
    temperature: 0.3,
    signal,
  });

  let parsed: RawPlan;
  try {
    parsed = extractJson<RawPlan>(raw);
  } catch {
    throw new AiRequestError('AI javobi tushunarsiz formatda keldi. Qayta urinib ko‘ring.');
  }

  return {
    hook: str(parsed.hook),
    title: str(parsed.title),
    description: str(parsed.description),
    hashtags: strArray(parsed.hashtags).map((tag) => (tag.startsWith('#') ? tag : `#${tag}`)).slice(0, 15),
    keepRanges: sanitiseRanges(parsed.keepRanges, input.durationMs),
    emphasisWords: strArray(parsed.emphasisWords).slice(0, 40),
    suggestedGrade: pick(parsed.suggestedGrade, GRADE_IDS, 'teal_orange'),
    suggestedSubtitleStyle: pick(parsed.suggestedSubtitleStyle, STYLE_IDS, 'hormozi'),
    suggestedTransition: pick(parsed.suggestedTransition, TRANSITION_IDS, 'none'),
    imageIdeas: sanitiseImageIdeas(parsed.imageIdeas, input.durationMs),
    musicMood: str(parsed.musicMood),
    notes: str(parsed.notes),
    createdAt: Date.now(),
    model: `${config.provider}:${config.model}`,
  };
}

function buildDirectorPrompt(input: DirectorInput): string {
  const transcript = input.transcript
    .map((line) => `[${formatTimecode(line.startMs, true)} → ${formatTimecode(line.endMs, true)}] ${line.text}`)
    .join('\n');

  const silences = input.silences
    .slice(0, 60)
    .map((gap) => `${Math.round(gap.startMs)}-${Math.round(gap.endMs)}`)
    .join(', ');

  return [
    `Platform: ${input.platform}`,
    `Source duration: ${Math.round(input.durationMs)} ms`,
    `Target duration: ${Math.round(input.targetDurationMs)} ms`,
    `Spoken language: ${input.language || 'unknown'}`,
    input.hasMusic ? `Background music present${input.bpm ? `, ${input.bpm} BPM` : ''}` : 'No music yet',
    '',
    'Silence ranges (ms):',
    silences || '(none detected)',
    '',
    'Transcript:',
    transcript || '(no speech detected)',
    '',
    input.extraInstructions ? `Extra instructions from the creator: ${input.extraInstructions}` : '',
    '',
    'Return exactly this JSON shape:',
    JSON.stringify(
      {
        hook: 'first line of the video, spoken language',
        title: 'short title',
        description: 'caption for the post',
        hashtags: ['#example'],
        keepRanges: [{ startMs: 0, endMs: 4200, score: 0.9, reason: 'why this stays' }],
        emphasisWords: ['word'],
        suggestedGrade: GRADE_IDS.join('|'),
        suggestedSubtitleStyle: STYLE_IDS.join('|'),
        suggestedTransition: TRANSITION_IDS.join('|'),
        imageIdeas: [
          {
            startMs: 5200,
            endMs: 7400,
            phrase: 'the exact words being spoken',
            prompt: 'what the picture should show',
            style: OVERLAY_STYLES.join('|'),
          },
        ],
        musicMood: 'e.g. driving lo-fi, 90 BPM',
        notes: 'anything the creator should know',
      },
      null,
      2
    ),
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/** Ranges arrive unsorted and sometimes overlapping; the timeline cannot take either. */
function sanitiseRanges(value: unknown, durationMs: number): AiPlan['keepRanges'] {
  if (!Array.isArray(value)) return [];

  const cleaned = value
    .map((item: any) => ({
      startMs: Math.max(0, Math.round(Number(item?.startMs ?? item?.start ?? 0))),
      endMs: Math.min(durationMs, Math.round(Number(item?.endMs ?? item?.end ?? 0))),
      score: clamp01(Number(item?.score ?? 0.5)),
      reason: str(item?.reason),
    }))
    .filter((range) => Number.isFinite(range.startMs) && Number.isFinite(range.endMs))
    .filter((range) => range.endMs - range.startMs >= 250)
    .sort((a, b) => a.startMs - b.startMs);

  const merged: AiPlan['keepRanges'] = [];
  for (const range of cleaned) {
    const previous = merged[merged.length - 1];
    if (previous && range.startMs < previous.endMs) {
      previous.endMs = Math.max(previous.endMs, range.endMs);
      previous.score = Math.max(previous.score, range.score);
      continue;
    }
    merged.push(range);
  }
  return merged;
}

/**
 * Illustrations are clamped hard: a model that proposes twenty overlapping
 * images would bury the video, and one anchored past the end of the clip would
 * never appear at all.
 */
function sanitiseImageIdeas(value: unknown, durationMs: number): AiPlan['imageIdeas'] {
  if (!Array.isArray(value)) return [];

  const cleaned = value
    .map((item: any) => ({
      startMs: Math.max(0, Math.round(Number(item?.startMs ?? 0))),
      endMs: Math.round(Number(item?.endMs ?? 0)),
      phrase: str(item?.phrase),
      prompt: str(item?.prompt),
      style: pick(item?.style, OVERLAY_STYLES, 'cutaway'),
    }))
    .filter((idea) => idea.prompt && Number.isFinite(idea.startMs) && Number.isFinite(idea.endMs))
    .filter((idea) => idea.startMs < durationMs)
    .map((idea) => ({
      ...idea,
      endMs: Math.min(durationMs, Math.max(idea.endMs, idea.startMs + 1200)),
    }))
    .sort((a, b) => a.startMs - b.startMs);

  const kept: AiPlan['imageIdeas'] = [];
  for (const idea of cleaned) {
    const previous = kept[kept.length - 1];
    if (previous && idea.startMs < previous.endMs + 500) continue;
    kept.push(idea);
    if (kept.length >= MAX_IMAGE_IDEAS) break;
  }
  return kept;
}

const TRANSLATE_SYSTEM = `You translate video captions.
Return a JSON array of strings — one translated line per input line, same order, same count.
Keep each line about the same length as the original so it still fits on screen.
Do not add notes, numbering, or punctuation that was not there.`;

/**
 * Translates the caption track while keeping every word's timing.
 *
 * Lines are translated as a unit and then redistributed across the original
 * word slots proportionally to word length — the timings stay valid, which is
 * what matters for a caption that has to stay glued to the speech.
 */
export async function translateWords(
  config: LlmConfig,
  words: Word[],
  targetLanguage: string,
  signal?: AbortSignal
): Promise<Word[]> {
  const lines = groupForTranslation(words);
  if (!lines.length) return words;

  const raw = await completeText(config, {
    system: TRANSLATE_SYSTEM,
    user: `Target language: ${targetLanguage}\n\nLines:\n${JSON.stringify(lines.map((l) => l.text), null, 2)}`,
    maxTokens: 8000,
    temperature: 0.2,
    signal,
  });

  let translated: string[];
  try {
    const parsed = extractJson<unknown>(raw);
    translated = Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    throw new AiRequestError('Tarjima javobi noto‘g‘ri formatda keldi.');
  }

  if (translated.length !== lines.length) {
    throw new AiRequestError('Tarjima qatorlari soni mos kelmadi. Qayta urinib ko‘ring.');
  }

  const result: Word[] = [];
  lines.forEach((line, index) => {
    result.push(...redistribute(line.words, translated[index]));
  });
  return result;
}

function groupForTranslation(words: Word[]): { text: string; words: Word[] }[] {
  const groups: { text: string; words: Word[] }[] = [];
  let current: Word[] = [];

  const flush = () => {
    if (!current.length) return;
    groups.push({ text: current.map((w) => w.text).join(' '), words: current });
    current = [];
  };

  for (const word of words) {
    const gap = current.length ? word.startMs - current[current.length - 1].endMs : 0;
    if (current.length >= 12 || gap > 700) flush();
    current.push(word);
  }
  flush();
  return groups;
}

/** Spreads a translated line back over the original words' time span. */
function redistribute(originals: Word[], translatedLine: string): Word[] {
  const tokens = translatedLine.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length || !originals.length) return originals;

  const startMs = originals[0].startMs;
  const endMs = originals[originals.length - 1].endMs;
  const totalChars = tokens.reduce((n, token) => n + token.length, 0) || 1;

  let cursor = startMs;
  return tokens.map((token, index) => {
    const share = (token.length / totalChars) * (endMs - startMs);
    const wordStart = Math.round(cursor);
    cursor += share;
    return {
      text: token,
      startMs: wordStart,
      endMs: index === tokens.length - 1 ? endMs : Math.round(cursor),
    };
  });
}

const COPY_SYSTEM = `You write social copy for short-form video.
Reply with JSON only: { "title": string, "description": string, "hashtags": string[] }.
Write in the same language as the transcript. Keep the title under 60 characters.
Hashtags: 8-12, lowercase, no spaces, mixed broad and niche.`;

export async function generateCopy(
  config: LlmConfig,
  transcript: Transcript,
  platform: string,
  signal?: AbortSignal
): Promise<{ title: string; description: string; hashtags: string[] }> {
  const raw = await completeText(config, {
    system: COPY_SYSTEM,
    user: `Platform: ${platform}\n\nTranscript:\n${transcript.text.slice(0, 6000)}`,
    maxTokens: 2000,
    temperature: 0.7,
    signal,
  });

  const parsed = extractJson<Record<string, unknown>>(raw);
  return {
    title: str(parsed.title),
    description: str(parsed.description),
    hashtags: strArray(parsed.hashtags)
      .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
      .slice(0, 15),
  };
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

function pick<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  const candidate = String(value ?? '').trim() as T;
  return allowed.includes(candidate) ? candidate : fallback;
}
