import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const testsDir = path.dirname(fileURLToPath(import.meta.url));
export const fixturesDir = path.join(testsDir, '.fixtures');
export const outputDir = path.join(testsDir, '.output');

/**
 * These tests drive a real ffmpeg, because the thing under test *is* a set of
 * ffmpeg command lines — a mocked runner would only prove the strings match
 * themselves. Any build with libass, libx264/265, libmp3lame and vid.stab works.
 */
export function ffmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const which = spawnSync('which', ['ffmpeg'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  throw new Error(
    'ffmpeg not found. Install it, or set FFMPEG_PATH to a build with libass and libx264.'
  );
}

export function ffmpeg(args: string[]): { ok: boolean; stderr: string } {
  const result = spawnSync(ffmpegPath(), args, { maxBuffer: 64 * 1024 * 1024, timeout: 300_000 });
  return { ok: result.status === 0, stderr: (result.stderr ?? Buffer.from('')).toString() };
}

/** Runs ffmpeg and throws with the tail of stderr, which is where the reason lives. */
export function ffmpegOrThrow(args: string[]): string {
  const { ok, stderr } = ffmpeg(args);
  if (!ok) throw new Error(stderr.trim().split('\n').slice(-6).join('\n'));
  return stderr;
}

export function ensureFixtures(): {
  source: string;
  silentVertical: string;
  music: string;
  images: string[];
} {
  fs.mkdirSync(fixturesDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const source = path.join(fixturesDir, 'source.mp4');
  const silentVertical = path.join(fixturesDir, 'silent_vertical.mp4');
  const music = path.join(fixturesDir, 'music.mp3');

  if (!fs.existsSync(source)) {
    // Talking-head stand-in: a 300 Hz tone gated off for 1.8 s in every 5 s
    // window, which gives silencedetect something real to find.
    ffmpegOrThrow([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=12',
      '-f', 'lavfi', '-i', "aevalsrc='0.35*sin(2*PI*300*t)*lt(mod(t,5),3.2)':s=48000:d=12",
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
      source,
    ]);
  }

  if (!fs.existsSync(silentVertical)) {
    ffmpegOrThrow([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30:duration=8',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      silentVertical,
    ]);
  }

  if (!fs.existsSync(music)) {
    ffmpegOrThrow([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=180:duration=20',
      '-c:a', 'libmp3lame', '-b:a', '128k',
      music,
    ]);
  }

  // Stand-ins for AI-generated illustrations: flat colour cards, each a
  // different size so the overlay geometry has to actually do its scaling.
  const images = ['illustration_a.png', 'illustration_b.png', 'illustration_c.png'].map(
    (name, index) => {
      const file = path.join(fixturesDir, name);
      if (!fs.existsSync(file)) {
        const size = [`1024x1024`, `768x1024`, `1024x576`][index];
        const colour = ['crimson', 'teal', 'goldenrod'][index];
        ffmpegOrThrow([
          '-hide_banner', '-loglevel', 'error', '-y',
          '-f', 'lavfi', '-i', `color=c=${colour}:s=${size}`,
          '-frames:v', '1',
          file,
        ]);
      }
      return file;
    }
  );

  return { source, silentVertical, music, images };
}

export type MediaFacts = {
  durationMs: number;
  integratedLufs: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
  width: number;
  height: number;
};

export function inspect(file: string): MediaFacts {
  const { stderr } = ffmpeg(['-hide_banner', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-']);

  const duration = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  const durationMs = duration
    ? (Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])) * 1000
    : 0;

  // Only the input block describes the file; ffmpeg also prints its own output streams.
  const outputIndex = stderr.indexOf('Output #0');
  const inputBlock = stderr.slice(0, outputIndex === -1 ? stderr.length : outputIndex);
  const size = inputBlock.match(/Video: .*?, (\d+)x(\d+)/);

  const summaryIndex = stderr.lastIndexOf('Integrated loudness');
  const lufs = summaryIndex === -1 ? null : stderr.slice(summaryIndex).match(/I:\s*(-?[\d.]+)\s*LUFS/);

  return {
    durationMs,
    integratedLufs: lufs ? Number(lufs[1]) : null,
    hasVideo: /Stream #0:\d+.*: Video:/.test(inputBlock),
    hasAudio: /Stream #0:\d+.*: Audio:/.test(inputBlock),
    width: size ? Number(size[1]) : 0,
    height: size ? Number(size[2]) : 0,
  };
}

/** Integrated loudness over a time window, used to check ducking and fades. */
export function loudnessBetween(file: string, fromSec: number, toSec: number): number | null {
  const { stderr } = ffmpeg([
    '-hide_banner', '-ss', String(fromSec), '-to', String(toSec), '-i', file,
    '-af', 'ebur128', '-f', 'null', '-',
  ]);
  const index = stderr.lastIndexOf('Integrated loudness');
  if (index === -1) return null;
  const match = stderr.slice(index).match(/I:\s*(-?[\d.]+)\s*LUFS/);
  return match ? Number(match[1]) : null;
}

export class Runner {
  private passed = 0;
  private failed = 0;
  private readonly failures: string[] = [];

  check(name: string, ok: boolean, detail = ''): void {
    if (ok) {
      this.passed += 1;
      console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`);
    } else {
      this.failed += 1;
      this.failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
      console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
    }
  }

  section(title: string): void {
    console.log(`\n${title}`);
  }

  report(): number {
    console.log(`\n${this.passed} passed, ${this.failed} failed`);
    if (this.failures.length) {
      console.log('\nFailures:');
      for (const failure of this.failures) console.log(`  - ${failure}`);
    }
    return this.failed;
  }
}
