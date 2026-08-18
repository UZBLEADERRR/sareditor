import { File } from 'expo-file-system';

import { run, cancel as cancelRun } from '../ffmpeg/engine';
import { buildAss, buildSrt } from '../ffmpeg/subtitles';
import { buildRender } from '../ffmpeg/pipeline';
import { stabilizeDetectArgs } from '../ffmpeg/filters/motion';
import { ASPECT_SIZES } from '../ffmpeg/presets';
import { buildTimeline } from '../ffmpeg/timeline';
import type { Project, RenderRecord, Segment, Word } from '../types/project';
import { uid } from '../utils/id';
import { even } from '../utils/format';
import { fontsDir, outputFile, toNativePath, workFile } from '../utils/paths';

export type RenderStage = 'prepare' | 'stabilize' | 'captions' | 'encode' | 'finalize';

export type RenderProgress = {
  stage: RenderStage;
  /** 0..1 across the whole job, not just the current stage. */
  progress: number;
  message: string;
  speed?: number;
  etaMs?: number;
};

export type RenderOptions = {
  onProgress?: (progress: RenderProgress) => void;
  /** Pass the same key to `cancelRender` to stop the job. */
  key?: string;
};

/**
 * Runs a project end to end and returns the finished file.
 *
 * Stabilisation needs its own analysis pass before the main encode, and its
 * transform file is cached on the project so toggling other settings does not
 * pay for it twice.
 */
export async function renderProject(project: Project, options: RenderOptions = {}): Promise<RenderRecord> {
  const key = options.key ?? uid('render_');
  const report = options.onProgress ?? (() => {});

  if (!project.source) throw new Error('Loyihada video yo‘q');
  report({ stage: 'prepare', progress: 0.01, message: 'Tayyorlanmoqda…' });

  const timeline = buildTimeline(
    project.segments,
    project.effects.transition === 'none' ? 0 : project.effects.transitionMs
  );
  if (!timeline.totalMs) throw new Error('Kesilgan bo‘lak yo‘q — avval videoni kesing');

  let stabilizeTrfPath = project.analysis?.stabilizeTrfPath;
  if (project.effects.stabilize && !stabilizeTrfPath) {
    report({ stage: 'stabilize', progress: 0.03, message: 'Kamera silkinishi tahlil qilinmoqda…' });
    stabilizeTrfPath = await runStabilizeDetect(project, key, (fraction) =>
      report({
        stage: 'stabilize',
        progress: 0.03 + fraction * 0.15,
        message: 'Kamera silkinishi tahlil qilinmoqda…',
      })
    );
  }

  let assPath: string | undefined;
  const wantsCaptions = project.subtitle.enabled && Boolean(project.transcript?.words.length);

  const built = buildRender({
    project,
    outputPath: '',
    assPath: wantsCaptions ? 'pending' : undefined,
    stabilizeTrfPath: project.effects.stabilize ? stabilizeTrfPath : undefined,
  });

  if (wantsCaptions && built.captionWords.length) {
    report({ stage: 'captions', progress: 0.19, message: 'Subtitrlar tayyorlanmoqda…' });
    assPath = writeAssFile(project, built.captionWords);
  }

  const output = outputFile(`${sanitise(project.name)}_${uid()}.mp4`);
  if (output.exists) output.delete();
  const outputPath = toNativePath(output.uri);

  const final = buildRender({
    project,
    outputPath,
    assPath,
    fontsDir: toNativePath(fontsDir().uri),
    stabilizeTrfPath: project.effects.stabilize ? stabilizeTrfPath : undefined,
  });

  const encodeStart = Date.now();
  report({ stage: 'encode', progress: 0.2, message: 'Video render qilinmoqda…' });

  await run(final.args, {
    key,
    totalMs: final.totalMs,
    onProgress: (event) => {
      const elapsed = Date.now() - encodeStart;
      const etaMs = event.progress > 0.02 ? (elapsed / event.progress) * (1 - event.progress) : undefined;
      report({
        stage: 'encode',
        progress: 0.2 + event.progress * 0.78,
        message: 'Video render qilinmoqda…',
        speed: event.speed,
        etaMs,
      });
    },
  });

  report({ stage: 'finalize', progress: 0.99, message: 'Yakunlanmoqda…' });

  return {
    id: uid('out_'),
    uri: output.uri,
    createdAt: Date.now(),
    durationMs: final.totalMs,
    sizeBytes: output.exists ? output.size ?? 0 : 0,
    platform: project.export.platform,
    savedToGallery: false,
  };
}

export async function cancelRender(key: string): Promise<void> {
  await cancelRun(key);
}

/**
 * Renders a few seconds at low resolution so the user can actually see the look
 * before committing to a full export. Same code path as the real render, which
 * is the point — a preview that lies is worse than no preview.
 */
export async function renderPreview(
  project: Project,
  options: { aroundMs?: number; durationMs?: number; onProgress?: (fraction: number) => void; key?: string } = {}
): Promise<string> {
  if (!project.source) throw new Error('Loyihada video yo‘q');

  const durationMs = options.durationMs ?? 4000;
  const aroundMs = options.aroundMs ?? 0;
  const preview = buildPreviewProject(project, aroundMs, durationMs);

  const wantsCaptions = preview.subtitle.enabled && Boolean(preview.transcript?.words.length);
  const probe = buildRender({ project: preview, outputPath: '', assPath: wantsCaptions ? 'pending' : undefined });

  const assPath = wantsCaptions && probe.captionWords.length
    ? writeAssFile(preview, probe.captionWords, 'preview')
    : undefined;

  const output = workFile(`preview_${uid()}.mp4`);
  if (output.exists) output.delete();

  const built = buildRender({
    project: preview,
    outputPath: toNativePath(output.uri),
    assPath,
    fontsDir: toNativePath(fontsDir().uri),
  });

  await run(built.args, {
    key: options.key ?? uid('preview_'),
    totalMs: built.totalMs,
    onProgress: (event) => options.onProgress?.(event.progress),
  });

  return output.uri;
}

/**
 * Narrows a project down to a short window at reduced resolution.
 *
 * The preview keeps every look setting and only shrinks the frame, so what the
 * user sees is the real filter graph — just cheaper. Encoding stays on x264
 * because the hardware encoder's minimum keyframe interval makes very short
 * clips look worse than they will in the final export.
 */
function buildPreviewProject(project: Project, aroundMs: number, durationMs: number): Project {
  const timeline = buildTimeline(
    project.segments,
    project.effects.transition === 'none' ? 0 : project.effects.transitionMs
  );

  const start = Math.min(Math.max(0, aroundMs), Math.max(0, timeline.totalMs - durationMs));
  const end = start + durationMs;

  const segments: Segment[] = [];
  for (const item of timeline.placed) {
    const overlapStart = Math.max(item.outStartMs, start);
    const overlapEnd = Math.min(item.outEndMs, end);
    if (overlapEnd <= overlapStart) continue;
    const speed = item.segment.speed > 0 ? item.segment.speed : 1;
    segments.push({
      ...item.segment,
      id: uid('pv_'),
      startMs: item.segment.startMs + (overlapStart - item.outStartMs) * speed,
      endMs: item.segment.startMs + (overlapEnd - item.outStartMs) * speed,
    });
  }

  const base = ASPECT_SIZES[project.export.aspect];
  const scale = Math.min(1, 540 / base.width);

  return {
    ...project,
    segments: segments.length ? segments : project.segments.slice(0, 1),
    export: {
      ...project.export,
      width: even(Math.round(base.width * scale)),
      height: even(Math.round(base.height * scale)),
      fps: Math.min(30, project.export.fps),
      videoBitrateKbps: 3500,
      audioBitrateKbps: 128,
      encoder: 'x264',
    },
    effects: {
      ...project.effects,
      // A 4 second preview should not spend two thirds of itself fading.
      fadeInMs: 0,
      fadeOutMs: 0,
      stabilize: false,
    },
  };
}

/** Writes the caption file next to the render and returns its path. */
function writeAssFile(project: Project, words: Word[], prefix = 'subs'): string {
  const file = workFile(`${prefix}_${uid()}.ass`);
  if (file.exists) file.delete();
  file.create({ overwrite: true });
  file.write(
    buildAss({
      words,
      config: project.subtitle,
      width: project.export.width,
      height: project.export.height,
    })
  );
  return toNativePath(file.uri);
}

/** Exports the caption track as a standalone .srt for uploading alongside the video. */
export function writeSrtFile(project: Project): string | null {
  if (!project.transcript?.words.length) return null;
  const file = outputFile(`${sanitise(project.name)}_${uid()}.srt`);
  if (file.exists) file.delete();
  file.create({ overwrite: true });
  file.write(buildSrt(project.transcript.words, project.subtitle));
  return file.uri;
}

async function runStabilizeDetect(
  project: Project,
  key: string,
  onProgress: (fraction: number) => void
): Promise<string> {
  const trf = workFile(`stab_${uid()}.trf`);
  if (trf.exists) trf.delete();
  const trfPath = toNativePath(trf.uri);

  await run(stabilizeDetectArgs(project.source!.uri, trfPath), {
    key: `${key}_stab`,
    totalMs: project.source!.durationMs,
    onProgress: (event) => onProgress(event.progress),
  });

  return trfPath;
}

function sanitise(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[^\w-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40) || 'sar'
  );
}

export function estimateOutputBytes(project: Project): number {
  const timeline = buildTimeline(
    project.segments,
    project.effects.transition === 'none' ? 0 : project.effects.transitionMs
  );
  const seconds = timeline.totalMs / 1000;
  const kbps = project.export.videoBitrateKbps + project.export.audioBitrateKbps;
  return Math.round((kbps * 1000 * seconds) / 8);
}

export function fileExists(uri: string): boolean {
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}
