import { clamp, round } from '../../utils/format';

/**
 * `atempo` only accepts 0.5..100 in a single pass, so slower-than-half speeds
 * have to be reached by chaining stages.
 */
export function atempoChain(speed: number): string {
  const target = clamp(speed, 0.05, 16);
  if (Math.abs(target - 1) < 0.001) return '';
  const stages: number[] = [];
  let remaining = target;
  while (remaining < 0.5) {
    stages.push(0.5);
    remaining /= 0.5;
  }
  while (remaining > 2) {
    stages.push(2);
    remaining /= 2;
  }
  stages.push(remaining);
  return stages.map((s) => `atempo=${round(s, 5)}`).join(',');
}

/**
 * Speech cleanup: cut rumble, tame hiss, even out the level, and lift the
 * presence band so a phone-mic voice cuts through background music.
 */
export function voiceEnhanceFilters(): string {
  return [
    'highpass=f=85',
    'lowpass=f=13000',
    'afftdn=nf=-24:nt=w',
    'acompressor=threshold=0.08:ratio=3:attack=8:release=180:makeup=2',
    'equalizer=f=3000:t=q:w=1.4:g=2.5',
    'equalizer=f=180:t=q:w=1.0:g=-1.5',
  ].join(',');
}

export function volumeFilter(db: number): string {
  if (Math.abs(db) < 0.05) return '';
  return `volume=${round(db, 2)}dB`;
}

/**
 * Sidechain ducking: the music is the main input, the voice is the detector.
 * Whenever someone speaks the track drops, then recovers over ~350 ms.
 */
export function duckFilter(duckAmountDb: number): string {
  const ratio = clamp(duckAmountDb / 2, 2, 20);
  return `sidechaincompress=threshold=0.035:ratio=${round(ratio, 2)}:attack=18:release=340:makeup=1:detection=rms`;
}

/** Single-pass EBU R128 normalisation to the platform's target loudness. */
export function loudnormFilter(targetLufs: number): string {
  return `loudnorm=I=${round(clamp(targetLufs, -30, -8), 1)}:TP=-1.0:LRA=11`;
}

/** Keeps a peak from ever clipping after the mix, which phones make very audible. */
export function limiterFilter(): string {
  return 'alimiter=level_in=1:level_out=0.97:limit=0.97:attack=5:release=50';
}

export function resampleFilter(): string {
  return 'aresample=48000:async=1:first_pts=0';
}
