import type { ZoomMode } from '../../types/project';
import { clamp, even, round } from '../../utils/format';

const MAX_PULSE_BEATS = 90;

/**
 * Builds the zoom stage.
 *
 * The frame is pre-scaled by `1 + amount` before `zoompan`, so the widest point
 * of the move (`zoom = 1`) shows the whole frame and the tightest (`zoom = 1 +
 * amount`) samples at native resolution. Every intermediate step is therefore a
 * downscale, which is why the result stays sharp instead of going mushy the way
 * a naive zoompan does.
 */
export function zoomStage(options: {
  mode: ZoomMode;
  amount: number;
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  /** Beat positions in the output timeline (ms), used by the `pulse` mode. */
  beats?: number[];
}): string {
  const { mode, width, height, fps, durationMs } = options;
  const amount = clamp(options.amount, 0, 0.6);
  if (mode === 'none' || amount < 0.01) return '';

  const preW = even(Math.round(width * (1 + amount)));
  const preH = even(Math.round(height * (1 + amount)));
  const durationSec = Math.max(0.5, durationMs / 1000);
  const t = `(on/${fps})`;

  let zoomExpr: string;
  switch (mode) {
    case 'in':
      zoomExpr = `1+${round(amount, 4)}*min(1,${t}/${round(durationSec, 3)})`;
      break;
    case 'out':
      zoomExpr = `1+${round(amount, 4)}*(1-min(1,${t}/${round(durationSec, 3)}))`;
      break;
    case 'pulse':
    default:
      zoomExpr = pulseExpression(t, amount, options.beats, durationMs);
      break;
  }

  return [
    `scale=${preW}:${preH}:flags=bicubic`,
    `zoompan=z='${zoomExpr}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=${fps}`,
  ].join(',');
}

/**
 * A short, decaying punch on every beat. With detected beats it follows the
 * track exactly; without them it falls back to a steady 0.5 s pulse so the
 * option still does something useful on footage with no music analysis yet.
 */
function pulseExpression(t: string, amount: number, beats: number[] | undefined, durationMs: number): string {
  const a = round(amount, 4);
  const usable = (beats ?? [])
    .filter((ms) => ms >= 0 && ms <= durationMs)
    .slice(0, MAX_PULSE_BEATS);

  if (!usable.length) {
    return `1+${a}*pow(max(0,1-mod(${t},0.5)/0.18),2)`;
  }

  const bumps = usable
    .map((ms) => `exp(-pow((${t}-${round(ms / 1000, 3)})/0.085,2))`)
    .join('+');
  return `1+${a}*min(1,${bumps})`;
}

/**
 * Handheld shake. The crop window keeps a constant size and only its offset
 * moves — `crop` re-evaluates x/y every frame whenever the expressions mention
 * `t`, so the link never has to renegotiate frame dimensions mid-graph.
 */
export function shakeStage(strength: number, width: number, height: number): string {
  const s = clamp(strength, 0, 1);
  if (s < 0.02) return '';
  const inset = 0.97;
  const ampX = round(s * 0.012, 5);
  const ampY = round(s * 0.010, 5);
  const cropW = even(Math.round(width * inset));
  const cropH = even(Math.round(height * inset));
  return [
    `crop=w=${cropW}:h=${cropH}` +
      `:x='(iw-${cropW})/2+iw*${ampX}*sin(2*PI*t*7.3)'` +
      `:y='(ih-${cropH})/2+ih*${ampY}*sin(2*PI*t*5.1+1.1)'`,
    `scale=${width}:${height}:flags=bicubic`,
  ].join(',');
}

/** Pass 1 of stabilisation — writes the camera-motion transform file. */
export function stabilizeDetectArgs(input: string, trfPath: string): string[] {
  return [
    '-hide_banner', '-y',
    '-i', input,
    '-vf', `vidstabdetect=shakiness=6:accuracy=12:result=${trfPath}`,
    '-f', 'null', '-',
  ];
}

/** Pass 2 of stabilisation — consumes the transform file in the main graph. */
export function stabilizeTransformFilter(trfPath: string): string {
  return `vidstabtransform=input=${trfPath}:zoom=1:smoothing=24:interpol=bicubic,unsharp=5:5:0.6:3:3:0.0`;
}
