import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { translateWords } from '../../ai/director';
import { transcribe, type TranscribeProgress } from '../../ai/transcribe';
import { linesFromWords } from '../../ai/transcribe';
import { Badge, Button, Card, ChipRow, Divider, Field, Hint, SectionTitle, SliderRow, ToggleRow } from '../../components/ui';
import { SUBTITLE_STYLES, SUBTITLE_STYLE_ORDER, SYSTEM_FONTS, applySubtitleStyle } from '../../presets/subtitleStyles';
import { listImportedFonts, pickFont } from '../../services/media';
import { registerFonts } from '../../ffmpeg/engine';
import { useProjects } from '../../store/projects';
import { useSettings } from '../../store/settings';
import { colors, radius, spacing, typography } from '../../theme';
import type { Project, SubtitleAnimation } from '../../types/project';
import { formatTimecode } from '../../utils/format';

const TEXT_COLORS = ['#FFFFFF', '#FFE81F', '#3ED598', '#FF4D8D', '#7C5CFF', '#38E0C8', '#FFB65C', '#000000'];

const ANIMATIONS: { value: SubtitleAnimation; label: string }[] = [
  { value: 'pop', label: 'Sakrash' },
  { value: 'bounce', label: 'Kuchli' },
  { value: 'slideUp', label: 'Pastdan' },
  { value: 'fade', label: 'Yumshoq' },
  { value: 'typewriter', label: 'Mashinka' },
  { value: 'none', label: 'Yo‘q' },
];

export function SubtitlePanel({ project, onSeek }: { project: Project; onSeek: (ms: number) => void }) {
  const updateSubtitle = useProjects((state) => state.updateSubtitle);
  const setTranscript = useProjects((state) => state.setTranscript);
  const settings = useSettings();

  const [working, setWorking] = React.useState<'transcribe' | 'translate' | null>(null);
  const [progress, setProgress] = React.useState<TranscribeProgress | null>(null);
  const [translateTo, setTranslateTo] = React.useState('');
  const [emphasisInput, setEmphasisInput] = React.useState('');
  const [fonts, setFonts] = React.useState(() => listImportedFonts());

  const subtitle = project.subtitle;
  const source = project.source;

  const runTranscribe = async () => {
    if (!source) return;
    if (!settings.isSttReady()) {
      Alert.alert('Kalit kerak', 'Sozlamalar → “Nutqni matnga aylantirish” bo‘limiga API kalitni qo‘shing.');
      return;
    }

    setWorking('transcribe');
    setProgress({ stage: 'extract', progress: 0 });
    try {
      const result = await transcribe(settings.sttConfig(), source.uri, {
        durationMs: source.durationMs,
        onProgress: setProgress,
      });
      if (!result.words.length) {
        Alert.alert('Nutq topilmadi', 'Videoda tanib olinadigan gap yo‘q ko‘rinadi.');
        return;
      }
      setTranscript(project.id, result);
      updateSubtitle(project.id, { language: result.language, enabled: true });
      Alert.alert('Tayyor', `${result.words.length} ta so‘z vaqti bilan yozib olindi.`);
    } catch (error) {
      Alert.alert('Transkripsiya bo‘lmadi', (error as Error).message);
    } finally {
      setWorking(null);
      setProgress(null);
    }
  };

  const runTranslate = async () => {
    if (!project.transcript?.words.length) return;
    if (!translateTo.trim()) {
      Alert.alert('Til kerak', 'Qaysi tilga tarjima qilinsin? Masalan: English, Русский.');
      return;
    }
    if (!settings.isLlmReady()) {
      Alert.alert('Kalit kerak', 'Sozlamalar → “AI model” bo‘limiga API kalitni qo‘shing.');
      return;
    }

    setWorking('translate');
    try {
      const words = await translateWords(settings.llmConfig(), project.transcript.words, translateTo.trim());
      setTranscript(project.id, {
        ...project.transcript,
        words,
        lines: linesFromWords(words),
        language: translateTo.trim(),
        text: words.map((word) => word.text).join(' '),
      });
      Alert.alert('Tarjima tayyor', 'Subtitr vaqtlari saqlab qolindi.');
    } catch (error) {
      Alert.alert('Tarjima bo‘lmadi', (error as Error).message);
    } finally {
      setWorking(null);
    }
  };

  const importFont = async () => {
    try {
      const font = await pickFont();
      if (!font) return;
      await registerFonts();
      setFonts(listImportedFonts());
      Alert.alert(
        'Shrift qo‘shildi',
        'Shrift ro‘yxatidan tanlang. Nomi fayl ichidagi shrift nomi bilan mos bo‘lishi kerak.'
      );
    } catch (error) {
      Alert.alert('Shrift qo‘shilmadi', (error as Error).message);
    }
  };

  const addEmphasis = () => {
    const words = emphasisInput
      .split(/[,\s]+/)
      .map((word) => word.trim())
      .filter(Boolean);
    if (!words.length) return;
    updateSubtitle(project.id, {
      emphasisWords: Array.from(new Set([...subtitle.emphasisWords, ...words])),
    });
    setEmphasisInput('');
  };

  const transcriptLines = project.transcript?.lines ?? [];

  return (
    <View>
      <SectionTitle>Matn</SectionTitle>
      <Card>
        {project.transcript ? (
          <>
            <View style={styles.transcriptHeader}>
              <Badge label={`${project.transcript.words.length} so‘z`} color={colors.teal} />
              <Text style={styles.transcriptMeta}>
                {project.transcript.language} · {project.transcript.provider}
              </Text>
            </View>
            <Divider />
          </>
        ) : (
          <Text style={styles.lead}>
            Videodagi nutqni so‘zma-so‘z vaqti bilan yozib oladi. Shundan keyin subtitrlar aynan gapga
            mos tushadi.
          </Text>
        )}

        {working === 'transcribe' && progress ? (
          <View style={styles.progressBox}>
            <ActivityIndicator color={colors.accentSoft} size="small" />
            <Text style={styles.progressText}>
              {progress.stage === 'extract'
                ? 'Ovoz ajratilmoqda…'
                : progress.stage === 'upload'
                  ? `Yuborilmoqda ${progress.chunk ?? 1}/${progress.chunkCount ?? 1}`
                  : 'Yakunlanmoqda…'}
              {'  '}
              {Math.round(progress.progress * 100)}%
            </Text>
          </View>
        ) : null}

        <Button
          label={project.transcript ? 'Qayta yozib olish' : 'Nutqni matnga aylantirish'}
          icon="mic-outline"
          onPress={runTranscribe}
          loading={working === 'transcribe'}
          disabled={!source || working !== null}
        />
      </Card>

      {project.transcript ? (
        <>
          <SectionTitle>Tarjima</SectionTitle>
          <Card>
            <Field
              label="Qaysi tilga"
              value={translateTo}
              onChangeText={setTranslateTo}
              placeholder="English / Русский / Türkçe"
              autoCapitalize="words"
              hint="Vaqtlar o‘zgarmaydi — faqat so‘zlar almashadi."
            />
            <Button
              label="Subtitrni tarjima qilish"
              icon="language-outline"
              variant="secondary"
              onPress={runTranslate}
              loading={working === 'translate'}
              disabled={working !== null}
            />
          </Card>
        </>
      ) : null}

      <SectionTitle>Ko‘rinish</SectionTitle>
      <Card>
        <ToggleRow
          label="Subtitrni videoga yozish"
          hint="O‘chirilsa, matn videoga kuydirilmaydi."
          value={subtitle.enabled}
          onChange={(value) => updateSubtitle(project.id, { enabled: value })}
        />
        <Divider />

        <Text style={styles.fieldLabel}>Uslub</Text>
        <ChipRow
          options={SUBTITLE_STYLE_ORDER.map((id) => ({ value: id, label: SUBTITLE_STYLES[id].label }))}
          value={subtitle.styleId}
          onChange={(styleId) =>
            updateSubtitle(project.id, applySubtitleStyle(subtitle, styleId))
          }
        />
        <Hint>{SUBTITLE_STYLES[subtitle.styleId].hint}</Hint>

        <View style={{ height: spacing.lg }} />

        <SliderRow
          label="Hajm"
          value={subtitle.fontSizePct}
          min={2.5}
          max={12}
          step={0.1}
          onChange={(value) => updateSubtitle(project.id, { fontSizePct: value })}
          format={(value) => `${value.toFixed(1)}%`}
          hint="Kadr balandligiga nisbatan — har qanday ruxsatda bir xil ko‘rinadi."
        />
        <SliderRow
          label="Balandligi"
          value={subtitle.positionPct}
          min={10}
          max={92}
          step={1}
          onChange={(value) => updateSubtitle(project.id, { positionPct: Math.round(value) })}
          format={(value) => `${Math.round(value)}%`}
          hint="Instagramda pastki 15% interfeys bilan to‘silib qoladi."
        />
        <SliderRow
          label="Kontur qalinligi"
          value={subtitle.outlineWidth}
          min={0}
          max={12}
          step={0.5}
          onChange={(value) => updateSubtitle(project.id, { outlineWidth: value })}
          format={(value) => value.toFixed(1)}
        />
        <SliderRow
          label="Soya"
          value={subtitle.shadowDepth}
          min={0}
          max={6}
          step={0.5}
          onChange={(value) => updateSubtitle(project.id, { shadowDepth: value })}
          format={(value) => value.toFixed(1)}
        />
        <SliderRow
          label="Qatordagi so‘zlar"
          value={subtitle.maxWordsPerLine}
          min={1}
          max={10}
          step={1}
          onChange={(value) => updateSubtitle(project.id, { maxWordsPerLine: Math.round(value) })}
          format={(value) => String(Math.round(value))}
          hint="Kam so‘z — tezroq ritm, ko‘proq e’tibor."
        />

        <ToggleRow
          label="BOSH HARFLAR"
          value={subtitle.uppercase}
          onChange={(value) => updateSubtitle(project.id, { uppercase: value })}
        />
        <ToggleRow
          label="Aytilayotgan so‘zni yoritish"
          hint="Har bir so‘z aytilganda rangi o‘zgaradi."
          value={subtitle.karaoke}
          onChange={(value) => updateSubtitle(project.id, { karaoke: value })}
        />

        <Divider />
        <Text style={styles.fieldLabel}>Animatsiya</Text>
        <ChipRow
          options={ANIMATIONS.map((item) => ({ value: item.value, label: item.label }))}
          value={subtitle.animation}
          onChange={(animation) => updateSubtitle(project.id, { animation })}
        />
      </Card>

      <SectionTitle>Ranglar</SectionTitle>
      <Card>
        <ColorRow
          label="Asosiy matn"
          value={subtitle.primaryColor}
          onChange={(primaryColor) => updateSubtitle(project.id, { primaryColor })}
        />
        <ColorRow
          label="Yoritilgan so‘z"
          value={subtitle.highlightColor}
          onChange={(highlightColor) => updateSubtitle(project.id, { highlightColor })}
        />
        <ColorRow
          label="Kontur / fon"
          value={subtitle.outlineColor}
          onChange={(outlineColor) => updateSubtitle(project.id, { outlineColor })}
        />
        <ColorRow
          label="Muhim so‘zlar"
          value={subtitle.emphasisColor}
          onChange={(emphasisColor) => updateSubtitle(project.id, { emphasisColor })}
        />
        {subtitle.styleId === 'boxed' ? (
          <SliderRow
            label="Fon shaffofligi"
            value={subtitle.bgOpacity}
            min={0}
            max={1}
            step={0.05}
            onChange={(bgOpacity) => updateSubtitle(project.id, { bgOpacity })}
            format={(value) => `${Math.round(value * 100)}%`}
          />
        ) : null}
      </Card>

      <SectionTitle>Muhim so‘zlar</SectionTitle>
      <Card>
        <Text style={styles.lead}>
          Bu so‘zlar boshqa rangda chiqadi. Raqamlar, natijalar, qarama-qarshiliklar uchun ishlating.
        </Text>
        <View style={styles.emphasisRow}>
          <View style={{ flex: 1 }}>
            <Field
              label=""
              value={emphasisInput}
              onChangeText={setEmphasisInput}
              placeholder="pul, 10 barobar, bepul"
            />
          </View>
        </View>
        <Button label="Qo‘shish" icon="add-outline" variant="secondary" onPress={addEmphasis} compact />

        {subtitle.emphasisWords.length ? (
          <View style={styles.tagWrap}>
            {subtitle.emphasisWords.map((word) => (
              <Pressable
                key={word}
                onPress={() =>
                  updateSubtitle(project.id, {
                    emphasisWords: subtitle.emphasisWords.filter((item) => item !== word),
                  })
                }
                style={styles.tag}
              >
                <Text style={styles.tagText}>{word}</Text>
                <Ionicons name="close" size={12} color={colors.textFaint} />
              </Pressable>
            ))}
          </View>
        ) : null}
      </Card>

      <SectionTitle>Shrift</SectionTitle>
      <Card>
        <ChipRow
          options={[
            ...SYSTEM_FONTS.map((font) => ({ value: font, label: font })),
            ...fonts.map((font) => ({ value: font.name.replace(/\.[^.]+$/, ''), label: font.name })),
          ]}
          value={subtitle.fontFamily}
          onChange={(fontFamily) => updateSubtitle(project.id, { fontFamily })}
        />
        <Hint>
          Ro‘yxatdagi birinchi shriftlar Android tizimidan olinadi va har doim mavjud. O‘z shriftingizni
          qo‘shsangiz, uning ichki nomi bilan tanlanadi.
        </Hint>
        <View style={{ height: spacing.md }} />
        <Button label="Shrift qo‘shish (.ttf)" icon="cloud-upload-outline" variant="secondary" onPress={importFont} compact />
      </Card>

      {transcriptLines.length ? (
        <>
          <SectionTitle>Transkript</SectionTitle>
          <Card padded={false}>
            {transcriptLines.slice(0, 80).map((line, index) => (
              <Pressable key={index} onPress={() => onSeek(line.startMs)} style={styles.lineRow}>
                <Text style={styles.lineTime}>{formatTimecode(line.startMs)}</Text>
                <Text style={styles.lineText}>{line.text}</Text>
              </Pressable>
            ))}
            {transcriptLines.length > 80 ? (
              <Text style={styles.moreLines}>… yana {transcriptLines.length - 80} qator</Text>
            ) : null}
          </Card>
        </>
      ) : null}
    </View>
  );
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.colorRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.swatchRow}>
        {TEXT_COLORS.map((color) => (
          <Pressable
            key={color}
            onPress={() => onChange(color)}
            style={[
              styles.swatch,
              { backgroundColor: color },
              value.toUpperCase() === color.toUpperCase() && styles.swatchActive,
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  lead: { ...typography.small, color: colors.textDim, lineHeight: 19, marginBottom: spacing.md },
  fieldLabel: { ...typography.small, color: colors.textDim, marginBottom: 6 },

  transcriptHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  transcriptMeta: { ...typography.tiny, color: colors.textFaint },

  progressBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.bgElevated,
  },
  progressText: { ...typography.small, color: colors.textDim },

  colorRow: { marginBottom: spacing.md },
  swatchRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  swatch: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.border,
  },
  swatchActive: { borderColor: colors.text, transform: [{ scale: 1.12 }] },

  emphasisRow: { flexDirection: 'row', gap: spacing.sm },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tagText: { ...typography.tiny, color: colors.text },

  lineRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  lineTime: { ...typography.mono, color: colors.textFaint, width: 46 },
  lineText: { ...typography.small, color: colors.textDim, flex: 1, lineHeight: 18 },
  moreLines: { ...typography.tiny, color: colors.textFaint, padding: spacing.lg },
});
