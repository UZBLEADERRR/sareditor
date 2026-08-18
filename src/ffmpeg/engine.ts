import type { EventSubscription } from 'expo-modules-core';

import SarFFmpeg, { type DeviceInfo, type FFmpegProgress, type FFmpegResult } from '../../modules/ffmpeg';
import { fontsDir, toNativePath } from '../utils/paths';
import { uid } from '../utils/id';

export type RunOptions = {
  /** Stable id so the run can be cancelled and progress attributed correctly. */
  key?: string;
  /** Expected output duration; drives the 0..1 progress fraction. */
  totalMs?: number;
  onProgress?: (progress: FFmpegProgress) => void;
};

export class FFmpegError extends Error {
  readonly logs: string;
  readonly returnCode: number;

  constructor(message: string, result: FFmpegResult) {
    super(message);
    this.name = 'FFmpegError';
    this.logs = result.logs;
    this.returnCode = result.returnCode;
  }
}

export class CancelledError extends Error {
  constructor() {
    super('Render bekor qilindi');
    this.name = 'CancelledError';
  }
}

/**
 * Runs one ffmpeg command and resolves with its logs.
 *
 * Failures throw with the tail of stderr attached, because that is where every
 * useful ffmpeg diagnostic lives (missing codec, bad filter syntax, no space).
 */
export async function run(args: string[], options: RunOptions = {}): Promise<FFmpegResult> {
  const key = options.key ?? uid('run_');
  let subscription: EventSubscription | undefined;

  if (options.onProgress) {
    subscription = SarFFmpeg.addListener('onProgress', (event) => {
      if (event.key === key) options.onProgress?.(event);
    });
  }

  try {
    const result = await SarFFmpeg.run(key, args, options.totalMs ?? 0);
    if (result.cancelled) throw new CancelledError();
    if (!result.success) {
      throw new FFmpegError(extractFfmpegError(result.logs) ?? 'FFmpeg xatolik bilan tugadi', result);
    }
    return result;
  } finally {
    subscription?.remove();
  }
}

/** Same as `run`, but a non-zero exit is returned instead of thrown. */
export async function tryRun(args: string[], options: RunOptions = {}): Promise<FFmpegResult> {
  const key = options.key ?? uid('run_');
  let subscription: EventSubscription | undefined;
  if (options.onProgress) {
    subscription = SarFFmpeg.addListener('onProgress', (event) => {
      if (event.key === key) options.onProgress?.(event);
    });
  }
  try {
    return await SarFFmpeg.run(key, args, options.totalMs ?? 0);
  } finally {
    subscription?.remove();
  }
}

export async function cancel(key: string): Promise<void> {
  try {
    await SarFFmpeg.cancel(key);
  } catch {
    // Nothing running under that key — cancelling twice is not an error.
  }
}

export async function cancelAll(): Promise<void> {
  await SarFFmpeg.cancelAll();
}

export type MediaInfo = {
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  rotation: number;
  hasAudio: boolean;
  hasVideo: boolean;
  videoCodec?: string;
  audioCodec?: string;
  audioSampleRate?: number;
  bitrate: number;
  sizeBytes: number;
};

/** ffprobe wrapper that normalises the handful of fields the editor cares about. */
export async function probe(pathOrUri: string): Promise<MediaInfo> {
  const result = await SarFFmpeg.probe(toNativePath(pathOrUri));
  if (!result.ok || !result.json) {
    throw new Error('Fayl o‘qib bo‘lmadi. Format qo‘llab-quvvatlanmasligi mumkin.');
  }
  const info = JSON.parse(result.json) as Record<string, any>;
  const streams: Record<string, any>[] = info.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');

  const rotation = readRotation(video);
  const rotated = rotation === 90 || rotation === 270;
  const rawWidth = Number(video?.width ?? 0);
  const rawHeight = Number(video?.height ?? 0);

  return {
    durationMs: Math.round(Number(info.format?.duration ?? video?.duration ?? 0) * 1000),
    width: rotated ? rawHeight : rawWidth,
    height: rotated ? rawWidth : rawHeight,
    fps: parseFrameRate(video?.r_frame_rate ?? video?.avg_frame_rate),
    rotation,
    hasAudio: Boolean(audio),
    hasVideo: Boolean(video),
    videoCodec: video?.codec_name,
    audioCodec: audio?.codec_name,
    audioSampleRate: audio ? Number(audio.sample_rate) : undefined,
    bitrate: Number(info.format?.bit_rate ?? 0),
    sizeBytes: Number(info.format?.size ?? 0),
  };
}

function parseFrameRate(value?: string): number {
  if (!value) return 30;
  const [num, den] = value.split('/').map(Number);
  if (!den) return num || 30;
  const fps = num / den;
  return Number.isFinite(fps) && fps > 0 ? Math.round(fps * 1000) / 1000 : 30;
}

function readRotation(video?: Record<string, any>): number {
  if (!video) return 0;
  const tagRotate = Number(video.tags?.rotate ?? 0);
  if (tagRotate) return ((tagRotate % 360) + 360) % 360;
  const displayMatrix = (video.side_data_list ?? []).find(
    (d: Record<string, any>) => d.rotation !== undefined
  );
  if (displayMatrix) {
    const value = Number(displayMatrix.rotation);
    return ((Math.round(-value) % 360) + 360) % 360;
  }
  return 0;
}

/**
 * ffmpeg reports the real reason on one of the last few stderr lines; the rest is
 * banner noise. Surfacing that line makes failures debuggable from the phone.
 */
export function extractFfmpegError(logs: string): string | null {
  if (!logs) return null;
  const interesting = logs
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !line.startsWith('frame=') &&
        !line.startsWith('size=') &&
        (/error|invalid|failed|no such file|not found|unable|cannot|denied|unsupported/i.test(line))
    );
  return interesting.length ? interesting[interesting.length - 1].slice(0, 400) : null;
}

let fontsRegistered = false;

/**
 * Points libass/fontconfig at the Android system fonts plus anything the user
 * imported. Without this, burned-in subtitles silently fall back to a default
 * face or fail to render non-Latin glyphs.
 */
export async function registerFonts(mapping: Record<string, string> = {}): Promise<string[]> {
  const dirs = ['/system/fonts', toNativePath(fontsDir().uri)];
  const registered = await SarFFmpeg.registerFontDirectories(dirs, mapping);
  fontsRegistered = true;
  return registered;
}

export function areFontsRegistered(): boolean {
  return fontsRegistered;
}

export function deviceInfo(): DeviceInfo {
  return SarFFmpeg.deviceInfo();
}

export type { FFmpegProgress, FFmpegResult };
