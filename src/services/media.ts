import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { Directory, File } from 'expo-file-system';

import { probe } from '../ffmpeg/engine';
import type { SourceClip } from '../types/project';
import { uid } from '../utils/id';
import { safeFileName } from '../ffmpeg/filters/escape';
import { fontsDir, mediaDir, toFileUri, toNativePath } from '../utils/paths';

const ALBUM_NAME = 'SAR Editor';

/**
 * ffmpeg cannot read a `content://` URI, and picked files often live outside the
 * sandbox, so anything the user brings in is copied into app storage first.
 */
async function copyIntoApp(uri: string, directory: Directory, name: string): Promise<string> {
  const target = new File(directory, safeFileName(name, `${uid()}.bin`));
  if (target.exists) target.delete();
  const source = new File(uri);
  await source.copy(target);
  return target.uri;
}

export async function pickVideo(): Promise<SourceClip | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Galereyaga ruxsat berilmadi. Sozlamalardan ruxsat bering.');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['videos'],
    allowsMultipleSelection: false,
    quality: 1,
    // Transcoding would re-compress before we ever touch the file.
    videoExportPreset: ImagePicker.VideoExportPreset.Passthrough,
  });

  if (result.canceled || !result.assets?.length) return null;
  return describeVideo(result.assets[0].uri, result.assets[0].fileName ?? 'video.mp4');
}

export async function recordVideo(): Promise<SourceClip | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new Error('Kameraga ruxsat berilmadi.');

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['videos'],
    quality: 1,
    videoExportPreset: ImagePicker.VideoExportPreset.Passthrough,
  });

  if (result.canceled || !result.assets?.length) return null;
  return describeVideo(result.assets[0].uri, `record_${uid()}.mp4`);
}

/** Copies the clip into app storage and reads its real properties with ffprobe. */
export async function describeVideo(uri: string, name: string): Promise<SourceClip> {
  const localUri = uri.startsWith('content://')
    ? await copyIntoApp(uri, mediaDir(), name)
    : uri;

  const info = await probe(localUri);
  if (!info.hasVideo) throw new Error('Bu faylda video oqim topilmadi.');

  const file = new File(localUri);
  return {
    id: uid('src_'),
    uri: toNativePath(localUri),
    name,
    durationMs: info.durationMs,
    width: info.width,
    height: info.height,
    fps: info.fps,
    hasAudio: info.hasAudio,
    rotation: info.rotation,
    sizeBytes: file.exists ? file.size ?? info.sizeBytes : info.sizeBytes,
  };
}

export type PickedAudio = {
  uri: string;
  name: string;
  durationMs: number;
};

/** Lets the user bring in their own track — the app never ships or fetches music. */
export async function pickAudio(): Promise<PickedAudio | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['audio/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  const localUri = await copyIntoApp(asset.uri, mediaDir(), asset.name ?? `music_${uid()}.mp3`);
  const info = await probe(localUri);

  return {
    uri: toNativePath(localUri),
    name: asset.name ?? 'Musiqa',
    durationMs: info.durationMs,
  };
}

export async function pickFont(): Promise<{ uri: string; name: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['font/ttf', 'font/otf', 'application/x-font-ttf', 'application/octet-stream'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  if (!/\.(ttf|otf)$/i.test(asset.name ?? '')) {
    throw new Error('Faqat .ttf yoki .otf shrift fayllari qo‘llab-quvvatlanadi.');
  }
  const localUri = await copyIntoApp(asset.uri, fontsDir(), asset.name ?? `font_${uid()}.ttf`);
  return { uri: toNativePath(localUri), name: asset.name ?? 'Shrift' };
}

/** Lets the user swap the in-app logo for their own artwork. */
export async function pickLogo(): Promise<{ uri: string; name: string } | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error('Galereyaga ruxsat berilmadi.');

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    quality: 1,
  });
  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  const localUri = await copyIntoApp(asset.uri, mediaDir(), asset.fileName ?? `logo_${uid()}.png`);
  return { uri: toNativePath(localUri), name: asset.fileName ?? 'logo' };
}

export async function pickLut(): Promise<{ uri: string; name: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  if (!/\.cube$/i.test(asset.name ?? '')) {
    throw new Error('LUT sifatida .cube fayl kerak.');
  }
  const localUri = await copyIntoApp(asset.uri, mediaDir(), asset.name ?? `lut_${uid()}.cube`);
  return { uri: toNativePath(localUri), name: asset.name ?? 'LUT' };
}

/** Saves a finished render into the device gallery, in its own album. */
export async function saveToGallery(uri: string): Promise<void> {
  const permission = await MediaLibrary.requestPermissionsAsync(false, ['video']);
  if (!permission.granted) {
    throw new Error('Galereyaga yozish uchun ruxsat kerak.');
  }

  const asset = await MediaLibrary.Asset.create(toFileUri(uri));
  const album = await MediaLibrary.Album.get(ALBUM_NAME);
  if (album) {
    await album.add([asset]);
  } else {
    await MediaLibrary.Album.create(ALBUM_NAME, [asset], false);
  }
}

export async function shareFile(uri: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Bu qurilmada ulashish mavjud emas.');
  }
  await Sharing.shareAsync(toFileUri(uri));
}

/** Frames for the timeline strip. Failures are tolerated — a gap beats a crash. */
export async function generateThumbnails(uri: string, timesMs: number[]): Promise<(string | null)[]> {
  const results: (string | null)[] = [];
  for (const time of timesMs) {
    try {
      const thumb = await VideoThumbnails.getThumbnailAsync(toFileUri(uri), {
        time: Math.max(0, Math.round(time)),
        quality: 0.5,
      });
      results.push(thumb.uri);
    } catch {
      results.push(null);
    }
  }
  return results;
}

export function listImportedFonts(): { name: string; uri: string }[] {
  const dir = fontsDir();
  if (!dir.exists) return [];
  return dir
    .list()
    .filter((entry): entry is File => entry instanceof File && /\.(ttf|otf)$/i.test(entry.uri))
    .map((file) => ({
      name: decodeURIComponent(file.uri.split('/').pop() ?? 'font'),
      uri: toNativePath(file.uri),
    }));
}
