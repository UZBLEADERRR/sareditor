import React from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { VideoPreview } from '../../components/VideoPreview';
import { Button, Card, ChipRow, Divider, Hint, SectionTitle, SliderRow, ToggleRow } from '../../components/ui';
import { GRADES, GRADE_ORDER } from '../../ffmpeg/filters/grade';
import { LOOK_PRESETS } from '../../presets/lookPresets';
import { renderPreview } from '../../services/render';
import { pickLut } from '../../services/media';
import { useProjects } from '../../store/projects';
import { colors, spacing, typography } from '../../theme';
import type { FillMode, Project, ZoomMode } from '../../types/project';
import { sourceToOutput, buildTimeline } from '../../ffmpeg/timeline';

const FILL_MODES: { value: FillMode; label: string; hint: string }[] = [
  { value: 'crop', label: 'To‘ldirish', hint: 'Kadr to‘liq to‘ladi, chetlari kesiladi' },
  { value: 'blurPad', label: 'Xira fon', hint: 'Butun kadr ko‘rinadi, bo‘sh joyga xira nusxa qo‘yiladi' },
  { value: 'fit', label: 'Qora chet', hint: 'Butun kadr ko‘rinadi, chetlari qora' },
];

const ZOOM_MODES: { value: ZoomMode; label: string }[] = [
  { value: 'none', label: 'Yo‘q' },
  { value: 'in', label: 'Yaqinlashish' },
  { value: 'out', label: 'Uzoqlashish' },
  { value: 'pulse', label: 'Zarb' },
];

export function EffectsPanel({ project, playheadMs }: { project: Project; playheadMs: number }) {
  const updateEffects = useProjects((state) => state.updateEffects);

  const [previewUri, setPreviewUri] = React.useState<string | null>(null);
  const [rendering, setRendering] = React.useState(false);
  const [progress, setProgress] = React.useState(0);

  const effects = project.effects;

  const makePreview = async () => {
    setRendering(true);
    setProgress(0);
    try {
      const timeline = buildTimeline(
        project.segments,
        effects.transition === 'none' ? 0 : effects.transitionMs
      );
      const at = sourceToOutput(timeline, playheadMs) ?? 0;
      const uri = await renderPreview(project, {
        aroundMs: at,
        durationMs: 4000,
        onProgress: setProgress,
      });
      // Force the player to reload even when the path pattern repeats.
      setPreviewUri(null);
      setTimeout(() => setPreviewUri(uri), 60);
    } catch (error) {
      Alert.alert('Ko‘rish uchun render bo‘lmadi', (error as Error).message);
    } finally {
      setRendering(false);
    }
  };

  const importLut = async () => {
    try {
      const lut = await pickLut();
      if (!lut) return;
      updateEffects(project.id, { lutUri: lut.uri });
    } catch (error) {
      Alert.alert('LUT qo‘shilmadi', (error as Error).message);
    }
  };

  return (
    <View>
      <SectionTitle>Tayyor uslublar</SectionTitle>
      <Card>
        <ChipRow
          options={LOOK_PRESETS.map((preset) => ({ value: preset.id, label: preset.label }))}
          value={
            LOOK_PRESETS.find((preset) => preset.effects.grade === effects.grade)?.id ?? 'clean'
          }
          onChange={(id) => {
            const preset = LOOK_PRESETS.find((item) => item.id === id);
            if (preset) updateEffects(project.id, preset.effects);
          }}
        />
        <Hint>
          Uslub bir vaqtda rang, vinyet, don va harakatni o‘rnatadi. Keyin pastdagi tugmalar bilan
          har birini alohida sozlash mumkin.
        </Hint>
      </Card>

      <SectionTitle>Natijani ko‘rish</SectionTitle>
      <Card>
        <Text style={styles.lead}>
          Effektlar telefon ekranida jonli ko‘rinmaydi — ular render paytida qo‘llanadi. Shuning uchun
          kursor turgan joydan 4 soniyalik haqiqiy namuna tayyorlanadi.
        </Text>
        {previewUri ? (
          <View style={{ marginBottom: spacing.md }}>
            <VideoPreview uri={previewUri} aspect={project.export.aspect} showAspectMask={false} />
          </View>
        ) : null}
        <Button
          label={rendering ? `Tayyorlanmoqda ${Math.round(progress * 100)}%` : 'Namunani ko‘rish'}
          icon="eye-outline"
          onPress={makePreview}
          loading={rendering}
          disabled={rendering}
        />
      </Card>

      <SectionTitle>Kadr</SectionTitle>
      <Card>
        <ChipRow
          options={FILL_MODES.map((mode) => ({ value: mode.value, label: mode.label }))}
          value={effects.fillMode}
          onChange={(fillMode) => updateEffects(project.id, { fillMode })}
        />
        <Hint>{FILL_MODES.find((mode) => mode.value === effects.fillMode)?.hint}</Hint>

        <View style={{ height: spacing.lg }} />
        <SliderRow
          label="Kino chiziqlari"
          value={effects.letterbox}
          min={0}
          max={0.3}
          step={0.01}
          onChange={(letterbox) => updateEffects(project.id, { letterbox })}
          format={(value) => (value < 0.01 ? 'yo‘q' : `${Math.round(value * 100)}%`)}
          hint="Yuqori va pastdan qora chiziq — kadrga kinoga o‘xshash nisbat beradi."
        />
      </Card>

      <SectionTitle>Rang</SectionTitle>
      <Card>
        <ChipRow
          options={GRADE_ORDER.map((id) => ({ value: id, label: GRADES[id].label }))}
          value={effects.grade}
          onChange={(grade) => updateEffects(project.id, { grade })}
        />
        <Hint>{GRADES[effects.grade].description}</Hint>

        <View style={{ height: spacing.lg }} />
        <SliderRow
          label="Kuchi"
          value={effects.gradeStrength}
          min={0}
          max={1}
          step={0.05}
          onChange={(gradeStrength) => updateEffects(project.id, { gradeStrength })}
          format={(value) => `${Math.round(value * 100)}%`}
          disabled={effects.grade === 'none'}
        />

        <Divider />
        {effects.lutUri ? (
          <View style={styles.lutRow}>
            <Text style={styles.lutText} numberOfLines={1}>
              LUT: {effects.lutUri.split('/').pop()}
            </Text>
            <Button
              label="O‘chirish"
              variant="ghost"
              compact
              onPress={() => updateEffects(project.id, { lutUri: undefined })}
            />
          </View>
        ) : (
          <Button label="O‘z LUT faylingiz (.cube)" icon="color-filter-outline" variant="secondary" onPress={importLut} compact />
        )}
      </Card>

      <SectionTitle>Kino effektlari</SectionTitle>
      <Card>
        <SliderRow
          label="Chetlarning qorayishi"
          value={effects.vignette}
          min={0}
          max={1}
          step={0.05}
          onChange={(vignette) => updateEffects(project.id, { vignette })}
          format={(value) => (value < 0.02 ? 'yo‘q' : `${Math.round(value * 100)}%`)}
          hint="Ko‘zni kadr markaziga tortadi — eng sezilarli kino belgisi."
        />
        <SliderRow
          label="Nur (bloom)"
          value={effects.bloom}
          min={0}
          max={1}
          step={0.05}
          onChange={(bloom) => updateEffects(project.id, { bloom })}
          format={(value) => (value < 0.03 ? 'yo‘q' : `${Math.round(value * 100)}%`)}
          hint="Yorug‘ joylar atrofida yumshoq nur — qimmat optikaga o‘xshash ta’sir."
        />
        <SliderRow
          label="Plyonka doni"
          value={effects.grain}
          min={0}
          max={1}
          step={0.02}
          onChange={(grain) => updateEffects(project.id, { grain })}
          format={(value) => (value < 0.02 ? 'yo‘q' : `${Math.round(value * 100)}%`)}
        />
        <SliderRow
          label="O‘tkirlik"
          value={effects.sharpen}
          min={0}
          max={1}
          step={0.05}
          onChange={(sharpen) => updateEffects(project.id, { sharpen })}
          format={(value) => (value < 0.02 ? 'yo‘q' : `${Math.round(value * 100)}%`)}
        />
        <SliderRow
          label="Rang siljishi"
          value={effects.chromatic}
          min={0}
          max={1}
          step={0.05}
          onChange={(chromatic) => updateEffects(project.id, { chromatic })}
          format={(value) => (value < 0.05 ? 'yo‘q' : `${Math.round(value * 100)}%`)}
          hint="Chetlarda yengil RGB ajralishi. Ozgina bo‘lgani yaxshi."
        />
      </Card>

      <SectionTitle>Harakat</SectionTitle>
      <Card>
        <Text style={styles.fieldLabel}>Zoom</Text>
        <ChipRow
          options={ZOOM_MODES.map((mode) => ({ value: mode.value, label: mode.label }))}
          value={effects.zoom}
          onChange={(zoom) => updateEffects(project.id, { zoom })}
        />
        {effects.zoom === 'pulse' && !project.music.beats?.length ? (
          <Hint>
            Musiqa bo‘limida zarblarni topsangiz, urish aynan trek ritmiga tushadi. Hozircha bir tekis
            0.5 s ritm ishlatiladi.
          </Hint>
        ) : null}

        <View style={{ height: spacing.md }} />
        <SliderRow
          label="Zoom kuchi"
          value={effects.zoomAmount}
          min={0.02}
          max={0.4}
          step={0.01}
          onChange={(zoomAmount) => updateEffects(project.id, { zoomAmount })}
          format={(value) => `${Math.round(value * 100)}%`}
          disabled={effects.zoom === 'none'}
        />
        <SliderRow
          label="Qo‘l silkinishi"
          value={effects.shake}
          min={0}
          max={1}
          step={0.05}
          onChange={(shake) => updateEffects(project.id, { shake })}
          format={(value) => (value < 0.02 ? 'yo‘q' : `${Math.round(value * 100)}%`)}
        />

        <Divider />
        <ToggleRow
          label="Silkinishni bartaraf qilish"
          hint="Videoni oldindan tahlil qiladi va kamerani tekislaydi. Render vaqti sezilarli oshadi."
          value={effects.stabilize}
          onChange={(stabilize) => updateEffects(project.id, { stabilize })}
        />
      </Card>

      <SectionTitle>Kirish va chiqish</SectionTitle>
      <Card>
        <SliderRow
          label="Boshida qorayish"
          value={effects.fadeInMs}
          min={0}
          max={2000}
          step={50}
          onChange={(fadeInMs) => updateEffects(project.id, { fadeInMs: Math.round(fadeInMs) })}
          format={(value) => `${Math.round(value)} ms`}
          hint="Reels uchun 0 ms yaxshiroq — birinchi kadr darrov ko‘rinsin."
        />
        <SliderRow
          label="Oxirida qorayish"
          value={effects.fadeOutMs}
          min={0}
          max={3000}
          step={50}
          onChange={(fadeOutMs) => updateEffects(project.id, { fadeOutMs: Math.round(fadeOutMs) })}
          format={(value) => `${Math.round(value)} ms`}
        />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  lead: { ...typography.small, color: colors.textDim, lineHeight: 19, marginBottom: spacing.md },
  fieldLabel: { ...typography.small, color: colors.textDim, marginBottom: 6 },
  lutRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  lutText: { ...typography.tiny, color: colors.textDim, flex: 1 },
});
