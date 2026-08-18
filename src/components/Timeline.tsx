import { Image } from 'react-native';
import React from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import * as Haptics from 'expo-haptics';

import { colors, radius, spacing, typography } from '../theme';
import type { Segment } from '../types/project';
import { clamp, formatTimecode } from '../utils/format';

const TRACK_HEIGHT = 64;
const HANDLE_WIDTH = 18;
const MIN_SEGMENT_MS = 300;

type Props = {
  durationMs: number;
  segments: Segment[];
  selectedId: string | null;
  playheadMs: number;
  thumbnails?: (string | null)[];
  /** Detected pauses, drawn as faint marks so silence is visible while cutting. */
  silences?: { startMs: number; endMs: number }[];
  beats?: number[];
  onSelect: (id: string | null) => void;
  onSeek: (ms: number) => void;
  onChangeSegment: (id: string, patch: { startMs?: number; endMs?: number }) => void;
};

/**
 * The cut view.
 *
 * The track always represents the *source* duration, so segment blocks sit where
 * the footage actually is. Dragging a handle edits one boundary and is clamped
 * against its neighbours, which keeps the segment list ordered and non-
 * overlapping — the two invariants the render pipeline relies on.
 */
export function Timeline({
  durationMs,
  segments,
  selectedId,
  playheadMs,
  thumbnails,
  silences,
  beats,
  onSelect,
  onSeek,
  onChangeSegment,
}: Props) {
  const [width, setWidth] = React.useState(0);

  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
  const toX = React.useCallback(
    (ms: number) => (durationMs > 0 ? (ms / durationMs) * width : 0),
    [durationMs, width]
  );
  const toMs = React.useCallback(
    (x: number) => (width > 0 ? clamp((x / width) * durationMs, 0, durationMs) : 0),
    [durationMs, width]
  );

  const ordered = React.useMemo(
    () => [...segments].sort((a, b) => a.startMs - b.startMs),
    [segments]
  );

  return (
    <View style={styles.container}>
      <View style={styles.track} onLayout={onLayout}>
        <ThumbnailStrip thumbnails={thumbnails} />

        <View style={styles.dimLayer} pointerEvents="none" />

        {silences?.map((gap, index) => (
          <View
            key={`sil_${index}`}
            pointerEvents="none"
            style={[
              styles.silence,
              { left: toX(gap.startMs), width: Math.max(1, toX(gap.endMs) - toX(gap.startMs)) },
            ]}
          />
        ))}

        {ordered.map((segment) => (
          <SegmentBlock
            key={segment.id}
            segment={segment}
            selected={segment.id === selectedId}
            left={toX(segment.startMs)}
            width={Math.max(6, toX(segment.endMs) - toX(segment.startMs))}
            onSelect={() => onSelect(segment.id === selectedId ? null : segment.id)}
          />
        ))}

        {beats?.map((ms, index) => (
          <View key={`beat_${index}`} pointerEvents="none" style={[styles.beat, { left: toX(ms) }]} />
        ))}

        {selectedId
          ? (() => {
              const segment = ordered.find((item) => item.id === selectedId);
              if (!segment) return null;
              const index = ordered.indexOf(segment);
              const lowerBound = index > 0 ? ordered[index - 1].endMs : 0;
              const upperBound = index < ordered.length - 1 ? ordered[index + 1].startMs : durationMs;
              return (
                <>
                  <Handle
                    x={toX(segment.startMs)}
                    side="start"
                    onDrag={(dx) => {
                      const next = clamp(
                        toMs(toX(segment.startMs) + dx),
                        lowerBound,
                        segment.endMs - MIN_SEGMENT_MS
                      );
                      onChangeSegment(segment.id, { startMs: Math.round(next) });
                    }}
                  />
                  <Handle
                    x={toX(segment.endMs)}
                    side="end"
                    onDrag={(dx) => {
                      const next = clamp(
                        toMs(toX(segment.endMs) + dx),
                        segment.startMs + MIN_SEGMENT_MS,
                        upperBound
                      );
                      onChangeSegment(segment.id, { endMs: Math.round(next) });
                    }}
                  />
                </>
              );
            })()
          : null}

        <View pointerEvents="none" style={[styles.playhead, { left: toX(playheadMs) }]} />

        <Pressable
          style={styles.seekLayer}
          onPress={(event) => onSeek(toMs(event.nativeEvent.locationX))}
        />
      </View>

      <View style={styles.ruler}>
        <Text style={styles.rulerText}>0:00</Text>
        <Text style={styles.rulerText}>{formatTimecode(durationMs / 2)}</Text>
        <Text style={styles.rulerText}>{formatTimecode(durationMs)}</Text>
      </View>
    </View>
  );
}

function ThumbnailStrip({ thumbnails }: { thumbnails?: (string | null)[] }) {
  if (!thumbnails?.length) return <View style={styles.thumbFallback} />;
  return (
    <View style={styles.thumbRow} pointerEvents="none">
      {thumbnails.map((uri, index) =>
        uri ? (
          <Image key={index} source={{ uri }} style={styles.thumb} resizeMode="cover" />
        ) : (
          <View key={index} style={[styles.thumb, styles.thumbEmpty]} />
        )
      )}
    </View>
  );
}

function SegmentBlock({
  segment,
  selected,
  left,
  width,
  onSelect,
}: {
  segment: Segment;
  selected: boolean;
  left: number;
  width: number;
  onSelect: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync().catch(() => undefined);
        onSelect();
      }}
      style={[styles.segment, selected && styles.segmentSelected, { left, width }]}
    >
      {segment.speed !== 1 && width > 40 ? (
        <Text style={styles.segmentBadge}>{segment.speed.toFixed(2).replace(/0+$/, '')}x</Text>
      ) : null}
    </Pressable>
  );
}

/** A drag handle reporting cumulative dx, so the caller can clamp per frame. */
function Handle({ x, side, onDrag }: { x: number; side: 'start' | 'end'; onDrag: (dx: number) => void }) {
  const startRef = React.useRef(0);

  const responder = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          startRef.current = 0;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
        },
        onPanResponderMove: (_event, gesture) => {
          const delta = gesture.dx - startRef.current;
          startRef.current = gesture.dx;
          onDrag(delta);
        },
      }),
    [onDrag]
  );

  return (
    <View
      {...responder.panHandlers}
      style={[
        styles.handle,
        { left: x - HANDLE_WIDTH / 2 },
        side === 'start' ? styles.handleStart : styles.handleEnd,
      ]}
    >
      <View style={styles.handleGrip} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%' },
  track: {
    height: TRACK_HEIGHT,
    borderRadius: radius.sm,
    backgroundColor: colors.bgElevated,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  thumbRow: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, flexDirection: 'row' },
  thumb: { flex: 1, height: '100%' },
  thumbEmpty: { backgroundColor: colors.surfaceAlt },
  thumbFallback: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.surfaceAlt,
  },
  dimLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(6,6,10,0.62)',
  },
  silence: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(255,92,108,0.18)' },
  beat: { position: 'absolute', top: 0, width: 1, height: 8, backgroundColor: colors.teal },
  segment: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: 'rgba(124,92,255,0.55)',
    backgroundColor: 'rgba(124,92,255,0.14)',
    justifyContent: 'flex-end',
    padding: 3,
  },
  segmentSelected: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(124,92,255,0.26)',
  },
  segmentBadge: { ...typography.tiny, color: colors.text },
  handle: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: HANDLE_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  handleStart: { borderTopLeftRadius: 5, borderBottomLeftRadius: 5 },
  handleEnd: { borderTopRightRadius: 5, borderBottomRightRadius: 5 },
  handleGrip: { width: 2, height: 22, borderRadius: 1, backgroundColor: '#fff', opacity: 0.9 },
  playhead: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: colors.pink },
  seekLayer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  ruler: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
    paddingHorizontal: 2,
  },
  rulerText: { ...typography.tiny, color: colors.textFaint },
});
