import fs from 'node:fs';
import path from 'node:path';

import { stabilizeDetectArgs } from '../src/ffmpeg/filters/motion';
import { buildRender } from '../src/ffmpeg/pipeline';
import { buildAss } from '../src/ffmpeg/subtitles';
import { buildTimeline } from '../src/ffmpeg/timeline';
import type { Project, Word } from '../src/types/project';
import { ffmpeg, inspect, outputDir, Runner } from './helpers';
import { allScenarios, baseProject, outputPathFor, SOURCE } from './scenarios';

function writeAss(project: Project, words: Word[], name: string): string {
  const file = path.join(outputDir, `${name}.ass`);
  fs.writeFileSync(
    file,
    buildAss({
      words,
      config: project.subtitle,
      width: project.export.width,
      height: project.export.height,
    })
  );
  return file;
}

/** Renders one project for real and returns the produced file. */
function render(project: Project, name: string): string {
  const outputPath = outputPathFor(outputDir, name);

  // First pass builds the caption words on the export timeline; the .ass file
  // cannot be written before the cut is known.
  const probe = buildRender({
    project,
    outputPath: '',
    assPath: project.subtitle.enabled ? 'pending' : undefined,
  });
  const assPath =
    project.subtitle.enabled && probe.captionWords.length
      ? writeAss(project, probe.captionWords, name)
      : undefined;

  const built = buildRender({ project, outputPath, assPath, fontsDir: '/usr/share/fonts' });
  const { ok, stderr } = ffmpeg(built.args);
  if (!ok) throw new Error(stderr.trim().split('\n').slice(-5).join('\n'));
  return outputPath;
}

export function runRenderTests(runner: Runner): void {
  runner.section('Render pipeline');

  for (const { name, project } of allScenarios()) {
    try {
      const file = render(project, name);
      const facts = inspect(file);
      const expected = buildTimeline(
        project.segments,
        project.effects.transition === 'none' ? 0 : project.effects.transitionMs
      ).totalMs;

      runner.check(
        `${name} renders`,
        fs.statSync(file).size > 1000,
        `${(fs.statSync(file).size / 1024).toFixed(0)} KB`
      );
      runner.check(
        `${name} duration matches the timeline`,
        Math.abs(facts.durationMs - expected) < 350,
        `expected ${(expected / 1000).toFixed(2)} s, got ${(facts.durationMs / 1000).toFixed(2)} s`
      );
      runner.check(
        `${name} frame size matches the export config`,
        facts.width === project.export.width && facts.height === project.export.height,
        `${facts.width}x${facts.height}`
      );
    } catch (error) {
      runner.check(`${name} renders`, false, (error as Error).message);
    }
  }

  runner.section('Audio wiring');

  const withAudio = inspect(outputPathFor(outputDir, 'minimal'));
  runner.check('a clip with sound keeps its audio stream', withAudio.hasAudio);

  const silent = inspect(outputPathFor(outputDir, 'source_without_audio'));
  runner.check('a silent source produces no audio stream', !silent.hasAudio);

  const musicOnly = inspect(outputPathFor(outputDir, 'music_only_original_muted'));
  runner.check('muting the original still leaves the music', musicOnly.hasAudio);

  const normalised = inspect(outputPathFor(outputDir, 'effects_full'));
  runner.check(
    'loudness normalisation reaches the platform target',
    normalised.integratedLufs !== null && Math.abs(normalised.integratedLufs + 14) < 2,
    `${normalised.integratedLufs} LUFS`
  );

  runner.section('Stabilisation (two pass)');

  try {
    const trf = path.join(outputDir, 'stabilize.trf');
    const detect = ffmpeg(stabilizeDetectArgs(SOURCE.uri, trf));
    runner.check('vidstabdetect writes a transform file', detect.ok && fs.existsSync(trf));

    const project = baseProject({ effects: { ...baseProject().effects, stabilize: true } });
    const built = buildRender({
      project,
      outputPath: outputPathFor(outputDir, 'stabilized'),
      stabilizeTrfPath: trf,
    });
    const { ok, stderr } = ffmpeg(built.args);
    runner.check(
      'vidstabtransform runs inside the main graph',
      ok,
      ok ? '' : stderr.trim().split('\n').slice(-3).join(' ')
    );
  } catch (error) {
    runner.check('stabilisation', false, (error as Error).message);
  }
}
