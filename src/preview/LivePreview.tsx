import { Ionicons } from '@expo/vector-icons';
import {
  Canvas,
  Group,
  Image as SkiaImage,
  RadialGradient,
  Rect,
  Skia,
  Text as SkiaText,
  useImage,
  vec,
  type SkFont,
} from '@shopify/react-native-skia';
import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { needsProxy } from '../ffmpeg/proxy';
import { buildTimeline, outputToSource, sourceToOutput } from '../ffmpeg/timeline';
import { ASPECT_RATIOS } from '../ffmpeg/presets';
import { colors, radius, spacing, typography } from '../theme';
import type { ImageOverlay, Project } from '../types/project';
import { trace } from '../services/diagnostics';
import { clamp, formatTimecode } from '../utils/format';
import { toFileUri } from '../utils/paths';
import { layoutCaption } from './captionLayout';
import { gradeColorMatrix } from './colorMatrix';
import { gradeOverlay, rgba } from './gradeOverlay';
import { gainFromDb, useMixPlayback } from './useMixPlayback';
import {
  buildCues,
  captionAt,
  fadeOpacityAt,
  fitRect,
  letterboxBarHeight,
  overlayOpacityAt,
  overlayRect,
  overlaySlideOffset,
  zoomScaleAt,
} from './frame';

/** Effect parameters change slowly; 20 Hz is plenty and keeps React quiet. */
const TICK_MS = 50;

export type DragTarget = { kind: 'caption' } | { kind: 'overlay'; id: string } | null;

type Props = {
  project: Project;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  /** Position on the export timeline. */
  outputMs: number;
  onSeek: (ms: number) => void;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onMoveCaption?: (position: { xPct: number; yPct: number }) => void;
  onMoveOverlay?: (id: string, position: { xPct: number; yPct: number }) => void;
  /** Turns off editing handles, e.g. while a render is running. */
  locked?: boolean;
  /** The playback copy is still being built. */
  preparing?: boolean;
};

/**
 * The editor's picture.
 *
 * Everything the exporter does to a frame — the reframe, the grade, the
 * vignette and bars, the zoom, the captions and the illustrations — is redrawn
 * here on the GPU as the video plays, so a change to any slider shows up
 * immediately instead of only after a render.
 *
 * It is an approximation in one respect: the colour work is a matrix rather
 * than ffmpeg's filter chain, so curve-based looks land close rather than
 * exact. Geometry and timing are shared with the renderer outright.
 */
export function LivePreview({
  project,
  playing,
  onPlayingChange,
  outputMs,
  onSeek,
  fullscreen,
  onToggleFullscreen,
  onMoveCaption,
  onMoveOverlay,
  locked,
  preparing,
}: Props) {
  const source = project.source;
  const config = project.export;

  const timeline = React.useMemo(
    () =>
      buildTimeline(
        project.segments,
        project.effects.transition === 'none' ? 0 : project.effects.transitionMs
      ),
    [project.segments, project.effects.transition, project.effects.transitionMs]
  );

  useMixPlayback({ project, playing, outputMs });

  // Always the proxy when one exists: the original may be 4K HEVC, which is
  // more than the frame decoder can safely handle. While the proxy is still
  // being written there is deliberately nothing to play — handing the decoder
  // the original in the meantime would walk straight back into the failure the
  // proxy exists to avoid.
  const playbackUri = source
    ? preparing
      ? null
      : (source.previewUri ?? (needsProxy(source) ? null : source.uri))
    : null;

  React.useEffect(() => {
    if (!playbackUri) return undefined;
    trace(`player open ${playbackUri.split('/').pop()}`);
    return () => trace('player close');
  }, [playbackUri]);

  // Playback runs through ExoPlayer rather than a frame decoder feeding the
  // canvas. Driving MediaCodec ourselves and handing each frame to the GPU is
  // what took the process down on real hardware; a platform video view is the
  // one path that is guaranteed to survive whatever the phone's camera wrote.
  const player = useVideoPlayer(playbackUri ? toFileUri(playbackUri) : null, (instance) => {
    instance.loop = false;
    instance.timeUpdateEventInterval = TICK_MS / 1000;
  });

  const [currentSourceMs, setCurrentSourceMs] = React.useState(0);
  useEventListener(player, 'timeUpdate', ({ currentTime }) =>
    setCurrentSourceMs(currentTime * 1000)
  );

  React.useEffect(() => {
    if (playing) player.play();
    else player.pause();
  }, [playing, player]);

  // The mix is live too: muting the original, changing the music level or
  // adding a voice line is audible immediately, without a render.
  React.useEffect(() => {
    player.volume = project.audio.muteOriginal
      ? 0
      : gainFromDb(project.audio.originalVolumeDb);
  }, [project.audio.muteOriginal, project.audio.originalVolumeDb, player]);

  const [box, setBox] = React.useState({ width: 0, height: 0 });
  const [selected, setSelected] = React.useState<DragTarget>(null);

  // --------------------------------------------------------------- clock ---
  // The file plays start to finish; this maps its position onto the cut and
  // jumps the head whenever the playhead runs off the end of a segment.
  const outputRef = React.useRef(outputMs);
  outputRef.current = outputMs;

  React.useEffect(() => {
    if (!playing || !source) return;
    const mapped = sourceToOutput(timeline, currentSourceMs);

    if (mapped === null) {
      // Outside every kept range: hop to whichever segment comes next.
      const next = timeline.placed.find((item) => item.segment.startMs > currentSourceMs);
      if (next) {
        player.currentTime = next.segment.startMs / 1000;
      } else {
        onPlayingChange(false);
        onSeek(timeline.totalMs);
      }
      return;
    }
    onSeek(mapped);
  }, [playing, source, timeline, currentSourceMs, player, onSeek, onPlayingChange]);

  /** Moves the file's head to wherever the export timeline says we are. */
  const seekTo = React.useCallback(
    (ms: number) => {
      const target = outputToSource(timeline, clamp(ms, 0, timeline.totalMs));
      if (target) player.currentTime = target.sourceMs / 1000;
      onSeek(clamp(ms, 0, timeline.totalMs));
    },
    [timeline, player, onSeek]
  );

  const seekToRef = React.useRef(seekTo);
  seekToRef.current = seekTo;

  React.useEffect(() => {
    // A seek requested from outside (timeline scrub) must move the file too.
    if (!playing) seekToRef.current(outputMs);
    // Only react to external seeks, not to our own tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // ------------------------------------------------------------- drawing ---
  const frame = React.useMemo(() => {
    if (!box.width) return { width: 0, height: 0, x: 0, y: 0 };
    const ratio = ASPECT_RATIOS[config.aspect];
    const width = Math.min(box.width, box.height * ratio);
    const height = width / ratio;
    return { width, height, x: (box.width - width) / 2, y: (box.height - height) / 2 };
  }, [box, config.aspect]);

  const effects = project.effects;
  const grade = React.useMemo(
    () => gradeOverlay(gradeColorMatrix(effects.grade, effects.gradeStrength)),
    [effects.grade, effects.gradeStrength]
  );

  const zoom = zoomScaleAt({
    mode: effects.zoom,
    amount: effects.zoomAmount,
    ms: outputMs,
    totalMs: timeline.totalMs,
    beats: project.music.beatSync ? project.music.beats : undefined,
  });
  const fade = fadeOpacityAt(effects.fadeInMs, effects.fadeOutMs, outputMs, timeline.totalMs);
  const barHeight = letterboxBarHeight(effects.letterbox, frame.height);

  const videoRect = React.useMemo(
    () => fitRect(source?.width || 1, source?.height || 1, frame.width, frame.height, effects.fillMode),
    [source, frame.width, frame.height, effects.fillMode]
  );

  // ------------------------------------------------------------ captions ---
  const cues = React.useMemo(
    () =>
      project.transcript?.words.length
        ? buildCues(project.transcript.words, project.subtitle)
        : [],
    [project.transcript, project.subtitle]
  );

  const font = useCaptionFont(project.subtitle.fontFamily, (project.subtitle.fontSizePct / 100) * frame.height);
  const active = React.useMemo(
    () => (cues.length ? captionAt(cues, outputMs, project.subtitle.karaoke) : null),
    [cues, outputMs, project.subtitle.karaoke]
  );

  // ------------------------------------------------------------ gestures ---
  const pan = React.useMemo(
    () =>
      Gesture.Pan()
        .enabled(!locked)
        .onBegin((event) => {
          const x = (event.x - frame.x) / frame.width;
          const y = (event.y - frame.y) / frame.height;
          const hit = hitTest(project, x, y, outputMs);
          if (hit) setSelected(hit);
        })
        .onUpdate((event) => {
          if (!selected || !frame.width) return;
          const xPct = clamp(((event.x - frame.x) / frame.width) * 100, 3, 97);
          const yPct = clamp(((event.y - frame.y) / frame.height) * 100, 3, 97);
          if (selected.kind === 'caption') onMoveCaption?.({ xPct, yPct });
          else onMoveOverlay?.(selected.id, { xPct, yPct });
        })
        .runOnJS(true),
    [locked, frame, project, outputMs, selected, onMoveCaption, onMoveOverlay]
  );

  const tap = React.useMemo(
    () =>
      Gesture.Tap()
        .maxDuration(220)
        .onEnd(() => {
          if (selected) {
            setSelected(null);
            return;
          }
          onPlayingChange(!playing);
        })
        .runOnJS(true),
    [selected, playing, onPlayingChange]
  );

  const gesture = React.useMemo(() => Gesture.Exclusive(pan, tap), [pan, tap]);

  return (
    <View
      style={[styles.wrapper, fullscreen && styles.wrapperFullscreen]}
      onLayout={(event: LayoutChangeEvent) =>
        setBox({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })
      }
    >
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill}>
          {/*
            The picture is a platform video view sitting under the canvas, sized
            and zoomed to the same rectangle the exporter will use. Everything
            drawn afterwards is overlay, so the canvas above it stays
            transparent.
          */}
          <View
            pointerEvents="none"
            style={[
              styles.stage,
              {
                left: frame.x,
                top: frame.y,
                width: frame.width,
                height: frame.height,
                opacity: fade,
              },
            ]}
          >
            {playbackUri ? (
              <VideoView
                player={player}
                nativeControls={false}
                contentFit="fill"
                // A SurfaceView is punched through the window and composited
                // underneath it, which would put the video behind the canvas
                // drawing the captions. A texture view is an ordinary view and
                // layers the way the rest of the tree expects.
                surfaceType="textureView"
                useExoShutter={false}
                style={{
                  position: 'absolute',
                  left: videoRect.x,
                  top: videoRect.y,
                  width: videoRect.width,
                  height: videoRect.height,
                  transform: [{ scale: zoom }],
                }}
              />
            ) : null}
          </View>

          <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
            <Group
              transform={[{ translateX: frame.x }, { translateY: frame.y }]}
              clip={{ x: 0, y: 0, width: frame.width, height: frame.height }}
              opacity={fade}
            >
              {/*
                The grade, painted on rather than applied to the pixels — see
                gradeOverlay for what that can and cannot reproduce.
              */}
              {grade ? (
                <Group>
                  <Rect
                    x={0}
                    y={0}
                    width={frame.width}
                    height={frame.height}
                    color={rgba(grade.multiply)}
                    blendMode="multiply"
                  />
                  <Rect
                    x={0}
                    y={0}
                    width={frame.width}
                    height={frame.height}
                    color={rgba(grade.add)}
                    blendMode="plus"
                  />
                  {grade.wash > 0.02 ? (
                    <Rect
                      x={0}
                      y={0}
                      width={frame.width}
                      height={frame.height}
                      color={rgba([0.5, 0.5, 0.5], grade.wash)}
                    />
                  ) : null}
                </Group>
              ) : null}

              {effects.vignette > 0.02 ? (
                <Rect
                  x={0}
                  y={0}
                  width={frame.width}
                  height={frame.height}
                  blendMode="multiply"
                  opacity={clamp(effects.vignette, 0, 1)}
                >
                  <RadialGradient
                    c={vec(frame.width / 2, frame.height / 2)}
                    r={Math.max(frame.width, frame.height) * 0.72}
                    colors={['#ffffff', '#ffffff', '#000000']}
                    positions={[0, 0.42, 1]}
                  />
                </Rect>
              ) : null}

              {barHeight > 0 ? (
                <>
                  <Rect x={0} y={0} width={frame.width} height={barHeight} color="#000000" />
                  <Rect
                    x={0}
                    y={frame.height - barHeight}
                    width={frame.width}
                    height={barHeight}
                    color="#000000"
                  />
                </>
              ) : null}

              {project.overlays.map((overlay) => (
                <OverlayImage
                  key={overlay.id}
                  overlay={overlay}
                  ms={outputMs}
                  frameWidth={frame.width}
                  frameHeight={frame.height}
                  selected={selected?.kind === 'overlay' && selected.id === overlay.id}
                />
              ))}

              {project.subtitle.enabled && active && font ? (
                <Caption
                  active={active}
                  config={project.subtitle}
                  font={font}
                  frameWidth={frame.width}
                  frameHeight={frame.height}
                />
              ) : null}
            </Group>
          </Canvas>

          {/* Selection outlines live outside the canvas so they never export. */}
          {selected ? (
            <View pointerEvents="none" style={styles.selectionHint}>
              <Text style={styles.selectionText}>
                {selected.kind === 'caption' ? 'Subtitr — suring' : 'Rasm — suring'}
              </Text>
            </View>
          ) : null}

          {preparing ? (
            <View pointerEvents="none" style={styles.preparing}>
              <ActivityIndicator color="#fff" />
              <Text style={styles.preparingText}>Video tayyorlanmoqda…</Text>
            </View>
          ) : !playing ? (
            <View pointerEvents="none" style={styles.playBadgeWrap}>
              <View style={styles.playBadge}>
                <Ionicons name="play" size={22} color="#fff" />
              </View>
            </View>
          ) : null}
        </View>
      </GestureDetector>

      <View style={styles.hud} pointerEvents="box-none">
        <Text style={styles.timecode}>
          {formatTimecode(outputMs)} / {formatTimecode(timeline.totalMs)}
        </Text>
        {onToggleFullscreen ? (
          <Pressable onPress={onToggleFullscreen} hitSlop={10} style={styles.hudButton}>
            <Ionicons name={fullscreen ? 'contract-outline' : 'expand-outline'} size={17} color="#fff" />
          </Pressable>
        ) : null}
      </View>

    </View>
  );
}

/** Picks whatever the finger landed on, illustrations before captions. */
function hitTest(project: Project, xFraction: number, yFraction: number, ms: number): DragTarget {
  for (let index = project.overlays.length - 1; index >= 0; index -= 1) {
    const overlay = project.overlays[index];
    if (ms < overlay.startMs || ms > overlay.endMs) continue;
    const rect = overlayRect(overlay, 1, 1, 16, 9);
    if (
      xFraction >= rect.x &&
      xFraction <= rect.x + rect.width &&
      yFraction >= rect.y &&
      yFraction <= rect.y + rect.height
    ) {
      return { kind: 'overlay', id: overlay.id };
    }
  }

  // Captions occupy a band around their anchor rather than a precise box.
  const captionY = (project.subtitle.positionPct ?? 70) / 100;
  if (project.subtitle.enabled && Math.abs(yFraction - captionY) < 0.14) {
    return { kind: 'caption' };
  }
  return null;
}

function OverlayImage({
  overlay,
  ms,
  frameWidth,
  frameHeight,
  selected,
}: {
  overlay: ImageOverlay;
  ms: number;
  frameWidth: number;
  frameHeight: number;
  selected: boolean;
}) {
  const image = useImage(toFileUri(overlay.uri));
  const opacity = overlayOpacityAt(overlay, ms);
  if (!image || opacity <= 0) return null;

  const rect = overlayRect(overlay, frameWidth, frameHeight, image.width(), image.height());
  const slide = overlaySlideOffset(overlay, ms, frameHeight);

  return (
    <Group opacity={opacity}>
      <SkiaImage
        image={image}
        x={rect.x}
        y={rect.y + slide}
        width={rect.width}
        height={rect.height}
        fit="cover"
      />
      {selected ? (
        <Rect
          x={rect.x}
          y={rect.y + slide}
          width={rect.width}
          height={rect.height}
          color={colors.accent}
          style="stroke"
          strokeWidth={2}
        />
      ) : null}
    </Group>
  );
}

/**
 * Draws the caption with the same outline, colours and word highlight the
 * burned-in track will have. Stroke goes down first so the fill sits inside it.
 */
function Caption({
  active,
  config,
  font,
  frameWidth,
  frameHeight,
}: {
  active: NonNullable<ReturnType<typeof captionAt>>;
  config: Project['subtitle'];
  font: SkFont;
  frameWidth: number;
  frameHeight: number;
}) {
  const layout = React.useMemo(
    () => layoutCaption(active.cue, config, font, frameWidth),
    [active.cue, config, font, frameWidth]
  );

  const emphasis = React.useMemo(
    () => new Set(config.emphasisWords.map((word) => word.toLowerCase())),
    [config.emphasisWords]
  );

  const anchorX = (frameWidth * clamp(config.positionXPct ?? 50, 3, 97)) / 100;
  const anchorY = (frameHeight * clamp(config.positionPct, 3, 97)) / 100;
  const originX = anchorX - layout.width / 2;
  const originY = anchorY - layout.height / 2 + font.getSize();

  const outline = Math.max(0, config.outlineWidth) * (frameHeight / 960);

  return (
    <Group>
      {layout.words.map((word) => {
        const isActive = word.index === active.activeWordIndex;
        const isEmphasis = emphasis.has(word.text.toLowerCase());
        const fill = isActive
          ? config.highlightColor
          : isEmphasis
            ? config.emphasisColor
            : config.primaryColor;

        const x = originX + word.x;
        const y = originY + word.y;

        return (
          <Group key={`${word.index}_${word.x}`}>
            {outline > 0.2 ? (
              <SkiaText
                x={x}
                y={y}
                text={word.text}
                font={font}
                color={config.outlineColor}
                style="stroke"
                strokeWidth={outline}
              />
            ) : null}
            <SkiaText x={x} y={y} text={word.text} font={font} color={fill} />
          </Group>
        );
      })}
    </Group>
  );
}

/**
 * Matches the caption family against the fonts installed on the device, which
 * is the same set libass draws from at export time.
 */
function useCaptionFont(family: string, size: number): SkFont | null {
  return React.useMemo(() => {
    if (!size || size < 4) return null;
    try {
      const manager = Skia.FontMgr.System();
      const typeface =
        manager.matchFamilyStyle(family, { weight: 700 }) ?? manager.matchFamilyStyle('', { weight: 700 });
      return typeface ? Skia.Font(typeface, size) : null;
    } catch {
      return null;
    }
  }, [family, size]);
}

const styles = StyleSheet.create({
  /** The safe frame: black, clipped, and exactly the export aspect. */
  stage: { position: 'absolute', overflow: 'hidden', backgroundColor: '#000000' },
  wrapper: {
    width: '100%',
    aspectRatio: 16 / 11,
    backgroundColor: '#000',
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  wrapperFullscreen: { flex: 1, aspectRatio: undefined, borderRadius: 0 },

  playBadgeWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBadge: {
    width: 54,
    height: 54,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(10,10,16,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 3,
  },

  hud: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    bottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timecode: {
    ...typography.mono,
    color: '#fff',
    backgroundColor: 'rgba(6,6,10,0.55)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  hudButton: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(6,6,10,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  preparing: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(6,6,10,0.55)',
  },
  preparingText: { ...typography.tiny, color: '#fff' },

  selectionHint: {
    position: 'absolute',
    top: spacing.sm,
    alignSelf: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: `${colors.accent}dd`,
  },
  selectionText: { ...typography.tiny, color: '#fff' },
});
