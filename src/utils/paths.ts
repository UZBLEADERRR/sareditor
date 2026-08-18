import { Directory, File, Paths } from 'expo-file-system';

/**
 * ffmpeg takes POSIX paths, while expo-file-system hands out `file://` URIs.
 * Everything that crosses into the native module goes through here.
 */
export function toNativePath(uri: string): string {
  if (!uri) return uri;
  if (uri.startsWith('file://')) return decodeURI(uri.replace('file://', ''));
  return uri;
}

export function toFileUri(path: string): string {
  if (!path) return path;
  return path.startsWith('file://') ? path : `file://${path}`;
}

function ensure(dir: Directory): Directory {
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/** Scratch space for analysis passes and previews — safe to wipe at any time. */
export const workDir = () => ensure(new Directory(Paths.cache, 'sar-work'));
/** Finished renders live here until the user saves them to the gallery. */
export const outputDir = () => ensure(new Directory(Paths.document, 'sar-output'));
/** Music the user imported, copied locally so ffmpeg can read it directly. */
export const mediaDir = () => ensure(new Directory(Paths.document, 'sar-media'));
/** User supplied .ttf/.otf files, registered with libass on boot. */
export const fontsDir = () => ensure(new Directory(Paths.document, 'sar-fonts'));

export function workFile(name: string): File {
  return new File(workDir(), name);
}

export function outputFile(name: string): File {
  return new File(outputDir(), name);
}

/** Copies an arbitrary content:// or file:// source into app storage. */
export async function importToMedia(uri: string, fileName: string): Promise<string> {
  const target = new File(mediaDir(), fileName);
  if (target.exists) target.delete();
  const source = new File(uri);
  source.copy(target);
  return toNativePath(target.uri);
}

export function clearWorkDir(): void {
  const dir = workDir();
  if (!dir.exists) return;
  for (const entry of dir.list()) {
    try {
      entry.delete();
    } catch {
      // A file still held by a cancelled ffmpeg session; it gets cleaned next time.
    }
  }
}

export function workDirSizeBytes(): number {
  const dir = workDir();
  if (!dir.exists) return 0;
  return dir
    .list()
    .reduce((total, entry) => total + (entry instanceof File ? entry.size ?? 0 : 0), 0);
}
