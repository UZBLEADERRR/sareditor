import type { GradeId, OverlayStyle, SubtitleStyleId, TransitionId } from '../types/project';

/** JSON-schema fragment shared by both provider dialects. */
export type ToolSchema = {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
};

export type AgentToolSpec = {
  name: string;
  description: string;
  parameters: ToolSchema;
};

const GRADES: GradeId[] = [
  'none', 'teal_orange', 'warm_film', 'cold_cinema', 'vibrant', 'moody', 'vintage', 'bw',
];
const CAPTION_STYLES: SubtitleStyleId[] = [
  'hormozi', 'karaoke', 'clean', 'neon', 'boxed', 'typewriter', 'bounce', 'cinema',
];
const TRANSITIONS: TransitionId[] = [
  'none', 'fade', 'dissolve', 'flash', 'slideup', 'slideleft', 'circleopen', 'pixelize', 'wipeleft',
];
const OVERLAY_STYLES: OverlayStyle[] = ['cutaway', 'fullscreen', 'corner'];

const range = {
  startMs: { type: 'integer', description: 'Start in milliseconds, measured on the original video' },
  endMs: { type: 'integer', description: 'End in milliseconds, measured on the original video' },
};

/**
 * What the agent is allowed to do to a project.
 *
 * Every time argument is on the **original** video's clock, including the ones
 * for illustrations and voiceover. Cuts change the timeline underneath, so
 * asking the model to track two clocks would be a reliable source of drift; the
 * executor converts once, at the end, when the final cut is known.
 */
export const AGENT_TOOLS: AgentToolSpec[] = [
  {
    name: 'read_transcript',
    description:
      'Read what is said in the video, with timings. Call this first whenever the request depends on the content.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'read_project',
    description: 'Read the current cut, look, captions, audio, library assets and illustrations.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'keep_ranges',
    description:
      'Replace the cut with exactly these ranges of the original video, in order. Use for a full re-edit.',
    parameters: {
      type: 'object',
      properties: {
        ranges: {
          type: 'array',
          description: 'Ordered, non-overlapping ranges to keep',
          items: { type: 'object', properties: range, required: ['startMs', 'endMs'] },
        },
      },
      required: ['ranges'],
    },
  },
  {
    name: 'remove_range',
    description: 'Cut one piece out of the video, keeping everything else.',
    parameters: { type: 'object', properties: range, required: ['startMs', 'endMs'] },
  },
  {
    name: 'set_speed',
    description: 'Speed up or slow down one part. 2 is twice as fast, 0.5 is half speed.',
    parameters: {
      type: 'object',
      properties: { ...range, speed: { type: 'number', description: '0.25 to 4' } },
      required: ['startMs', 'endMs', 'speed'],
    },
  },
  {
    name: 'set_look',
    description: 'Change the colour grade and cinematic effects. Only pass what should change.',
    parameters: {
      type: 'object',
      properties: {
        grade: { type: 'string', enum: GRADES },
        gradeStrength: { type: 'number', description: '0 to 1' },
        vignette: { type: 'number', description: '0 to 1, darkens the frame edges' },
        grain: { type: 'number', description: '0 to 1' },
        bloom: { type: 'number', description: '0 to 1, glow around highlights' },
        letterbox: { type: 'number', description: '0 to 0.3, black cinema bars' },
        zoom: { type: 'string', enum: ['none', 'in', 'out', 'pulse'] },
        zoomAmount: { type: 'number', description: '0.02 to 0.4' },
        transition: { type: 'string', enum: TRANSITIONS },
      },
    },
  },
  {
    name: 'set_captions',
    description: 'Change how the burned-in subtitles look and where they sit.',
    parameters: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        styleId: { type: 'string', enum: CAPTION_STYLES },
        fontSizePct: { type: 'number', description: 'Cap height as a percent of frame height, 2.5 to 12' },
        positionPct: { type: 'number', description: '0 top, 100 bottom' },
        positionXPct: { type: 'number', description: '0 left, 100 right' },
        uppercase: { type: 'boolean' },
        karaoke: { type: 'boolean' },
        highlightColor: { type: 'string', description: 'Hex, e.g. #FFE81F' },
        emphasisWords: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'translate_captions',
    description:
      'Translate the burned-in subtitles into another language, keeping every word timing. Use when the creator asks for another language.',
    parameters: {
      type: 'object',
      properties: { language: { type: 'string', description: 'Target language, e.g. English, Русский' } },
      required: ['language'],
    },
  },
  {
    name: 'add_illustration',
    description:
      'Draw a picture and show it while a phrase is spoken. Use for concrete things the viewer cannot see.',
    parameters: {
      type: 'object',
      properties: {
        ...range,
        prompt: { type: 'string', description: 'What the picture shows. No text in the image.' },
        style: { type: 'string', enum: OVERLAY_STYLES },
        phrase: { type: 'string', description: 'The words this illustrates' },
      },
      required: ['startMs', 'endMs', 'prompt'],
    },
  },
  {
    name: 'place_library_media',
    description:
      "Show one of the creator's own photos or clips at a moment. Call read_project first to get the asset ids.",
    parameters: {
      type: 'object',
      properties: {
        ...range,
        assetId: { type: 'string' },
        style: { type: 'string', enum: OVERLAY_STYLES },
      },
      required: ['startMs', 'endMs', 'assetId'],
    },
  },
  {
    name: 'remove_overlay',
    description: 'Remove an illustration or placed clip by id.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'clear_overlays',
    description: 'Remove every illustration and placed clip at once.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'add_voiceover',
    description:
      'Speak a line and mix it into the video at a moment. Use for narration, intros, or a dubbed translation.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        startMs: { type: 'integer', description: 'When it starts, on the original video clock' },
        duckOriginal: { type: 'boolean', description: 'Quieten the original audio underneath' },
      },
      required: ['text', 'startMs'],
    },
  },
  {
    name: 'clear_voiceovers',
    description: 'Remove every generated voice line.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'set_audio',
    description: 'Change the audio mix.',
    parameters: {
      type: 'object',
      properties: {
        muteOriginal: { type: 'boolean' },
        originalVolumeDb: { type: 'number' },
        musicVolumeDb: { type: 'number' },
        duckMusic: { type: 'boolean', description: 'Lower the music while someone speaks' },
        voiceEnhance: { type: 'boolean' },
      },
    },
  },
  {
    name: 'finish',
    description: 'Stop and report what was done. Always call this last.',
    parameters: {
      type: 'object',
      properties: { summary: { type: 'string', description: "One short paragraph in the creator's language" } },
      required: ['summary'],
    },
  },
];

export const AGENT_TOOL_NAMES = AGENT_TOOLS.map((tool) => tool.name);
