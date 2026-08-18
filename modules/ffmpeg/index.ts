import { NativeModule, requireNativeModule } from 'expo';

export type FFmpegProgress = {
  key: string;
  /** Position inside the *output* timeline, in milliseconds. */
  timeMs: number;
  /** 0..1, only meaningful when a total duration was passed to `run`. */
  progress: number;
  speed: number;
  fps: number;
  frame: number;
  bitrate: number;
  sizeBytes: number;
};

export type FFmpegResult = {
  returnCode: number;
  success: boolean;
  cancelled: boolean;
  state: string;
  durationMs: number;
  /** Tail of ffmpeg's stderr — parsed for silencedetect / blackdetect / errors. */
  logs: string;
  failStackTrace: string;
};

export type ProbeResult = { ok: boolean; json: string; logs: string };

export type DeviceVoice = {
  id: string;
  language: string;
  /** Android's own 1-500 quality score; higher is better. */
  quality: number;
  networkRequired: boolean;
};

export type SynthesisResult = {
  path: string;
  sizeBytes: number;
};

export type DeviceInfo = {
  abis: string[];
  sdkInt: number;
  model: string;
  cores: number;
};

type FFmpegModuleEvents = {
  onProgress: (event: FFmpegProgress) => void;
};

declare class SarFFmpegModule extends NativeModule<FFmpegModuleEvents> {
  run(key: string, args: string[], totalMs: number): Promise<FFmpegResult>;
  cancel(key: string): Promise<boolean>;
  cancelAll(): Promise<boolean>;
  probe(path: string): Promise<ProbeResult>;
  registerFontDirectories(dirs: string[], mapping: Record<string, string>): Promise<string[]>;
  listSpeechVoices(): Promise<DeviceVoice[]>;
  synthesizeSpeech(
    text: string,
    voiceId: string | null,
    language: string | null,
    outputPath: string
  ): Promise<SynthesisResult>;
  deviceInfo(): DeviceInfo;
}

export default requireNativeModule<SarFFmpegModule>('SarFFmpeg');
