import { AiConfigError, AiRequestError, LLM_PROVIDERS, type LlmConfig } from '../types';

/** Pinned per Anthropic's versioning policy; the API requires it on every call. */
const ANTHROPIC_VERSION = '2023-06-01';

export type LlmRequest = {
  system: string;
  user: string;
  maxTokens?: number;
  /** Non-zero only for creative copy; planning runs deterministic. */
  temperature?: number;
  signal?: AbortSignal;
};

/**
 * One text-in / text-out call, dispatched to whichever provider the user
 * configured. Keys stay on the device and go straight to the provider — nothing
 * is proxied through a server of ours.
 */
export async function completeText(config: LlmConfig, request: LlmRequest): Promise<string> {
  if (!config.apiKey) {
    throw new AiConfigError('AI kaliti kiritilmagan. Sozlamalar bo‘limiga kalitni qo‘shing.');
  }
  if (!config.model) {
    throw new AiConfigError('AI modeli tanlanmagan.');
  }

  switch (config.provider) {
    case 'anthropic':
      return completeAnthropic(config, request);
    case 'gemini':
      return completeGemini(config, request);
    case 'openai':
    case 'openai_compatible':
    default:
      return completeOpenAiCompatible(config, request);
  }
}

/**
 * Anthropic Messages API over plain fetch.
 *
 * The official SDK is the usual choice, but it cannot be bundled here: it does
 * `await import('node:fs')` to read credential profiles from disk, which Metro
 * refuses to resolve for a React Native target. Every other provider in this
 * file already goes through fetch, the app only ever needs one non-streaming
 * call, and the key comes from the user rather than a profile on disk — so the
 * SDK's value here was close to zero and its cost was a bundle that would not
 * build.
 */
async function completeAnthropic(config: LlmConfig, request: LlmRequest): Promise<string> {
  const baseUrl = (config.baseUrl || LLM_PROVIDERS.anthropic.defaultBaseUrl).replace(/\/$/, '');

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      // The key belongs to the person holding the phone; there is no server to
      // proxy through, which is exactly what this header acknowledges.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: request.maxTokens ?? 8000,
      system: request.system,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      messages: [{ role: 'user', content: request.user }],
    }),
    signal: request.signal,
  });

  const payload = await readJson(response);
  if (!response.ok) {
    throw new AiRequestError(anthropicErrorMessage(payload, response.status), response.status);
  }

  if (payload?.stop_reason === 'refusal') {
    throw new AiRequestError(
      `Model so‘rovni bajarmadi: ${payload?.stop_details?.explanation ?? 'sabab ko‘rsatilmadi'}`
    );
  }

  // Thinking blocks come back alongside the answer; only the text is wanted.
  const text = (payload?.content ?? [])
    .filter((block: { type?: string }) => block?.type === 'text')
    .map((block: { text?: string }) => block.text ?? '')
    .join('\n')
    .trim();

  if (!text) throw new AiRequestError('Anthropic bo‘sh javob qaytardi');
  return text;
}

function anthropicErrorMessage(payload: any, status: number): string {
  if (status === 401 || status === 403) return 'Anthropic kaliti noto‘g‘ri.';
  if (status === 429) return 'Limit tugadi, birozdan keyin urinib ko‘ring.';
  const message = payload?.error?.message;
  if (status === 400 && message) return `So‘rov noto‘g‘ri: ${message}`;
  return message ? `Anthropic xatosi (${status}): ${message}` : `Anthropic xatosi (${status})`;
}

async function completeOpenAiCompatible(config: LlmConfig, request: LlmRequest): Promise<string> {
  const baseUrl = (config.baseUrl || LLM_PROVIDERS[config.provider].defaultBaseUrl).replace(/\/$/, '');
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: request.maxTokens ?? 8000,
      temperature: request.temperature ?? 0.4,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
    }),
    signal: request.signal,
  });

  const payload = await readJson(response);
  if (!response.ok) {
    throw new AiRequestError(providerErrorMessage(payload, response.status), response.status);
  }
  const text = payload?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new AiRequestError('Modeldan bo‘sh javob keldi');
  return text.trim();
}

async function completeGemini(config: LlmConfig, request: LlmRequest): Promise<string> {
  const baseUrl = (config.baseUrl || LLM_PROVIDERS.gemini.defaultBaseUrl).replace(/\/$/, '');
  const url = `${baseUrl}/v1beta/models/${encodeURIComponent(config.model)}:generateContent`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': config.apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: request.system }] },
      contents: [{ role: 'user', parts: [{ text: request.user }] }],
      generationConfig: {
        temperature: request.temperature ?? 0.4,
        maxOutputTokens: request.maxTokens ?? 8000,
        responseMimeType: 'application/json',
      },
    }),
    signal: request.signal,
  });

  const payload = await readJson(response);
  if (!response.ok) {
    throw new AiRequestError(providerErrorMessage(payload, response.status), response.status);
  }
  const parts = payload?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((part: { text?: string }) => part.text ?? '').join('').trim();
  if (!text) throw new AiRequestError('Gemini bo‘sh javob qaytardi');
  return text;
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

function providerErrorMessage(payload: any, status: number): string {
  const message = payload?.error?.message ?? payload?.message;
  if (status === 401 || status === 403) return 'API kalit noto‘g‘ri yoki ruxsat yo‘q.';
  if (status === 429) return 'So‘rovlar limiti tugadi. Birozdan keyin urinib ko‘ring.';
  return message ? `AI xatosi (${status}): ${message}` : `AI xatosi (${status})`;
}
