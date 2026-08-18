import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import React from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { listImageModels, listLlmModels, listSttModels, type ModelOption } from '../ai/models';
import { useBrand } from '../brand';
import { completeText } from '../ai/providers/llm';
import { LLM_PROVIDERS, STT_PROVIDERS, type LlmProviderId, type SttProviderId } from '../ai/types';
import { Badge, Button, Card, ChipRow, Divider, Field, Hint, IconButton, SectionTitle, ToggleRow } from '../components/ui';
import { deviceInfo } from '../ffmpeg/engine';
import { PLATFORM_ORDER, PLATFORM_PRESETS } from '../ffmpeg/presets';
import { sttKeyIsShared, useSettings } from '../store/settings';
import { colors, radius, spacing, typography } from '../theme';
import { pickLogo } from '../services/media';
import { formatBytes } from '../utils/format';
import { clearWorkDir, toFileUri, workDirSizeBytes } from '../utils/paths';

export function SettingsScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const settings = useSettings();
  const brand = useBrand();

  const [testing, setTesting] = React.useState(false);
  const [cacheBytes, setCacheBytes] = React.useState(0);

  React.useEffect(() => {
    setCacheBytes(workDirSizeBytes());
  }, []);

  const llmInfo = LLM_PROVIDERS[settings.llmProvider];
  const sttInfo = STT_PROVIDERS[settings.sttProvider];
  const sharedKey = sttKeyIsShared(settings);

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
            hint={!settings.llmApiKey && llmInfo.keyUrl ? `Kalitni bu yerdan oling: ${llmInfo.keyUrl}` : undefined}
          />

          <ModelPicker
            label="Model"
            value={settings.llmModel}
            options={settings.llmModelOptions}
            hasKey={Boolean(settings.llmApiKey)}
            onChange={(model) => settings.update({ llmModel: model })}
            onLoad={() => listLlmModels(settings.llmConfig())}
            onLoaded={settings.setLlmModelOptions}
          />

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
            disabled={!settings.isLlmReady()}
          />
        </Card>

        <SectionTitle>Ekrandagi rasmlar</SectionTitle>
        <Card>
          <Text style={styles.lead}>
            AI gapirilgan misollarga rasm chizib ekranga chiqaradi. Buning uchun rasm chizadigan
            modelni tanlang — kalit yuqoridagi bilan bir xil.
          </Text>

          {settings.llmProvider === 'gemini' ? (
            <ModelPicker
              label="Rasm modeli"
              value={settings.imageModel}
              options={settings.imageModelOptions}
              hasKey={Boolean(settings.llmApiKey)}
              onChange={(model) => settings.update({ imageModel: model })}
              onLoad={() => listImageModels(settings.llmConfig())}
              onLoaded={settings.setImageModelOptions}
              autoLoad={false}
            />
          ) : (
            <Hint>
              Rasm yaratish hozircha faqat Gemini orqali ishlaydi. Yuqorida Gemini’ni tanlang.
            </Hint>
          )}
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

          {sharedKey ? (
            <View style={styles.sharedKey}>
              <Ionicons name="link-outline" size={15} color={colors.teal} />
              <Text style={styles.sharedKeyText}>
                Yuqoridagi {LLM_PROVIDERS[settings.llmProvider].label} kaliti ishlatilmoqda. Boshqa
                kalit kerak bo‘lsa, pastga kiriting.
              </Text>
            </View>
          ) : null}

          <Field
            label={sharedKey ? 'Boshqa API kalit (ixtiyoriy)' : 'API kalit'}
            value={settings.sttApiKey}
            onChangeText={(value) => settings.setSttApiKey(value)}
            placeholder={sharedKey ? 'bo‘sh qoldirsangiz yuqoridagisi ishlatiladi' : 'API kalit'}
            secure
          />

          <ModelPicker
            label="Model"
            value={settings.sttModel}
            options={settings.sttModelOptions}
            hasKey={Boolean(settings.sttApiKey || sharedKey)}
            onChange={(model) => settings.update({ sttModel: model })}
            onLoad={() => listSttModels(settings.sttConfig())}
            onLoaded={settings.setSttModelOptions}
          />

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

        <SectionTitle>Ilova nomi va logotipi</SectionTitle>
        <Card>
          <View style={styles.brandRow}>
            {brand.logoUri ? (
              <Image source={{ uri: toFileUri(brand.logoUri) }} style={styles.brandLogo} />
            ) : (
              <View style={[styles.brandLogo, styles.brandLogoEmpty]}>
                <Ionicons name="image-outline" size={18} color={colors.textFaint} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Button
                label="Logotipni tanlash"
                icon="images-outline"
                variant="secondary"
                compact
                onPress={async () => {
                  try {
                    const logo = await pickLogo();
                    if (logo) brand.update({ logoUri: logo.uri });
                  } catch (error) {
                    Alert.alert('Logotip qo‘yilmadi', (error as Error).message);
                  }
                }}
              />
            </View>
          </View>

          <View style={{ height: spacing.md }} />
          <Field label="Nomi" value={brand.name} onChangeText={(name) => brand.update({ name })} autoCapitalize="words" />
          <Field
            label="Tagline"
            value={brand.tagline}
            onChangeText={(tagline) => brand.update({ tagline })}
            autoCapitalize="sentences"
          />
          <Button label="Standart holatga qaytarish" variant="ghost" compact onPress={brand.reset} />
          <Hint>
            Bu ilova ichidagi nom va logotip. Telefon ekranidagi ikonka va o‘rnatish nomi
            assets/ papkasidagi fayllardan yig‘iladi.
          </Hint>
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

/**
 * Model chooser backed by the provider's own catalogue.
 *
 * The list is fetched, never hardcoded, so a model released yesterday shows up
 * without an app update. A free-text field stays available underneath because
 * gateways and proxies routinely expose models their `/models` endpoint omits.
 */
function ModelPicker({
  label,
  value,
  options,
  hasKey,
  onChange,
  onLoad,
  onLoaded,
  autoLoad = true,
}: {
  label: string;
  value: string;
  options: ModelOption[];
  hasKey: boolean;
  onChange: (model: string) => void;
  onLoad: () => Promise<ModelOption[]>;
  onLoaded: (options: ModelOption[]) => void;
  /** Image models are a long list; only fetch them when the user asks. */
  autoLoad?: boolean;
}) {
  const [loading, setLoading] = React.useState(false);
  const [manual, setManual] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const models = await onLoad();
      onLoaded(models);
      if (!models.length) {
        Alert.alert('Model topilmadi', 'Provayder bo‘sh ro‘yxat qaytardi. Model nomini qo‘lda kiriting.');
        setManual(true);
        return;
      }
      // Nothing chosen yet, or the old choice is gone from the catalogue.
      if (!value || !models.some((model) => model.id === value)) {
        onChange(models[0].id);
      }
    } catch (error) {
      Alert.alert('Modellar yuklanmadi', (error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [onLoad, onLoaded, onChange, value]);

  // Fetch once as soon as a key exists and nothing has been loaded yet.
  const autoLoaded = React.useRef(false);
  React.useEffect(() => {
    if (autoLoad && hasKey && !options.length && !autoLoaded.current) {
      autoLoaded.current = true;
      load();
    }
  }, [autoLoad, hasKey, options.length, load]);

  return (
    <View style={styles.picker}>
      <View style={styles.pickerHeader}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <View style={styles.pickerActions}>
          {options.length ? <Badge label={`${options.length} ta`} color={colors.teal} /> : null}
          {loading ? (
            <ActivityIndicator size="small" color={colors.accentSoft} />
          ) : (
            <Pressable onPress={load} disabled={!hasKey} hitSlop={8}>
              <Text style={[styles.pickerAction, !hasKey && { color: colors.textFaint }]}>
                {options.length ? 'Yangilash' : 'Yuklash'}
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      {!hasKey ? (
        <Hint>Avval API kalitni kiriting — modellar ro‘yxati o‘sha kalit bilan olinadi.</Hint>
      ) : options.length ? (
        <>
          <ChipRow
            options={options.map((model) => ({ value: model.id, label: model.label }))}
            value={value}
            onChange={onChange}
          />
          {options.find((model) => model.id === value)?.hint ? (
            <Hint>{options.find((model) => model.id === value)?.hint}</Hint>
          ) : null}
        </>
      ) : loading ? (
        <Hint>Provayderdan modellar so‘ralmoqda…</Hint>
      ) : (
        <Hint>Ro‘yxat hali yuklanmagan.</Hint>
      )}

      {manual || (hasKey && !options.length && !loading) ? (
        <View style={{ marginTop: spacing.sm }}>
          <Field
            label="Model nomini qo‘lda kiritish"
            value={value}
            onChangeText={onChange}
            placeholder="provayder bergan model nomi"
          />
        </View>
      ) : (
        <Pressable onPress={() => setManual(true)} hitSlop={6}>
          <Text style={styles.manualLink}>Model nomini qo‘lda kiritish</Text>
        </Pressable>
      )}
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

  sharedKey: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    padding: spacing.sm,
    marginBottom: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: `${colors.teal}10`,
  },
  sharedKeyText: { ...typography.tiny, color: colors.textDim, flex: 1, lineHeight: 16 },

  fieldLabel: { ...typography.small, color: colors.textDim },
  lead: { ...typography.small, color: colors.textDim, lineHeight: 19, marginBottom: spacing.md },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  brandLogo: { width: 54, height: 54, borderRadius: radius.md, backgroundColor: colors.bgElevated },
  brandLogoEmpty: { alignItems: 'center', justifyContent: 'center' },

  picker: { marginBottom: spacing.md },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  pickerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pickerAction: { ...typography.tiny, color: colors.accentSoft, fontWeight: '700' },
  manualLink: { ...typography.tiny, color: colors.textFaint, marginTop: spacing.sm },

  cacheRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md },
  cacheLabel: { ...typography.small, color: colors.text },
  cacheValue: { ...typography.mono, color: colors.accentSoft },

  deviceText: { ...typography.tiny, color: colors.textDim, marginBottom: 4 },
  license: { ...typography.tiny, color: colors.textFaint, lineHeight: 16 },
});
