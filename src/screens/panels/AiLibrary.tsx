import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button, Card, Hint, SectionTitle } from '../../components/ui';
import { generateThumbnails, pickLibraryAssets } from '../../services/media';
import { useProjects } from '../../store/projects';
import { colors, radius, spacing, typography } from '../../theme';
import type { MediaAsset, Project } from '../../types/project';
import { formatDuration } from '../../utils/format';
import { toFileUri } from '../../utils/paths';

/**
 * The creator's own photos and clips, waiting for the agent to place them.
 *
 * The note is the important field: the agent gets the file list with these
 * descriptions and nothing else, so "mahsulot qutisi" is what makes a picture
 * land on the sentence about the box rather than somewhere arbitrary.
 */
export function AiLibrary({ project }: { project: Project }) {
  const addAssets = useProjects((state) => state.addLibraryAssets);
  const removeAsset = useProjects((state) => state.removeLibraryAsset);
  const updateAsset = useProjects((state) => state.updateLibraryAsset);
  const [busy, setBusy] = React.useState(false);

  const importMedia = async () => {
    setBusy(true);
    try {
      const assets = await pickLibraryAssets();
      if (assets.length) addAssets(project.id, assets);
    } catch (error) {
      Alert.alert('Yuklanmadi', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionTitle>Mening rasm va videolarim</SectionTitle>
      <Card>
        <Button
          label="Rasm yoki video yuklash"
          icon="images-outline"
          variant="secondary"
          onPress={importMedia}
          loading={busy}
        />
        <Hint style={{ marginTop: spacing.md }}>
          Yuklaganingizdan keyin har biriga qisqa izoh yozing — AI aynan shu izohga qarab, gap mos
          kelgan daqiqada uni videoga qo‘yadi.
        </Hint>
      </Card>

      {project.library.length ? (
        <Card padded={false}>
          {project.library.map((asset) => (
            <AssetRow
              key={asset.id}
              asset={asset}
              onNote={(note) => updateAsset(project.id, asset.id, { note })}
              onRemove={() =>
                Alert.alert('O‘chirilsinmi?', asset.name, [
                  { text: 'Bekor qilish', style: 'cancel' },
                  {
                    text: 'O‘chirish',
                    style: 'destructive',
                    onPress: () => removeAsset(project.id, asset.id),
                  },
                ])
              }
            />
          ))}
        </Card>
      ) : null}
    </>
  );
}

function AssetRow({
  asset,
  onNote,
  onRemove,
}: {
  asset: MediaAsset;
  onNote: (note: string) => void;
  onRemove: () => void;
}) {
  const [note, setNote] = React.useState(asset.note);
  const [thumb, setThumb] = React.useState<string | null>(
    asset.kind === 'image' ? asset.uri : null
  );

  React.useEffect(() => {
    if (asset.kind !== 'video') return;
    let cancelled = false;
    generateThumbnails(asset.uri, [Math.min(500, asset.durationMs / 2)]).then((frames) => {
      if (!cancelled) setThumb(frames[0] ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [asset.kind, asset.uri, asset.durationMs]);

  return (
    <View style={styles.row}>
      <View style={styles.thumbWrap}>
        {thumb ? (
          <Image source={{ uri: toFileUri(thumb) }} style={styles.thumb} resizeMode="cover" />
        ) : (
          <Ionicons name="videocam-outline" size={18} color={colors.textFaint} />
        )}
        {asset.kind === 'video' ? (
          <View style={styles.durationTag}>
            <Text style={styles.durationText}>{formatDuration(asset.durationMs)}</Text>
          </View>
        ) : null}
      </View>

      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>
          {asset.name}
        </Text>
        <TextInput
          style={styles.note}
          value={note}
          onChangeText={setNote}
          onBlur={() => onNote(note.trim())}
          placeholder="Nima ko‘rinadi? Masalan: qadoqlangan mahsulot"
          placeholderTextColor={colors.textFaint}
        />
      </View>

      <Pressable onPress={onRemove} hitSlop={8}>
        <Ionicons name="trash-outline" size={17} color={colors.red} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  thumbWrap: {
    width: 52,
    height: 52,
    borderRadius: radius.sm,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumb: { width: '100%', height: '100%' },
  durationTag: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    paddingHorizontal: 4,
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  durationText: { ...typography.tiny, fontSize: 9, color: '#fff' },
  name: { ...typography.small, color: colors.text },
  note: {
    ...typography.tiny,
    color: colors.textDim,
    paddingVertical: 2,
    paddingHorizontal: 0,
  },
});
