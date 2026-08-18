import { Directory, File } from 'expo-file-system';

import { run } from '../ffmpeg/engine';
import type { Transcript, TranscriptLine, Word } from '../types/project';
import { uid } from '../utils/id';
import { toFileUri, toNativePath, workDir } from '../utils/paths';
import { extractJson } from './json';
import { AiConfigError, AiRequestError, STT_PROVIDERS, type SttConfig } from './types';
import { throwIfAborted } from '../utils/abort';

/** Whisper-style endpoints cap uploads at 25 MB; 10 minutes of 64 kbps mono is ~4.8 MB. */
const WHISPER_CHUNK_MS = 10 * 60 * 1000;
/**
 * Gemini transcribes through the same model that answers prompts, so the clip
 * has to fit in one request *and* the per-word timings have to fit in the
 * response. Five minutes keeps both comfortable — roughly 750 words out.
 */
const GEMINI_CHUNK_MS = 5 * 60 * 1000;

export type TranscribeProgress = {
  stage: 'extract' | 'upload' | 'merge';
  /** 0..1 across the whole job. */
  progress: number;
  chunk?: number;
  chunkCount?: number;
};

export type TranscribeOptions = {
  durationMs: number;
  onProgress?: (progress: TranscribeProgress) => void;
  signal?: AbortSignal;
};

/**
 * Produces a word-timed transcript for the source clip.
 *
 * The video's audio is first re-encoded to a small mono MP3 — uploading the
 * original file would be tens of megabytes of video the model never looks at —
 * and split into chunks when the take is long. Word timings from each chunk are
 * shifted back onto the source timeline before merging.
 */
export async function transcribe(
  config: SttConfig,
  videoPathOrUri: string,
  options: TranscribeOptions
): Promise<Transcript> {
  if (!config.apiKey) {
    throw new AiConfigError('Transkripsiya uchun API kalit kerak. Sozlamalardan qo‘shing.');
  }

  const chunkMs = config.provider === 'gemini' ? GEMINI_CHUNK_MS : WHISPER_CHUNK_MS;
  const chunks = await extractAudioChunks(videoPathOrUri, options.durationMs, chunkMs, options.onProgress);

  try {
    const allWords: Word[] = [];
    const texts: string[] = [];
    let language = config.language ?? '';

    for (let index = 0; index < chunks.length; index += 1) {
      throwIfAborted(options.signal);
      options.onProgress?.({
        stage: 'upload',
        progress: 0.25 + (0.7 * index) / chunks.length,
        chunk: index + 1,
        chunkCount: chunks.length,
      });

      const result = await uploadChunk(config, chunks[index].file, options.signal);
      const offset = chunks[index].offsetMs;

      if (result.language && !config.language) language = result.language;
      if (result.text) texts.push(result.text.trim());
      for (const word of result.words) {
        allWords.push({
          text: word.text,
          startMs: word.startMs + offset,
          endMs: word.endMs + offset,
          confidence: word.confidence,
        });
      }
    }

    options.onProgress?.({ stage: 'merge', progress: 0.97 });
    allWords.sort((a, b) => a.startMs - b.startMs);

    return {
      language: language || 'auto',
      text: texts.join(' ').trim(),
      words: allWords,
      lines: linesFromWords(allWords),
      createdAt: Date.now(),
      provider: `${config.provider}:${config.model}`,
    };
  } finally {
    for (const chunk of chunks) {
      try {
        if (chunk.file.exists) chunk.file.delete();
      } catch {
        // Cache file; the work directory gets swept anyway.
      }
    }
  }
}

type AudioChunk = { file: File; offsetMs: number };

/** Extracts speech-only audio, split into upload-sized pieces. */
async function extractAudioChunks(
  videoPathOrUri: string,
  durationMs: number,
  chunkMs: number,
  onProgress?: (progress: TranscribeProgress) => void
): Promise<AudioChunk[]> {
  onProgress?.({ stage: 'extract', progress: 0.02 });

  const folder = new Directory(workDir(), `stt_${uid()}`);
  folder.create({ intermediates: true });
  const folderPath = toNativePath(folder.uri);

  const shared = [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-i', toNativePath(videoPathOrUri),
    '-vn',
    '-ac', '1',
    '-ar', '16000',
    '-c:a', 'libmp3lame',
    '-b:a', '64k',
  ];

  if (durationMs <= chunkMs) {
    const output = `${folderPath}/chunk_000.mp3`;
    await run([...shared, output], {
      totalMs: durationMs,
      onProgress: (event) => onProgress?.({ stage: 'extract', progress: 0.02 + event.progress * 0.2 }),
    });
    return [{ file: new File(toFileUri(output)), offsetMs: 0 }];
  }

  await run(
    [
      ...shared,
      '-f', 'segment',
      '-segment_time', String(chunkMs / 1000),
      '-reset_timestamps', '1',
      `${folderPath}/chunk_%03d.mp3`,
    ],
    {
      totalMs: durationMs,
      onProgress: (event) => onProgress?.({ stage: 'extract', progress: 0.02 + event.progress * 0.2 }),
    }
  );

  return folder
    .list()
    .filter((entry): entry is File => entry instanceof File && entry.uri.endsWith('.mp3'))
    .sort((a, b) => a.uri.localeCompare(b.uri))
    .map((file, index) => ({ file, offsetMs: index * chunkMs }));
}

type ChunkResult = {
  text: string;
  language?: string;
  words: Word[];
};

async function uploadChunk(config: SttConfig, file: File, signal?: AbortSignal): Promise<ChunkResult> {
  if (config.provider === 'gemini') return transcribeWithGemini(config, file, signal);

  const baseUrl = (config.baseUrl || STT_PROVIDERS[config.provider].defaultBaseUrl).replace(/\/$/, '');
  if (!baseUrl) throw new AiConfigError('Transkripsiya server manzili ko‘rsatilmagan.');

  const form = new FormData();
  // React Native's FormData takes a file descriptor object rather than a Blob.
  form.append('file', {
    uri: toFileUri(file.uri),
    name: 'audio.mp3',
    type: 'audio/mpeg',
  } as unknown as Blob);
  form.append('model', config.model);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  form.append('timestamp_granularities[]', 'segment');
  if (config.language) form.append('language', config.language);

  const response = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: form,
    signal,
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new AiRequestError(transcriptionError(raw, response.status), response.status);
  }

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new AiRequestError('Transkripsiya javobini o‘qib bo‘lmadi');
  }

  return {
    text: typeof payload.text === 'string' ? payload.text : '',
    language: typeof payload.language === 'string' ? payload.language : undefined,
    words: wordsFromPayload(payload),
  };
}

const GEMINI_PROMPT = `Transcribe every word spoken in this audio.

Rules:
- Times are milliseconds from the start of THIS audio clip, not from any larger recording.
- One entry per spoken word, in the order spoken.
- Transcribe in the language actually spoken. Do not translate.
- Keep numbers as they are said.
- If there is no speech at all, return an empty words array.`;

/** Gemini's schema dialect is an OpenAPI subset; keep it to the supported types. */
const GEMINI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    language: { type: 'STRING', description: 'ISO-639-1 code of the spoken language' },
    words: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING' },
          startMs: { type: 'INTEGER' },
          endMs: { type: 'INTEGER' },
        },
        required: ['text', 'startMs', 'endMs'],
        propertyOrdering: ['text', 'startMs', 'endMs'],
      },
    },
  },
  required: ['language', 'words'],
  propertyOrdering: ['language', 'words'],
};

/**
 * Transcribes a chunk with a Gemini model.
 *
 * Unlike Whisper, this is a general multimodal model being asked for word
 * timings, so the request pins a response schema and zero temperature. The
 * result still goes through the same normalisation as every other provider,
 * which drops entries with impossible timings rather than trusting the model.
 */
async function transcribeWithGemini(
  config: SttConfig,
  file: File,
  signal?: AbortSignal
): Promise<ChunkResult> {
  const baseUrl = (config.baseUrl || STT_PROVIDERS.gemini.defaultBaseUrl).replace(/\/$/, '');
  const audio = await file.base64();

  const instruction = config.language
    ? `${GEMINI_PROMPT}\n\nThe speaker is using this language: ${config.language}.`
    : GEMINI_PROMPT;

  const response = await fetch(
    `${baseUrl}/v1beta/models/${encodeURIComponent(config.model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { inline_data: { mime_type: 'audio/mpeg', data: audio } },
              { text: instruction },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: GEMINI_SCHEMA,
        },
      }),
      signal,
    }
  );

  const raw = await response.text();
  if (!response.ok) {
    throw new AiRequestError(transcriptionError(raw, response.status), response.status);
  }

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new AiRequestError('Transkripsiya javobini o‘qib bo‘lmadi');
  }

  const blocked = payload?.promptFeedback?.blockReason;
  if (blocked) throw new AiRequestError(`Model audioni rad etdi: ${blocked}`);

  const text = (payload?.candidates?.[0]?.content?.parts ?? [])
    .map((part: { text?: string }) => part.text ?? '')
    .join('');
  if (!text.trim()) return { text: '', words: [] };

  let parsed: any;
  try {
    parsed = extractJson<any>(text);
  } catch {
    throw new AiRequestError('Model vaqtlarni JSON ko‘rinishida qaytarmadi.');
  }

  const words = normaliseWords(parsed?.words);
  return {
    text: words.map((word) => word.text).join(' '),
    language: typeof parsed?.language === 'string' ? parsed.language : undefined,
    words,
  };
}

/** Shared cleanup: drop entries the model got wrong rather than trusting them. */
function normaliseWords(value: unknown): Word[] {
  if (!Array.isArray(value)) return [];
  const words: Word[] = [];
  let previousEnd = 0;

  for (const entry of value) {
    const text = String(entry?.text ?? '').trim();
    if (!text) continue;
    const startMs = Math.max(0, Math.round(Number(entry?.startMs ?? 0)));
    let endMs = Math.round(Number(entry?.endMs ?? 0));
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    // A model occasionally emits a zero-length or reversed span; give it a
    // plausible duration instead of dropping the word out of the caption.
    if (endMs <= startMs) endMs = startMs + 220;
    if (startMs < previousEnd - 400) continue;
    words.push({ text, startMs, endMs });
    previousEnd = endMs;
  }
  return words;
}

function transcriptionError(raw: string, status: number): string {
  if (status === 401 || status === 403) return 'Transkripsiya kaliti noto‘g‘ri.';
  if (status === 413) return 'Audio fayl juda katta.';
  if (status === 429) return 'Limit tugadi, birozdan keyin urinib ko‘ring.';
  try {
    const parsed = JSON.parse(raw);
    const message = parsed?.error?.message ?? parsed?.message;
    if (message) return `Transkripsiya xatosi (${status}): ${message}`;
  } catch {
    // Non-JSON error body; fall through to the generic message.
  }
  return `Transkripsiya xatosi (${status})`;
}

/**
 * Prefers real word timings. When a provider only returns segments, the words
 * are spread across each segment proportionally to their length — noticeably
 * less precise, but still usable for captions rather than failing outright.
 */
function wordsFromPayload(payload: any): Word[] {
  if (Array.isArray(payload.words) && payload.words.length) {
    return payload.words
      .map((word: any) => ({
        text: String(word.word ?? word.text ?? '').trim(),
        startMs: Math.round(Number(word.start ?? 0) * 1000),
        endMs: Math.round(Number(word.end ?? 0) * 1000),
      }))
      .filter((word: Word) => word.text && word.endMs > word.startMs);
  }

  if (!Array.isArray(payload.segments)) return [];

  const words: Word[] = [];
  for (const segment of payload.segments) {
    const text = String(segment.text ?? '').trim();
    if (!text) continue;
    const startMs = Math.round(Number(segment.start ?? 0) * 1000);
    const endMs = Math.round(Number(segment.end ?? 0) * 1000);
    const tokens = text.split(/\s+/).filter(Boolean);
    const totalChars = tokens.reduce((n, token) => n + token.length, 0) || 1;

    let cursor = startMs;
    for (const token of tokens) {
      const share = (token.length / totalChars) * (endMs - startMs);
      words.push({ text: token, startMs: Math.round(cursor), endMs: Math.round(cursor + share) });
      cursor += share;
    }
  }
  return words;
}

/** Sentence-ish grouping, used for the transcript view and the director prompt. */
export function linesFromWords(words: Word[], maxGapMs = 700, maxChars = 90): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  let current: Word[] = [];

  const flush = () => {
    if (!current.length) return;
    lines.push({
      startMs: current[0].startMs,
      endMs: current[current.length - 1].endMs,
      text: current.map((w) => w.text).join(' '),
      words: current,
    });
    current = [];
  };

  for (const word of words) {
    const gap = current.length ? word.startMs - current[current.length - 1].endMs : 0;
    const chars = current.reduce((n, w) => n + w.text.length + 1, 0);
    if (current.length && (gap > maxGapMs || chars > maxChars || /[.!?]$/.test(current[current.length - 1].text))) {
      flush();
    }
    current.push(word);
  }
  flush();
  return lines;
}
