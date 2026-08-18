import { assTime, buildAss, fittingCharsPerLine, groupWordsIntoCues } from '../src/ffmpeg/subtitles';
import { chain, escapeFilterValue, safeFileName } from '../src/ffmpeg/filters/escape';
import { atempoChain } from '../src/ffmpeg/filters/audio';
import { buildTimeline, invertSegments, mapWordsToTimeline, sourceToOutput } from '../src/ffmpeg/timeline';
import { gradeFilters } from '../src/ffmpeg/filters/grade';
import { hexToAssColor } from '../src/utils/format';
import type { Segment, SubtitleConfig, Word } from '../src/types/project';
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
