import { Ionicons } from '@expo/vector-icons';
import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ASPECT_RATIOS } from '../ffmpeg/presets';
import { colors, radius, spacing, typography } from '../theme';
import type { AspectId } from '../types/project';
import { formatTimecode } from '../utils/format';
import { toFileUri } from '../utils/paths';

export type VideoPreviewHandle = {
  seekTo: (ms: number) => void;
  play: () => void;
  pause: () => void;
};

type Props = {
  uri?: string;
  aspect: AspectId;
  /** Restricts scrubbing and playback to the current cut. */
  boundsMs?: { startMs: number; endMs: number };
  onTimeUpdate?: (ms: number) => void;
  overlay?: React.ReactNode;
  /** Rendered previews are already framed, so the mask would double up. */
  showAspectMask?: boolean;
};

/**
 * Source playback with a crop guide for the target aspect.
 *
 * The player shows the untouched source — the burned-in look only exists after a
 * render — so the mask matters: it is the only way to see what will actually
 * survive the reframe to 9:16 while trimming.
 */
export const VideoPreview = React.forwardRef<VideoPreviewHandle, Props>(function VideoPreview(
  { uri, aspect, boundsMs, onTimeUpdate, overlay, showAspectMask = true },
  ref
) {
  const player = useVideoPlayer(uri ? toFileUri(uri) : null, (instance) => {
    instance.loop = false;
    instance.timeUpdateEventInterval = 0.1;
    instance.muted = false;
  });

  const [playing, setPlaying] = React.useState(false);
  const [currentMs, setCurrentMs] = React.useState(0);
  const [ready, setReady] = React.useState(false);

  useEventListener(player, 'playingChange', ({ isPlaying }) => setPlaying(isPlaying));
  useEventListener(player, 'statusChange', ({ status }) => setReady(status === 'readyToPlay'));

  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    const ms = currentTime * 1000;
    setCurrentMs(ms);
    onTimeUpdate?.(ms);

    // Keep playback inside the trimmed range so preview matches the cut.
    if (boundsMs && ms >= boundsMs.endMs - 30) {
      player.pause();
      player.currentTime = boundsMs.startMs / 1000;
    }
  });

  React.useImperativeHandle(ref, () => ({
    seekTo: (ms: number) => {
      player.currentTime = Math.max(0, ms) / 1000;
      setCurrentMs(ms);
    },
    play: () => player.play(),
    pause: () => player.pause(),
  }));

  const toggle = React.useCallback(() => {
    if (playing) {
      player.pause();
      return;
    }
    if (boundsMs && (currentMs < boundsMs.startMs || currentMs >= boundsMs.endMs - 40)) {
      player.currentTime = boundsMs.startMs / 1000;
    }
    player.play();
  }, [playing, player, boundsMs, currentMs]);

  const ratio = ASPECT_RATIOS[aspect];

  return (
    <View style={styles.wrapper}>
      <View style={styles.stage}>
        {uri ? (
          <VideoView
            player={player}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            nativeControls={false}
          />
        ) : (
          <View style={styles.placeholder}>
            <Ionicons name="videocam-outline" size={28} color={colors.textFaint} />
          </View>
        )}

        {showAspectMask && uri ? <AspectMask ratio={ratio} /> : null}
        {overlay}

        {!ready && uri ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.accentSoft} />
          </View>
        ) : null}

        <Pressable style={styles.tapLayer} onPress={toggle}>
          {!playing ? (
            <View style={styles.playBadge}>
              <Ionicons name="play" size={22} color="#fff" />
            </View>
          ) : null}
        </Pressable>

        <View style={styles.timecode}>
          <Text style={styles.timecodeText}>{formatTimecode(currentMs, true)}</Text>
        </View>
      </View>
    </View>
  );
});

/**
 * Draws the safe frame for the export aspect over the source video. Everything
 * dimmed is what a `crop` fill mode will throw away.
 */
function AspectMask({ ratio }: { ratio: number }) {
  const [box, setBox] = React.useState({ width: 0, height: 0 });

  const frame = React.useMemo(() => {
    if (!box.width || !box.height) return null;
    const containerRatio = box.width / box.height;
    if (containerRatio > ratio) {
      const width = box.height * ratio;
      return { width, height: box.height, left: (box.width - width) / 2, top: 0 };
    }
    const height = box.width / ratio;
    return { width: box.width, height, left: 0, top: (box.height - height) / 2 };
  }, [box, ratio]);

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={(event) =>
        setBox({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })
      }
    >
      {frame ? (
        <View
          style={[
            styles.maskFrame,
            { left: frame.left, top: frame.top, width: frame.width, height: frame.height },
          ]}
        />
      ) : null}
    </View>
  );
}

/** RN 0.86 dropped `StyleSheet.absoluteFillObject`; this is the spreadable equivalent. */
const FILL = { position: 'absolute' as const, left: 0, right: 0, top: 0, bottom: 0 };

const styles = StyleSheet.create({
  wrapper: { width: '100%' },
  stage: {
    width: '100%',
    aspectRatio: 16 / 10,
    backgroundColor: '#000',
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  placeholder: { ...FILL, alignItems: 'center', justifyContent: 'center' },
  loading: { ...FILL, alignItems: 'center', justifyContent: 'center' },
  tapLayer: { ...FILL, alignItems: 'center', justifyContent: 'center' },
  playBadge: {
    width: 54,
    height: 54,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(10,10,16,0.62)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    paddingLeft: 3,
  },
  maskFrame: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: 'rgba(124,92,255,0.75)',
    borderRadius: 4,
  },
  timecode: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(6,6,10,0.7)',
  },
  timecodeText: { ...typography.mono, color: colors.text },
});
