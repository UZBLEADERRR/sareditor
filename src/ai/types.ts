import type { GradeId, SubtitleStyleId } from '../types/project';

export type LlmProviderId = 'anthropic' | 'openai' | 'gemini' | 'openai_compatible';
export type SttProviderId = 'openai' | 'groq' | 'openai_compatible';

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

export type LlmProviderInfo = {
  id: LlmProviderId;
  label: string;
  hint: string;
  defaultModel: string;
  defaultBaseUrl: string;
  keyPlaceholder: string;
  models: string[];
};

export type SttProviderInfo = {
  id: SttProviderId;
  label: string;
  hint: string;
  defaultModel: string;
  defaultBaseUrl: string;
  models: string[];
};

export const LLM_PROVIDERS: Record<LlmProviderId, LlmProviderInfo> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    hint: 'Montaj rejasi va matnlar uchun eng kuchli variant',
    defaultModel: 'claude-opus-5',
    defaultBaseUrl: 'https://api.anthropic.com',
    keyPlaceholder: 'sk-ant-...',
    models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    hint: 'GPT modellari',
    defaultModel: 'gpt-4o',
    defaultBaseUrl: 'https://api.openai.com/v1',
    keyPlaceholder: 'sk-...',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini'],
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    hint: 'Tez va arzon',
    defaultModel: 'gemini-2.0-flash',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    keyPlaceholder: 'AIza...',
    models: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'],
  },
  openai_compatible: {
    id: 'openai_compatible',
    label: 'Boshqa (OpenAI-mos)',
    hint: 'OpenRouter, Groq, Together, o‘z serveringiz — /chat/completions',
    defaultModel: '',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    keyPlaceholder: 'API kalit',
    models: [],
  },
};

export const STT_PROVIDERS: Record<SttProviderId, SttProviderInfo> = {
  openai: {
    id: 'openai',
    label: 'OpenAI Whisper',
    hint: 'So‘z-darajasidagi aniq vaqtlar',
    defaultModel: 'whisper-1',
    defaultBaseUrl: 'https://api.openai.com/v1',
    models: ['whisper-1'],
  },
  groq: {
    id: 'groq',
    label: 'Groq Whisper',
    hint: 'Eng tez va arzon transkripsiya',
    defaultModel: 'whisper-large-v3-turbo',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    models: ['whisper-large-v3-turbo', 'whisper-large-v3'],
  },
  openai_compatible: {
    id: 'openai_compatible',
    label: 'Boshqa (OpenAI-mos)',
    hint: '/audio/transcriptions endpointiga ega har qanday server',
    defaultModel: 'whisper-1',
    defaultBaseUrl: '',
    models: [],
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
