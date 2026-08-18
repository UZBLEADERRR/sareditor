import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Alert, Image, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { generateCopy } from '../../ai/director';
import { Badge, Button, Card, Divider, Field, Hint, SectionTitle, Stat, ToggleRow } from '../../components/ui';
import { GRADES } from '../../ffmpeg/filters/grade';
import { PLATFORM_PRESETS } from '../../ffmpeg/presets';
import { SUBTITLE_STYLES } from '../../presets/subtitleStyles';
import { runAutoEdit, type AutoEditProgress } from '../../services/autoEdit';
import { useProjects } from '../../store/projects';
import { useSettings } from '../../store/settings';
import { colors, gradients, radius, spacing, typography } from '../../theme';
import type { Project } from '../../types/project';
import { formatDuration, formatTimecode } from '../../utils/format';
import { toFileUri } from '../../utils/paths';

export function AiPanel({ project }: { project: Project }) {
  const patchProject = useProjects((state) => state.patch);
  const setAiPlan = useProjects((state) => state.setAiPlan);
  const removeOverlay = useProjects((state) => state.removeOverlay);
  const settings = useSettings();

  const [running, setRunning] = React.useState(false);
  const [progress, setProgress] = React.useState<AutoEditProgress | null>(null);
  const [busyCopy, setBusyCopy] = React.useState(false);
  const [instructions, setInstructions] = React.useState('');

  const plan = project.aiPlan;
  const preset = PLATFORM_PRESETS[project.export.platform];
  const canRun = settings.isLlmReady() && settings.isSttReady() && Boolean(project.source);

  const runEverything = async () => {
    if (!project.source) return;
    if (!settings.isLlmReady() || !settings.isSttReady()) {
      Alert.alert(
        'Avval AI ulanishi kerak',
        'Sozlamalarda kalitni kiriting va modelni tanlang. Gemini bo‘lsa, bitta kalit yetadi.'
      );
      return;
    }

    setRunning(true);
    setProgress({ stage: 'transcribe', progress: 0, message: 'Boshlanmoqda…' });
    try {
      const wantsImages = settings.autoImages && settings.isImageReady();
      const result = await runAutoEdit(project, {
        llm: settings.llmConfig(),
        stt: settings.sttConfig(),
        image: wantsImages ? settings.imageConfig() : undefined,
        extraInstructions: instructions.trim() || undefined,
        onProgress: setProgress,
      });

      patchProject(project.id, result.patch);

      const lines = [
        `${result.patch.segments?.length ?? 0} ta bo‘lak qoldirildi`,
        `Rang: ${GRADES[result.plan.suggestedGrade].label}`,
        `Subtitr: ${SUBTITLE_STYLES[result.plan.suggestedSubtitleStyle].label}`,
      ];
      if (result.imagesMade) lines.push(`${result.imagesMade} ta rasm qo‘shildi`);
      if (result.imagesFailed) lines.push(`${result.imagesFailed} ta rasm chiqmadi`);
      if (settings.autoImages && !settings.isImageReady()) {
        lines.push('Rasm modeli tanlanmagani uchun rasmlar qo‘shilmadi');
      }

      Alert.alert('Tayyor', [...lines, ...result.notes].join('\n'));
    } catch (error) {
      Alert.alert('Bajarilmadi', (error as Error).message);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const runCopy = async () => {
    if (!project.transcript) return;
    setBusyCopy(true);
    try {
      const copy = await generateCopy(settings.llmConfig(), project.transcript, preset.label);
      if (!plan) return;
      setAiPlan(project.id, { ...plan, ...copy });
    } catch (error) {
      Alert.alert('Matn yozilmadi', (error as Error).message);
    } finally {
      setBusyCopy(false);
    }
  };

  const totalPlanned = plan?.keepRanges.reduce((sum, range) => sum + (range.endMs - range.startMs), 0) ?? 0;

  return (
    <View>
      <View style={styles.hero}>
        <LinearGradient
          colors={gradients.brandWide}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroGlow}
        />
        <View style={styles.heroBody}>
          <Text style={styles.heroTitle}>Hammasini AI qilsin</Text>
          <Text style={styles.heroText}>
            Bitta tugma: nutqni yozib oladi, keraksiz joylarni kesadi, o‘tishlarni qo‘yadi, rang va
            subtitr uslubini tanlaydi va gapirilgan misollarga rasm chizib ekranga chiqaradi.
          </Text>

          {running && progress ? (
            <View style={styles.progressBox}>
              <View style={styles.progressHeader}>
                <Text style={styles.progressMessage}>{progress.message}</Text>
                <Text style={styles.progressPercent}>{Math.round(progress.progress * 100)}%</Text>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.round(progress.progress * 100)}%` }]} />
              </View>
            </View>
          ) : null}

          <Button
            label={plan ? 'Qaytadan qilsin' : 'Boshlash'}
            icon="sparkles"
            onPress={runEverything}
            loading={running}
            disabled={running || !canRun}
          />

          {!canRun && !running ? (
            <Hint style={{ marginTop: spacing.sm }}>
              Sozlamalarda AI kalitini kiriting va modelni tanlang.
            </Hint>
          ) : null}
        </View>
      </View>

      <SectionTitle>Ko‘rsatmalar</SectionTitle>
      <Card>
        <Field
          label="AI nimaga e’tibor bersin (ixtiyoriy)"
          value={instructions}
          onChangeText={setInstructions}
          placeholder="Masalan: narx haqidagi qismni olib tashla, 30 soniyaga sig‘dir, rasmlar ko‘p bo‘lmasin"
          multiline
          autoCapitalize="sentences"
        />
        <Divider />
        <ToggleRow
          label="Gapirilgan misollarga rasm chizsin"
          hint={
            settings.isImageReady()
              ? 'Aniq narsa aytilganda ekranda rasm paydo bo‘ladi.'
              : 'Buning uchun Sozlamalarda rasm modelini tanlash kerak (Gemini).'
          }
          value={settings.autoImages}
          onChange={(autoImages) => settings.update({ autoImages })}
          disabled={!settings.isImageReady()}
        />
      </Card>

      {project.overlays.length ? (
        <>
          <SectionTitle>Ekrandagi rasmlar</SectionTitle>
          <Card padded={false}>
            {project.overlays.map((overlay) => (
              <View key={overlay.id} style={styles.overlayRow}>
                <Image source={{ uri: toFileUri(overlay.uri) }} style={styles.overlayThumb} resizeMode="cover" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.overlayPhrase} numberOfLines={2}>
                    {overlay.phrase || overlay.prompt}
                  </Text>
                  <Text style={styles.overlayMeta}>
                    {formatTimecode(overlay.startMs)} → {formatTimecode(overlay.endMs)} · {overlay.style}
                  </Text>
                </View>
                <Pressable onPress={() => removeOverlay(project.id, overlay.id)} hitSlop={8}>
                  <Ionicons name="trash-outline" size={17} color={colors.red} />
                </Pressable>
              </View>
            ))}
          </Card>
          <Hint>Rasmlar subtitr tagida, kadrning yuqori qismida chiqadi.</Hint>
        </>
      ) : null}

      {plan ? (
        <>
          <SectionTitle>AI qarori</SectionTitle>
          <Card>
            <View style={styles.statRow}>
              <Stat label="BO‘LAKLAR" value={String(plan.keepRanges.length)} />
              <Stat label="DAVOMIYLIK" value={formatDuration(totalPlanned)} />
              <Stat label="RASMLAR" value={String(project.overlays.length)} />
            </View>

            {plan.hook ? (
              <>
                <Divider />
                <Text style={styles.fieldLabel}>Boshlanish gapi</Text>
                <Text style={styles.hook}>{plan.hook}</Text>
              </>
            ) : null}

            <Divider />
            <View style={styles.badgeRow}>
              <Badge label={`Rang: ${GRADES[plan.suggestedGrade].label}`} />
              <Badge
                label={`Subtitr: ${SUBTITLE_STYLES[plan.suggestedSubtitleStyle].label}`}
                color={colors.teal}
              />
              <Badge label={`O‘tish: ${plan.suggestedTransition}`} color={colors.amber} />
              {plan.musicMood ? <Badge label={plan.musicMood} color={colors.pink} /> : null}
            </View>

            {plan.notes ? <Hint style={{ marginTop: spacing.md }}>{plan.notes}</Hint> : null}
          </Card>

          {plan.keepRanges.length ? (
            <>
              <SectionTitle>Qoldirilgan joylar</SectionTitle>
              <Card padded={false}>
                {plan.keepRanges.map((range, index) => (
                  <View key={index} style={styles.rangeRow}>
                    <Text style={styles.rangeTime}>
                      {formatTimecode(range.startMs)} → {formatTimecode(range.endMs)}
                    </Text>
                    <Text style={styles.rangeReason}>{range.reason || '—'}</Text>
                  </View>
                ))}
              </Card>
            </>
          ) : null}

          <SectionTitle>Post matni</SectionTitle>
          <Card>
            {plan.title ? (
              <>
                <Text style={styles.fieldLabel}>Sarlavha</Text>
                <Text selectable style={styles.copyText}>
                  {plan.title}
                </Text>
              </>
            ) : null}

            {plan.description ? (
              <>
                <View style={{ height: spacing.md }} />
                <Text style={styles.fieldLabel}>Tavsif</Text>
                <Text selectable style={styles.copyText}>
                  {plan.description}
                </Text>
              </>
            ) : null}

            {plan.hashtags.length ? (
              <>
                <View style={{ height: spacing.md }} />
                <Text style={styles.fieldLabel}>Hashtaglar</Text>
                <Text selectable style={styles.hashtags}>
                  {plan.hashtags.join(' ')}
                </Text>
              </>
            ) : null}

            <View style={{ height: spacing.lg }} />
            <View style={styles.buttonRow}>
              <Button
                label="Matnni yangilash"
                icon="create-outline"
                variant="secondary"
                onPress={runCopy}
                loading={busyCopy}
                disabled={!project.transcript || busyCopy}
                style={{ flex: 1 }}
              />
              {plan.description || plan.hashtags.length ? (
                <Pressable
                  style={styles.shareButton}
                  onPress={() =>
                    Share.share({
                      message: [plan.title, plan.description, plan.hashtags.join(' ')]
                        .filter(Boolean)
                        .join('\n\n'),
                    })
                  }
                >
                  <Ionicons name="share-outline" size={18} color={colors.text} />
                </Pressable>
              ) : null}
            </View>
          </Card>

          <Hint style={{ marginTop: spacing.md }}>
            Model: {plan.model} · {new Date(plan.createdAt).toLocaleString()}
          </Hint>
        </>
      ) : (
        <>
          <SectionTitle>Nima bo‘ladi</SectionTitle>
          <Card>
            <Step icon="mic-outline" text="Nutq so‘zma-so‘z vaqti bilan yozib olinadi" />
            <Step icon="cut-outline" text="Keraksiz joylar va uzoq pauzalar kesiladi" />
            <Step icon="swap-horizontal-outline" text="Bo‘laklar orasiga mos o‘tish qo‘yiladi" />
            <Step icon="color-wand-outline" text="Rang va subtitr uslubi tanlanadi" />
            <Step icon="image-outline" text="Aytilgan misollarga rasm chizilib ekranga chiqadi" />
            <Step icon="text-outline" text="Sarlavha, tavsif va hashtaglar yoziladi" />
            <Divider />
            <Hint>
              Hammasi loyihaga qo‘llanadi, lekin qulflanmaydi — har bir bo‘limda qo‘lda o‘zgartirsangiz
              bo‘ladi.
            </Hint>
          </Card>
        </>
      )}
    </View>
  );
}

function Step({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepIcon}>
        <Ionicons name={icon} size={14} color={colors.accentSoft} />
      </View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    marginTop: spacing.lg,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: `${colors.accent}55`,
    backgroundColor: colors.surface,
  },
  heroGlow: { position: 'absolute', left: 0, right: 0, top: 0, height: 3 },
  heroBody: { padding: spacing.lg },
  heroTitle: { ...typography.title, color: colors.text },
  heroText: {
    ...typography.small,
    color: colors.textDim,
    lineHeight: 20,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },

  progressBox: { marginBottom: spacing.lg },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  progressMessage: { ...typography.small, color: colors.text, flex: 1 },
  progressPercent: { ...typography.mono, color: colors.accentSoft },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.accent },

  fieldLabel: { ...typography.small, color: colors.textDim, marginBottom: 6 },
  statRow: { flexDirection: 'row' },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  hook: { ...typography.body, color: colors.text, lineHeight: 22 },
  copyText: { ...typography.small, color: colors.text, lineHeight: 20 },
  hashtags: { ...typography.small, color: colors.accentSoft, lineHeight: 20 },

  overlayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  overlayThumb: {
    width: 52,
    height: 52,
    borderRadius: radius.sm,
    backgroundColor: colors.bgElevated,
  },
  overlayPhrase: { ...typography.small, color: colors.text, lineHeight: 18 },
  overlayMeta: { ...typography.tiny, color: colors.textFaint, marginTop: 3 },

  rangeRow: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  rangeTime: { ...typography.mono, color: colors.text },
  rangeReason: { ...typography.tiny, color: colors.textFaint, marginTop: 2, lineHeight: 15 },

  step: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 7 },
  stepIcon: {
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    backgroundColor: `${colors.accent}1A`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { ...typography.small, color: colors.textDim, flex: 1 },

  buttonRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  shareButton: {
    width: 46,
    height: 38,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
