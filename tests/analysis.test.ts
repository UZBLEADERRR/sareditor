import fs from 'node:fs';
import path from 'node:path';

import {
  estimateBpm,
  parseEbur128,
  parseRmsEnvelope,
  parseSceneLog,
  parseSilenceLog,
  pickOnsets,
} from '../src/analysis/parse';
import { segmentsFromSilence } from '../src/analysis/autocut';
import { duckFilter } from '../src/ffmpeg/filters/audio';
import { ffmpeg, ffmpegOrThrow, loudnessBetween, outputDir, Runner } from './helpers';
import { ensureFixtures } from './helpers';

const WINDOW_MS = (512 / 22050) * 1000;

export function runAnalysisTests(runner: Runner): void {
  const fixtures = ensureFixtures();

  runner.section('Silence detection');

  const silenceLog = ffmpeg([
    '-hide_banner', '-nostdin', '-i', fixtures.source,
    '-af', 'silencedetect=noise=-32dB:d=0.450', '-f', 'null', '-',
  ]).stderr;
  const silences = parseSilenceLog(silenceLog);

  // The fixture's tone is gated off for 1.8 s in every 5 s window.
  runner.check('silencedetect output is parsed', silences.length >= 2, `${silences.length} ranges`);
  runner.check(
    'ranges are ordered and non-overlapping',
    silences.every((range, index) =>
      range.endMs > range.startMs && (index === 0 || range.startMs >= silences[index - 1].endMs)
    ),
    silences.map((r) => `${Math.round(r.startMs)}-${Math.round(r.endMs)}`).join(', ')
  );

  const segments = segmentsFromSilence(12_000, silences, { paddingMs: 120 });
  runner.check(
    'auto-cut yields a valid segment list',
    segments.every((segment, index) =>
      segment.endMs > segment.startMs &&
      segment.endMs <= 12_000 &&
      (index === 0 || segment.startMs >= segments[index - 1].endMs)
    ),
    `${segments.length} segments`
  );

  runner.section('Scene detection');

  const sceneLog = ffmpeg([
    '-hide_banner', '-nostdin', '-i', fixtures.source,
    '-filter:v', "select='gt(scene,0.02)',showinfo", '-an', '-f', 'null', '-',
  ]).stderr;
  runner.check('showinfo timestamps are parsed', parseSceneLog(sceneLog).length > 0);

  runner.section('Beat detection');

  // A 120 BPM click track: an exponential decay retriggered every 0.5 s.
  const clicks = path.join(outputDir, 'clicks.wav');
  ffmpegOrThrow([
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
    '-i', "aevalsrc='0.9*sin(2*PI*900*t)*exp(-12*mod(t,0.5))':s=44100:d=20",
    clicks,
  ]);

  const statsFile = path.join(outputDir, 'clicks-stats.txt');
  ffmpeg([
    '-hide_banner', '-nostdin', '-y', '-i', clicks,
    '-af',
    'aformat=channel_layouts=mono,aresample=22050,asetnsamples=n=512:p=0,' +
      `astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=${statsFile}`,
    '-vn', '-f', 'null', '-',
  ]);

  const envelope = parseRmsEnvelope(fs.readFileSync(statsFile, 'utf8'));
  runner.check('astats envelope is parsed', envelope.length > 100, `${envelope.length} windows`);

  const beats = pickOnsets(envelope, WINDOW_MS);
  runner.check(
    'onsets land on the click track',
    beats.length >= 30 && beats.length <= 48,
    `${beats.length} beats over 20 s`
  );
  runner.check('tempo is recovered', Math.abs(estimateBpm(beats) - 120) <= 5, `${estimateBpm(beats)} BPM`);

  runner.section('Loudness');

  const loudLog = ffmpeg([
    '-hide_banner', '-nostdin', '-i', fixtures.source,
    '-af', 'ebur128=peak=true', '-vn', '-f', 'null', '-',
  ]).stderr;
  const reading = parseEbur128(loudLog);
  runner.check(
    'ebur128 summary is parsed, not the running value',
    reading !== null && reading.integratedLufs > -40,
    reading ? `${reading.integratedLufs} LUFS, peak ${reading.truePeakDb} dBFS` : 'null'
  );

  runner.section('Sidechain ducking');

  // Music alone on the output, so the reading cannot be coloured by the voice.
  const music = path.join(outputDir, 'duck-music.wav');
  const voice = path.join(outputDir, 'duck-voice.wav');
  const ducked = path.join(outputDir, 'duck-result.wav');

  ffmpegOrThrow(['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
    '-i', 'sine=frequency=180:duration=6', music]);
  ffmpegOrThrow(['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
    '-i', "aevalsrc='0.5*sin(2*PI*700*t)*lt(t,3)':s=44100:d=6", voice]);
  ffmpegOrThrow([
    '-hide_banner', '-loglevel', 'error', '-y', '-i', music, '-i', voice,
    '-filter_complex', `[0:a][1:a]${duckFilter(12)}[out]`, '-map', '[out]', ducked,
  ]);

  const underVoice = loudnessBetween(ducked, 0.5, 2.5);
  const inGap = loudnessBetween(ducked, 3.6, 5.6);
  runner.check(
    'music drops while the voice is present',
    underVoice !== null && inGap !== null && inGap - underVoice > 6,
    `${underVoice} LUFS under voice vs ${inGap} LUFS in the gap`
  );
}
