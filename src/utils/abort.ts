/**
 * `AbortSignal.prototype.throwIfAborted` does not exist here.
 *
 * React Native ships an older AbortController polyfill: the signal itself and
 * `addEventListener` are there, but the convenience methods added to the spec
 * later — `throwIfAborted`, `AbortSignal.timeout`, `AbortSignal.any` — are not.
 * Calling one is not a no-op, it is a TypeError, which in a release build means
 * every long-running job dies with "undefined is not a function" before it has
 * done anything.
 */
export function throwIfAborted(signal?: AbortSignal | null): void {
  if (!signal?.aborted) return;
  const reason = (signal as { reason?: unknown }).reason;
  if (reason instanceof Error) throw reason;
  throw abortError();
}

/** The DOMException browsers throw, in the shape this app can recognise. */
export function abortError(message = 'To‘xtatildi'): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
