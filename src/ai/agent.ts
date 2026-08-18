import type { Project } from '../types/project';
import { AGENT_TOOLS } from './agentTools';
import { AgentExecutor, type AgentServices } from './agentExecutor';
import { chatWithTools, type ChatMessage, type ToolCall } from './providers/toolChat';
import { AiRequestError } from './types';

export type AgentEvent =
  | { type: 'thinking' }
  | { type: 'tool'; name: string; label: string }
  | { type: 'change'; text: string }
  | { type: 'note'; text: string };

export type AgentRun = {
  /** Absent when the agent only answered a question. */
  patch?: Partial<Project>;
  /** What the agent says back, in the creator's language. */
  reply: string;
  changes: string[];
  warnings: string[];
  /** The conversation so far, to pass back in for the next message. */
  history: ChatMessage[];
  steps: number;
};

export type RunAgentOptions = {
  project: Project;
  instruction: string;
  /** Previous turns, so "yana bittasini qo‘sh" means something. */
  history?: ChatMessage[];
  services: AgentServices;
  /** Safety net against a model that never calls `finish`. */
  maxSteps?: number;
  onEvent?: (event: AgentEvent) => void;
};

const DEFAULT_MAX_STEPS = 14;

const SYSTEM_PROMPT = `You are the editing agent inside Fara Editor, a phone video editor for Reels, TikTok and Shorts.
The creator talks to you in plain language and you edit their project by calling tools.

How to work:
- Do what was asked, then call finish. Do not ask for permission first — the creator can undo everything with one button.
- Call read_project before touching anything you are not sure about, and read_transcript whenever the request depends on what is said.
- Times you pass to tools are always on the ORIGINAL video's clock, the same clock read_transcript reports. Never try to compensate for cuts you made; the editor converts once at the end.
- Prefer few, decisive edits over many small ones. Short-form video dies of clutter.
- If a tool refuses because something is not configured, carry on with the rest and mention it in the summary. Never invent a workaround.
- Never remove work the creator did by hand unless they asked for it. Adding is safer than replacing.
- When they ask for another language, translate_captions keeps the timings; add_voiceover speaks it aloud. Do both only if they asked for a dub.

The summary you pass to finish is what the creator reads. Write it in their language — the same language they wrote to you in, Uzbek unless they use another. Two or three short sentences, plain words, no lists, no markdown.`;

/**
 * One turn of the editing agent: read the request, call tools until the work is
 * done, and hand back a patch.
 *
 * The loop is deliberately bounded. A model that keeps calling tools forever
 * would burn the creator's own API credit, so after `maxSteps` rounds the run
 * stops and whatever was already applied is returned — the edits are real
 * either way, and the project is never left half-written because the patch is
 * only produced once, at the end.
 */
export async function runAgent(options: RunAgentOptions): Promise<AgentRun> {
  const { project, instruction, services } = options;
  const emit = options.onEvent ?? (() => {});
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;

  const executor = new AgentExecutor(project, services);
  const history: ChatMessage[] = [...(options.history ?? []), { role: 'user', text: instruction }];

  let reply = '';
  let steps = 0;

  for (; steps < maxSteps; steps += 1) {
    services.signal?.throwIfAborted();
    emit({ type: 'thinking' });

    const turn = await chatWithTools(services.llm, {
      system: `${SYSTEM_PROMPT}\n\n${projectBriefing(project)}`,
      messages: history,
      tools: AGENT_TOOLS,
      signal: services.signal,
    });

    history.push({ role: 'assistant', text: turn.text, calls: turn.calls });
    if (turn.text) reply = turn.text;

    if (!turn.calls.length) {
      // No tools, just an answer — the model is talking, not editing.
      break;
    }

    const outcomes = [];
    let finished = false;

    for (const call of turn.calls) {
      services.signal?.throwIfAborted();
      emit({ type: 'tool', name: call.name, label: toolLabel(call) });

      const execution = await execute(executor, call);
      if (execution.change) {
        executor.record(execution.change);
        emit({ type: 'change', text: execution.change });
      }
      outcomes.push({ id: call.id, name: call.name, content: execution.result });

      if (execution.done) {
        finished = true;
        if (execution.summary) reply = execution.summary;
      }
    }

    history.push({ role: 'tool', outcomes });
    if (finished) {
      steps += 1;
      break;
    }
  }

  const patch = executor.touched ? executor.patch() : undefined;
  for (const warning of executor.warnings) emit({ type: 'note', text: warning });

  return {
    patch,
    reply: reply || (executor.changes.length ? 'Bajarildi.' : 'Hech narsa o‘zgartirilmadi.'),
    changes: executor.changes,
    warnings: executor.warnings,
    history,
    steps,
  };
}

/**
 * A failing tool is reported back to the model rather than thrown.
 *
 * A refused image prompt or a missing key is something the agent can work
 * around — it can pick a different phrasing, or skip the picture and say so.
 * Aborts are the exception: those mean the creator pressed stop.
 */
async function execute(executor: AgentExecutor, call: ToolCall) {
  try {
    return await executor.run(call);
  } catch (error) {
    if (isAbort(error)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    return { result: `Tool failed: ${message}` };
  }
}

function isAbort(error: unknown): boolean {
  return (
    (error as { name?: string })?.name === 'AbortError' ||
    (error instanceof AiRequestError && error.status === 499)
  );
}

/** Facts the agent would otherwise waste a tool call to learn. */
function projectBriefing(project: Project): string {
  const source = project.source;
  return [
    'Current project:',
    `- name: ${project.name}`,
    `- source video: ${source ? `${Math.round(source.durationMs)} ms, ${source.width}x${source.height}` : 'none imported yet'}`,
    `- pieces in the cut: ${project.segments.length}`,
    `- transcript: ${project.transcript?.words.length ? `${project.transcript.words.length} words, language ${project.transcript.language}` : 'not made yet'}`,
    `- creator media in the library: ${project.library.length}`,
    `- illustrations on screen: ${project.overlays.length}`,
    `- voice lines: ${project.voiceovers.length}`,
  ].join('\n');
}

/** Short label shown while a tool runs, in the creator's language. */
function toolLabel(call: ToolCall): string {
  switch (call.name) {
    case 'read_transcript':
      return 'Nutqni o‘qiyapti';
    case 'read_project':
      return 'Loyihani ko‘ryapti';
    case 'keep_ranges':
      return 'Montajni qayta yig‘yapti';
    case 'remove_range':
      return 'Keraksiz joyni kesyapti';
    case 'set_speed':
      return 'Tezlikni o‘zgartiryapti';
    case 'set_look':
      return 'Rang va effektlarni qo‘yyapti';
    case 'set_captions':
      return 'Subtitrni sozlayapti';
    case 'translate_captions':
      return 'Subtitrni tarjima qilyapti';
    case 'add_illustration':
      return 'Rasm chizyapti';
    case 'place_library_media':
      return 'Rasmingizni joylashtiryapti';
    case 'remove_overlay':
    case 'clear_overlays':
      return 'Rasmlarni olib tashlayapti';
    case 'add_voiceover':
      return 'Ovoz yozyapti';
    case 'clear_voiceovers':
      return 'Ovozlarni olib tashlayapti';
    case 'set_audio':
      return 'Ovoz miksini sozlayapti';
    case 'set_format':
      return 'Formatni o‘zgartiryapti';
    case 'finish':
      return 'Yakunlayapti';
    default:
      return call.name;
  }
}
