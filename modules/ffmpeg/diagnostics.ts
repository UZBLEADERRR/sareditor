import { requireOptionalNativeModule } from 'expo';

export type DiagnosticsDeviceInfo = {
  manufacturer: string;
  model: string;
  androidRelease: string;
  sdkInt: number;
  abis: string[];
  /** 4096 on most phones, 16384 on Android 15+ devices built for 16 KB pages. */
  pageSizeBytes: number;
  totalMemMb: number;
  availMemMb: number;
  lowMemory: boolean;
};

type SarDiagnosticsModule = {
  trace(message: string): void;
  previousTrace(): string;
  currentTrace(): string;
  deviceInfo(): DiagnosticsDeviceInfo;
};

/**
 * Optional on purpose: an APK built before this module existed should still
 * run, it just cannot report anything.
 */
export default requireOptionalNativeModule<SarDiagnosticsModule>('SarDiagnostics');
