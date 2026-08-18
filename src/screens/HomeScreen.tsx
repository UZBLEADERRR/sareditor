import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useBrand } from '../brand';
import { Badge, Button, EmptyState, IconButton } from '../components/ui';
import { PLATFORM_PRESETS } from '../ffmpeg/presets';
import type { RootStackParamList } from '../navigation';
import { generateThumbnails, pickVideo, recordVideo } from '../services/media';
import { useProjects } from '../store/projects';
import { useSettings } from '../store/settings';
import { colors, gradients, radius, spacing, typography } from '../theme';
import type { Project } from '../types/project';
import { formatDuration, formatBytes } from '../utils/format';
import { toFileUri } from '../utils/paths';
import { buildTimeline } from '../ffmpeg/timeline';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Home'>;

export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();

  const projects = useProjects((state) => state.projects);
  const createProject = useProjects((state) => state.create);
  const attachSource = useProjects((state) => state.attachSource);
  const removeProject = useProjects((state) => state.remove);
  const setActive = useProjects((state) => state.setActive);

  const brand = useBrand();
  const defaultPlatform = useSettings((state) => state.defaultPlatform);
  // Readiness means a key *and* a chosen model, and the speech side may be
  // borrowing the model key when both point at the same provider.
  const llmReady = useSettings((state) => state.isLlmReady());
  const sttReady = useSettings((state) => state.isSttReady());

  const [busy, setBusy] = React.useState(false);

  const startProject = React.useCallback(
    async (mode: 'library' | 'camera') => {
      setBusy(true);
      try {
        const source = mode === 'library' ? await pickVideo() : await recordVideo();
        if (!source) return;

        const project = createProject(
          source.name.replace(/\.[^.]+$/, '').slice(0, 30),
          defaultPlatform as Project['export']['platform']
        );
        attachSource(project.id, source);
        navigation.navigate('Editor', { projectId: project.id });
      } catch (error) {
        Alert.alert('Video ochilmadi', (error as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [attachSource, createProject, defaultPlatform, navigation]
  );

  const openProject = (project: Project) => {
    setActive(project.id);
    navigation.navigate('Editor', { projectId: project.id });
  };

  const confirmDelete = (project: Project) => {
    Alert.alert('Loyihani o‘chirish', `"${project.name}" o‘chirilsinmi?`, [
      { text: 'Bekor qilish', style: 'cancel' },
      { text: 'O‘chirish', style: 'destructive', onPress: () => removeProject(project.id) },
    ]);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.brandRow}>
          {brand.logoUri ? (
            <Image source={{ uri: toFileUri(brand.logoUri) }} style={styles.brandLogo} />
          ) : null}
          <View>
            <Text style={styles.brand}>{brand.name}</Text>
            <Text style={styles.tagline}>{brand.tagline}</Text>
          </View>
        </View>
        <IconButton icon="settings-outline" onPress={() => navigation.navigate('Settings')} size={22} />
      </View>

      {!llmReady || !sttReady ? (
        <Pressable style={styles.setupBanner} onPress={() => navigation.navigate('Settings')}>
          <Ionicons name="sparkles-outline" size={18} color={colors.amber} />
          <View style={{ flex: 1 }}>
            <Text style={styles.setupTitle}>AI hali ulanmagan</Text>
            <Text style={styles.setupText}>
              {!sttReady && !llmReady
                ? 'Kalitni qo‘shing va modelni tanlang — bittasi ham matn, ham nutqqa yetadi'
                : !sttReady
                  ? 'Subtitr uchun nutq modelini tanlang'
                  : 'Avto-montaj uchun modelni tanlang'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
        </Pressable>
      ) : null}

      <FlatList
        data={projects}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 140 }]}
        ListHeaderComponent={
          projects.length ? <Text style={styles.listHeader}>LOYIHALAR</Text> : null
        }
        ListEmptyComponent={
          <EmptyState
            icon="film-outline"
            title="Hali loyiha yo‘q"
            message="Videoni tanlang — AI o‘zi kesadi, subtitr yozadi, ranglarni qo‘yadi va misollarga rasm chizadi."
          />
        }
        renderItem={({ item }) => (
          <ProjectRow project={item} onPress={() => openProject(item)} onLongPress={() => confirmDelete(item)} />
        )}
      />

      <View style={[styles.dock, { paddingBottom: insets.bottom + spacing.md }]}>
        <LinearGradient colors={gradients.fade} style={styles.dockFade} pointerEvents="none" />
        <View style={styles.dockRow}>
          <Button
            label="Galereyadan"
            icon="images-outline"
            onPress={() => startProject('library')}
            loading={busy}
            style={{ flex: 2 }}
          />
          <Button
            label="Yozish"
            icon="videocam-outline"
            variant="secondary"
            onPress={() => startProject('camera')}
            disabled={busy}
            style={{ flex: 1 }}
          />
        </View>
      </View>
    </View>
  );
}

function ProjectRow({
  project,
  onPress,
  onLongPress,
}: {
  project: Project;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const [thumb, setThumb] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    if (!project.source) {
      setLoading(false);
      return;
    }
    const at = project.segments[0]?.startMs ?? 0;
    generateThumbnails(project.source.uri, [at + 200])
      .then(([uri]) => {
        if (!cancelled) setThumb(uri);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.source, project.segments]);

  const timeline = buildTimeline(
    project.segments,
    project.effects.transition === 'none' ? 0 : project.effects.transitionMs
  );
  const preset = PLATFORM_PRESETS[project.export.platform];

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.75 }]}
    >
      <View style={styles.thumb}>
        {thumb ? (
          <Image source={{ uri: thumb }} style={styles.thumbImage} resizeMode="cover" />
        ) : loading ? (
          <ActivityIndicator size="small" color={colors.textFaint} />
        ) : (
          <Ionicons name="film-outline" size={20} color={colors.textFaint} />
        )}
      </View>

      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {project.name}
        </Text>
        <View style={styles.rowMeta}>
          <Badge label={preset.label} />
          <Text style={styles.rowMetaText}>{formatDuration(timeline.totalMs)}</Text>
          {project.transcript ? (
            <Ionicons name="chatbox-ellipses-outline" size={13} color={colors.teal} />
          ) : null}
          {project.music.enabled ? (
            <Ionicons name="musical-notes-outline" size={13} color={colors.pink} />
          ) : null}
          {project.renders.length ? (
            <Text style={styles.rowMetaText}>{formatBytes(project.renders[0].sizeBytes)}</Text>
          ) : null}
        </View>
      </View>

      <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  brandLogo: { width: 38, height: 38, borderRadius: radius.md },
  brand: { ...typography.display, color: colors.text },
  tagline: { ...typography.tiny, color: colors.textFaint, marginTop: 2 },

  setupBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: `${colors.amber}14`,
    borderWidth: 1,
    borderColor: `${colors.amber}33`,
  },
  setupTitle: { ...typography.small, color: colors.text, fontWeight: '700' },
  setupText: { ...typography.tiny, color: colors.textDim, marginTop: 2 },

  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  listHeader: { ...typography.section, color: colors.textFaint, marginBottom: spacing.sm },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  thumb: {
    width: 54,
    height: 68,
    borderRadius: radius.sm,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbImage: { width: '100%', height: '100%' },
  rowBody: { flex: 1, gap: 6 },
  rowTitle: { ...typography.body, color: colors.text, fontWeight: '700' },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  rowMetaText: { ...typography.tiny, color: colors.textFaint },

  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  dockFade: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  dockRow: { flexDirection: 'row', gap: spacing.sm },
});
