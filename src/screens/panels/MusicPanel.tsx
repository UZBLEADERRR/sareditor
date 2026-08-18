import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { analyseBeats } from '../../analysis/beats';
import { measureLoudness } from '../../analysis/loudness';
import { Badge, Button, Card, Divider, Hint, SectionTitle, SliderRow, Stat, ToggleRow } from '../../components/ui';
import { PLATFORM_PRESETS } from '../../ffmpeg/presets';
import { pickAudio } from '../../services/media';
import { useProjects } from '../../store/projects';
import { colors, radius, spacing, typography } from '../../theme';
import type { Project } from '../../types/project';
import { formatDuration } from '../../utils/format';

export function MusicPanel({ project }: { project: Project }) {
  const updateMusic = useProjects((state) => state.updateMusic);
  const updateAudio = useProjects((state) => state.updateAudio);
  const patch = useProjects((state) => state.patch);

  const [busy, setBusy] = React.useState<'pick' | 'beats' | 'loudness' | null>(null);
  const music = project.music;
  const audio = project.audio;
  const preset = PLATFORM_PRESETS[project.export.platform];

  const choose = async () => {
    setBusy('pick');
    try {
      const track = await pickAudio();
      if (!track) return;
      updateMusic(project.id, {
        enabled: true,
        uri: track.uri,
        name: track.name,
        durationMs: track.durationMs,
        startMs: 0,
        beats: undefined,
        bpm: undefined,
        beatSync: false,
      });
    } catch (error) {
      Alert.alert('Musiqa qo‘shilmadi', (error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const detectBeats = async () => {
    if (!music.uri) return;
    setBusy('beats');
    try {
      const analysis = await analyseBeats(music.uri);
      if (!analysis.beats.length) {
        Alert.alert('Ritm topilmadi', 'Bu trekda aniq zarblar yo‘q ko‘rinadi.');
        return;
      }
      updateMusic(project.id, { beats: analysis.beats, bpm: analysis.bpm, beatSync: true });
      Alert.alert('Ritm topildi', `${analysis.beats.length} ta zarb · ${analysis.bpm} BPM`);
    } catch (error) {
      Alert.alert('Tahlil bo‘lmadi', (error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const checkLoudness = async () => {
    if (!project.source) return;
    setBusy('loudness');
    try {
      const reading = await measureLoudness(project.source.uri);
      if (!reading) {
        Alert.alert('O‘lchab bo‘lmadi', 'Videoda ovoz yo‘q ko‘rinadi.');
        return;
      }
      patch(project.id, { analysis: { ...project.analysis, loudnessLufs: reading.integratedLufs } });
      Alert.alert(
        'Ovoz balandligi',
        `Hozir: ${reading.integratedLufs.toFixed(1)} LUFS\nMaqsad: ${preset.targetLufs} LUFS\n` +
          `Eng baland nuqta: ${reading.truePeakDb.toFixed(1)} dBFS`
      );
    } catch (error) {
      Alert.alert('O‘lchab bo‘lmadi', (error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View>
      <SectionTitle>Fon musiqasi</SectionTitle>
      <Card>
        {music.uri ? (
          <>
            <View style={styles.trackRow}>
              <View style={styles.trackIcon}>
                <Ionicons name="musical-note" size={18} color={colors.pink} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.trackName} numberOfLines={1}>
                  {music.name}
                </Text>
                <Text style={styles.trackMeta}>
                  {formatDuration(music.durationMs ?? 0)}
                  {music.bpm ? ` · ${music.bpm} BPM` : ''}
                </Text>
              </View>
              <Button
                label="O‘chirish"
                variant="ghost"
                compact
                onPress={() =>
                  updateMusic(project.id, {
                    enabled: false,
                    uri: undefined,
                    name: undefined,
                    beats: undefined,
                    bpm: undefined,
                    beatSync: false,
                  })
                }
              />
            </View>
            <Divider />
            <ToggleRow
              label="Musiqani qo‘shish"
              value={music.enabled}
              onChange={(enabled) => updateMusic(project.id, { enabled })}
            />
          </>
        ) : (
          <>
            <Text style={styles.lead}>
              O‘zingiz yuklagan trek ishlatiladi — ilova musiqa tarqatmaydi, shuning uchun mualliflik
              huquqi bo‘yicha muammo chiqmaydi.
            </Text>
            <Button
              label="Trek tanlash"
              icon="musical-notes-outline"
              onPress={choose}
              loading={busy === 'pick'}
            />
          </>
        )}
      </Card>

      {music.uri ? (
        <>
          <SectionTitle>Miks</SectionTitle>
          <Card>
            <SliderRow
              label="Musiqa balandligi"
              value={music.volumeDb}
              min={-40}
              max={6}
              step={0.5}
              onChange={(volumeDb) => updateMusic(project.id, { volumeDb })}
              format={(value) => `${value.toFixed(1)} dB`}
              disabled={!music.enabled}
            />

            <ToggleRow
              label="Gapirganda musiqani pasaytirish"
              hint="Sidechain ducking — ovoz chiqqanda trek avtomatik pasayadi va keyin ko‘tariladi."
              value={music.duckEnabled}
              onChange={(duckEnabled) => updateMusic(project.id, { duckEnabled })}
              disabled={!music.enabled || audio.muteOriginal}
            />
            <SliderRow
              label="Pasayish kuchi"
              value={music.duckAmountDb}
              min={4}
              max={24}
              step={1}
              onChange={(duckAmountDb) => updateMusic(project.id, { duckAmountDb })}
              format={(value) => `${Math.round(value)} dB`}
              disabled={!music.enabled || !music.duckEnabled || audio.muteOriginal}
            />

            <Divider />

            <SliderRow
              label="Trek qayeridan boshlansin"
              value={music.startMs}
              min={0}
              max={Math.max(1000, (music.durationMs ?? 60000) - 1000)}
              step={500}
              onChange={(startMs) => updateMusic(project.id, { startMs: Math.round(startMs) })}
              format={(value) => formatDuration(value)}
              disabled={!music.enabled}
              hint="Eng kuchli joyidan boshlash — birinchi soniyalarda e’tiborni ushlab turadi."
            />
            <SliderRow
              label="Kirish (fade in)"
              value={music.fadeInMs}
              min={0}
              max={4000}
              step={100}
              onChange={(fadeInMs) => updateMusic(project.id, { fadeInMs: Math.round(fadeInMs) })}
              format={(value) => `${Math.round(value)} ms`}
              disabled={!music.enabled}
            />
            <SliderRow
              label="Chiqish (fade out)"
              value={music.fadeOutMs}
              min={0}
              max={5000}
              step={100}
              onChange={(fadeOutMs) => updateMusic(project.id, { fadeOutMs: Math.round(fadeOutMs) })}
              format={(value) => `${Math.round(value)} ms`}
              disabled={!music.enabled}
            />
            <ToggleRow
              label="Takrorlash"
              hint="Trek videodan qisqa bo‘lsa, oxirigacha aylanadi."
              value={music.loop}
              onChange={(loop) => updateMusic(project.id, { loop })}
              disabled={!music.enabled}
            />
          </Card>

          <SectionTitle>Ritm</SectionTitle>
          <Card>
            {music.beats?.length ? (
              <View style={styles.statRow}>
                <Stat label="ZARBLAR" value={String(music.beats.length)} />
                <Stat label="TEMP" value={`${music.bpm ?? 0} BPM`} />
              </View>
            ) : (
              <Text style={styles.lead}>
                Trekdagi zarblarni topadi. Shundan keyin kadr har bir zarbda bir oz “urib” qo‘yadi —
                Reels’dagi eng ko‘p ishlatiladigan effekt.
              </Text>
            )}

            <Button
              label={music.beats?.length ? 'Qayta tahlil qilish' : 'Zarblarni topish'}
              icon="pulse-outline"
              variant="secondary"
              onPress={detectBeats}
              loading={busy === 'beats'}
              disabled={busy !== null}
            />

            {music.beats?.length ? (
              <>
                <View style={{ height: spacing.md }} />
                <ToggleRow
                  label="Kadrni zarbga moslash"
                  hint="Effektlar bo‘limidagi “Zoom → Zarb” rejimi shu ma’lumotdan foydalanadi."
                  value={music.beatSync}
                  onChange={(beatSync) => updateMusic(project.id, { beatSync })}
                />
              </>
            ) : null}
          </Card>
        </>
      ) : null}

      <SectionTitle>Asl ovoz</SectionTitle>
      <Card>
        <ToggleRow
          label="Asl ovozni o‘chirish"
          value={audio.muteOriginal}
          onChange={(muteOriginal) => updateAudio(project.id, { muteOriginal })}
          disabled={!project.source?.hasAudio}
        />
        {!project.source?.hasAudio ? <Hint>Bu videoda ovoz yo‘q.</Hint> : null}

        <SliderRow
          label="Ovoz balandligi"
          value={audio.originalVolumeDb}
          min={-24}
          max={12}
          step={0.5}
          onChange={(originalVolumeDb) => updateAudio(project.id, { originalVolumeDb })}
          format={(value) => `${value.toFixed(1)} dB`}
          disabled={audio.muteOriginal || !project.source?.hasAudio}
        />

        <ToggleRow
          label="Ovozni tozalash"
          hint="Gulduros va shovqinni kesadi, nutqni oldinga chiqaradi. Telefon mikrofoni uchun sezilarli farq."
          value={audio.voiceEnhance}
          onChange={(voiceEnhance) => updateAudio(project.id, { voiceEnhance })}
          disabled={audio.muteOriginal || !project.source?.hasAudio}
        />

        <Divider />

        <ToggleRow
          label="Ovoz balandligini standartlashtirish"
          hint={`${preset.label} yuklamalarni ${preset.targetLufs} LUFS ga keltiradi. Balandroq yuborilsa, platformaning o‘zi pasaytiradi va miks kuchini yo‘qotadi.`}
          value={audio.normalizeLoudness}
          onChange={(normalizeLoudness) => updateAudio(project.id, { normalizeLoudness })}
        />
        <SliderRow
          label="Maqsadli balandlik"
          value={audio.targetLufs}
          min={-24}
          max={-9}
          step={0.5}
          onChange={(targetLufs) => updateAudio(project.id, { targetLufs })}
          format={(value) => `${value.toFixed(1)} LUFS`}
          disabled={!audio.normalizeLoudness}
        />

        {project.analysis?.loudnessLufs !== undefined ? (
          <Badge
            label={`O‘lchangan: ${project.analysis.loudnessLufs.toFixed(1)} LUFS`}
            color={colors.teal}
          />
        ) : null}
        <View style={{ height: spacing.md }} />
        <Button
          label="Hozirgi balandlikni o‘lchash"
          icon="speedometer-outline"
          variant="secondary"
          onPress={checkLoudness}
          loading={busy === 'loudness'}
          disabled={busy !== null || !project.source?.hasAudio}
          compact
        />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  lead: { ...typography.small, color: colors.textDim, lineHeight: 19, marginBottom: spacing.md },
  statRow: { flexDirection: 'row', marginBottom: spacing.md },
  trackRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  trackIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: `${colors.pink}1A`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackName: { ...typography.body, color: colors.text, fontWeight: '700' },
  trackMeta: { ...typography.tiny, color: colors.textFaint, marginTop: 2 },
});
