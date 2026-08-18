import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { colors, gradients, radius, spacing, typography } from '../theme';

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <View style={styles.sectionTitleRow}>
      <Text style={styles.sectionTitle}>{String(children).toUpperCase()}</Text>
      {action}
    </View>
  );
}

export function Card({
  children,
  style,
  padded = true,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}) {
  return <View style={[styles.card, padded && styles.cardPadded, style]}>{children}</View>;
}

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  loading,
  style,
  compact,
}: ButtonProps) {
  const inactive = disabled || loading;

  const content = (
    <View style={[styles.buttonInner, compact && styles.buttonInnerCompact]}>
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? '#fff' : colors.text} size="small" />
      ) : (
        icon && (
          <Ionicons
            name={icon}
            size={compact ? 15 : 18}
            color={variant === 'primary' ? '#fff' : variant === 'danger' ? colors.red : colors.text}
          />
        )
      )}
      <Text
        style={[
          styles.buttonLabel,
          compact && styles.buttonLabelCompact,
          variant === 'danger' && { color: colors.red },
          variant === 'ghost' && { color: colors.textDim },
        ]}
      >
        {label}
      </Text>
    </View>
  );

  return (
    <Pressable
      onPress={() => {
        if (inactive) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
        onPress();
      }}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        variant !== 'primary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        variant === 'ghost' && styles.buttonGhost,
        inactive && styles.buttonDisabled,
        pressed && !inactive && styles.buttonPressed,
        style,
      ]}
    >
      {variant === 'primary' ? (
        <LinearGradient
          colors={gradients.brand}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {content}
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  size = 20,
  color = colors.text,
  style,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.6 }, style]}
    >
      <Ionicons name={icon} size={size} color={color} />
    </Pressable>
  );
}

export type ChipOption<T extends string> = {
  value: T;
  label: string;
  hint?: string;
  icon?: keyof typeof Ionicons.glyphMap;
};

export function ChipRow<T extends string>({
  options,
  value,
  onChange,
  scroll = true,
}: {
  options: ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  scroll?: boolean;
}) {
  const chips = options.map((option) => {
    const selected = option.value === value;
    return (
      <Pressable
        key={option.value}
        onPress={() => {
          Haptics.selectionAsync().catch(() => undefined);
          onChange(option.value);
        }}
        style={[styles.chip, selected && styles.chipSelected]}
      >
        {option.icon ? (
          <Ionicons
            name={option.icon}
            size={14}
            color={selected ? colors.text : colors.textDim}
            style={{ marginRight: 6 }}
          />
        ) : null}
        <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{option.label}</Text>
      </Pressable>
    );
  });

  if (!scroll) return <View style={styles.chipWrap}>{chips}</View>;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipScroll}
    >
      {chips}
    </ScrollView>
  );
}

export function SliderRow({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  format,
  hint,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.sliderRow, disabled && { opacity: 0.4 }]}>
      <View style={styles.sliderHeader}>
        <Text style={styles.sliderLabel}>{label}</Text>
        <Text style={styles.sliderValue}>{format ? format(value) : value.toFixed(2)}</Text>
      </View>
      <Slider
        value={value}
        minimumValue={min}
        maximumValue={max}
        step={step}
        onValueChange={onChange}
        disabled={disabled}
        minimumTrackTintColor={colors.accent}
        maximumTrackTintColor={colors.border}
        thumbTintColor={colors.text}
        style={styles.slider}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function ToggleRow({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.toggleRow, disabled && { opacity: 0.4 }]}>
      <View style={styles.toggleText}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={(next) => {
          Haptics.selectionAsync().catch(() => undefined);
          onChange(next);
        }}
        disabled={disabled}
        trackColor={{ false: colors.border, true: colors.accent }}
        thumbColor={colors.text}
      />
    </View>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secure,
  hint,
  autoCapitalize = 'none',
  multiline,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  secure?: boolean;
  hint?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words';
  multiline?: boolean;
  keyboardType?: 'default' | 'url' | 'numeric';
}) {
  const [hidden, setHidden] = React.useState(Boolean(secure));

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldInputWrap}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          secureTextEntry={hidden}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          multiline={multiline}
          keyboardType={keyboardType}
          style={[styles.fieldInput, multiline && styles.fieldInputMultiline]}
        />
        {secure ? (
          <IconButton
            icon={hidden ? 'eye-outline' : 'eye-off-outline'}
            onPress={() => setHidden((prev) => !prev)}
            size={18}
            color={colors.textDim}
          />
        ) : null}
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' }) {
  return (
    <View style={styles.stat}>
      <Text
        style={[
          styles.statValue,
          tone === 'good' && { color: colors.green },
          tone === 'warn' && { color: colors.amber },
        ]}
      >
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={26} color={colors.accentSoft} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyMessage}>{message}</Text>
      {action ? <View style={{ marginTop: spacing.lg }}>{action}</View> : null}
    </View>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

export function Badge({ label, color = colors.accent }: { label: string; color?: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: `${color}22`, borderColor: `${color}55` }]}>
      <Text style={[styles.badgeLabel, { color }]}>{label}</Text>
    </View>
  );
}

export function Hint({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.hint, style]}>{children}</Text>;
}

const styles = StyleSheet.create({
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  sectionTitle: { ...typography.section, color: colors.textFaint },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    overflow: 'hidden',
  },
  cardPadded: { padding: spacing.lg },

  button: {
    height: 50,
    borderRadius: radius.md,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonCompact: { height: 38, borderRadius: radius.sm },
  buttonSecondary: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  buttonDanger: { backgroundColor: 'transparent', borderColor: `${colors.red}55` },
  buttonGhost: { backgroundColor: 'transparent', borderColor: 'transparent' },
  buttonDisabled: { opacity: 0.4 },
  buttonPressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg },
  buttonInnerCompact: { paddingHorizontal: spacing.md, gap: 6 },
  buttonLabel: { ...typography.body, color: '#fff', fontWeight: '700' },
  buttonLabelCompact: { fontSize: 13 },

  iconButton: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  chipScroll: { gap: spacing.sm, paddingVertical: 2, paddingRight: spacing.lg },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: { backgroundColor: `${colors.accent}26`, borderColor: colors.accent },
  chipLabel: { ...typography.small, color: colors.textDim },
  chipLabelSelected: { color: colors.text, fontWeight: '700' },

  sliderRow: { marginBottom: spacing.md },
  sliderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sliderLabel: { ...typography.small, color: colors.text },
  sliderValue: { ...typography.mono, color: colors.accentSoft },
  slider: { width: '100%', height: 34, marginTop: -2 },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    gap: spacing.lg,
  },
  toggleText: { flex: 1 },
  toggleLabel: { ...typography.body, color: colors.text },

  field: { marginBottom: spacing.md },
  fieldLabel: { ...typography.small, color: colors.textDim, marginBottom: 6 },
  fieldInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingRight: spacing.xs,
  },
  fieldInput: {
    flex: 1,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 15,
  },
  fieldInputMultiline: { minHeight: 90, textAlignVertical: 'top' },

  stat: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm },
  statValue: { ...typography.title, color: colors.text },
  statLabel: { ...typography.tiny, color: colors.textFaint, marginTop: 2 },

  empty: { alignItems: 'center', paddingVertical: spacing.xxl, paddingHorizontal: spacing.xl },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: `${colors.accent}1A`,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  emptyTitle: { ...typography.title, color: colors.text, textAlign: 'center' },
  emptyMessage: {
    ...typography.small,
    color: colors.textDim,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 20,
  },

  divider: { height: 1, backgroundColor: colors.borderSoft, marginVertical: spacing.md },

  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  badgeLabel: { ...typography.tiny },

  hint: { ...typography.tiny, color: colors.textFaint, marginTop: 4, lineHeight: 15, fontWeight: '500' },
});
