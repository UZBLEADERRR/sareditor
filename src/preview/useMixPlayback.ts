import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import React from 'react';

import type { Project } from '../types/project';
import { toFileUri } from '../utils/paths';

/** Anything further apart than this and the ear notices; correct it. */
const DRIFT_TOLERANCE_MS = 260;

export const gainFromDb = (db: number): number => {
  if (!Number.isFinite(db)) return 1;
  return Math.min(4, Math.max(0, 10 ** (db / 20)));
};

/**
 * Plays the music bed and the generated voice lines along with the preview.
 *
 * Without this the picture is live but the mix is not, so changing a track or
 * its volume would only be audible after a full render — which is exactly the
 * wait the live preview exists to remove.
 *
 * The playhead stays the single source of truth: these players never drive it,
 * they follow it, and any drift beyond a quarter of a second is corrected with
 * a seek. Ducking under a voice line is applied here too, so the balance the
 * creator hears is the balance the renderer will produce.
 */
export function useMixPlayback({
  project,
  playing,
  outputMs,
}: {
  project: Project;
  playing: boolean;
  outputMs: number;
}): void {
  const music = project.music;
  const musicUri = music.enabled && music.uri ? toFileUri(music.uri) : null;

  const musicRef = React.useRef<AudioPlayer | null>(null);
  const voiceRef = React.useRef<Map<string, AudioPlayer>>(new Map());

  // ------------------------------------------------------------- music ---
  React.useEffect(() => {
    if (!musicUri) return undefined;
    const player = createAudioPlayer({ uri: musicUri });
    player.loop = music.loop;
    musicRef.current = player;
    return () => {
      musicRef.current = null;
      player.remove();
    };
  }, [musicUri, music.loop]);

  // -------------------------------------------------------------- voice ---
  const voiceKey = project.voiceovers.map((clip) => clip.id).join('|');

  React.useEffect(() => {
    const players = new Map<string, AudioPlayer>();
    for (const clip of project.voiceovers) {
      players.set(clip.id, createAudioPlayer({ uri: toFileUri(clip.uri) }));
    }
    voiceRef.current = players;
    return () => {
      for (const player of players.values()) player.remove();
      voiceRef.current = new Map();
    };
    // Rebuilding on every volume tweak would restart playback mid-word.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceKey]);

  // --------------------------------------------------------------- sync ---
  React.useEffect(() => {
    const activeVoice = project.voiceovers.find(
      (clip) => outputMs >= clip.startMs && outputMs < clip.startMs + clip.durationMs
    );

    // Voice lines
    for (const clip of project.voiceovers) {
      const player = voiceRef.current.get(clip.id);
      if (!player) continue;
      const active = clip === activeVoice;

      if (!active || !playing) {
        if (player.playing) player.pause();
        continue;
      }

      player.volume = gainFromDb(clip.volumeDb);
      const expectedMs = outputMs - clip.startMs;
      if (Math.abs(player.currentTime * 1000 - expectedMs) > DRIFT_TOLERANCE_MS) {
        player.seekTo(Math.max(0, expectedMs) / 1000);
      }
      if (!player.playing) player.play();
    }

    // Music bed
    const player = musicRef.current;
    if (!player) return;

    const ducked = activeVoice?.duckOriginal && music.duckEnabled;
    // duckAmountDb is stored as a positive amount of reduction.
    player.volume = gainFromDb(music.volumeDb - (ducked ? music.duckAmountDb : 0));

    if (!playing) {
      if (player.playing) player.pause();
      return;
    }

    const expectedMs = music.startMs + outputMs;
    if (Math.abs(player.currentTime * 1000 - expectedMs) > DRIFT_TOLERANCE_MS) {
      player.seekTo(Math.max(0, expectedMs) / 1000);
    }
    if (!player.playing) player.play();
  }, [
    playing,
    outputMs,
    project.voiceovers,
    music.startMs,
    music.volumeDb,
    music.duckEnabled,
    music.duckAmountDb,
  ]);

  // Leaving the editor while a track is playing would keep it playing.
  React.useEffect(
    () => () => {
      musicRef.current?.pause();
      for (const player of voiceRef.current.values()) player.pause();
    },
    []
  );
}
