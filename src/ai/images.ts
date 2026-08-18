import { File } from 'expo-file-system';

import type { AspectId } from '../types/project';
import { uid } from '../utils/id';
import { mediaDir, toNativePath } from '../utils/paths';
import { AiConfigError, AiRequestError, LLM_PROVIDERS, type LlmConfig } from './types';

export type ImageConfig = LlmConfig & {
  /** Generation methods reported by the catalogue, used to pick the endpoint. */
  methods?: string[];
};

/** Imagen accepts a fixed set of ratios; map the export aspect onto the nearest. */
function aspectFor(aspect: AspectId): string {
  switch (aspect) {
    case '9:16':
      return '9:16';
    case '16:9':
      return '16:9';
    case '4:5':
      return '3:4';
    case '1:1':
    default:
      return '1:1';
  }
}

/**
 * Generates one illustration and writes it into app storage.
 *
 * Two request shapes exist across the image families: the multimodal
 * `generateContent` path that returns inline image parts, and the `predict`
 * path used by the dedicated image models. Which one applies is read from the
 * catalogue rather than assumed, and if the first produces no picture the other
 * is tried before giving up.
 */
export async function generateImage(
  config: ImageConfig,
  prompt: string,
  aspect: AspectId,
  signal?: AbortSignal
): Promise<string> {
  if (!config.apiKey) throw new AiConfigError('Rasm yaratish uchun API kalit kerak.');
  if (!config.model) throw new AiConfigError('Rasm modeli tanlanmagan.');
  if (config.provider !== 'gemini') {
    throw new AiConfigError('Rasm yaratish hozircha faqat Gemini orqali ishlaydi.');
  }

  const baseUrl = (config.baseUrl || LLM_PROVIDERS.gemini.defaultBaseUrl).replace(/\/$/, '');
  const methods = config.methods ?? [];
  const order = methods.includes('predict') && !methods.includes('generateContent')
    ? (['predict', 'generateContent'] as const)
    : (['generateContent', 'predict'] as const);

  const failures: string[] = [];
  for (const method of order) {
    if (methods.length && !methods.includes(method)) continue;
    try {
      const base64 = method === 'predict'
        ? await viaPredict(baseUrl, config, prompt, aspect, signal)
        : await viaGenerateContent(baseUrl, config, prompt, aspect, signal);
      if (base64) return writeImage(base64);
      failures.push(`${method}: rasm qaytmadi`);
    } catch (error) {
      failures.push(`${method}: ${(error as Error).message}`);
    }
  }

  throw new AiRequestError(
    `Rasm yaratilmadi. ${failures.join(' · ')} — boshqa rasm modelini tanlab ko‘ring.`
  );
}

async function viaGenerateContent(
  baseUrl: string,
  config: ImageConfig,
  prompt: string,
  aspect: AspectId,
  signal?: AbortSignal
): Promise<string | null> {
  const response = await fetch(
    `${baseUrl}/v1beta/models/${encodeURIComponent(config.model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: illustrationPrompt(prompt, aspect) }] }],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
      signal,
    }
  );

  const payload = await readJson(response);
  if (!response.ok) throw new AiRequestError(errorMessage(payload, response.status), response.status);

  const parts = payload?.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const data = part?.inlineData?.data ?? part?.inline_data?.data;
    if (data) return String(data);
  }
  return null;
}

async function viaPredict(
  baseUrl: string,
  config: ImageConfig,
  prompt: string,
  aspect: AspectId,
  signal?: AbortSignal
): Promise<string | null> {
  const response = await fetch(
    `${baseUrl}/v1beta/models/${encodeURIComponent(config.model)}:predict`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
      body: JSON.stringify({
        instances: [{ prompt: illustrationPrompt(prompt, aspect) }],
        parameters: { sampleCount: 1, aspectRatio: aspectFor(aspect) },
      }),
      signal,
    }
  );

  const payload = await readJson(response);
  if (!response.ok) throw new AiRequestError(errorMessage(payload, response.status), response.status);

  const prediction = payload?.predictions?.[0];
  const data = prediction?.bytesBase64Encoded ?? prediction?.image?.imageBytes;
  return data ? String(data) : null;
}

/**
 * Keeps generated art consistent and, above all, free of text: burned-in
 * lettering fights the captions and is usually misspelled anyway.
 */
function illustrationPrompt(prompt: string, aspect: AspectId): string {
  return [
    prompt.trim(),
    '',
    `Framing: ${aspectFor(aspect)} aspect ratio, clean composition with the subject centred.`,
    'Style: sharp, well lit, high detail, cinematic colour.',
    'Absolutely no text, letters, numbers, captions, logos or watermarks anywhere in the image.',
  ].join('\n');
}

function writeImage(base64: string): string {
  const file = new File(mediaDir(), `overlay_${uid()}.png`);
  if (file.exists) file.delete();
  file.create({ overwrite: true });
  file.write(decodeBase64(base64));
  return toNativePath(file.uri);
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * React Native has no Buffer and its `atob` mangles binary, so the image bytes
 * are decoded directly into a Uint8Array.
 */
function decodeBase64(input: string): Uint8Array {
  const clean = input.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));

  let byteIndex = 0;
  let accumulator = 0;
  let bits = 0;

  for (const character of clean) {
    const value = BASE64_ALPHABET.indexOf(character);
    if (value === -1) continue;
    accumulator = (accumulator << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[byteIndex++] = (accumulator >> bits) & 0xff;
    }
  }

  return bytes.subarray(0, byteIndex);
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
  if (status === 401 || status === 403) return 'API kalit noto‘g‘ri yoki bu modelga ruxsat yo‘q.';
  if (status === 429) return 'So‘rovlar limiti tugadi.';
  const message = payload?.error?.message;
  return message ? `(${status}) ${message}` : `(${status})`;
}
