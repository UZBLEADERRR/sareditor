import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { runAgent } from '../../ai/agent';
import { generateImage } from '../../ai/images';
import { synthesize } from '../../ai/voice';
import { Hint } from '../../components/ui';
import { useAgentChat } from '../../store/agentChat';
import { useProjects } from '../../store/projects';
import { useSettings } from '../../store/settings';
import { colors, radius, spacing, typography } from '../../theme';
import type { Project } from '../../types/project';

/** Openers that show what the agent can actually do, in one tap. */
const SUGGESTIONS = [
  'Jimliklarni kesib tashla',
  'Boshini qiziqarli qilib qayta yig‘',
  'Subtitrni inglizchaga tarjima qil',
  'Kino rangi va yengil vinyet qo‘y',
  'Rasmlarimni mos joylarga qo‘y',
  'Boshiga tanishtiruvchi ovoz qo‘sh',
  'Sekin joylarni 1.5x tezlat',
];

export function AiChat({ project }: { project: Project }) {
  const settings = useSettings();
  const applyAiEdit = useProjects((state) => state.applyAiEdit);
  const undoAiEdit = useProjects((state) => state.undoAiEdit);

  const entries = useAgentChat((state) => state.threads[project.id]?.entries);
  const append = useAgentChat((state) => state.append);
  const setHistory = useAgentChat((state) => state.setHistory);
  const markUndone = useAgentChat((state) => state.markUndone);
  const clear = useAgentChat((state) => state.clear);

  const [input, setInput] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  const ready = settings.isLlmReady();

  const send = async (text: string) => {
    const instruction = text.trim();
    if (!instruction || busy) return;
    if (!ready) {
      Alert.alert('AI ulanmagan', 'Sozlamalarda kalitni kiriting va modelni tanlang.');
      return;
    }

    setInput('');
    append(project.id, { role: 'user', text: instruction });
    setBusy(true);
    setStatus('O‘ylayapti…');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await runAgent({
        project,
        instruction,
        history: useAgentChat.getState().threads[project.id]?.history ?? [],
        services: {
          llm: settings.llmConfig(),
          drawImage: settings.isImageReady()
            ? (prompt, aspect) =>
                generateImage(settings.imageConfig(), prompt, aspect, controller.signal)
            : undefined,
          speak: settings.isVoiceReady()
            ? (text) => synthesize(settings.voiceConfig(), text, controller.signal)
            : undefined,
          voiceLabel: settings.voiceLabel(),
          signal: controller.signal,
        },
        onEvent: (event) => {
          if (event.type === 'thinking') setStatus('O‘ylayapti…');
          if (event.type === 'tool') setStatus(`${event.label}…`);
          if (event.type === 'change') setStatus(event.text);
        },
      });

      setHistory(project.id, result.history);

      // The patch is written in one go, with a snapshot, so the message below
      // can put the whole run back exactly as it was.
      const editId = result.patch
        ? applyAiEdit(project.id, result.patch, {
            instruction,
            summary: result.reply,
            changes: result.changes,
          })
        : undefined;

      append(project.id, {
        role: 'agent',
        text: result.reply,
        changes: [...result.changes, ...result.warnings],
        editId,
      });
    } catch (error) {
      const message = (error as Error)?.message ?? 'Nomaʼlum xato';
      append(project.id, {
        role: 'error',
        text: controller.signal.aborted ? 'To‘xtatildi.' : message,
      });
    } finally {
      abortRef.current = null;
      setBusy(false);
      setStatus(null);
    }
  };

  const undo = (entryId: string, editId: string) => {
    undoAiEdit(project.id, editId);
    markUndone(project.id, entryId);
  };

  const list = entries ?? [];

  return (
    <View style={styles.wrap}>
      {list.length ? (
        <View style={styles.thread}>
          {list.map((entry) => {
            if (entry.role === 'user') {
              return (
                <View key={entry.id} style={styles.userRow}>
                  <Text style={styles.userText}>{entry.text}</Text>
                </View>
              );
            }
            if (entry.role === 'error') {
              return (
                <View key={entry.id} style={[styles.agentRow, styles.errorRow]}>
                  <Text style={styles.errorText}>{entry.text}</Text>
                </View>
              );
            }
            return (
              <View key={entry.id} style={styles.agentRow}>
                <Text style={styles.agentText}>{entry.text}</Text>

                {entry.changes?.length ? (
                  <View style={styles.changeList}>
                    {entry.changes.map((change, index) => (
                      <View key={index} style={styles.changeRow}>
                        <Ionicons name="checkmark" size={12} color={colors.green} />
                        <Text style={styles.changeText}>{change}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                {entry.editId ? (
                  entry.undone ? (
                    <Text style={styles.undoneText}>Bekor qilindi</Text>
                  ) : (
                    <Pressable
                      style={styles.undoButton}
                      onPress={() => undo(entry.id, entry.editId as string)}
                    >
                      <Ionicons name="arrow-undo-outline" size={13} color={colors.textDim} />
                      <Text style={styles.undoLabel}>AI qilganini bekor qil</Text>
                    </Pressable>
                  )
                ) : null}
              </View>
            );
          })}
        </View>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Nima qilay?</Text>
          <Text style={styles.emptyText}>
            Oddiy gap bilan ayting — kesaman, subtitr qo‘yaman, tarjima qilaman, ovoz beraman,
            rasmlaringizni mos joyga joylayman. Yoqmasa bitta tugma bilan hammasi ortga qaytadi.
          </Text>
        </View>
      )}

      {busy ? (
        <View style={styles.statusRow}>
          <ActivityIndicator size="small" color={colors.accentSoft} />
          <Text style={styles.statusText} numberOfLines={1}>
            {status ?? 'Ishlayapti…'}
          </Text>
          <Pressable onPress={() => abortRef.current?.abort()} hitSlop={8}>
            <Text style={styles.stopText}>To‘xtat</Text>
          </Pressable>
        </View>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        keyboardShouldPersistTaps="handled"
      >
        {SUGGESTIONS.map((suggestion) => (
          <Pressable
            key={suggestion}
            style={styles.chip}
            disabled={busy}
            onPress={() => send(suggestion)}
          >
            <Text style={styles.chipText}>{suggestion}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Masalan: 30 soniyaga sig‘dir, subtitrni sariq qil"
          placeholderTextColor={colors.textFaint}
          multiline
          editable={!busy}
          onSubmitEditing={() => send(input)}
          returnKeyType="send"
        />
        <Pressable
          onPress={() => send(input)}
          disabled={busy || !input.trim()}
          style={[styles.send, (busy || !input.trim()) && styles.sendDisabled]}
        >
          <Ionicons name="arrow-up" size={18} color="#fff" />
        </Pressable>
      </View>

      {!ready ? (
        <Hint style={{ marginTop: spacing.sm }}>
          Sozlamalarda AI kalitini kiriting va modelni tanlang.
        </Hint>
      ) : null}

      {list.length ? (
        <Pressable onPress={() => clear(project.id)} style={styles.clearRow} hitSlop={8}>
          <Text style={styles.clearText}>Suhbatni tozalash</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.md },

  thread: { gap: spacing.sm, marginBottom: spacing.md },
  userRow: {
    alignSelf: 'flex-end',
    maxWidth: '88%',
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    borderBottomRightRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  userText: { ...typography.small, color: '#fff', lineHeight: 19 },

  agentRow: {
    alignSelf: 'flex-start',
    maxWidth: '95%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: radius.md,
    borderBottomLeftRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  agentText: { ...typography.small, color: colors.text, lineHeight: 20 },
  errorRow: { borderColor: `${colors.red}66`, backgroundColor: `${colors.red}12` },
  errorText: { ...typography.small, color: colors.red, lineHeight: 19 },

  changeList: { marginTop: spacing.sm, gap: 3 },
  changeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  changeText: { ...typography.tiny, color: colors.textDim, flex: 1, lineHeight: 16 },

  undoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  undoLabel: { ...typography.tiny, color: colors.textDim },
  undoneText: { ...typography.tiny, color: colors.textFaint, marginTop: spacing.sm },

  empty: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  emptyTitle: { ...typography.body, color: colors.text, fontWeight: '700' },
  emptyText: { ...typography.small, color: colors.textDim, lineHeight: 20, marginTop: 6 },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  statusText: { ...typography.tiny, color: colors.accentSoft, flex: 1 },
  stopText: { ...typography.tiny, color: colors.red },

  chips: { gap: spacing.xs, paddingBottom: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipText: { ...typography.tiny, color: colors.textDim },

  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    color: colors.text,
    ...typography.small,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.35 },

  clearRow: { alignSelf: 'center', marginTop: spacing.md },
  clearText: { ...typography.tiny, color: colors.textFaint },
});
