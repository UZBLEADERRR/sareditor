import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, spacing, typography } from '../theme';

type Props = {
  /** The breadcrumb log from the session that died. */
  report: string;
  onDismiss: () => void;
};

/**
 * What the user sees after the app has vanished on them.
 *
 * The point is not to look good, it is to be copyable: the log is the only
 * evidence of a crash that leaves nothing on screen, and the person holding
 * the phone is the only one who can send it on.
 */
export function CrashReport({ report, onDismiss }: Props) {
  const insets = useSafeAreaInsets();
  const [copied, setCopied] = React.useState(false);

  const copy = React.useCallback(async () => {
    await Clipboard.setStringAsync(report);
    setCopied(true);
  }, [report]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.lg }]}>
      <View style={styles.header}>
        <Ionicons name="warning-outline" size={22} color={colors.amber} />
        <Text style={styles.title}>Ilova oxirgi safar yopilib qolgan</Text>
      </View>
      <Text style={styles.subtitle}>
        Quyidagi jurnal nima bo‘lganini ko‘rsatadi. Nusxa olib yuboring — shu bo‘yicha tuzatiladi.
      </Text>

      <ScrollView style={styles.logBox} contentContainerStyle={styles.logContent}>
        <Text selectable style={styles.log}>
          {report}
        </Text>
      </ScrollView>

      <View style={[styles.actions, { paddingBottom: insets.bottom + spacing.md }]}>
        <Pressable style={[styles.button, styles.primary]} onPress={copy}>
          <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={18} color={colors.bg} />
          <Text style={styles.primaryLabel}>{copied ? 'Nusxa olindi' : 'Nusxa olish'}</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={onDismiss}>
          <Text style={styles.label}>Yopish</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.lg,
    zIndex: 100,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.title, color: colors.text, flexShrink: 1 },
  subtitle: { ...typography.body, color: colors.textDim, marginTop: spacing.sm },
  logBox: {
    flex: 1,
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  logContent: { padding: spacing.md },
  log: { color: colors.textDim, fontFamily: 'monospace', fontSize: 11, lineHeight: 16 },
  actions: { flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.md },
  button: {
    flex: 1,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    backgroundColor: colors.surface,
  },
  primary: { backgroundColor: colors.accent },
  primaryLabel: { ...typography.body, color: colors.bg, fontWeight: "700" },
  label: { ...typography.body, color: colors.text },
});
