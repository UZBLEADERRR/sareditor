import { File } from 'expo-file-system';

import SarFFmpeg from '../../modules/ffmpeg';
import { probe } from '../ffmpeg/engine';
import { decodeBase64, pcmToWav, sampleRateFromMime } from '../utils/base64';
import { uid } from '../utils/id';
import { mediaDir, toNativePath } from '../utils/paths';
import { AiConfigError, AiRequestError } from './types';

export type VoiceProviderId = 'device' | 'gemini' | 'elevenlabs' | 'openai';

export type VoiceConfig = {
  provider: VoiceProviderId;
  apiKey: string;
  baseUrl?: string;
  /** Only the cloud providers use this. */
  model?: string;
  voiceId?: string;
  language?: string;
};

export type VoiceOption = {
  id: string;
  label: string;
  hint?: string;
};

export type VoiceProviderInfo = {
  id: VoiceProviderId;
  label: string;
  hint: string;
  defaultBaseUrl: string;
  /** Whether an API key is required at all. */
  needsKey: boolean;
};

export const VOICE_PROVIDERS: Record<VoiceProviderId, VoiceProviderInfo> = {
  device: {
    id: 'device',
    label: 'Telefon ovozi (bepul)',
    hint: 'Internetsiz ishlaydi, pul talab qilmaydi. Sifati qurilmaga bog‘liq.',
    defaultBaseUrl: '',
    needsKey: false,
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    hint: 'AI kaliti bilan bir xil kalit ishlaydi',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    needsKey: true,
  },
  elevenlabs: {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    hint: 'Eng tabiiy ovozlar, o‘z ovozingizni klonlash ham mumkin',
    defaultBaseUrl: 'https://api.elevenlabs.io',
    needsKey: true,
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    hint: 'Tez va arzon',
    defaultBaseUrl: 'https://api.openai.com/v1',
    needsKey: true,
  },
};

/**
 * Voices available from a provider.
 *
 * The device engine and ElevenLabs both publish a real catalogue. OpenAI's
 * voice names are documented rather than served, so nothing is invented here —
 * the picker simply falls back to a free-text field when a provider returns
 * nothing.
 */
export async function listVoices(config: VoiceConfig, signal?: AbortSignal): Promise<VoiceOption[]> {
  switch (config.provider) {
    case 'device': {
      const voices = await SarFFmpeg.listSpeechVoices();
      return voices
        .filter((voice) => !voice.networkRequired)
        .map((voice) => ({
          id: voice.id,
          label: `${voice.language} · ${voice.id.split('-').pop() ?? voice.id}`,
          hint: voice.quality >= 400 ? 'yuqori sifat' : undefined,
        }));
    }
    case 'elevenlabs': {
      const baseUrl = (config.baseUrl || VOICE_PROVIDERS.elevenlabs.defaultBaseUrl).replace(/\/$/, '');
      const response = await fetch(`${baseUrl}/v1/voices`, {
        headers: { 'xi-api-key': config.apiKey },
        signal,
      });
      const payload = await readJson(response);
      if (!response.ok) throw new AiRequestError(errorMessage(payload, response.status), response.status);
      return (payload?.voices ?? []).map((voice: any) => ({
        id: String(voice.voice_id),
        label: String(voice.name ?? voice.voice_id),
        hint: voice.labels?.accent ?? voice.category,
      }));
    }
    default:
      return [];
  }
}

export type SynthesisOutput = {
  uri: string;
  durationMs: number;
};

/**
 * Speaks a line into a file so the renderer can mix it.
 *
 * Playing it aloud would be useless here: the audio has to become a real file
 * that ffmpeg can delay and blend into the timeline.
 */
export async function synthesize(
  config: VoiceConfig,
  text: string,
  signal?: AbortSignal
): Promise<SynthesisOutput> {
  const trimmed = text.trim();
  if (!trimmed) throw new AiConfigError('Ovoz uchun matn bo‘sh.');
  if (VOICE_PROVIDERS[config.provider].needsKey && !config.apiKey) {
    throw new AiConfigError('Ovoz uchun API kalit kerak.');
  }

  const bytes = await renderSpeech(config, trimmed, signal);
  const info = await probe(bytes.uri);
  return { uri: bytes.uri, durationMs: info.durationMs || estimateDurationMs(trimmed) };
}

async function renderSpeech(
  config: VoiceConfig,
  text: string,
  signal?: AbortSignal
): Promise<{ uri: string }> {
  switch (config.provider) {
    case 'device': {
      const target = new File(mediaDir(), `voice_${uid()}.wav`);
      if (target.exists) target.delete();
      const result = await SarFFmpeg.synthesizeSpeech(
        text,
        config.voiceId ?? null,
        config.language ?? null,
        toNativePath(target.uri)
      );
      return { uri: result.path };
    }
    case 'elevenlabs':
      return elevenLabs(config, text, signal);
    case 'openai':
      return openAiSpeech(config, text, signal);
    case 'gemini':
    default:
      return geminiSpeech(config, text, signal);
  }
}

async function elevenLabs(config: VoiceConfig, text: string, signal?: AbortSignal): Promise<{ uri: string }> {
  if (!config.voiceId) throw new AiConfigError('ElevenLabs uchun ovozni tanlang.');
  const baseUrl = (config.baseUrl || VOICE_PROVIDERS.elevenlabs.defaultBaseUrl).replace(/\/$/, '');

  const response = await fetch(`${baseUrl}/v1/text-to-speech/${encodeURIComponent(config.voiceId)}`, {
    method: 'POST',
    headers: {
      'xi-api-key': config.apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: config.model || undefined,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
    signal,
  });

  if (!response.ok) {
    const payload = await readJson(response);
    throw new AiRequestError(errorMessage(payload, response.status), response.status);
  }
  return { uri: await writeAudio(await response.arrayBuffer(), 'mp3') };
}

async function openAiSpeech(config: VoiceConfig, text: string, signal?: AbortSignal): Promise<{ uri: string }> {
  const baseUrl = (config.baseUrl || VOICE_PROVIDERS.openai.defaultBaseUrl).replace(/\/$/, '');
  const response = await fetch(`${baseUrl}/audio/speech`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model || 'tts-1',
      voice: config.voiceId || 'alloy',
      input: text,
      response_format: 'mp3',
    }),
    signal,
  });

  if (!response.ok) {
    const payload = await readJson(response);
    throw new AiRequestError(errorMessage(payload, response.status), response.status);
  }
  return { uri: await writeAudio(await response.arrayBuffer(), 'mp3') };
}

/**
 * Gemini returns headerless PCM inside a normal content response, so the bytes
 * need a WAV header bolted on before anything will decode them.
 */
async function geminiSpeech(config: VoiceConfig, text: string, signal?: AbortSignal): Promise<{ uri: string }> {
  if (!config.model) throw new AiConfigError('Gemini ovoz modelini tanlang.');
  const baseUrl = (config.baseUrl || VOICE_PROVIDERS.gemini.defaultBaseUrl).replace(/\/$/, '');

  const response = await fetch(
    `${baseUrl}/v1beta/models/${encodeURIComponent(config.model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: config.voiceId
            ? { voiceConfig: { prebuiltVoiceConfig: { voiceName: config.voiceId } } }
            : undefined,
        },
      }),
      signal,
    }
  );

  const payload = await readJson(response);
  if (!response.ok) throw new AiRequestError(errorMessage(payload, response.status), response.status);

  const parts = payload?.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const inline = part?.inlineData ?? part?.inline_data;
    if (!inline?.data) continue;
    const pcm = decodeBase64(String(inline.data));
    const wav = pcmToWav(pcm, sampleRateFromMime(inline.mimeType ?? inline.mime_type));
    return { uri: await writeBytes(wav, 'wav') };
  }

  throw new AiRequestError('Model ovoz qaytarmadi. Boshqa ovoz modelini tanlang.');
}

async function writeAudio(buffer: ArrayBuffer, extension: string): Promise<string> {
  return writeBytes(new Uint8Array(buffer), extension);
}

async function writeBytes(bytes: Uint8Array, extension: string): Promise<string> {
  const file = new File(mediaDir(), `voice_${uid()}.${extension}`);
  if (file.exists) file.delete();
  file.create({ overwrite: true });
  file.write(bytes);
  return toNativePath(file.uri);
}

/** Rough fallback when a file carries no duration metadata: ~2.6 words a second. */
function estimateDurationMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(600, Math.round((words / 2.6) * 1000));
}

async function readJson(response: Response): Promise<any> {
  const raw = await response.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { error: { message: raw.slice(0, 300) } };
  }
}

function errorMessage(payload: any, status: number): string {
  if (status === 401 || status === 403) return 'Ovoz uchun API kalit noto‘g‘ri.';
  if (status === 429) return 'Ovoz so‘rovlari limiti tugadi.';
  const message = payload?.error?.message ?? payload?.detail?.message ?? payload?.message;
  return message ? `Ovoz xatosi (${status}): ${message}` : `Ovoz xatosi (${status})`;
}
