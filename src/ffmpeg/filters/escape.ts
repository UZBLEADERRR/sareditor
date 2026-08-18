/**
 * ffmpeg parses a filtergraph in two passes, so any literal that reaches a
 * filter argument has to survive both. These helpers keep generated paths and
 * expressions from breaking the graph.
 */

/** Escapes a value used as a filter option (level 2 + level 1). */
export function escapeFilterValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

/** Escapes a filesystem path for `ass=`, `subtitles=`, `movie=` and friends. */
export function escapeFilterPath(path: string): string {
  return escapeFilterValue(path);
}

/**
 * Generated working files are named through this so escaping never has to do
 * any real work — the safest quoting is the quoting you do not need.
 */
export function safeFileName(name: string, fallback = 'file'): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return cleaned || fallback;
}

/** Joins filter descriptions into one chain, dropping the no-op entries. */
export function chain(...filters: (string | null | undefined | false)[]): string {
  return filters.filter((f): f is string => Boolean(f)).join(',');
}
