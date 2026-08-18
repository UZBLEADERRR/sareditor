import Anthropic, {
  APIError,
  AuthenticationError,
  BadRequestError,
  RateLimitError,
} from '@anthropic-ai/sdk';

import { AiConfigError, AiRequestError, LLM_PROVIDERS, type LlmConfig } from '../types';

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

async function completeAnthropic(config: LlmConfig, request: LlmRequest): Promise<string> {
  const client = new Anthropic({
    apiKey: config.apiKey,
    baseURL: config.baseUrl || LLM_PROVIDERS.anthropic.defaultBaseUrl,
    // The key belongs to the person holding the phone; there is no server to
    // hide it behind, and the SDK refuses to run in a non-Node runtime without
    // this acknowledgement.
    dangerouslyAllowBrowser: true,
  });

  try {
    const response = await client.messages.create(
      {
        model: config.model,
        max_tokens: request.maxTokens ?? 8000,
        system: request.system,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        messages: [{ role: 'user', content: request.user }],
      },
      { signal: request.signal }
    );

    if (response.stop_reason === 'refusal') {
      throw new AiRequestError(
        `Model so‘rovni bajarmadi: ${response.stop_details?.explanation ?? 'sabab ko‘rsatilmadi'}`
      );
    }

    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();
  } catch (error) {
    if (error instanceof AiRequestError) throw error;
    if (error instanceof APIError) {
      throw new AiRequestError(anthropicMessage(error), error.status);
    }
    throw error;
  }
}

function anthropicMessage(error: APIError): string {
  if (error instanceof AuthenticationError) return 'Anthropic kaliti noto‘g‘ri.';
  if (error instanceof RateLimitError) return 'Limit tugadi, birozdan keyin urinib ko‘ring.';
  if (error instanceof BadRequestError) return `So‘rov noto‘g‘ri: ${error.message}`;
  return `Anthropic xatosi (${error.status}): ${error.message}`;
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
