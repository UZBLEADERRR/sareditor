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
  deviceInfo(): DeviceInfo;
}

export default requireNativeModule<SarFFmpegModule>('SarFFmpeg');
