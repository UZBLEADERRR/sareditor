export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function formatTimecode(ms: number, withMs = false): string {
  const safe = Math.max(0, Math.round(ms));
  const totalSeconds = Math.floor(safe / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number, size = 2) => String(n).padStart(size, '0');
  const base = hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
  return withMs ? `${base}.${pad(safe % 1000, 3)}` : base;
}

/** ffmpeg wants seconds with a dot, never a locale comma. */
export function toFfmpegSeconds(ms: number, decimals = 3): string {
  return (Math.max(0, ms) / 1000).toFixed(decimals);
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

/** `#RRGGBB` -> ASS `&HAABBGGRR&` (ASS alpha is inverted: 00 = opaque). */
export function hexToAssColor(hex: string, alpha = 1): string {
  const clean = hex.replace('#', '').trim();
  const full = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean.padEnd(6, '0').slice(0, 6);
  const r = full.slice(0, 2);
  const g = full.slice(2, 4);
  const b = full.slice(4, 6);
  const a = Math.round((1 - clamp(alpha, 0, 1)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `&H${a}${b}${g}${r}`.toUpperCase();
}

/** Linear interpolation used to scale grading presets by a 0..1 strength. */
export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * clamp(t, 0, 1);
}

export function round(value: number, decimals = 3): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** ffmpeg's H.264 encoders need even dimensions. */
export function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}
