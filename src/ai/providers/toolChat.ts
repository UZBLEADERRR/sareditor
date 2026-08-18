import type { AgentToolSpec } from '../agentTools';
import { AiConfigError, AiRequestError, LLM_PROVIDERS, type LlmConfig } from '../types';

const ANTHROPIC_VERSION = '2023-06-01';

/** One request from the model to run a tool. */
export type ToolCall = {
  /** Provider-issued id, echoed back with the result. Gemini gets a synthetic one. */
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type ToolOutcome = {
  id: string;
  name: string;
  /** Serialised result — every dialect here carries tool output as text. */
  content: string;
};

export type ChatMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; calls: ToolCall[] }
  | { role: 'tool'; outcomes: ToolOutcome[] };

export type ToolTurn = {
  text: string;
  calls: ToolCall[];
};

export type ToolChatRequest = {
  system: string;
  messages: ChatMessage[];
  tools: AgentToolSpec[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
};

/**
 * One round of a tool-calling conversation.
 *
 * The three provider dialects disagree about almost everything — where the
 * system prompt goes, whether tool calls carry ids, how results are handed
 * back — so the whole conversation is kept in the neutral `ChatMessage` shape
 * above and translated at the edge. That way the agent loop never has to know
 * which provider the user configured, and switching providers mid-project does
 * not corrupt the history.
 */
export async function chatWithTools(config: LlmConfig, request: ToolChatRequest): Promise<ToolTurn> {
  if (!config.apiKey) {
    throw new AiConfigError('AI kaliti kiritilmagan. Sozlamalar bo‘limiga kalitni qo‘shing.');
  }
  if (!config.model) {
    throw new AiConfigError('AI modeli tanlanmagan.');
  }

  switch (config.provider) {
    case 'anthropic':
      return anthropicTurn(config, request);
    case 'gemini':
      return geminiTurn(config, request);
    case 'openai':
    case 'openai_compatible':
    default:
      return openAiTurn(config, request);
  }
}

/* ------------------------------------------------------------------ Anthropic */

async function anthropicTurn(config: LlmConfig, request: ToolChatRequest): Promise<ToolTurn> {
  const baseUrl = (config.baseUrl || LLM_PROVIDERS.anthropic.defaultBaseUrl).replace(/\/$/, '');

  const messages = request.messages.map((message) => {
    if (message.role === 'user') return { role: 'user', content: message.text };
    if (message.role === 'assistant') {
      const content: unknown[] = [];
      if (message.text) content.push({ type: 'text', text: message.text });
      for (const call of message.calls) {
        content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.args });
      }
      return { role: 'assistant', content };
    }
    return {
      role: 'user',
      content: message.outcomes.map((outcome) => ({
        type: 'tool_result',
        tool_use_id: outcome.id,
        content: outcome.content,
      })),
    };
  });

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: request.maxTokens ?? 4000,
      system: request.system,
      tools: request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      })),
      messages,
    }),
    signal: request.signal,
  });

  const payload = await readJson(response);
  if (!response.ok) throw new AiRequestError(errorMessage(payload, response.status), response.status);

  const blocks: any[] = payload?.content ?? [];
  return {
    text: blocks
      .filter((block) => block?.type === 'text')
      .map((block) => String(block.text ?? ''))
      .join('\n')
      .trim(),
    calls: blocks
      .filter((block) => block?.type === 'tool_use')
      .map((block) => ({
        id: String(block.id),
        name: String(block.name),
        args: (block.input ?? {}) as Record<string, unknown>,
      })),
  };
}

/* --------------------------------------------------------------------- OpenAI */

async function openAiTurn(config: LlmConfig, request: ToolChatRequest): Promise<ToolTurn> {
  const baseUrl = (config.baseUrl || LLM_PROVIDERS[config.provider].defaultBaseUrl).replace(/\/$/, '');

  const messages: unknown[] = [{ role: 'system', content: request.system }];
  for (const message of request.messages) {
    if (message.role === 'user') {
      messages.push({ role: 'user', content: message.text });
    } else if (message.role === 'assistant') {
      messages.push({
        role: 'assistant',
        content: message.text || null,
        tool_calls: message.calls.length
          ? message.calls.map((call) => ({
              id: call.id,
              type: 'function',
              function: { name: call.name, arguments: JSON.stringify(call.args) },
            }))
          : undefined,
      });
    } else {
      for (const outcome of message.outcomes) {
        messages.push({ role: 'tool', tool_call_id: outcome.id, content: outcome.content });
      }
    }
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      max_tokens: request.maxTokens ?? 4000,
      temperature: request.temperature ?? 0.2,
      messages,
      tools: request.tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      })),
      tool_choice: 'auto',
    }),
    signal: request.signal,
  });

  const payload = await readJson(response);
  if (!response.ok) throw new AiRequestError(errorMessage(payload, response.status), response.status);

  const choice = payload?.choices?.[0]?.message;
  const calls: ToolCall[] = (choice?.tool_calls ?? []).map((call: any, index: number) => ({
    id: String(call?.id ?? `call_${index}`),
    name: String(call?.function?.name ?? ''),
    args: parseArguments(call?.function?.arguments),
  }));

  return { text: typeof choice?.content === 'string' ? choice.content.trim() : '', calls };
}

function parseArguments(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/* --------------------------------------------------------------------- Gemini */

async function geminiTurn(config: LlmConfig, request: ToolChatRequest): Promise<ToolTurn> {
  const baseUrl = (config.baseUrl || LLM_PROVIDERS.gemini.defaultBaseUrl).replace(/\/$/, '');
  const url = `${baseUrl}/v1beta/models/${encodeURIComponent(config.model)}:generateContent`;

  const contents = request.messages.map((message) => {
    if (message.role === 'user') return { role: 'user', parts: [{ text: message.text }] };
    if (message.role === 'assistant') {
      const parts: unknown[] = [];
      if (message.text) parts.push({ text: message.text });
      for (const call of message.calls) {
        parts.push({ functionCall: { name: call.name, args: call.args } });
      }
      // A model turn with no parts at all is rejected; an empty text keeps the
      // history shape valid when the model answered with tool calls only.
      if (!parts.length) parts.push({ text: '' });
      return { role: 'model', parts };
    }
    return {
      role: 'user',
      parts: message.outcomes.map((outcome) => ({
        functionResponse: { name: outcome.name, response: { result: outcome.content } },
      })),
    };
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: request.system }] },
      contents,
      tools: [{ functionDeclarations: request.tools.map(toGeminiDeclaration) }],
      toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
      // No responseMimeType here: asking for JSON output and function calling at
      // the same time is rejected, and the tool calls are the output that matters.
      generationConfig: {
        temperature: request.temperature ?? 0.2,
        maxOutputTokens: request.maxTokens ?? 4000,
      },
    }),
    signal: request.signal,
  });

  const payload = await readJson(response);
  if (!response.ok) throw new AiRequestError(errorMessage(payload, response.status), response.status);

  const parts: any[] = payload?.candidates?.[0]?.content?.parts ?? [];
  const calls: ToolCall[] = [];
  let text = '';

  parts.forEach((part, index) => {
    if (typeof part?.text === 'string') text += part.text;
    const call = part?.functionCall ?? part?.function_call;
    if (call?.name) {
      // Gemini does not issue call ids, so one is synthesised and only used to
      // pair the result up on our side.
      calls.push({
        id: `${call.name}_${index}`,
        name: String(call.name),
        args: (call.args ?? call.arguments ?? {}) as Record<string, unknown>,
      });
    }
  });

  return { text: text.trim(), calls };
}

/**
 * Gemini validates tool schemas against the OpenAPI proto, where `type` is an
 * enum: lowercase names are rejected outright. Empty parameter objects are
 * rejected too, so a no-argument tool is declared without a schema.
 */
function toGeminiDeclaration(tool: AgentToolSpec): Record<string, unknown> {
  const hasProperties = Object.keys(tool.parameters.properties ?? {}).length > 0;
  return {
    name: tool.name,
    description: tool.description,
    ...(hasProperties ? { parameters: toGeminiSchema(tool.parameters) } : {}),
  };
}

function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== 'object') return schema;

  const source = schema as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(source)) {
    if (key === 'type' && typeof value === 'string') {
      result.type = value.toUpperCase();
    } else if (key === 'properties' && value && typeof value === 'object') {
      const properties: Record<string, unknown> = {};
      for (const [name, child] of Object.entries(value as Record<string, unknown>)) {
        properties[name] = toGeminiSchema(child);
      }
      result.properties = properties;
    } else if (key === 'items') {
      result.items = toGeminiSchema(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/* ---------------------------------------------------------------------- shared */

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
  const message = payload?.error?.message ?? payload?.message;
  if (status === 401 || status === 403) return 'API kalit noto‘g‘ri yoki ruxsat yo‘q.';
  if (status === 429) return 'So‘rovlar limiti tugadi. Birozdan keyin urinib ko‘ring.';
  if (status === 400 && message && /tool|function/i.test(String(message))) {
    return `Model asboblarni qo‘llab-quvvatlamadi: ${message}`;
  }
  return message ? `AI xatosi (${status}): ${message}` : `AI xatosi (${status})`;
}
