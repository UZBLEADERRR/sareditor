import type { GradeId, SubtitleStyleId } from '../types/project';

export type LlmProviderId = 'gemini' | 'anthropic' | 'openai' | 'openai_compatible';
export type SttProviderId = 'gemini' | 'openai' | 'groq' | 'openai_compatible';

export type LlmConfig = {
  provider: LlmProviderId;
  apiKey: string;
  /** Only needed for self-hosted gateways and OpenAI-compatible proxies. */
  baseUrl?: string;
  model: string;
};

export type SttConfig = {
  provider: SttProviderId;
  apiKey: string;
  baseUrl?: string;
  model: string;
  /** ISO-639-1 hint; leave empty to let the model detect it. */
  language?: string;
};

/**
 * Model lists are never hardcoded — providers ship new models constantly and a
 * baked-in list is stale the day it is written. Every provider here exposes a
 * models endpoint, and src/ai/models.ts reads it with the user's own key.
 */
export type LlmProviderInfo = {
  id: LlmProviderId;
  label: string;
  hint: string;
  defaultBaseUrl: string;
  keyPlaceholder: string;
  /** Where to get a key, shown when the field is empty. */
  keyUrl: string;
};

export type SttProviderInfo = {
  id: SttProviderId;
  label: string;
  hint: string;
  defaultBaseUrl: string;
  /** Whether the provider transcribes through its own multimodal model. */
  multimodal: boolean;
};

export const LLM_PROVIDERS: Record<LlmProviderId, LlmProviderInfo> = {
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    hint: 'Bitta kalit bilan ham matn, ham nutq ishlaydi',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    keyPlaceholder: 'AIza...',
    keyUrl: 'aistudio.google.com/apikey',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    hint: 'Matn va montaj rejasi uchun',
    defaultBaseUrl: 'https://api.anthropic.com',
    keyPlaceholder: 'sk-ant-...',
    keyUrl: 'console.anthropic.com',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    hint: 'GPT modellari',
    defaultBaseUrl: 'https://api.openai.com/v1',
    keyPlaceholder: 'sk-...',
    keyUrl: 'platform.openai.com/api-keys',
  },
  openai_compatible: {
    id: 'openai_compatible',
    label: 'Boshqa (OpenAI-mos)',
    hint: 'OpenRouter, Groq, Together, o‘z serveringiz',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    keyPlaceholder: 'API kalit',
    keyUrl: '',
  },
};

export const STT_PROVIDERS: Record<SttProviderId, SttProviderInfo> = {
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    hint: 'Audio to‘g‘ridan-to‘g‘ri modelga beriladi — alohida kalit kerak emas',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    multimodal: true,
  },
  openai: {
    id: 'openai',
    label: 'OpenAI Whisper',
    hint: 'Nutqqa ixtisoslashgan, so‘z vaqtlari juda aniq',
    defaultBaseUrl: 'https://api.openai.com/v1',
    multimodal: false,
  },
  groq: {
    id: 'groq',
    label: 'Groq Whisper',
    hint: 'Eng tez va arzon Whisper',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    multimodal: false,
  },
  openai_compatible: {
    id: 'openai_compatible',
    label: 'Boshqa (OpenAI-mos)',
    hint: '/audio/transcriptions endpointiga ega har qanday server',
    defaultBaseUrl: '',
    multimodal: false,
  },
};

/** What the AI director is asked to decide about a clip. */
export type DirectorInput = {
  durationMs: number;
  platform: string;
  targetDurationMs: number;
  language: string;
  transcript: { startMs: number; endMs: number; text: string }[];
  silences: { startMs: number; endMs: number }[];
  hasMusic: boolean;
  bpm?: number;
  extraInstructions?: string;
};

export type DirectorOutput = {
  hook: string;
  title: string;
  description: string;
  hashtags: string[];
  keepRanges: { startMs: number; endMs: number; score: number; reason: string }[];
  emphasisWords: string[];
  suggestedGrade: GradeId;
  suggestedSubtitleStyle: SubtitleStyleId;
  musicMood: string;
  notes: string;
};

export class AiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiConfigError';
  }
}

export class AiRequestError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'AiRequestError';
    this.status = status;
  }
}
