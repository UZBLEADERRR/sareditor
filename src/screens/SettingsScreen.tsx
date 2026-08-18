import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LLM_PROVIDERS, STT_PROVIDERS, type LlmProviderId, type SttProviderId } from '../ai/types';
import { completeText } from '../ai/providers/llm';
import { Button, Card, ChipRow, Divider, Field, Hint, IconButton, SectionTitle, ToggleRow } from '../components/ui';
import { PLATFORM_ORDER, PLATFORM_PRESETS } from '../ffmpeg/presets';
import { useSettings } from '../store/settings';
import { colors, radius, spacing, typography } from '../theme';
import { formatBytes } from '../utils/format';
import { clearWorkDir, workDirSizeBytes } from '../utils/paths';
import { deviceInfo } from '../ffmpeg/engine';

export function SettingsScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const settings = useSettings();

  const [testing, setTesting] = React.useState(false);
  const [cacheBytes, setCacheBytes] = React.useState(0);

  React.useEffect(() => {
    setCacheBytes(workDirSizeBytes());
  }, []);

  const llmInfo = LLM_PROVIDERS[settings.llmProvider];
  const sttInfo = STT_PROVIDERS[settings.sttProvider];

  const testConnection = async () => {
    setTesting(true);
    try {
      const reply = await completeText(settings.llmConfig(), {
        system: 'Reply with the single word OK.',
        user: 'ping',
        maxTokens: 64,
      });
      Alert.alert('Ulanish ishladi', `Model javobi: ${reply.slice(0, 120) || '(bo‘sh)'}`);
    } catch (error) {
      Alert.alert('Ulanmadi', (error as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const clearCache = () => {
    Alert.alert('Vaqtinchalik fayllar', 'Tahlil va preview fayllari o‘chirilsinmi?', [
      { text: 'Bekor qilish', style: 'cancel' },
      {
        text: 'Tozalash',
        style: 'destructive',
        onPress: () => {
          clearWorkDir();
          setCacheBytes(workDirSizeBytes());
        },
      },
    ]);
  };

  const device = React.useMemo(() => {
    try {
      return deviceInfo();
    } catch {
      return null;
    }
  }, []);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <IconButton icon="chevron-back" onPress={() => navigation.goBack()} />
        <Text style={styles.title}>Sozlamalar</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.notice}>
          <Ionicons name="lock-closed-outline" size={16} color={colors.teal} />
          <Text style={styles.noticeText}>
            Kalitlar faqat shu telefonda, Android keystore ichida saqlanadi. So‘rovlar to‘g‘ridan-to‘g‘ri
            siz tanlagan provayderga ketadi.
          </Text>
        </View>

        <SectionTitle>AI model (montaj rejasi, matnlar)</SectionTitle>
        <Card>
          <ChipRow<LlmProviderId>
            options={(Object.keys(LLM_PROVIDERS) as LlmProviderId[]).map((id) => ({
              value: id,
              label: LLM_PROVIDERS[id].label,
            }))}
            value={settings.llmProvider}
            onChange={settings.setLlmProvider}
          />
          <Hint style={{ marginBottom: spacing.md }}>{llmInfo.hint}</Hint>

          <Field
            label="API kalit"
            value={settings.llmApiKey}
            onChangeText={(value) => settings.setLlmApiKey(value)}
            placeholder={llmInfo.keyPlaceholder}
            secure
          />

          {llmInfo.models.length ? (
            <View style={{ marginBottom: spacing.md }}>
              <Text style={styles.fieldLabel}>Model</Text>
              <ChipRow
                options={llmInfo.models.map((model) => ({ value: model, label: model }))}
                value={settings.llmModel}
                onChange={(model) => settings.update({ llmModel: model })}
              />
            </View>
          ) : (
            <Field
              label="Model nomi"
              value={settings.llmModel}
              onChangeText={(value) => settings.update({ llmModel: value })}
              placeholder="masalan: meta-llama/llama-3.3-70b-instruct"
            />
          )}

          <Field
            label="Server manzili (ixtiyoriy)"
            value={settings.llmBaseUrl}
            onChangeText={(value) => settings.update({ llmBaseUrl: value })}
            placeholder={llmInfo.defaultBaseUrl}
            keyboardType="url"
            hint="Bo‘sh qoldirsangiz standart manzil ishlatiladi."
          />

          <Button
            label="Ulanishni tekshirish"
            icon="flash-outline"
            variant="secondary"
            onPress={testConnection}
            loading={testing}
            disabled={!settings.llmApiKey}
          />
        </Card>

        <SectionTitle>Nutqni matnga aylantirish (subtitr)</SectionTitle>
        <Card>
          <ChipRow<SttProviderId>
            options={(Object.keys(STT_PROVIDERS) as SttProviderId[]).map((id) => ({
              value: id,
              label: STT_PROVIDERS[id].label,
            }))}
            value={settings.sttProvider}
            onChange={settings.setSttProvider}
          />
          <Hint style={{ marginBottom: spacing.md }}>{sttInfo.hint}</Hint>

          <Field
            label="API kalit"
            value={settings.sttApiKey}
            onChangeText={(value) => settings.setSttApiKey(value)}
            placeholder="sk-..."
            secure
          />

          {sttInfo.models.length ? (
            <View style={{ marginBottom: spacing.md }}>
              <Text style={styles.fieldLabel}>Model</Text>
              <ChipRow
                options={sttInfo.models.map((model) => ({ value: model, label: model }))}
                value={settings.sttModel}
                onChange={(model) => settings.update({ sttModel: model })}
              />
            </View>
          ) : (
            <Field
              label="Model nomi"
              value={settings.sttModel}
              onChangeText={(value) => settings.update({ sttModel: value })}
              placeholder="whisper-1"
            />
          )}

          <Field
            label="Server manzili (ixtiyoriy)"
            value={settings.sttBaseUrl}
            onChangeText={(value) => settings.update({ sttBaseUrl: value })}
            placeholder={sttInfo.defaultBaseUrl || 'https://.../v1'}
            keyboardType="url"
          />

          <Field
            label="Nutq tili (ixtiyoriy)"
            value={settings.sttLanguage}
            onChangeText={(value) => settings.update({ sttLanguage: value.trim().toLowerCase() })}
            placeholder="uz, ru, en …"
            hint="Bo‘sh qoldirsangiz model tilni o‘zi aniqlaydi. Til ko‘rsatilsa aniqlik oshadi."
          />
        </Card>

        <SectionTitle>Standart platforma</SectionTitle>
        <Card>
          <ChipRow
            options={PLATFORM_ORDER.map((id) => ({ value: id, label: PLATFORM_PRESETS[id].label }))}
            value={settings.defaultPlatform}
            onChange={(platform) => settings.update({ defaultPlatform: platform })}
          />
          <Hint style={{ marginTop: spacing.sm }}>
            Yangi loyihalar shu format bilan ochiladi. Har bir loyihada keyin o‘zgartirsa bo‘ladi.
          </Hint>
        </Card>

        <SectionTitle>Xotira</SectionTitle>
        <Card>
          <ToggleRow
            label="Tahlil fayllarini saqlash"
            hint="O‘chirilgan holda preview va tahlil fayllari avtomatik tozalanadi."
            value={settings.keepWorkFiles}
            onChange={(value) => settings.update({ keepWorkFiles: value })}
          />
          <Divider />
          <View style={styles.cacheRow}>
            <Text style={styles.cacheLabel}>Vaqtinchalik fayllar</Text>
            <Text style={styles.cacheValue}>{formatBytes(cacheBytes)}</Text>
          </View>
          <Button label="Tozalash" icon="trash-outline" variant="secondary" onPress={clearCache} compact />
        </Card>

        <SectionTitle>Qurilma</SectionTitle>
        <Card>
          <Text style={styles.deviceText}>
            {device ? `${device.model} · ${device.cores} yadro · Android SDK ${device.sdkInt}` : 'Aniqlanmadi'}
          </Text>
          <Text style={styles.deviceText}>{device ? device.abis.join(', ') : ''}</Text>
          <Divider />
          <Text style={styles.license}>
            Video qayta ishlash FFmpeg (ffmpeg-kit full-gpl) orqali bajariladi. Ilova GPL-3.0 shartlari
            asosida tarqatiladi.
          </Text>
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  title: { ...typography.title, color: colors.text },
  content: { paddingHorizontal: spacing.lg },

  notice: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    marginTop: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: `${colors.teal}12`,
    borderWidth: 1,
    borderColor: `${colors.teal}30`,
  },
  noticeText: { ...typography.tiny, color: colors.textDim, flex: 1, lineHeight: 16 },

  fieldLabel: { ...typography.small, color: colors.textDim, marginBottom: 6 },

  cacheRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md },
  cacheLabel: { ...typography.small, color: colors.text },
  cacheValue: { ...typography.mono, color: colors.accentSoft },

  deviceText: { ...typography.tiny, color: colors.textDim, marginBottom: 4 },
  license: { ...typography.tiny, color: colors.textFaint, lineHeight: 16 },
});
