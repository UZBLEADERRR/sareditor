import type { AspectId, EncoderId, ExportConfig, PlatformId } from '../types/project';

export const ASPECT_SIZES: Record<AspectId, { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '4:5': { width: 1080, height: 1350 },
  '1:1': { width: 1080, height: 1080 },
  '16:9': { width: 1920, height: 1080 },
};

export const ASPECT_RATIOS: Record<AspectId, number> = {
  '9:16': 9 / 16,
  '4:5': 4 / 5,
  '1:1': 1,
  '16:9': 16 / 9,
};

export type PlatformPreset = {
  id: PlatformId;
  label: string;
  hint: string;
  aspect: AspectId;
  fps: number;
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  /** Platform loudness target in LUFS. */
  targetLufs: number;
  maxDurationMs: number;
};

/**
 * Bitrates sit at the upper end of what each platform accepts without extra
 * re-compression, which is the single biggest lever on perceived quality.
 */
export const PLATFORM_PRESETS: Record<PlatformId, PlatformPreset> = {
  instagram_reels: {
    id: 'instagram_reels',
    label: 'Instagram Reels',
    hint: '9:16 · 90 soniyagacha',
    aspect: '9:16',
    fps: 30,
    videoBitrateKbps: 12000,
    audioBitrateKbps: 192,
    targetLufs: -14,
    maxDurationMs: 90_000,
  },
  instagram_feed: {
    id: 'instagram_feed',
    label: 'Instagram Feed',
    hint: '4:5 · lentada eng katta joy',
    aspect: '4:5',
    fps: 30,
    videoBitrateKbps: 10000,
    audioBitrateKbps: 192,
    targetLufs: -14,
    maxDurationMs: 600_000,
  },
  tiktok: {
    id: 'tiktok',
    label: 'TikTok',
    hint: '9:16 · 10 daqiqagacha',
    aspect: '9:16',
    fps: 30,
    videoBitrateKbps: 12000,
    audioBitrateKbps: 192,
    targetLufs: -14,
    maxDurationMs: 600_000,
  },
  youtube_shorts: {
    id: 'youtube_shorts',
    label: 'YouTube Shorts',
    hint: '9:16 · 3 daqiqagacha',
    aspect: '9:16',
    fps: 30,
    videoBitrateKbps: 14000,
    audioBitrateKbps: 192,
    targetLufs: -14,
    maxDurationMs: 180_000,
  },
  youtube: {
    id: 'youtube',
    label: 'YouTube',
    hint: '16:9 · uzun format',
    aspect: '16:9',
    fps: 30,
    videoBitrateKbps: 16000,
    audioBitrateKbps: 256,
    targetLufs: -14,
    maxDurationMs: 3_600_000,
  },
};

export const PLATFORM_ORDER: PlatformId[] = [
  'instagram_reels',
  'tiktok',
  'youtube_shorts',
  'instagram_feed',
  'youtube',
];

export function exportConfigFor(platform: PlatformId, encoder: EncoderId = 'hardware'): ExportConfig {
  const preset = PLATFORM_PRESETS[platform];
  const size = ASPECT_SIZES[preset.aspect];
  return {
    platform,
    aspect: preset.aspect,
    width: size.width,
    height: size.height,
    fps: preset.fps,
    videoBitrateKbps: preset.videoBitrateKbps,
    audioBitrateKbps: preset.audioBitrateKbps,
    encoder,
  };
}

export type EncoderOption = {
  id: EncoderId;
  label: string;
  hint: string;
};

export const ENCODER_OPTIONS: EncoderOption[] = [
  {
    id: 'hardware',
    label: 'Tezkor (HW)',
    hint: 'Telefon chipidagi koder — 3-6x tez, batareya kam yeydi',
  },
  {
    id: 'x264',
    label: 'Sifatli (x264)',
    hint: 'Eng barqaror sifat, sekinroq. Instagram uchun tavsiya etiladi',
  },
  {
    id: 'x265',
    label: 'HEVC (x265)',
    hint: 'Bir xil sifatda ~35% kichik fayl, eng sekin',
  },
];

/**
 * Output codec arguments. Hardware encoding goes through Android MediaCodec, so
 * it needs a plain bitrate target; the software encoders get CRF-style quality
 * with a bitrate ceiling instead.
 */
export function encoderArgs(config: ExportConfig): string[] {
  const bitrate = `${config.videoBitrateKbps}k`;
  const maxrate = `${Math.round(config.videoBitrateKbps * 1.35)}k`;
  const bufsize = `${Math.round(config.videoBitrateKbps * 2)}k`;

  switch (config.encoder) {
    case 'hardware':
      return [
        '-c:v', 'h264_mediacodec',
        '-b:v', bitrate,
        '-maxrate', maxrate,
        '-bufsize', bufsize,
        '-g', String(config.fps * 2),
      ];
    case 'x265':
      return [
        '-c:v', 'libx265',
        '-preset', 'medium',
        '-crf', '24',
        '-maxrate', maxrate,
        '-bufsize', bufsize,
        '-tag:v', 'hvc1',
        '-g', String(config.fps * 2),
      ];
    case 'x264':
    default:
      return [
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '20',
        '-profile:v', 'high',
        '-level', '4.2',
        '-maxrate', maxrate,
        '-bufsize', bufsize,
        '-g', String(config.fps * 2),
        '-bf', '2',
      ];
  }
}

export function audioEncoderArgs(config: ExportConfig): string[] {
  return ['-c:a', 'aac', '-b:a', `${config.audioBitrateKbps}k`, '-ar', '48000', '-ac', '2'];
}

export function containerArgs(): string[] {
  return ['-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-map_metadata', '-1'];
}
