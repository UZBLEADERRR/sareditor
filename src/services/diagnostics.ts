import Diagnostics, { type DiagnosticsDeviceInfo } from '../../modules/ffmpeg/diagnostics';

/**
 * Breadcrumbs.
 *
 * The editor touches a lot of native code on the way from "user picked a file"
 * to "first frame on screen" — ffprobe, an ffmpeg transcode, MediaMetadata\
 * Retriever, a MediaCodec decode inside Skia. When one of those takes the
 * process down there is no stack trace and no red box, only a launcher and a
 * system dialog. Dropping a breadcrumb before and after each step turns that
 * into a readable "got this far" on the next launch.
 *
 * Calls are synchronous and cheap (one line appended and flushed), and never
 * throw — a diagnostic that can fail the thing it is watching is worse than no
 * diagnostic at all.
 */
export function trace(message: string): void {
  try {
    Diagnostics?.trace(message);
  } catch {
    // ignored on purpose
  }
}

/** Wraps a step so both its start and its outcome are recorded. */
export async function traced<T>(label: string, run: () => Promise<T>): Promise<T> {
  trace(`${label} →`);
  const startedAt = Date.now();
  try {
    const value = await run();
    trace(`${label} ✓ ${Date.now() - startedAt}ms`);
    return value;
  } catch (error) {
    trace(`${label} ✗ ${describe(error)}`);
    throw error;
  }
}

/** The log written by the session before this one — empty on a first launch. */
export function previousTrace(): string {
  try {
    return Diagnostics?.previousTrace() ?? '';
  } catch {
    return '';
  }
}

export function currentTrace(): string {
  try {
    return Diagnostics?.currentTrace() ?? '';
  } catch {
    return '';
  }
}

export function deviceInfo(): DiagnosticsDeviceInfo | null {
  try {
    return Diagnostics?.deviceInfo() ?? null;
  } catch {
    return null;
  }
}

/**
 * A session that ended the way sessions are supposed to end writes this before
 * going away, so the next launch can tell a crash from a normal close.
 */
export const CLEAN_MARKER = 'session-parked';

export function markClean(): void {
  trace(CLEAN_MARKER);
}

/**
 * True when the previous session left breadcrumbs that stop mid-step: either an
 * uncaught exception was recorded, or the log simply ends without the app ever
 * having been backgrounded.
 */
export function previousSessionCrashed(log: string): boolean {
  if (!log.trim()) return false;
  if (log.includes('FATAL')) return true;
  const lines = log.trimEnd().split('\n');
  const last = lines[lines.length - 1] ?? '';
  return !last.includes(CLEAN_MARKER);
}

export function describe(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ''}`;
  }
  return String(error);
}
