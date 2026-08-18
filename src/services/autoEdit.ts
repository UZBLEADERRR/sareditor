import { generateImage, type ImageConfig } from '../ai/images';
import { planEdit } from '../ai/director';
import { transcribe } from '../ai/transcribe';
import type { LlmConfig, SttConfig } from '../ai/types';
import { detectSilence, type SilenceRange } from '../analysis/silence';
import { segmentsFromSilence } from '../analysis/autocut';
import { PLATFORM_PRESETS } from '../ffmpeg/presets';
import { buildTimeline, sourceToOutput } from '../ffmpeg/timeline';
import { applySubtitleStyle } from '../presets/subtitleStyles';
import type { AiPlan, ImageOverlay, Project, Segment, Transcript } from '../types/project';
import { uid } from '../utils/id';

export type AutoEditStage = 'transcribe' | 'analyse' | 'plan' | 'images' | 'apply';

export type AutoEditProgress = {
  stage: AutoEditStage;
  /** 0..1 across the whole job. */
  progress: number;
  message: string;
};

export type AutoEditOptions = {
  llm: LlmConfig;
  stt: SttConfig;
  /** Omit to skip illustrations entirely. */
  image?: ImageConfig;
  extraInstructions?: string;
  onProgress?: (progress: AutoEditProgress) => void;
  signal?: AbortSignal;
};

export type AutoEditResult = {
  patch: Partial<Project>;
  plan: AiPlan;
  imagesMade: number;
  imagesFailed: number;
  /** Anything the user should know about what was skipped or fell back. */
  notes: string[];
};

/**
 * The whole edit, from one button.
 *
 * Transcribe, find the pauses, ask the model what to keep and how it should
 * look, then generate the illustrations it asked for. Every step reuses work
 * the project already has, so pressing the button twice does not pay for the
 * transcript twice.
 *
 * Nothing is written to the project here — the caller receives a patch and
 * decides whether to apply it, which keeps a half-finished run from leaving a
 * project in a strange state.
 */
export async function runAutoEdit(project: Project, options: AutoEditOptions): Promise<AutoEditResult> {
  const source = project.source;
  if (!source) throw new Error('Loyihada video yo‘q');

  const report = options.onProgress ?? (() => {});
  const notes: string[] = [];
  const preset = PLATFORM_PRESETS[project.export.platform];

  // ---------------------------------------------------------- transcript ---
  let transcript: Transcript | undefined = project.transcript;
  if (!transcript?.words.length) {
    report({ stage: 'transcribe', progress: 0.02, message: 'Nutq matnga aylantirilmoqda…' });
    transcript = await transcribe(options.stt, source.uri, {
      durationMs: source.durationMs,
      signal: options.signal,
      onProgress: (event) =>
        report({
          stage: 'transcribe',
          progress: 0.02 + event.progress * 0.43,
          message:
            event.stage === 'extract'
              ? 'Ovoz ajratilmoqda…'
              : `Nutq tanilmoqda ${event.chunk ?? 1}/${event.chunkCount ?? 1}`,
        }),
    });
    if (!transcript.words.length) {
      notes.push('Videoda tanib olinadigan nutq topilmadi — montaj faqat jimliklarga qarab qilindi.');
    }
  }

  // ------------------------------------------------------------ silences ---
  options.signal?.throwIfAborted();
  let silences: SilenceRange[] | undefined = project.analysis?.silences;
  if (!silences) {
    report({ stage: 'analyse', progress: 0.48, message: 'Jimliklar tahlil qilinmoqda…' });
    silences = await detectSilence(source.uri);
  }

  // ---------------------------------------------------------------- plan ---
  options.signal?.throwIfAborted();
  report({ stage: 'plan', progress: 0.56, message: 'AI montaj rejasini tuzmoqda…' });

  const plan = await planEdit(
    options.llm,
    {
      durationMs: source.durationMs,
      platform: preset.label,
      targetDurationMs: Math.min(preset.maxDurationMs, 60_000),
      language: transcript?.language ?? options.stt.language ?? '',
      transcript: (transcript?.lines ?? []).map((line) => ({
        startMs: line.startMs,
        endMs: line.endMs,
        text: line.text,
      })),
      silences,
      hasMusic: project.music.enabled,
      bpm: project.music.bpm,
      extraInstructions: options.extraInstructions,
    },
    options.signal
  );

  // --------------------------------------------------------------- apply ---
  // The model's ranges are preferred, but a plan with no usable cuts would
  // leave the whole take uncut; the silence map is the fallback.
  let segments: Segment[] = plan.keepRanges.map((range) => ({
    id: uid('seg_'),
    startMs: Math.round(range.startMs),
    endMs: Math.round(range.endMs),
    speed: 1,
  }));

  if (!segments.length) {
    notes.push('AI kesish nuqtalarini bermadi — jimliklar bo‘yicha kesildi.');
    segments = segmentsFromSilence(source.durationMs, silences, {
      paddingMs: 120,
      targetDurationMs: preset.maxDurationMs,
    });
  }

  const effects = {
    ...project.effects,
    grade: plan.suggestedGrade,
    transition: plan.suggestedTransition,
  };

  const subtitle = {
    ...applySubtitleStyle(project.subtitle, plan.suggestedSubtitleStyle),
    enabled: Boolean(transcript?.words.length),
    emphasisWords: Array.from(new Set([...project.subtitle.emphasisWords, ...plan.emphasisWords])),
  };

  // -------------------------------------------------------------- images ---
  let imagesMade = 0;
  let imagesFailed = 0;
  const overlays: ImageOverlay[] = [];

  if (options.image && plan.imageIdeas.length) {
    // The director timed its ideas against the source, but overlays play on the
    // exported timeline — after the cut, those are different clocks.
    const timeline = buildTimeline(segments, effects.transition === 'none' ? 0 : effects.transitionMs);
    const placed = plan.imageIdeas
      .map((idea) => {
        const startMs = sourceToOutput(timeline, idea.startMs);
        const endMs = sourceToOutput(timeline, idea.endMs);
        return startMs === null || endMs === null || endMs <= startMs ? null : { idea, startMs, endMs };
      })
      .filter((item): item is { idea: AiPlan['imageIdeas'][number]; startMs: number; endMs: number } =>
        item !== null
      );

    const dropped = plan.imageIdeas.length - placed.length;
    if (dropped > 0) {
      notes.push(`${dropped} ta rasm kesilgan joyga to‘g‘ri kelgani uchun tashlandi.`);
    }

    for (let index = 0; index < placed.length; index += 1) {
      options.signal?.throwIfAborted();
      const { idea, startMs, endMs } = placed[index];
      report({
        stage: 'images',
        progress: 0.66 + (0.32 * index) / placed.length,
        message: `Rasm yaratilmoqda ${index + 1}/${placed.length}`,
      });

      try {
        const uri = await generateImage(options.image, idea.prompt, project.export.aspect, options.signal);
        overlays.push({
          id: uid('ovl_'),
          uri,
          startMs: Math.round(startMs),
          endMs: Math.round(endMs),
          phrase: idea.phrase,
          prompt: idea.prompt,
          style: idea.style,
          animation: 'fade',
          opacity: 1,
        });
        imagesMade += 1;
      } catch (error) {
        imagesFailed += 1;
        // One refused prompt should not sink the whole run.
        if (imagesFailed === 1) notes.push(`Rasm xatosi: ${(error as Error).message}`);
      }
    }
  }

  report({ stage: 'apply', progress: 0.99, message: 'Loyihaga qo‘llanmoqda…' });

  return {
    patch: {
      transcript,
      segments,
      effects,
      subtitle,
      overlays,
      aiPlan: plan,
      analysis: { ...project.analysis, silences },
    },
    plan,
    imagesMade,
    imagesFailed,
    notes,
  };
}
