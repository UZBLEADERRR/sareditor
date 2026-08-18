import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Alert, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { generateCopy, planEdit } from '../../ai/director';
import { detectSilence } from '../../analysis/silence';
import { Badge, Button, Card, Divider, Field, Hint, SectionTitle, Stat } from '../../components/ui';
import { GRADES } from '../../ffmpeg/filters/grade';
import { PLATFORM_PRESETS } from '../../ffmpeg/presets';
import { SUBTITLE_STYLES, applySubtitleStyle } from '../../presets/subtitleStyles';
import { useProjects } from '../../store/projects';
import { useSettings } from '../../store/settings';
import { colors, radius, spacing, typography } from '../../theme';
import type { Project, Segment } from '../../types/project';
import { formatDuration, formatTimecode } from '../../utils/format';
import { uid } from '../../utils/id';

export function AiPanel({ project }: { project: Project }) {
  const setAiPlan = useProjects((state) => state.setAiPlan);
  const setSegments = useProjects((state) => state.setSegments);
  const updateEffects = useProjects((state) => state.updateEffects);
  const updateSubtitle = useProjects((state) => state.updateSubtitle);
  const patch = useProjects((state) => state.patch);
  const settings = useSettings();

  const [busy, setBusy] = React.useState<'plan' | 'copy' | null>(null);
  const [instructions, setInstructions] = React.useState('');
  const [stage, setStage] = React.useState('');

  const plan = project.aiPlan;
  const preset = PLATFORM_PRESETS[project.export.platform];

  const runPlan = async () => {
    if (!project.source) return;
    if (!settings.isLlmReady()) {
      Alert.alert('Kalit kerak', 'Sozlamalar → “AI model” bo‘limiga API kalitni qo‘shing.');
      return;
    }

    setBusy('plan');
    try {
      let silences = project.analysis?.silences;
      if (!silences) {
        setStage('Jimliklar tahlil qilinmoqda…');
        silences = await detectSilence(project.source.uri);
        patch(project.id, { analysis: { ...project.analysis, silences } });
      }

      setStage('AI montaj rejasini tuzmoqda…');
      const result = await planEdit(settings.llmConfig(), {
        durationMs: project.source.durationMs,
        platform: preset.label,
        targetDurationMs: Math.min(preset.maxDurationMs, 60_000),
        language: project.transcript?.language ?? settings.sttLanguage ?? '',
        transcript: (project.transcript?.lines ?? []).map((line) => ({
          startMs: line.startMs,
          endMs: line.endMs,
          text: line.text,
        })),
        silences,
        hasMusic: project.music.enabled,
        bpm: project.music.bpm,
        extraInstructions: instructions.trim() || undefined,
      });

      setAiPlan(project.id, result);
    } catch (error) {
      Alert.alert('Reja tuzilmadi', (error as Error).message);
    } finally {
      setBusy(null);
      setStage('');
    }
  };

  const applyPlan = () => {
    if (!plan) return;

    if (plan.keepRanges.length) {
      const segments: Segment[] = plan.keepRanges.map((range) => ({
        id: uid('seg_'),
        startMs: Math.round(range.startMs),
        endMs: Math.round(range.endMs),
        speed: 1,
      }));
      setSegments(project.id, segments);
    }

    updateEffects(project.id, { grade: plan.suggestedGrade });
    updateSubtitle(project.id, {
      ...applySubtitleStyle(project.subtitle, plan.suggestedSubtitleStyle),
      emphasisWords: Array.from(new Set([...project.subtitle.emphasisWords, ...plan.emphasisWords])),
    });

    Alert.alert(
      'Reja qo‘llandi',
      `${plan.keepRanges.length} ta bo‘lak qoldirildi, rang va subtitr uslubi yangilandi.`
    );
  };

  const runCopy = async () => {
    if (!project.transcript) return;
    setBusy('copy');
    try {
      const copy = await generateCopy(settings.llmConfig(), project.transcript, preset.label);
      setAiPlan(project.id, {
        ...(plan ?? {
          hook: '',
          keepRanges: [],
          emphasisWords: [],
          suggestedGrade: project.effects.grade,
          suggestedSubtitleStyle: project.subtitle.styleId,
          musicMood: '',
          notes: '',
          createdAt: Date.now(),
          model: `${settings.llmProvider}:${settings.llmModel}`,
        }),
        title: copy.title,
        description: copy.description,
        hashtags: copy.hashtags,
      });
    } catch (error) {
      Alert.alert('Matn yozilmadi', (error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const totalPlanned = plan?.keepRanges.reduce((sum, range) => sum + (range.endMs - range.startMs), 0) ?? 0;

  return (
    <View>
      <SectionTitle>AI rejissyor</SectionTitle>
      <Card>
        <Text style={styles.lead}>
          Transkript va jimliklarni o‘qib chiqadi, keyin qaysi joylar qolishi kerakligini, qanday rang va
          subtitr uslubi to‘g‘ri kelishini aytadi. Reja avtomatik qo‘llanmaydi — avval ko‘rib chiqasiz.
        </Text>

        {!project.transcript ? (
          <View style={styles.warn}>
            <Ionicons name="information-circle-outline" size={16} color={colors.amber} />
            <Text style={styles.warnText}>
              Transkript bo‘lmasa reja faqat jimliklarga qarab tuziladi. Yaxshiroq natija uchun avval
              “Subtitr” bo‘limida nutqni matnga aylantiring.
            </Text>
          </View>
        ) : null}

        <Field
          label="Qo‘shimcha ko‘rsatma (ixtiyoriy)"
          value={instructions}
          onChangeText={setInstructions}
          placeholder="Masalan: narx haqidagi qismni olib tashla, 30 soniyaga sig‘dir"
          multiline
          autoCapitalize="sentences"
        />

        {busy === 'plan' && stage ? <Hint>{stage}</Hint> : null}

        <Button
          label={plan ? 'Rejani qayta tuzish' : 'Montaj rejasini tuzish'}
          icon="sparkles-outline"
          onPress={runPlan}
          loading={busy === 'plan'}
          disabled={!project.source || busy !== null}
        />
      </Card>

      {plan ? (
        <>
          <SectionTitle>Reja</SectionTitle>
          <Card>
            <View style={styles.statRow}>
              <Stat label="BO‘LAKLAR" value={String(plan.keepRanges.length)} />
              <Stat label="DAVOMIYLIK" value={formatDuration(totalPlanned)} />
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
              {plan.musicMood ? <Badge label={plan.musicMood} color={colors.pink} /> : null}
            </View>

            {plan.notes ? <Hint style={{ marginTop: spacing.md }}>{plan.notes}</Hint> : null}

            <View style={{ height: spacing.lg }} />
            <Button label="Rejani qo‘llash" icon="checkmark-done-outline" onPress={applyPlan} />
          </Card>

          {plan.keepRanges.length ? (
            <>
              <SectionTitle>Qoldiriladigan joylar</SectionTitle>
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
                loading={busy === 'copy'}
                disabled={!project.transcript || busy !== null}
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
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  lead: { ...typography.small, color: colors.textDim, lineHeight: 19, marginBottom: spacing.md },
  fieldLabel: { ...typography.small, color: colors.textDim, marginBottom: 6 },
  statRow: { flexDirection: 'row' },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  hook: { ...typography.body, color: colors.text, lineHeight: 22 },
  copyText: { ...typography.small, color: colors.text, lineHeight: 20 },
  hashtags: { ...typography.small, color: colors.accentSoft, lineHeight: 20 },

  warn: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: `${colors.amber}12`,
  },
  warnText: { ...typography.tiny, color: colors.textDim, flex: 1, lineHeight: 16 },

  rangeRow: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  rangeTime: { ...typography.mono, color: colors.text },
  rangeReason: { ...typography.tiny, color: colors.textFaint, marginTop: 2, lineHeight: 15 },

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
