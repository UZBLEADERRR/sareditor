import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useKeepAwake } from 'expo-keep-awake';
import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CutTimeline } from '../components/CutTimeline';
import { Sheet } from '../components/Sheet';
import { IconButton } from '../components/ui';
import { resize, splitAt } from '../editing/segments';
import { buildTimeline, outputToSource, sourceToOutput } from '../ffmpeg/timeline';
import { LivePreview } from '../preview/LivePreview';
import type { RootStackParamList } from '../navigation';
import { generateThumbnails } from '../services/media';
import { trace } from '../services/diagnostics';
import { buildPreviewProxy } from '../services/proxy';
import { useProjects } from '../store/projects';
import { colors, radius, spacing, typography } from '../theme';
import { AiChat } from './panels/AiChat';
import { AiPanel } from './panels/AiPanel';
import { EffectsPanel } from './panels/EffectsPanel';
import { ExportPanel } from './panels/ExportPanel';
import { MusicPanel } from './panels/MusicPanel';
import { SubtitlePanel } from './panels/SubtitlePanel';
import { TrimPanel } from './panels/TrimPanel';

const THUMBNAIL_COUNT = 24;

type ToolId = 'trim' | 'subtitle' | 'music' | 'effects' | 'export' | 'ai';

const TOOLS: { id: ToolId; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'trim', label: 'Kesish', icon: 'cut-outline' },
  { id: 'subtitle', label: 'Subtitr', icon: 'chatbox-ellipses-outline' },
  { id: 'music', label: 'Musiqa', icon: 'musical-notes-outline' },
  { id: 'effects', label: 'Effekt', icon: 'color-wand-outline' },
  { id: 'export', label: 'Eksport', icon: 'cloud-upload-outline' },
];

const TOOL_TITLES: Record<ToolId, string> = {
  trim: 'Kesish va tezlik',
  subtitle: 'Subtitr',
  music: 'Musiqa va ovoz',
  effects: 'Rang va effektlar',
  export: 'Eksport',
  ai: 'AI yordamchi',
};

type Nav = NativeStackNavigationProp<RootStackParamList, 'Editor'>;

/**
 * The editor.
 *
 * Picture on top, the cut scrolling under a fixed playhead in the middle,
 * tools in a drawer at the bottom — the shape every phone editor has settled
 * on, because it leaves the preview visible while something is being changed.
 *
 * The header toggle switches the bottom half between doing it yourself and
 * telling the agent what to do. Both write to the same project, so a caption
 * dragged by hand survives the next thing the agent is asked for.
 */
export function EditorScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootStackParamList, 'Editor'>>();
  const insets = useSafeAreaInsets();
  useKeepAwake();

  const projectId = route.params.projectId;
  const project = useProjects((state) => state.projects.find((item) => item.id === projectId));
  const setSegments = useProjects((state) => state.setSegments);
  const undoAiEdit = useProjects((state) => state.undoAiEdit);
  const updateSubtitle = useProjects((state) => state.updateSubtitle);
  const updateOverlay = useProjects((state) => state.updateOverlay);

  const [mode, setMode] = React.useState<'manual' | 'ai'>(
    route.params.startInAi ? 'ai' : 'manual'
  );
  const [tool, setTool] = React.useState<ToolId | null>(null);
  const [selectedSegmentId, setSelectedSegmentId] = React.useState<string | null>(null);
  // The playhead lives on the export timeline; every panel speaks that clock.
  const [playheadMs, setPlayheadMs] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [fullscreen, setFullscreen] = React.useState(false);
  const [thumbnails, setThumbnails] = React.useState<(string | null)[]>([]);
  const [preparing, setPreparing] = React.useState(false);

  const source = project?.source;
  // `attachSource` restarts the project; recording the proxy path must not
  // throw away the cut, the transcript or anything else already done.
  const patchProject = useProjects((state) => state.patch);

  // The preview and the film strip both read the proxy, never the original.
  // Building it before either one touches the file is the whole point: a 4K
  // clip handed to the frame decoder can bring the process down.
  React.useEffect(() => {
    if (!source || !projectId) return undefined;
    let cancelled = false;
    trace(`editor mount ${source.width}x${source.height} proxy=${source.previewUri ? 'yes' : 'no'}`);

    (async () => {
      let playbackUri = source.previewUri;

      if (!playbackUri) {
        setPreparing(true);
        try {
          playbackUri = await buildPreviewProxy(source);
        } catch {
          // A proxy that could not be built must not leave the editor with
          // nothing to play; fall back to the original and record that, so the
          // preview stops waiting for a file that is never coming.
          playbackUri = source.uri;
        } finally {
          if (!cancelled) {
            // Recorded even when it is the original, so the decision survives a
            // remount and the preview knows the wait is over either way.
            patchProject(projectId, {
              source: { ...source, previewUri: playbackUri ?? source.uri },
            });
            setPreparing(false);
          }
        }
      }

      if (cancelled) return;
      const step = source.durationMs / (THUMBNAIL_COUNT + 1);
      const times = Array.from({ length: THUMBNAIL_COUNT }, (_, index) => step * (index + 1));
      const result = await generateThumbnails(playbackUri ?? source.uri, times);
      if (!cancelled) setThumbnails(result);
    })();

    return () => {
      cancelled = true;
    };
  }, [source, projectId, patchProject]);

  if (!project) {
    return (
      <View style={[styles.screen, styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.missing}>Loyiha topilmadi</Text>
        <IconButton icon="chevron-back" onPress={() => navigation.goBack()} />
      </View>
    );
  }

  const timeline = buildTimeline(
    project.segments,
    project.effects.transition === 'none' ? 0 : project.effects.transitionMs
  );
  const selected = project.segments.find((segment) => segment.id === selectedSegmentId);
  const sourcePlayhead = outputToSource(timeline, playheadMs)?.sourceMs ?? 0;
  const lastAiEdit = project.aiEdits?.[0];

  /** Panels seek in source time; the preview and the strip want export time. */
  const seekSource = (sourceMs: number) => {
    const mapped = sourceToOutput(timeline, sourceMs);
    if (mapped !== null) setPlayheadMs(mapped);
  };

  const splitAtPlayhead = () => {
    const next = splitAt(project.segments, sourcePlayhead);
    if (next.length === project.segments.length) {
      Alert.alert('Kesib bo‘lmadi', 'Kursorni bo‘lak ichiga, chetlaridan uzoqroqqa qo‘ying.');
      return;
    }
    setSegments(project.id, next);
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

  const preview = (
    <LivePreview
      project={project}
      preparing={preparing}
      playing={playing}
      onPlayingChange={setPlaying}
      outputMs={playheadMs}
      onSeek={setPlayheadMs}
      fullscreen={fullscreen}
      onToggleFullscreen={() => setFullscreen(!fullscreen)}
      onMoveCaption={({ xPct, yPct }) =>
        updateSubtitle(project.id, { positionXPct: Math.round(xPct), positionPct: Math.round(yPct) })
      }
      onMoveOverlay={(overlayId, { xPct, yPct }) =>
        updateOverlay(project.id, overlayId, { xPct: Math.round(xPct), yPct: Math.round(yPct) })
      }
    />
  );

  if (fullscreen) {
    return (
      <View style={styles.fullscreen}>
        {preview}
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

        <View style={styles.modeToggle}>
          <ModeButton
            label="Qo‘lda"
            icon="options-outline"
            active={mode === 'manual'}
            onPress={() => setMode('manual')}
          />
          <ModeButton
            label="AI"
            icon="sparkles"
            active={mode === 'ai'}
            onPress={() => setMode('ai')}
          />
        </View>

        <View style={styles.headerRight}>
          {/* Export stays reachable from both modes; the toolbar disappears in AI mode. */}
          <IconButton icon="cloud-upload-outline" onPress={() => setTool('export')} />
          <IconButton icon="settings-outline" onPress={() => navigation.navigate('Settings')} />
        </View>
      </View>

      <View style={styles.stage}>{preview}</View>

      <View style={styles.transport}>
        <TransportButton
          icon="arrow-undo-outline"
          label="Bekor"
          disabled={!lastAiEdit}
          onPress={() => lastAiEdit && undoAiEdit(project.id, lastAiEdit.id)}
        />
        <TransportButton icon="cut-outline" label="Kesish" onPress={splitAtPlayhead} />

        <Pressable style={styles.playButton} onPress={() => setPlaying(!playing)}>
          <Ionicons name={playing ? 'pause' : 'play'} size={20} color="#fff" />
        </Pressable>

        <TransportButton
          icon="trash-outline"
          label="O‘chirish"
          tone={colors.red}
          disabled={!selected}
          onPress={deleteSelected}
        />
        <TransportButton icon="expand-outline" label="To‘liq" onPress={() => setFullscreen(true)} />
      </View>

      <CutTimeline
        project={project}
        timeline={timeline}
        playheadMs={playheadMs}
        selectedId={selectedSegmentId}
        thumbnails={thumbnails}
        onSeek={setPlayheadMs}
        onSelect={setSelectedSegmentId}
        onChangeSegment={(id, patch) => setSegments(project.id, resize(project.segments, id, patch))}
      />

      {mode === 'manual' ? (
        <View style={[styles.toolbar, { paddingBottom: insets.bottom + spacing.sm }]}>
          {TOOLS.map((item) => (
            <Pressable key={item.id} style={styles.tool} onPress={() => setTool(item.id)}>
              <View style={styles.toolIcon}>
                <Ionicons name={item.icon} size={18} color={colors.text} />
              </View>
              <Text style={styles.toolLabel}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={[styles.aiDock, { paddingBottom: insets.bottom + spacing.sm }]}>
          <View style={styles.aiDockHeader}>
            <Text style={styles.aiDockTitle}>Ayting — men qilaman</Text>
            <Pressable onPress={() => setTool('ai')} hitSlop={8}>
              <Text style={styles.aiDockMore}>Batafsil</Text>
            </Pressable>
          </View>
          <ScrollView
            style={styles.aiDockBody}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <AiChat project={project} compact />
          </ScrollView>
        </View>
      )}

      <Sheet
        visible={tool !== null}
        title={tool ? TOOL_TITLES[tool] : ''}
        onClose={() => setTool(null)}
      >
        {tool === 'trim' ? (
          <TrimPanel
            project={project}
            selectedSegmentId={selectedSegmentId}
            onSelectSegment={setSelectedSegmentId}
            onSeek={seekSource}
          />
        ) : null}
        {tool === 'subtitle' ? <SubtitlePanel project={project} onSeek={seekSource} /> : null}
        {tool === 'music' ? <MusicPanel project={project} /> : null}
        {tool === 'effects' ? <EffectsPanel project={project} playheadMs={playheadMs} /> : null}
        {tool === 'export' ? <ExportPanel project={project} /> : null}
        {tool === 'ai' ? <AiPanel project={project} /> : null}
      </Sheet>
    </View>
  );
}

function ModeButton({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.modeButton, active && styles.modeButtonActive]}>
      <Ionicons name={icon} size={14} color={active ? '#fff' : colors.textFaint} />
      <Text style={[styles.modeLabel, active && styles.modeLabelActive]}>{label}</Text>
    </Pressable>
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
        disabled && { opacity: 0.3 },
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
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.xs,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 2,
  },
  modeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  modeButtonActive: { backgroundColor: colors.accent },
  modeLabel: { ...typography.tiny, color: colors.textFaint },
  modeLabelActive: { color: '#fff' },

  stage: { flex: 1, paddingHorizontal: spacing.lg, minHeight: 180 },

  transport: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  transportButton: { alignItems: 'center', gap: 3, width: 58 },
  transportLabel: { ...typography.tiny, color: colors.textDim },
  playButton: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },

  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    backgroundColor: colors.bgElevated,
  },
  tool: { alignItems: 'center', gap: 5 },
  toolIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolLabel: { ...typography.tiny, color: colors.textDim },

  aiDock: {
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    backgroundColor: colors.bgElevated,
    paddingHorizontal: spacing.lg,
    maxHeight: '46%',
  },
  aiDockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
  },
  aiDockTitle: { ...typography.tiny, color: colors.textFaint },
  aiDockMore: { ...typography.tiny, color: colors.accentSoft },
  aiDockBody: { flexGrow: 0 },
});
