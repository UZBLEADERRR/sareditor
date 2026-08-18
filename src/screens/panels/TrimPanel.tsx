import React from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { detectSilence, segmentsFromSilence, silenceSavings } from '../../analysis/silence';
import { detectScenes } from '../../analysis/scenes';
import { Badge, Button, Card, ChipRow, Divider, Hint, SectionTitle, SliderRow, Stat } from '../../components/ui';
import { PLATFORM_PRESETS } from '../../ffmpeg/presets';
import { buildTimeline } from '../../ffmpeg/timeline';
import { useProjects } from '../../store/projects';
import { colors, radius, spacing, typography } from '../../theme';
import type { Project, Segment, TransitionId } from '../../types/project';
import { formatDuration, formatTimecode } from '../../utils/format';
import { uid } from '../../utils/id';

const TRANSITIONS: { value: TransitionId; label: string }[] = [
  { value: 'none', label: 'Yo‘q' },
  { value: 'fade', label: 'Fade' },
  { value: 'dissolve', label: 'Erish' },
  { value: 'flash', label: 'Yorug‘lik' },
  { value: 'slideup', label: 'Yuqoriga' },
  { value: 'slideleft', label: 'Chapga' },
  { value: 'circleopen', label: 'Doira' },
  { value: 'pixelize', label: 'Piksel' },
];

type Props = {
  project: Project;
  selectedSegmentId: string | null;
  onSelectSegment: (id: string | null) => void;
  onSeek: (ms: number) => void;
};

export function TrimPanel({ project, selectedSegmentId, onSelectSegment, onSeek }: Props) {
  const setSegments = useProjects((state) => state.setSegments);
  const patch = useProjects((state) => state.patch);
  const updateEffects = useProjects((state) => state.updateEffects);

  const [analysing, setAnalysing] = React.useState<'silence' | 'scenes' | null>(null);
  const [noiseDb, setNoiseDb] = React.useState(-32);
  const [minPauseMs, setMinPauseMs] = React.useState(450);
  const [paddingMs, setPaddingMs] = React.useState(120);
  const [fitTarget, setFitTarget] = React.useState(false);

  const source = project.source;
  const timeline = buildTimeline(
    project.segments,
    project.effects.transition === 'none' ? 0 : project.effects.transitionMs
  );
  const selected = project.segments.find((segment) => segment.id === selectedSegmentId);
  const preset = PLATFORM_PRESETS[project.export.platform];

  const runAutoCut = async () => {
    if (!source) return;
    setAnalysing('silence');
    try {
      const silences = await detectSilence(source.uri, { noiseDb, minSilenceMs: minPauseMs });
      const segments = segmentsFromSilence(source.durationMs, silences, {
        paddingMs,
        targetDurationMs: fitTarget ? preset.maxDurationMs : undefined,
      });

      patch(project.id, { analysis: { ...project.analysis, silences } });
      setSegments(project.id, segments);
      onSelectSegment(null);

      const saved = silenceSavings(source.durationMs, segments);
      Alert.alert(
        'Avto-montaj tayyor',
        silences.length
          ? `${silences.length} ta jimlik topildi, ${formatDuration(saved)} qisqardi.`
          : 'Jimlik topilmadi — sezgirlikni oshirib ko‘ring.'
      );
    } catch (error) {
      Alert.alert('Tahlil qilinmadi', (error as Error).message);
    } finally {
      setAnalysing(null);
    }
  };

  const runSceneDetect = async () => {
    if (!source) return;
    setAnalysing('scenes');
    try {
      const scenes = await detectScenes(source.uri);
      patch(project.id, { analysis: { ...project.analysis, scenes } });
      if (!scenes.length) {
        Alert.alert('Kadr almashinuvi topilmadi', 'Bu videoda keskin o‘tishlar yo‘q ko‘rinadi.');
        return;
      }
      Alert.alert('Topildi', `${scenes.length} ta kadr almashinuvi belgilandi.`);
    } catch (error) {
      Alert.alert('Tahlil qilinmadi', (error as Error).message);
    } finally {
      setAnalysing(null);
    }
  };

  const splitOnScenes = () => {
    const scenes = project.analysis?.scenes;
    if (!source || !scenes?.length) return;

    const cuts = [0, ...scenes, source.durationMs].sort((a, b) => a - b);
    const segments: Segment[] = [];
    for (let i = 0; i < cuts.length - 1; i += 1) {
      if (cuts[i + 1] - cuts[i] < 400) continue;
      segments.push({ id: uid('seg_'), startMs: cuts[i], endMs: cuts[i + 1], speed: 1 });
    }
    setSegments(project.id, segments.length ? segments : project.segments);
  };

  const resetSegments = () => {
    if (!source) return;
    setSegments(project.id, [{ id: uid('seg_'), startMs: 0, endMs: source.durationMs, speed: 1 }]);
    onSelectSegment(null);
  };

  const setSpeed = (speed: number) => {
    if (!selected) return;
    setSegments(
      project.id,
      project.segments.map((segment) => (segment.id === selected.id ? { ...segment, speed } : segment))
    );
  };

  const overTarget = timeline.totalMs > preset.maxDurationMs;

  return (
    <View>
      <SectionTitle>Hozirgi montaj</SectionTitle>
      <Card>
        <View style={styles.statRow}>
          <Stat label="BO‘LAKLAR" value={String(project.segments.length)} />
          <Stat
            label="DAVOMIYLIK"
            value={formatDuration(timeline.totalMs)}
            tone={overTarget ? 'warn' : 'good'}
          />
          <Stat
            label="QISQARDI"
            value={formatDuration(Math.max(0, (source?.durationMs ?? 0) - timeline.totalMs))}
          />
        </View>
        {overTarget ? (
          <Hint style={{ color: colors.amber }}>
            {preset.label} uchun chegara {formatDuration(preset.maxDurationMs)}. Videoni qisqartiring.
          </Hint>
        ) : null}
      </Card>

      <SectionTitle>Avto-montaj</SectionTitle>
      <Card>
        <Text style={styles.lead}>
          Jimliklarni topib avtomatik kesadi — gapirish orasidagi bo‘shliqlar, noto‘g‘ri boshlangan
          dublllar va nafas olishlar chiqib ketadi.
        </Text>

        <SliderRow
          label="Sezgirlik"
          value={noiseDb}
          min={-50}
          max={-18}
          step={1}
          onChange={setNoiseDb}
          format={(value) => `${value} dB`}
          hint="Pastroq qiymat — faqat chuqur jimlikni kesadi. Shovqinli yozuvda -25 dB dan boshlang."
        />
        <SliderRow
          label="Eng qisqa pauza"
          value={minPauseMs}
          min={200}
          max={1500}
          step={50}
          onChange={setMinPauseMs}
          format={(value) => `${Math.round(value)} ms`}
        />
        <SliderRow
          label="Chetlarga zaxira"
          value={paddingMs}
          min={0}
          max={400}
          step={10}
          onChange={setPaddingMs}
          format={(value) => `${Math.round(value)} ms`}
          hint="So‘z boshi va oxiri kesilib qolmasligi uchun qoldiriladigan joy."
        />

        <Pressable style={styles.checkRow} onPress={() => setFitTarget((prev) => !prev)}>
          <View style={[styles.checkbox, fitTarget && styles.checkboxOn]} />
          <Text style={styles.checkLabel}>
            {preset.label} chegarasiga sig‘dirish ({formatDuration(preset.maxDurationMs)})
          </Text>
        </Pressable>

        <Button
          label="Jimliklarni kesish"
          icon="cut-outline"
          onPress={runAutoCut}
          loading={analysing === 'silence'}
          disabled={!source || analysing !== null}
        />
      </Card>

      <SectionTitle>Kadr almashinuvi</SectionTitle>
      <Card>
        <Text style={styles.lead}>
          Videodagi keskin o‘tishlarni topadi. Bir nechta dubl bitta faylga yozilgan bo‘lsa qulay.
        </Text>
        <View style={styles.buttonRow}>
          <Button
            label="Topish"
            icon="scan-outline"
            variant="secondary"
            onPress={runSceneDetect}
            loading={analysing === 'scenes'}
            disabled={!source || analysing !== null}
            style={{ flex: 1 }}
          />
          <Button
            label="Bo‘laklarga ajratish"
            icon="albums-outline"
            variant="secondary"
            onPress={splitOnScenes}
            disabled={!project.analysis?.scenes?.length}
            style={{ flex: 1 }}
          />
        </View>
        {project.analysis?.scenes?.length ? (
          <Hint>{project.analysis.scenes.length} ta o‘tish topilgan.</Hint>
        ) : null}
      </Card>

      <SectionTitle>Tanlangan bo‘lak</SectionTitle>
      <Card>
        {selected ? (
          <>
            <View style={styles.selectedHeader}>
              <Badge label={`${formatTimecode(selected.startMs)} → ${formatTimecode(selected.endMs)}`} />
              <Text style={styles.selectedLength}>
                {formatDuration(selected.endMs - selected.startMs)}
              </Text>
            </View>
            <Divider />
            <Text style={styles.fieldLabel}>Tezlik</Text>
            <ChipRow
              options={[
                { value: '0.5', label: '0.5x' },
                { value: '0.75', label: '0.75x' },
                { value: '1', label: '1x' },
                { value: '1.25', label: '1.25x' },
                { value: '1.5', label: '1.5x' },
                { value: '2', label: '2x' },
                { value: '3', label: '3x' },
              ]}
              value={String(selected.speed)}
              onChange={(value) => setSpeed(Number(value))}
            />
            <Hint>Tezlik ovozga ham qo‘llanadi — ohang o‘zgarmaydi, faqat tezlashadi.</Hint>
          </>
        ) : (
          <Text style={styles.lead}>
            Vaqt chizig‘idagi bo‘lakni bosing — shundan keyin uni cho‘zish, tezlashtirish yoki o‘chirish
            mumkin bo‘ladi.
          </Text>
        )}
      </Card>

      <SectionTitle>Bo‘laklar ro‘yxati</SectionTitle>
      <Card padded={false}>
        {project.segments.map((segment, index) => (
          <Pressable
            key={segment.id}
            onPress={() => {
              onSelectSegment(segment.id);
              onSeek(segment.startMs);
            }}
            style={[styles.segmentRow, segment.id === selectedSegmentId && styles.segmentRowActive]}
          >
            <Text style={styles.segmentIndex}>{index + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.segmentTime}>
                {formatTimecode(segment.startMs, true)} → {formatTimecode(segment.endMs, true)}
              </Text>
              <Text style={styles.segmentMeta}>
                {formatDuration(segment.endMs - segment.startMs)}
                {segment.speed !== 1 ? ` · ${segment.speed}x` : ''}
              </Text>
            </View>
          </Pressable>
        ))}
      </Card>

      <SectionTitle>O‘tishlar</SectionTitle>
      <Card>
        <ChipRow
          options={TRANSITIONS.map((item) => ({ value: item.value, label: item.label }))}
          value={project.effects.transition}
          onChange={(value) => updateEffects(project.id, { transition: value })}
        />
        <View style={{ height: spacing.md }} />
        <SliderRow
          label="O‘tish davomiyligi"
          value={project.effects.transitionMs}
          min={100}
          max={1200}
          step={50}
          onChange={(value) => updateEffects(project.id, { transitionMs: Math.round(value) })}
          format={(value) => `${Math.round(value)} ms`}
          disabled={project.effects.transition === 'none'}
          hint="Har bir o‘tish qo‘shni bo‘laklarni bir-birining ustiga qo‘yadi, shuning uchun umumiy davomiylik biroz qisqaradi."
        />
      </Card>

      <View style={{ height: spacing.lg }} />
      <Button label="Hamma kesishlarni bekor qilish" icon="refresh-outline" variant="ghost" onPress={resetSegments} />
    </View>
  );
}

const styles = StyleSheet.create({
  statRow: { flexDirection: 'row' },
  lead: { ...typography.small, color: colors.textDim, lineHeight: 19, marginBottom: spacing.md },
  fieldLabel: { ...typography.small, color: colors.textDim, marginBottom: 6 },
  buttonRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },

  checkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  checkboxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkLabel: { ...typography.small, color: colors.textDim, flex: 1 },

  selectedHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selectedLength: { ...typography.mono, color: colors.accentSoft },

  segmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  segmentRowActive: { backgroundColor: `${colors.accent}14` },
  segmentIndex: { ...typography.mono, color: colors.textFaint, width: 20 },
  segmentTime: { ...typography.small, color: colors.text },
  segmentMeta: { ...typography.tiny, color: colors.textFaint, marginTop: 2 },
});
