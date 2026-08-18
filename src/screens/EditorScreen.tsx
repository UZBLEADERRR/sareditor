import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useKeepAwake } from 'expo-keep-awake';
import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Timeline } from '../components/Timeline';
import { IconButton } from '../components/ui';
import { PLATFORM_PRESETS } from '../ffmpeg/presets';
import { buildTimeline, outputToSource, sourceToOutput } from '../ffmpeg/timeline';
import { LivePreview } from '../preview/LivePreview';
import type { RootStackParamList } from '../navigation';
import { generateThumbnails } from '../services/media';
import { useProjects } from '../store/projects';
import { colors, radius, spacing, typography } from '../theme';
import type { Segment } from '../types/project';
import { formatDuration, formatTimecode } from '../utils/format';
import { uid } from '../utils/id';
import { AiPanel } from './panels/AiPanel';
import { EffectsPanel } from './panels/EffectsPanel';
import { ExportPanel } from './panels/ExportPanel';
import { MusicPanel } from './panels/MusicPanel';
import { SubtitlePanel } from './panels/SubtitlePanel';
import { TrimPanel } from './panels/TrimPanel';

const THUMBNAIL_COUNT = 12;

type TabId = 'trim' | 'subtitle' | 'music' | 'effects' | 'ai' | 'export';

const TABS: { id: TabId; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'trim', label: 'Kesish', icon: 'cut-outline' },
  { id: 'subtitle', label: 'Subtitr', icon: 'chatbox-ellipses-outline' },
  { id: 'music', label: 'Musiqa', icon: 'musical-notes-outline' },
  { id: 'effects', label: 'Effekt', icon: 'color-wand-outline' },
  { id: 'ai', label: 'AI', icon: 'sparkles-outline' },
  { id: 'export', label: 'Eksport', icon: 'cloud-upload-outline' },
];

type Nav = NativeStackNavigationProp<RootStackParamList, 'Editor'>;

export function EditorScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootStackParamList, 'Editor'>>();
  const insets = useSafeAreaInsets();
  useKeepAwake();

  const projectId = route.params.projectId;
  const project = useProjects((state) => state.projects.find((item) => item.id === projectId));
  const setSegments = useProjects((state) => state.setSegments);

  const updateSubtitle = useProjects((state) => state.updateSubtitle);
  const updateOverlay = useProjects((state) => state.updateOverlay);

  const [tab, setTab] = React.useState<TabId>('trim');
  const [selectedSegmentId, setSelectedSegmentId] = React.useState<string | null>(null);
  // The playhead lives on the *export* timeline; the preview and every panel
  // speak that clock, and only the strip converts back to source time.
  const [playheadMs, setPlayheadMs] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [fullscreen, setFullscreen] = React.useState(false);
  const [thumbnails, setThumbnails] = React.useState<(string | null)[]>([]);

  React.useEffect(() => {
    if (!project?.source) return;
    let cancelled = false;
    const step = project.source.durationMs / (THUMBNAIL_COUNT + 1);
    const times = Array.from({ length: THUMBNAIL_COUNT }, (_, index) => step * (index + 1));

    generateThumbnails(project.source.uri, times).then((result) => {
      if (!cancelled) setThumbnails(result);
    });
    return () => {
      cancelled = true;
    };
  }, [project?.source]);

  if (!project) {
    return (
      <View style={[styles.screen, styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.missing}>Loyiha topilmadi</Text>
        <IconButton icon="chevron-back" onPress={() => navigation.goBack()} />
      </View>
    );
  }

  const source = project.source;
  const timeline = buildTimeline(
    project.segments,
    project.effects.transition === 'none' ? 0 : project.effects.transitionMs
  );
  const selected = project.segments.find((segment) => segment.id === selectedSegmentId);

  /** Panels and the strip seek in source time; the preview wants export time. */
  const seekSource = (sourceMs: number) => {
    const mapped = sourceToOutput(timeline, sourceMs);
    setPlayheadMs(mapped ?? playheadMs);
  };
  const seek = seekSource;

  const sourcePlayhead = outputToSource(timeline, playheadMs)?.sourceMs ?? 0;

  /** Splits the segment under the playhead into two, which is the core cut gesture. */
  const splitAtPlayhead = () => {
    const target = project.segments.find(
      (segment) => sourcePlayhead > segment.startMs + 200 && sourcePlayhead < segment.endMs - 200
    );
    if (!target) {
      Alert.alert('Kesib bo‘lmadi', 'Kursorni bo‘lak ichiga, chetlaridan uzoqroqqa qo‘ying.');
      return;
    }
    const cut = Math.round(sourcePlayhead);
    const next: Segment[] = [];
    for (const segment of project.segments) {
      if (segment.id !== target.id) {
        next.push(segment);
        continue;
      }
      next.push({ ...segment, endMs: cut });
      next.push({ ...segment, id: uid('seg_'), startMs: cut });
    }
    setSegments(project.id, next.sort((a, b) => a.startMs - b.startMs));
  };

  const deleteSelected = () => {
    if (!selected) return;
    if (project.segments.length <= 1) {
      Alert.alert('O‘chirib bo‘lmadi', 'Kamida bitta bo‘lak qolishi kerak.');
      return;
    }
    setSegments(
      project.id,
      project.segments.filter((segment) => segment.id !== selected.id)
    );
    setSelectedSegmentId(null);
  };

  const changeSegment = (id: string, patch: { startMs?: number; endMs?: number }) => {
    setSegments(
      project.id,
      project.segments.map((segment) => (segment.id === id ? { ...segment, ...patch } : segment))
    );
  };


  if (fullscreen) {
    return (
      <View style={styles.fullscreen}>
        <LivePreview
          project={project}
          playing={playing}
          onPlayingChange={setPlaying}
          outputMs={playheadMs}
          onSeek={setPlayheadMs}
          fullscreen
          onToggleFullscreen={() => setFullscreen(false)}
          onMoveCaption={({ xPct, yPct }) =>
            updateSubtitle(project.id, {
              positionXPct: Math.round(xPct),
              positionPct: Math.round(yPct),
            })
          }
          onMoveOverlay={(overlayId, { xPct, yPct }) =>
            updateOverlay(project.id, overlayId, {
              xPct: Math.round(xPct),
              yPct: Math.round(yPct),
            })
          }
        />
        <Pressable
          onPress={() => setFullscreen(false)}
          style={[styles.fullscreenClose, { top: insets.top + spacing.sm }]}
        >
          <Ionicons name="close" size={20} color="#fff" />
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <IconButton icon="chevron-back" onPress={() => navigation.goBack()} />
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {project.name}
          </Text>
          <Text style={styles.headerSub}>
            {PLATFORM_PRESETS[project.export.platform].label} · {formatDuration(timeline.totalMs)}
          </Text>
        </View>
        <IconButton icon="settings-outline" onPress={() => navigation.navigate('Settings')} />
      </View>

      <View style={styles.stage}>
        <LivePreview
          project={project}
          playing={playing}
          onPlayingChange={setPlaying}
          outputMs={playheadMs}
          onSeek={setPlayheadMs}
          onToggleFullscreen={() => setFullscreen(true)}
          onMoveCaption={({ xPct, yPct }) =>
            updateSubtitle(project.id, {
              positionXPct: Math.round(xPct),
              positionPct: Math.round(yPct),
            })
          }
          onMoveOverlay={(overlayId, { xPct, yPct }) =>
            updateOverlay(project.id, overlayId, {
              xPct: Math.round(xPct),
              yPct: Math.round(yPct),
            })
          }
        />
      </View>

      <View style={styles.timelineArea}>
        <Timeline
          durationMs={source?.durationMs ?? 0}
          segments={project.segments}
          selectedId={selectedSegmentId}
          playheadMs={sourcePlayhead}
          thumbnails={thumbnails}
          silences={project.analysis?.silences}
          onSelect={setSelectedSegmentId}
          onSeek={seek}
          onChangeSegment={changeSegment}
        />

        <View style={styles.transport}>
          <TransportButton icon="cut-outline" label="Kesish" onPress={splitAtPlayhead} />
          <TransportButton
            icon="trash-outline"
            label="O‘chirish"
            onPress={deleteSelected}
            disabled={!selected}
            tone={colors.red}
          />
          <TransportButton
            icon="play-skip-back-outline"
            label="Boshiga"
            onPress={() => seekSource(selected?.startMs ?? 0)}
          />
          <TransportButton
            icon="scan-outline"
            label={selected ? 'Bekor' : 'Tanlash'}
            onPress={() =>
              setSelectedSegmentId(selected ? null : (project.segments[0]?.id ?? null))
            }
          />
        </View>
      </View>

      <View style={styles.tabBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabScroll}>
          {TABS.map((item) => {
            const active = item.id === tab;
            return (
              <Pressable
                key={item.id}
                onPress={() => setTab(item.id)}
                style={[styles.tab, active && styles.tabActive]}
              >
                <Ionicons name={item.icon} size={15} color={active ? colors.text : colors.textFaint} />
                <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        style={styles.panel}
        contentContainerStyle={[styles.panelContent, { paddingBottom: insets.bottom + spacing.xxl }]}
        keyboardShouldPersistTaps="handled"
      >
        {tab === 'trim' ? (
          <TrimPanel
            project={project}
            selectedSegmentId={selectedSegmentId}
            onSelectSegment={setSelectedSegmentId}
            onSeek={seek}
          />
        ) : null}
        {tab === 'subtitle' ? <SubtitlePanel project={project} onSeek={seek} /> : null}
        {tab === 'music' ? <MusicPanel project={project} /> : null}
        {tab === 'effects' ? <EffectsPanel project={project} playheadMs={playheadMs} /> : null}
        {tab === 'ai' ? <AiPanel project={project} /> : null}
        {tab === 'export' ? <ExportPanel project={project} /> : null}
      </ScrollView>
    </View>
  );
}

function TransportButton({
  icon,
  label,
  onPress,
  disabled,
  tone,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.transportButton,
        disabled && { opacity: 0.35 },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Ionicons name={icon} size={17} color={tone ?? colors.text} />
      <Text style={[styles.transportLabel, tone ? { color: tone } : null]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  fullscreen: { flex: 1, backgroundColor: '#000' },
  fullscreenClose: {
    position: 'absolute',
    right: spacing.lg,
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(6,6,10,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centered: { alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  missing: { ...typography.body, color: colors.textDim },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.xs,
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { ...typography.body, color: colors.text, fontWeight: '700' },
  headerSub: { ...typography.tiny, color: colors.textFaint, marginTop: 1 },

  stage: { paddingHorizontal: spacing.lg },
  timelineArea: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },

  transport: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    paddingVertical: spacing.sm,
  },
  transportButton: { flex: 1, alignItems: 'center', gap: 3 },
  transportLabel: { ...typography.tiny, color: colors.textDim },

  tabBar: { marginTop: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  tabScroll: { paddingHorizontal: spacing.lg, gap: spacing.xs },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: colors.accent },
  tabLabel: { ...typography.small, color: colors.textFaint },
  tabLabelActive: { color: colors.text, fontWeight: '700' },

  panel: { flex: 1 },
  panelContent: { paddingHorizontal: spacing.lg },
});
