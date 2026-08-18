import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import type { Timeline } from '../ffmpeg/timeline';
import { colors, radius, spacing, typography } from '../theme';
import type { Project, Segment } from '../types/project';
import { clamp, formatTimecode } from '../utils/format';
import { toFileUri } from '../utils/paths';

const VIDEO_ROW_HEIGHT = 56;
const THIN_ROW_HEIGHT = 20;
const TILE_WIDTH = 44;
const HANDLE_WIDTH = 16;
const MIN_SEGMENT_MS = 200;

const MIN_PPS = 12;
const MAX_PPS = 320;
const DEFAULT_PPS = 55;

type Props = {
  project: Project;
  timeline: Timeline;
  /** Position on the export timeline. */
  playheadMs: number;
  selectedId: string | null;
  /** Frames sampled evenly across the source, used to fill the strip. */
  thumbnails: (string | null)[];
  onSeek: (ms: number) => void;
  onSelect: (id: string | null) => void;
  onChangeSegment: (id: string, patch: { startMs?: number; endMs?: number }) => void;
};

/**
 * The cut, laid out the way phone editors do it: the strip scrolls under a
 * playhead pinned to the centre of the screen.
 *
 * The blocks are drawn in *export* order, so what scrolls past is the edit
 * itself rather than the untouched file — a piece sped up to 2x takes half the
 * space, and a removed stretch simply is not there. Trimming still speaks
 * source time, so a handle dragged by one second of screen time moves the
 * source boundary by `speed` seconds.
 */
export function CutTimeline({
  project,
  timeline,
  playheadMs,
  selectedId,
  thumbnails,
  onSeek,
  onSelect,
  onChangeSegment,
}: Props) {
  const scrollRef = React.useRef<ScrollView>(null);
  const [viewport, setViewport] = React.useState(0);
  const [pps, setPps] = React.useState(DEFAULT_PPS);
  const [scrubbing, setScrubbing] = React.useState(false);
  const [trimming, setTrimming] = React.useState(false);

  const msToPx = React.useCallback((ms: number) => (ms / 1000) * pps, [pps]);
  const pxToMs = React.useCallback((px: number) => (px / pps) * 1000, [pps]);

  const totalMs = Math.max(timeline.totalMs, 1);
  const contentWidth = msToPx(totalMs);
  const pad = viewport / 2;

  // Follow the playhead unless the finger is the one moving it.
  React.useEffect(() => {
    if (scrubbing || trimming || !viewport) return;
    scrollRef.current?.scrollTo({ x: msToPx(playheadMs), animated: false });
  }, [playheadMs, msToPx, scrubbing, trimming, viewport]);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!scrubbing) return;
    onSeek(clamp(pxToMs(event.nativeEvent.contentOffset.x), 0, totalMs));
  };

  // Pinch zooms the time scale, exactly like the apps this replaces.
  const pinchStart = React.useRef(DEFAULT_PPS);
  const pinch = Gesture.Pinch()
    .onBegin(() => {
      pinchStart.current = pps;
    })
    .onUpdate((event) => {
      setPps(clamp(pinchStart.current * event.scale, MIN_PPS, MAX_PPS));
    })
    .runOnJS(true);

  const rows = buildRows(project, timeline);

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.clock}>{formatTimecode(playheadMs, true)}</Text>
        <Text style={styles.total}>{formatTimecode(totalMs)}</Text>
      </View>

      <GestureDetector gesture={pinch}>
        <View onLayout={(event: LayoutChangeEvent) => setViewport(event.nativeEvent.layout.width)}>
          <ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            scrollEnabled={!trimming}
            onScroll={onScroll}
            onScrollBeginDrag={() => setScrubbing(true)}
            onScrollEndDrag={() => setScrubbing(false)}
            onMomentumScrollEnd={() => setScrubbing(false)}
            contentContainerStyle={{ paddingHorizontal: pad }}
          >
            <View style={{ width: contentWidth }}>
              <Ruler totalMs={totalMs} pps={pps} />

              <View style={styles.videoRow}>
                {timeline.placed.map((item) => (
                  <SegmentBlock
                    key={item.segment.id}
                    segment={item.segment}
                    left={msToPx(item.outStartMs)}
                    width={Math.max(12, msToPx(item.playedMs))}
                    selected={item.segment.id === selectedId}
                    sourceDurationMs={project.source?.durationMs ?? 0}
                    thumbnails={thumbnails}
                    pps={pps}
                    onSelect={() => onSelect(item.segment.id === selectedId ? null : item.segment.id)}
                    onTrimStart={() => setTrimming(true)}
                    onTrimEnd={() => setTrimming(false)}
                    onTrim={(patch) => onChangeSegment(item.segment.id, patch)}
                  />
                ))}
              </View>

              {rows.map((row) => (
                <View key={row.key} style={styles.thinRow}>
                  {row.items.map((item, index) => (
                    <Pressable
                      key={`${row.key}_${index}`}
                      onPress={() => onSeek(item.startMs)}
                      style={[
                        styles.thinItem,
                        {
                          left: msToPx(item.startMs),
                          width: Math.max(6, msToPx(item.endMs - item.startMs)),
                          backgroundColor: row.color,
                        },
                      ]}
                    >
                      {item.label ? (
                        <Text style={styles.thinLabel} numberOfLines={1}>
                          {item.label}
                        </Text>
                      ) : null}
                    </Pressable>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      </GestureDetector>

      <View pointerEvents="none" style={styles.playhead} />
    </View>
  );
}

function Ruler({ totalMs, pps }: { totalMs: number; pps: number }) {
  // One tick per second is unreadable when zoomed out; step up as it shrinks.
  const stepMs = pps > 140 ? 500 : pps > 60 ? 1000 : pps > 25 ? 5000 : 10000;
  const ticks = Math.min(400, Math.floor(totalMs / stepMs) + 1);

  return (
    <View style={styles.ruler}>
      {Array.from({ length: ticks }, (_, index) => {
        const ms = index * stepMs;
        return (
          <View key={ms} style={[styles.tick, { left: (ms / 1000) * pps }]}>
            <View style={styles.tickMark} />
            <Text style={styles.tickLabel}>{formatTimecode(ms)}</Text>
          </View>
        );
      })}
    </View>
  );
}

function SegmentBlock({
  segment,
  left,
  width,
  selected,
  sourceDurationMs,
  thumbnails,
  pps,
  onSelect,
  onTrim,
  onTrimStart,
  onTrimEnd,
}: {
  segment: Segment;
  left: number;
  width: number;
  selected: boolean;
  sourceDurationMs: number;
  thumbnails: (string | null)[];
  pps: number;
  onSelect: () => void;
  onTrim: (patch: { startMs?: number; endMs?: number }) => void;
  onTrimStart: () => void;
  onTrimEnd: () => void;
}) {
  const speed = segment.speed > 0 ? segment.speed : 1;

  /** Screen pixels → source milliseconds, which is where the boundary lives. */
  const pxToSourceMs = (px: number) => (px / pps) * 1000 * speed;

  const makeHandle = (edge: 'start' | 'end') =>
    Gesture.Pan()
      .onBegin(() => {
        onTrimStart();
        Haptics.selectionAsync().catch(() => undefined);
      })
      .onUpdate((event) => {
        const delta = pxToSourceMs(event.translationX);
        if (edge === 'start') {
          onTrim({ startMs: Math.min(segment.startMs + delta, segment.endMs - MIN_SEGMENT_MS) });
        } else {
          onTrim({ endMs: Math.max(segment.endMs + delta, segment.startMs + MIN_SEGMENT_MS) });
        }
      })
      .onFinalize(onTrimEnd)
      .runOnJS(true);

  const tiles = Math.max(1, Math.round(width / TILE_WIDTH));

  return (
    <Pressable
      onPress={onSelect}
      style={[styles.block, { left, width }, selected && styles.blockSelected]}
    >
      <View style={styles.tiles}>
        {Array.from({ length: tiles }, (_, index) => {
          // Each tile shows the frame nearest to the source time under it.
          const share = (index + 0.5) / tiles;
          const sourceMs = segment.startMs + (segment.endMs - segment.startMs) * share;
          const uri = nearestThumbnail(thumbnails, sourceMs, sourceDurationMs);
          return uri ? (
            <Image
              key={index}
              source={{ uri: toFileUri(uri) }}
              style={styles.tile}
              resizeMode="cover"
            />
          ) : (
            <View key={index} style={[styles.tile, styles.tileEmpty]} />
          );
        })}
      </View>

      {speed !== 1 ? (
        <View style={styles.speedTag}>
          <Ionicons name="flash" size={9} color="#fff" />
          <Text style={styles.speedText}>{speed}x</Text>
        </View>
      ) : null}

      {selected ? (
        <>
          <GestureDetector gesture={makeHandle('start')}>
            <View style={[styles.handle, styles.handleLeft]}>
              <View style={styles.handleGrip} />
            </View>
          </GestureDetector>
          <GestureDetector gesture={makeHandle('end')}>
            <View style={[styles.handle, styles.handleRight]}>
              <View style={styles.handleGrip} />
            </View>
          </GestureDetector>
        </>
      ) : null}
    </Pressable>
  );
}

function nearestThumbnail(
  thumbnails: (string | null)[],
  sourceMs: number,
  durationMs: number
): string | null {
  if (!thumbnails.length || durationMs <= 0) return null;
  const index = Math.round((sourceMs / durationMs) * (thumbnails.length - 1));
  return thumbnails[clamp(index, 0, thumbnails.length - 1)] ?? null;
}

type Row = {
  key: string;
  color: string;
  items: { startMs: number; endMs: number; label?: string }[];
};

/** The thin lanes under the strip: music, voice, captions, illustrations. */
function buildRows(project: Project, timeline: Timeline): Row[] {
  const rows: Row[] = [];

  if (project.music.enabled && project.music.uri) {
    rows.push({
      key: 'music',
      color: `${colors.green}66`,
      items: [{ startMs: 0, endMs: timeline.totalMs, label: project.music.name ?? 'Musiqa' }],
    });
  }

  if (project.voiceovers.length) {
    rows.push({
      key: 'voice',
      color: `${colors.accent}88`,
      items: project.voiceovers.map((clip) => ({
        startMs: clip.startMs,
        endMs: clip.startMs + clip.durationMs,
        label: clip.text,
      })),
    });
  }

  if (project.overlays.length) {
    rows.push({
      key: 'overlays',
      color: `${colors.amber}77`,
      items: project.overlays.map((overlay) => ({
        startMs: overlay.startMs,
        endMs: overlay.endMs,
        label: overlay.phrase || overlay.prompt,
      })),
    });
  }

  if (project.subtitle.enabled && project.transcript?.lines.length) {
    rows.push({
      key: 'captions',
      color: `${colors.teal}66`,
      // Caption lines are timed against the source; the strip is export time.
      items: mapLines(project, timeline),
    });
  }

  return rows;
}

function mapLines(project: Project, timeline: Timeline): Row['items'] {
  const items: Row['items'] = [];
  for (const line of project.transcript?.lines ?? []) {
    for (const placed of timeline.placed) {
      const overlapStart = Math.max(line.startMs, placed.segment.startMs);
      const overlapEnd = Math.min(line.endMs, placed.segment.endMs);
      if (overlapEnd <= overlapStart) continue;
      const speed = placed.segment.speed > 0 ? placed.segment.speed : 1;
      items.push({
        startMs: placed.outStartMs + (overlapStart - placed.segment.startMs) / speed,
        endMs: placed.outStartMs + (overlapEnd - placed.segment.startMs) / speed,
        label: line.text,
      });
      break;
    }
    if (items.length >= 200) break;
  }
  return items;
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: spacing.sm },

  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xs,
  },
  clock: { ...typography.mono, color: colors.text },
  total: { ...typography.mono, color: colors.textFaint },

  ruler: { height: 16 },
  tick: { position: 'absolute', top: 0, flexDirection: 'row', alignItems: 'center', gap: 3 },
  tickMark: { width: 1, height: 5, backgroundColor: colors.border },
  tickLabel: { ...typography.tiny, fontSize: 9, color: colors.textFaint },

  videoRow: { height: VIDEO_ROW_HEIGHT, marginTop: 2 },
  block: {
    position: 'absolute',
    top: 0,
    height: VIDEO_ROW_HEIGHT,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  blockSelected: { borderColor: colors.accent, borderWidth: 2 },
  tiles: { flexDirection: 'row', height: '100%' },
  tile: { width: TILE_WIDTH, height: '100%' },
  tileEmpty: { backgroundColor: colors.surfaceAlt },

  speedTag: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  speedText: { ...typography.tiny, fontSize: 9, color: '#fff' },

  handle: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: HANDLE_WIDTH,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleLeft: { left: 0, borderTopLeftRadius: radius.sm, borderBottomLeftRadius: radius.sm },
  handleRight: { right: 0, borderTopRightRadius: radius.sm, borderBottomRightRadius: radius.sm },
  handleGrip: { width: 2, height: 18, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.9)' },

  thinRow: { height: THIN_ROW_HEIGHT, marginTop: 3 },
  thinItem: {
    position: 'absolute',
    top: 0,
    height: THIN_ROW_HEIGHT,
    borderRadius: 4,
    justifyContent: 'center',
    paddingHorizontal: 5,
    overflow: 'hidden',
  },
  thinLabel: { ...typography.tiny, fontSize: 9, color: colors.text },

  playhead: {
    position: 'absolute',
    left: '50%',
    top: spacing.sm + 18,
    bottom: spacing.sm,
    width: 2,
    marginLeft: -1,
    borderRadius: 1,
    backgroundColor: colors.pink,
  },
});
