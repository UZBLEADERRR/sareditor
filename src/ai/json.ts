/**
 * Models wrap JSON in prose or fences often enough that a bare `JSON.parse`
 * is not a safe contract, especially when the user points the app at an
 * arbitrary OpenAI-compatible gateway.
 */
export function extractJson<T>(raw: string): T {
  const trimmed = raw.trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(candidate) as T;
  } catch {
    // Fall through to the brace-scan below.
  }

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start !== -1 && end > start) {
    const slice = candidate.slice(start, end + 1);
    try {
      return JSON.parse(slice) as T;
    } catch {
      // Last resort: strip trailing commas, which is by far the most common
      // malformation in generated JSON.
      return JSON.parse(slice.replace(/,(\s*[}\]])/g, '$1')) as T;
    }
  }

  throw new Error('Javobdan JSON ajratib bo‘lmadi');
}
