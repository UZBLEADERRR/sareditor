import { assTime, buildAss, fittingCharsPerLine, groupWordsIntoCues } from '../src/ffmpeg/subtitles';
import { chain, escapeFilterValue, safeFileName } from '../src/ffmpeg/filters/escape';
import { atempoChain } from '../src/ffmpeg/filters/audio';
import { buildTimeline, invertSegments, mapWordsToTimeline, sourceToOutput } from '../src/ffmpeg/timeline';
import { gradeFilters } from '../src/ffmpeg/filters/grade';
import { hexToAssColor } from '../src/utils/format';
import type { Segment, SubtitleConfig, Word } from '../src/types/project';
import {
  captionAt,
  fadeOpacityAt,
  fitRect,
  letterboxBarHeight,
  overlayOpacityAt,
  overlayRect,
  zoomScaleAt,
} from '../src/preview/frame';
import { outputToSource } from '../src/ffmpeg/timeline';
import { gradeColorMatrix } from '../src/preview/colorMatrix';
import type { ImageOverlay } from '../src/types/project';
import { Runner } from './helpers';
import { TRANSCRIPT, baseProject } from './scenarios';

export function runUnitTests(runner: Runner): void {
  runner.section('Filter escaping');

  // A single backslash before the delimiter is what ffmpeg's parser wants; a
  // JS string literal makes it very easy to emit zero or two by accident.
  runner.check("':' is escaped with one backslash", escapeFilterValue('a:b') === 'a\\:b', escapeFilterValue('a:b'));
  runner.check("';' is escaped with one backslash", escapeFilterValue('a;b') === 'a\\;b', escapeFilterValue('a;b'));
  runner.check("',' is escaped with one backslash", escapeFilterValue('a,b') === 'a\\,b', escapeFilterValue('a,b'));
  runner.check('a backslash becomes two', escapeFilterValue('a\\b') === 'a\\\\b', escapeFilterValue('a\\b'));
  runner.check(
    'generated names stay free of characters that need escaping',
    safeFileName("Meniki: mo'jiza, 2024.mp4") === 'Meniki_mo_jiza_2024.mp4',
    safeFileName("Meniki: mo'jiza, 2024.mp4")
  );
  runner.check('chain drops empty stages', chain('a', '', null, 'b') === 'a,b');

  runner.section('Timeline maths');

  const segments: Segment[] = [
    { id: 'a', startMs: 0, endMs: 2000, speed: 1 },
    { id: 'b', startMs: 5000, endMs: 9000, speed: 2 },
  ];
  const plain = buildTimeline(segments, 0);
  runner.check(
    'speed shortens a segment on the output timeline',
    plain.totalMs === 4000,
    `${plain.totalMs} ms`
  );

  const withTransition = buildTimeline(segments, 500);
  runner.check(
    'each transition overlaps its neighbours',
    withTransition.totalMs === 3500,
    `${withTransition.totalMs} ms`
  );

  runner.check(
    'a source time inside the second segment maps through the speed change',
    sourceToOutput(plain, 7000) === 3000,
    String(sourceToOutput(plain, 7000))
  );
  runner.check('a cut-out source time maps to null', sourceToOutput(plain, 3000) === null);

  const mapped = mapWordsToTimeline(plain, [
    { text: 'kesilgan', startMs: 3000, endMs: 3500 },
    { text: 'qolgan', startMs: 6000, endMs: 6400 },
  ]);
  runner.check('words on the cutting room floor are dropped', mapped.length === 1, `${mapped.length} words`);
  runner.check(
    'a surviving word is rebased and speed-scaled',
    mapped[0]?.startMs === 2500,
    `${mapped[0]?.startMs} ms`
  );

  const gaps = invertSegments(segments, 12_000);
  runner.check(
    'inverting the cut list finds the removed ranges',
    gaps.length === 2 && gaps[0].startMs === 2000 && gaps[1].endMs === 12_000,
    JSON.stringify(gaps)
  );

  runner.section('Audio helpers');

  runner.check('unit speed needs no atempo', atempoChain(1) === '');
  runner.check('a 1.5x speed is a single stage', atempoChain(1.5) === 'atempo=1.5', atempoChain(1.5));
  runner.check(
    'below 0.5x, atempo is chained because one stage cannot reach it',
    atempoChain(0.25).split(',').length === 2,
    atempoChain(0.25)
  );
  runner.check(
    'above 2x, atempo is chained the same way',
    atempoChain(4).split(',').every((stage) => Number(stage.split('=')[1]) <= 2),
    atempoChain(4)
  );

  runner.section('Colour grading');

  runner.check('a zero-strength grade emits nothing', gradeFilters('teal_orange', 0) === '');
  runner.check('the neutral grade emits nothing', gradeFilters('none', 1) === '');
  const half = gradeFilters('teal_orange', 0.5);
  const full = gradeFilters('teal_orange', 1);
  runner.check('strength changes the emitted parameters', half !== full && half.length > 0, half);

  runner.section('Subtitle building');

  runner.check('ASS timestamps use centiseconds', assTime(3_661_230) === '1:01:01.23', assTime(3_661_230));
  // ASS colours are &HAABBGGRR with inverted alpha, i.e. byte-reversed from CSS.
  runner.check('a hex colour becomes BGR with inverted alpha', hexToAssColor('#FFE81F') === '&H001FE8FF', hexToAssColor('#FFE81F'));
  runner.check('opacity 0 means fully transparent in ASS', hexToAssColor('#000000', 0) === '&HFF000000', hexToAssColor('#000000', 0));

  const config = baseProject().subtitle as SubtitleConfig;
  const cues = groupWordsIntoCues(TRANSCRIPT.words, config);
  runner.check('words are grouped into cues', cues.length > 1, `${cues.length} cues`);
  runner.check(
    'cues stay in order and never overlap',
    cues.every((cue, index) => cue.endMs > cue.startMs && (index === 0 || cue.startMs >= cues[index - 1].startMs))
  );
  runner.check(
    'no cue exceeds the word limit',
    cues.every((cue) => cue.words.length <= config.maxWordsPerLine * 2)
  );

  // Captions are positioned with \pos, which disables ASS margins — the only
  // thing keeping text inside the frame is this calculation.
  runner.check(
    'a bigger font fits fewer characters',
    fittingCharsPerLine(1080, 80, true) > fittingCharsPerLine(1080, 160, true),
    `${fittingCharsPerLine(1080, 80, true)} vs ${fittingCharsPerLine(1080, 160, true)}`
  );

  const words: Word[] = [{ text: 'birinchi', startMs: 0, endMs: 400 }, { text: 'ikkinchi', startMs: 400, endMs: 900 }];
  const ass = buildAss({ words, config: { ...config, enabled: true, karaoke: true }, width: 1080, height: 1920 });
  runner.check('the ASS file declares the video resolution', ass.includes('PlayResX: 1080') && ass.includes('PlayResY: 1920'));
  runner.check(
    'karaoke emits one event per spoken word',
    ass.split('\n').filter((line) => line.startsWith('Dialogue:')).length === words.length,
    `${ass.split('\n').filter((line) => line.startsWith('Dialogue:')).length} events`
  );
  runner.check(
    'the active word carries a colour override and a reset',
    ass.includes('\\1c') && ass.includes('{\\r}')
  );
}

/**
 * The live preview reimplements the renderer's geometry on the GPU. These check
 * the two stay in agreement — a preview that lies about the crop or the caption
 * timing is worse than no preview.
 */
export function runPreviewTests(runner: Runner): void {
  runner.section('Preview geometry');

  // 16:9 source into a 9:16 frame: cropping must overflow the sides, fitting
  // must letterbox instead.
  const cropped = fitRect(1920, 1080, 1080, 1920, 'crop');
  runner.check(
    'crop fills the frame and overflows horizontally',
    Math.round(cropped.height) === 1920 && cropped.width > 1080 && cropped.x < 0,
    `${Math.round(cropped.width)}x${Math.round(cropped.height)} at x=${Math.round(cropped.x)}`
  );

  const fitted = fitRect(1920, 1080, 1080, 1920, 'fit');
  runner.check(
    'fit keeps the whole picture inside the frame',
    Math.round(fitted.width) === 1080 && fitted.height < 1920 && fitted.y > 0,
    `${Math.round(fitted.width)}x${Math.round(fitted.height)} at y=${Math.round(fitted.y)}`
  );

  runner.check('no letterbox below the threshold', letterboxBarHeight(0.005, 1920) === 0);
  runner.check(
    'letterbox bars take half the requested share each',
    letterboxBarHeight(0.2, 1920) === 192,
    String(letterboxBarHeight(0.2, 1920))
  );

  runner.section('Preview motion');

  runner.check('zoom is inert when disabled', zoomScaleAt({ mode: 'none', amount: 0.2, ms: 500, totalMs: 5000 }) === 1);
  const zoomStart = zoomScaleAt({ mode: 'in', amount: 0.2, ms: 0, totalMs: 5000 });
  const zoomEnd = zoomScaleAt({ mode: 'in', amount: 0.2, ms: 5000, totalMs: 5000 });
  runner.check(
    'zoom in walks from 1 to 1+amount',
    Math.abs(zoomStart - 1) < 0.001 && Math.abs(zoomEnd - 1.2) < 0.001,
    `${zoomStart.toFixed(3)} → ${zoomEnd.toFixed(3)}`
  );
  const pulse = zoomScaleAt({ mode: 'pulse', amount: 0.1, ms: 2000, totalMs: 8000, beats: [2000, 4000] });
  runner.check('a beat pulse peaks on the beat', Math.abs(pulse - 1.1) < 0.01, pulse.toFixed(3));

  runner.check('fades reach zero at the very edges', fadeOpacityAt(500, 500, 0, 5000) === 0);
  runner.check('fades are fully open in the middle', fadeOpacityAt(500, 500, 2500, 5000) === 1);

  runner.section('Preview captions');

  const words = [
    { text: 'bir', startMs: 0, endMs: 400 },
    { text: 'ikki', startMs: 400, endMs: 900 },
    { text: 'uch', startMs: 900, endMs: 1400 },
  ];
  const cues = [{ startMs: 0, endMs: 1400, words, breaks: [] }];

  runner.check('the first word is active at the start', captionAt(cues, 100, true)?.activeWordIndex === 0);
  runner.check('the middle word is active mid-cue', captionAt(cues, 600, true)?.activeWordIndex === 1);
  runner.check('nothing is highlighted when karaoke is off', captionAt(cues, 600, false)?.activeWordIndex === -1);
  runner.check('no caption outside the cue', captionAt(cues, 2000, true) === null);

  runner.section('Preview overlays');

  const overlay: ImageOverlay = {
    id: 'o', uri: 'x', startMs: 1000, endMs: 3000,
    phrase: '', prompt: '', style: 'cutaway', animation: 'fade', opacity: 1,
  };
  runner.check('an overlay is invisible before its moment', overlayOpacityAt(overlay, 500) === 0);
  runner.check('an overlay is fully visible mid-span', overlayOpacityAt(overlay, 2000) === 1);
  runner.check(
    'an overlay fades in rather than popping',
    overlayOpacityAt(overlay, 1050) > 0 && overlayOpacityAt(overlay, 1050) < 1,
    overlayOpacityAt(overlay, 1050).toFixed(3)
  );

  const cutaway = overlayRect(overlay, 1080, 1920, 1024, 1024);
  runner.check(
    'a cutaway is centred and stays clear of the caption area',
    Math.abs(cutaway.x + cutaway.width / 2 - 540) < 1 && cutaway.y + cutaway.height < 1920 * 0.75,
    `y=${Math.round(cutaway.y)} h=${Math.round(cutaway.height)}`
  );

  const corner = overlayRect({ ...overlay, style: 'corner' }, 1080, 1920, 1024, 576);
  runner.check(
    'a corner overlay hugs the top right',
    corner.x + corner.width < 1080 && corner.x > 540,
    `x=${Math.round(corner.x)} w=${Math.round(corner.width)}`
  );

  runner.section('Preview colour');

  runner.check('a neutral grade needs no matrix', gradeColorMatrix('none', 1) === null);
  const matrix = gradeColorMatrix('teal_orange', 1);
  runner.check('a grade produces a 4x5 matrix', matrix?.length === 20, String(matrix?.length));
  const mono = gradeColorMatrix('bw', 1);
  runner.check(
    'monochrome collapses the channels onto luma',
    Boolean(mono && Math.abs(mono[0] - mono[1]) < 0.9 && mono[0] > 0 && mono[1] > 0),
    mono ? mono.slice(0, 3).join(', ') : 'null'
  );

  runner.section('Preview clock');

  const timeline = buildTimeline(
    [
      { id: 'a', startMs: 1000, endMs: 3000, speed: 1 },
      { id: 'b', startMs: 8000, endMs: 10_000, speed: 2 },
    ],
    0
  );
  runner.check(
    'output time maps back into the first segment',
    outputToSource(timeline, 500)?.sourceMs === 1500,
    String(outputToSource(timeline, 500)?.sourceMs)
  );
  runner.check(
    'output time maps back through a speed change',
    outputToSource(timeline, 2500)?.sourceMs === 9000,
    String(outputToSource(timeline, 2500)?.sourceMs)
  );
  runner.check('past the end maps to nothing', outputToSource(timeline, 99_999) === null);
}
