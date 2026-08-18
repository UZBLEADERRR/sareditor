import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Badge, Button, Card, ChipRow, Divider, Hint, SectionTitle, Stat } from '../../components/ui';
import {
  ASPECT_SIZES,
  ENCODER_OPTIONS,
  PLATFORM_ORDER,
  PLATFORM_PRESETS,
} from '../../ffmpeg/presets';
import { buildTimeline } from '../../ffmpeg/timeline';
import { saveToGallery, shareFile } from '../../services/media';
import { cancelRender, estimateOutputBytes, renderProject, writeSrtFile, type RenderProgress } from '../../services/render';
import { useProjects } from '../../store/projects';
import { useSettings } from '../../store/settings';
import { colors, radius, spacing, typography } from '../../theme';
import type { AspectId, EncoderId, PlatformId, Project } from '../../types/project';
import { clearWorkDir } from '../../utils/paths';
import { even, formatBytes, formatDuration, formatTimecode } from '../../utils/format';
import { uid } from '../../utils/id';

const ASPECTS: { value: AspectId; label: string }[] = [
  { value: '9:16', label: '9:16' },
  { value: '4:5', label: '4:5' },
  { value: '1:1', label: '1:1' },
  { value: '16:9', label: '16:9' },
];

const RESOLUTIONS = [
  { value: '720', label: '720p', scale: 720 / 1080 },
  { value: '1080', label: '1080p', scale: 1 },
  { value: '1440', label: '2K', scale: 1440 / 1080 },
];

export function ExportPanel({ project }: { project: Project }) {
  const updateExport = useProjects((state) => state.updateExport);
  const setPlatform = useProjects((state) => state.setPlatform);
  const addRender = useProjects((state) => state.addRender);
  const markRenderSaved = useProjects((state) => state.markRenderSaved);
  const removeRender = useProjects((state) => state.removeRender);
  const keepWorkFiles = useSettings((state) => state.keepWorkFiles);

  const [progress, setProgress] = React.useState<RenderProgress | null>(null);
  const [renderKey, setRenderKey] = React.useState<string | null>(null);

  const config = project.export;
  const preset = PLATFORM_PRESETS[config.platform];
  const timeline = buildTimeline(
    project.segments,
    project.effects.transition === 'none' ? 0 : project.effects.transitionMs
  );
  const overTarget = timeline.totalMs > preset.maxDurationMs;

  const setAspect = (aspect: AspectId) => {
    const base = ASPECT_SIZES[aspect];
    const scale = config.height / ASPECT_SIZES[config.aspect].height;
    updateExport(project.id, {
      aspect,
      width: even(Math.round(base.width * scale)),
      height: even(Math.round(base.height * scale)),
    });
  };

  const setResolution = (value: string) => {
    const option = RESOLUTIONS.find((item) => item.value === value);
    if (!option) return;
    const base = ASPECT_SIZES[config.aspect];
    updateExport(project.id, {
      width: even(Math.round(base.width * option.scale)),
      height: even(Math.round(base.height * option.scale)),
      videoBitrateKbps: Math.round(preset.videoBitrateKbps * option.scale ** 1.6),
    });
  };

  const currentResolution =
    RESOLUTIONS.find(
      (option) => Math.abs(config.height - ASPECT_SIZES[config.aspect].height * option.scale) < 40
    )?.value ?? '1080';

  const start = async () => {
    if (!project.source) return;
    if (!timeline.totalMs) {
      Alert.alert('Bo‘sh montaj', 'Avval kamida bitta bo‘lak qoldiring.');
      return;
    }

    const key = uid('render_');
    setRenderKey(key);
    setProgress({ stage: 'prepare', progress: 0, message: 'Boshlanmoqda…' });

    try {
      const record = await renderProject(project, { key, onProgress: setProgress });
      addRender(project.id, record);
      if (!keepWorkFiles) clearWorkDir();
      Alert.alert(
        'Tayyor',
        `${formatDuration(record.durationMs)} · ${formatBytes(record.sizeBytes)}\n\nGalereyaga saqlang yoki to‘g‘ridan-to‘g‘ri ulashing.`
      );
    } catch (error) {
      const message = (error as Error).message;
      if ((error as Error).name !== 'CancelledError') {
        Alert.alert('Render bo‘lmadi', message);
      }
    } finally {
      setProgress(null);
      setRenderKey(null);
    }
  };

  const stop = async () => {
    if (renderKey) await cancelRender(renderKey);
  };

  const exportSrt = async () => {
    const uri = writeSrtFile(project);
    if (!uri) {
      Alert.alert('Subtitr yo‘q', 'Avval nutqni matnga aylantiring.');
      return;
    }
    try {
      await shareFile(uri);
    } catch (error) {
      Alert.alert('Ulashib bo‘lmadi', (error as Error).message);
    }
  };

  return (
    <View>
      <SectionTitle>Platforma</SectionTitle>
      <Card>
        <ChipRow<PlatformId>
          options={PLATFORM_ORDER.map((id) => ({ value: id, label: PLATFORM_PRESETS[id].label }))}
          value={config.platform}
          onChange={(platform) => setPlatform(project.id, platform)}
        />
        <Hint>{preset.hint}</Hint>

        <View style={{ height: spacing.lg }} />
        <View style={styles.statRow}>
          <Stat label="DAVOMIYLIK" value={formatTimecode(timeline.totalMs)} tone={overTarget ? 'warn' : 'good'} />
          <Stat label="O‘LCHAM" value={`${config.width}×${config.height}`} />
          <Stat label="TAXMINAN" value={formatBytes(estimateOutputBytes(project))} />
        </View>
        {overTarget ? (
          <Hint style={{ color: colors.amber }}>
            {preset.label} chegarasi {formatDuration(preset.maxDurationMs)} — hozirgi montaj undan uzun.
          </Hint>
        ) : null}
      </Card>

      <SectionTitle>Format</SectionTitle>
      <Card>
        <Text style={styles.fieldLabel}>Nisbat</Text>
        <ChipRow options={ASPECTS} value={config.aspect} onChange={setAspect} />

        <View style={{ height: spacing.lg }} />
        <Text style={styles.fieldLabel}>Sifat</Text>
        <ChipRow
          options={RESOLUTIONS.map((item) => ({ value: item.value, label: item.label }))}
          value={currentResolution}
          onChange={setResolution}
        />

        <View style={{ height: spacing.lg }} />
        <Text style={styles.fieldLabel}>Kadr chastotasi</Text>
        <ChipRow
          options={[
            { value: '24', label: '24 fps' },
            { value: '30', label: '30 fps' },
            { value: '60', label: '60 fps' },
          ]}
          value={String(config.fps)}
          onChange={(value) => updateExport(project.id, { fps: Number(value) })}
        />
        <Hint>
          Instagram va TikTok 30 fps bilan eng barqaror ishlaydi. 60 fps faqat tez harakatli kadrlarda
          farq qiladi va fayl hajmini oshiradi.
        </Hint>
      </Card>

      <SectionTitle>Koder</SectionTitle>
      <Card>
        <ChipRow<EncoderId>
          options={ENCODER_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
          value={config.encoder}
          onChange={(encoder) => updateExport(project.id, { encoder })}
        />
        <Hint>{ENCODER_OPTIONS.find((option) => option.id === config.encoder)?.hint}</Hint>
      </Card>

      <SectionTitle>Render</SectionTitle>
      <Card>
        {progress ? (
          <>
            <View style={styles.progressHeader}>
              <Text style={styles.progressMessage}>{progress.message}</Text>
              <Text style={styles.progressPercent}>{Math.round(progress.progress * 100)}%</Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.round(progress.progress * 100)}%` }]} />
            </View>
            <View style={styles.progressMeta}>
              {progress.speed ? <Text style={styles.progressMetaText}>{progress.speed.toFixed(2)}x</Text> : null}
              {progress.etaMs ? (
                <Text style={styles.progressMetaText}>
                  qolgan vaqt ~{formatDuration(progress.etaMs)}
                </Text>
              ) : null}
            </View>
            <View style={{ height: spacing.md }} />
            <Button label="To‘xtatish" icon="stop-circle-outline" variant="danger" onPress={stop} />
          </>
        ) : (
          <>
            <Text style={styles.lead}>
              Butun jarayon telefon ichida bajariladi — video hech qayerga yuklanmaydi. Uzunroq
              videolarda ekranni o‘chirmang.
            </Text>
            <Button
              label="Videoni tayyorlash"
              icon="sparkles-outline"
              onPress={start}
              disabled={!project.source}
            />
          </>
        )}
      </Card>

      <SectionTitle>Qo‘shimcha</SectionTitle>
      <Card>
        <Button
          label="Subtitrni .srt qilib chiqarish"
          icon="document-text-outline"
          variant="secondary"
          onPress={exportSrt}
          disabled={!project.transcript}
          compact
        />
        <Hint>YouTube’ga alohida subtitr fayli sifatida yuklash uchun.</Hint>
      </Card>

      {project.renders.length ? (
        <>
          <SectionTitle>Tayyor videolar</SectionTitle>
          {project.renders.map((render) => (
            <Card key={render.id} style={{ marginBottom: spacing.sm }}>
              <View style={styles.renderHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.renderTitle}>
                    {formatDuration(render.durationMs)} · {formatBytes(render.sizeBytes)}
                  </Text>
                  <Text style={styles.renderMeta}>
                    {new Date(render.createdAt).toLocaleString()} ·{' '}
                    {PLATFORM_PRESETS[render.platform].label}
                  </Text>
                </View>
                {render.savedToGallery ? <Badge label="Saqlandi" color={colors.green} /> : null}
              </View>

              <Divider />

              <View style={styles.renderActions}>
                <RenderAction
                  icon="download-outline"
                  label="Galereya"
                  onPress={async () => {
                    try {
                      await saveToGallery(render.uri);
                      markRenderSaved(project.id, render.id);
                      Alert.alert('Saqlandi', 'Video galereyadagi “Fara Editor” albomida.');
                    } catch (error) {
                      Alert.alert('Saqlanmadi', (error as Error).message);
                    }
                  }}
                />
                <RenderAction
                  icon="share-social-outline"
                  label="Ulashish"
                  onPress={async () => {
                    try {
                      await shareFile(render.uri);
                    } catch (error) {
                      Alert.alert('Ulashib bo‘lmadi', (error as Error).message);
                    }
                  }}
                />
                <RenderAction
                  icon="trash-outline"
                  label="O‘chirish"
                  tone={colors.red}
                  onPress={() => removeRender(project.id, render.id)}
                />
              </View>
            </Card>
          ))}
        </>
      ) : null}
    </View>
  );
}

function RenderAction({
  icon,
  label,
  onPress,
  tone,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  tone?: string;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.renderAction, pressed && { opacity: 0.6 }]}>
      <Ionicons name={icon} size={17} color={tone ?? colors.text} />
      <Text style={[styles.renderActionLabel, tone ? { color: tone } : null]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  lead: { ...typography.small, color: colors.textDim, lineHeight: 19, marginBottom: spacing.md },
  fieldLabel: { ...typography.small, color: colors.textDim, marginBottom: 6 },
  statRow: { flexDirection: 'row' },

  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  progressMessage: { ...typography.small, color: colors.text },
  progressPercent: { ...typography.mono, color: colors.accentSoft },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.accent },
  progressMeta: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  progressMetaText: { ...typography.tiny, color: colors.textFaint },

  renderHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  renderTitle: { ...typography.body, color: colors.text, fontWeight: '700' },
  renderMeta: { ...typography.tiny, color: colors.textFaint, marginTop: 2 },
  renderActions: { flexDirection: 'row', justifyContent: 'space-around' },
  renderAction: { alignItems: 'center', gap: 4, paddingVertical: spacing.xs, flex: 1 },
  renderActionLabel: { ...typography.tiny, color: colors.textDim },
});
