import { AiConfigError, AiRequestError, LLM_PROVIDERS, STT_PROVIDERS, type LlmConfig, type SttConfig } from './types';

export type ModelOption = {
  id: string;
  label: string;
  hint?: string;
};

/**
 * Model discovery.
 *
 * Nothing here contains a model name. Providers ship new models continuously,
 * so any list written into the app is wrong within weeks — instead each
 * provider's own catalogue endpoint is read with the user's key, and whatever
 * it returns is what the picker shows.
 */
export async function listLlmModels(config: LlmConfig, signal?: AbortSignal): Promise<ModelOption[]> {
  if (!config.apiKey) throw new AiConfigError('Avval API kalitni kiriting.');
  const baseUrl = (config.baseUrl || LLM_PROVIDERS[config.provider].defaultBaseUrl).replace(/\/$/, '');

  switch (config.provider) {
    case 'gemini':
      return listGeminiModels(baseUrl, config.apiKey, signal);
    case 'anthropic':
      return listAnthropicModels(baseUrl, config.apiKey, signal);
    default:
      return listOpenAiModels(baseUrl, config.apiKey, signal, 'chat');
  }
}

export async function listSttModels(config: SttConfig, signal?: AbortSignal): Promise<ModelOption[]> {
  if (!config.apiKey) throw new AiConfigError('Avval API kalitni kiriting.');
  const baseUrl = (config.baseUrl || STT_PROVIDERS[config.provider].defaultBaseUrl).replace(/\/$/, '');
  if (!baseUrl) throw new AiConfigError('Server manzilini kiriting.');

  if (config.provider === 'gemini') {
    return listGeminiModels(baseUrl, config.apiKey, signal);
  }
  return listOpenAiModels(baseUrl, config.apiKey, signal, 'audio');
}

async function listGeminiModels(baseUrl: string, apiKey: string, signal?: AbortSignal): Promise<ModelOption[]> {
  const models: ModelOption[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${baseUrl}/v1beta/models`);
    url.searchParams.set('pageSize', '200');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const response = await fetch(url.toString(), {
      headers: { 'x-goog-api-key': apiKey },
      signal,
    });
    const payload = await readJson(response);
    if (!response.ok) throw new AiRequestError(errorMessage(payload, response.status), response.status);

    for (const model of payload?.models ?? []) {
      // Only models that can actually answer a prompt; the catalogue also
      // carries embedding and tuning-only entries.
      if (!(model.supportedGenerationMethods ?? []).includes('generateContent')) continue;
      const id = String(model.name ?? '').replace(/^models\//, '');
      if (!id) continue;
      models.push({
        id,
        label: model.displayName || id,
        hint: model.inputTokenLimit ? `${formatTokens(model.inputTokenLimit)} kontekst` : undefined,
      });
    }
    pageToken = payload?.nextPageToken;
  } while (pageToken);

  return sortNewestFirst(models);
}

async function listAnthropicModels(baseUrl: string, apiKey: string, signal?: AbortSignal): Promise<ModelOption[]> {
  const models: ModelOption[] = [];
  let afterId: string | undefined;

  do {
    const url = new URL(`${baseUrl}/v1/models`);
    url.searchParams.set('limit', '100');
    if (afterId) url.searchParams.set('after_id', afterId);

    const response = await fetch(url.toString(), {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      signal,
    });
    const payload = await readJson(response);
    if (!response.ok) throw new AiRequestError(errorMessage(payload, response.status), response.status);

    for (const model of payload?.data ?? []) {
      if (!model?.id) continue;
      models.push({ id: String(model.id), label: model.display_name || String(model.id) });
    }
    afterId = payload?.has_more ? payload?.last_id : undefined;
  } while (afterId);

  // The API already returns newest first.
  return models;
}

type OpenAiKind = 'chat' | 'audio';

async function listOpenAiModels(
  baseUrl: string,
  apiKey: string,
  signal: AbortSignal | undefined,
  kind: OpenAiKind
): Promise<ModelOption[]> {
  const response = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });
  const payload = await readJson(response);
  if (!response.ok) throw new AiRequestError(errorMessage(payload, response.status), response.status);

  const all: (ModelOption & { created?: number })[] = (payload?.data ?? [])
    .filter((model: any) => model?.id)
    .map((model: any) => ({
      id: String(model.id),
      label: String(model.id),
      created: typeof model.created === 'number' ? model.created : undefined,
    }));

  const filtered = kind === 'audio' ? all.filter(isTranscriptionModel) : all.filter(isChatModel);
  // A gateway with unusual naming would otherwise show an empty picker; better
  // to show everything than to hide the model the user came for.
  const chosen = filtered.length ? filtered : all;

  const hasTimestamps = chosen.every((model) => model.created !== undefined);
  if (hasTimestamps) {
    chosen.sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
    return chosen.map(({ id, label }) => ({ id, label }));
  }
  return sortNewestFirst(chosen.map(({ id, label }) => ({ id, label })));
}

function isTranscriptionModel(model: { id: string }): boolean {
  return /whisper|transcri|speech-to-text|\bstt\b/i.test(model.id);
}

function isChatModel(model: { id: string }): boolean {
  return !/embed|whisper|transcri|tts|speech|moderation|dall-e|image|rerank|vision-encoder/i.test(model.id);
}

/**
 * Orders by the version numbers inside the name so newer releases surface
 * first, without the app knowing what any particular model is called.
 */
function sortNewestFirst(models: ModelOption[]): ModelOption[] {
  return [...models].sort((a, b) => compareNatural(b.id, a.id));
}

function compareNatural(a: string, b: string): number {
  const chunks = (value: string) => value.toLowerCase().match(/(\d+|\D+)/g) ?? [];
  const left = chunks(a);
  const right = chunks(b);

  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const x = left[i];
    const y = right[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = Number(x);
    const ny = Number(y);
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) {
      if (nx !== ny) return nx - ny;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${Math.round(count / 100_000) / 10}M`;
  if (count >= 1000) return `${Math.round(count / 1000)}K`;
  return String(count);
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
  if (status === 401 || status === 403) return 'API kalit noto‘g‘ri yoki ruxsat yo‘q.';
  if (status === 429) return 'So‘rovlar limiti tugadi.';
  const message = payload?.error?.message ?? payload?.message;
  return message ? `Modellarni olishda xato (${status}): ${message}` : `Modellarni olishda xato (${status})`;
}
