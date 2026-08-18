const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * React Native has no Buffer, and its `atob` mangles bytes above 0x7F, so
 * binary payloads from an API are decoded straight into a Uint8Array here.
 */
export function decodeBase64(input: string): Uint8Array {
  const clean = input.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));

  let byteIndex = 0;
  let accumulator = 0;
  let bits = 0;

  for (const character of clean) {
    const value = ALPHABET.indexOf(character);
    if (value === -1) continue;
    accumulator = (accumulator << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[byteIndex++] = (accumulator >> bits) & 0xff;
    }
  }

  return bytes.subarray(0, byteIndex);
}

/**
 * Wraps raw PCM in a WAV header.
 *
 * Some speech APIs return headerless little-endian PCM, which no decoder will
 * touch; 44 bytes of header turns it into a file ffmpeg can mix.
 */
export function pcmToWav(pcm: Uint8Array, sampleRate: number, channels = 1, bitsPerSample = 16): Uint8Array {
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const out = new Uint8Array(44 + pcm.length);
  const view = new DataView(out.buffer);

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) out[offset + i] = text.charCodeAt(i);
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  ascii(36, 'data');
  view.setUint32(40, pcm.length, true);
  out.set(pcm, 44);

  return out;
}

/** Reads the sample rate out of a `audio/L16;codec=pcm;rate=24000` style mime. */
export function sampleRateFromMime(mime: string | undefined, fallback = 24000): number {
  const match = /rate=(\d+)/.exec(mime ?? '');
  return match ? Number(match[1]) : fallback;
}
