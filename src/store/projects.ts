import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { exportConfigFor } from '../ffmpeg/presets';
import { uid } from '../utils/id';
import type {
  AiEdit,
  AiPlan,
  AiSnapshot,
  ImageOverlay,
  MediaAsset,
  AudioConfig,
  EffectsConfig,
  ExportConfig,
  MusicConfig,
  PlatformId,
  Project,
  RenderRecord,
  Segment,
  VoiceClip,
  SourceClip,
  SubtitleConfig,
  Transcript,
} from '../types/project';
import { createProject, defaultAudioConfig, withSource } from './defaults';

const STORAGE_KEY = 'sar.projects.v1';

type ProjectsState = {
  projects: Project[];
  activeId: string | null;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  active: () => Project | undefined;

  create: (name: string, platform?: PlatformId) => Project;
  remove: (id: string) => void;
  rename: (id: string, name: string) => void;
  setActive: (id: string | null) => void;

  patch: (id: string, patch: Partial<Project>) => void;
  attachSource: (id: string, source: SourceClip) => void;
  setSegments: (id: string, segments: Segment[]) => void;
  setTranscript: (id: string, transcript: Transcript | undefined) => void;
  setAiPlan: (id: string, plan: AiPlan | undefined) => void;
  setOverlays: (id: string, overlays: ImageOverlay[]) => void;
  removeOverlay: (id: string, overlayId: string) => void;
  updateOverlay: (id: string, overlayId: string, patch: Partial<ImageOverlay>) => void;
  addLibraryAssets: (id: string, assets: MediaAsset[]) => void;
  removeLibraryAsset: (id: string, assetId: string) => void;
  updateLibraryAsset: (id: string, assetId: string, patch: Partial<MediaAsset>) => void;
  setVoiceovers: (id: string, voiceovers: VoiceClip[]) => void;
  removeVoiceover: (id: string, voiceId: string) => void;
  /** Returns the id of the recorded run, so the chat can offer an undo button. */
  applyAiEdit: (
    id: string,
    patch: Partial<Project>,
    meta: { instruction: string; summary: string; changes: string[] }
  ) => string;
  undoAiEdit: (id: string, editId: string) => void;
  updateSubtitle: (id: string, patch: Partial<SubtitleConfig>) => void;
  updateMusic: (id: string, patch: Partial<MusicConfig>) => void;
  updateEffects: (id: string, patch: Partial<EffectsConfig>) => void;
  updateAudio: (id: string, patch: Partial<AudioConfig>) => void;
  updateExport: (id: string, patch: Partial<ExportConfig>) => void;
  setPlatform: (id: string, platform: PlatformId) => void;
  addRender: (id: string, render: RenderRecord) => void;
  markRenderSaved: (id: string, renderId: string) => void;
  removeRender: (id: string, renderId: string) => void;
};

export const useProjects = create<ProjectsState>((set, get) => ({
  projects: [],
  activeId: null,
  hydrated: false,

  hydrate: async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      set({ hydrated: true });
      return;
    }
    try {
      const parsed = JSON.parse(raw) as { projects: Project[]; activeId: string | null };
      set({
        projects: Array.isArray(parsed.projects) ? parsed.projects : [],
        activeId: parsed.activeId ?? null,
        hydrated: true,
      });
    } catch {
      // A corrupted store should not brick the app — start clean instead.
      set({ projects: [], activeId: null, hydrated: true });
    }
  },

  active: () => {
    const { projects, activeId } = get();
    return projects.find((project) => project.id === activeId);
  },

  create: (name, platform = 'instagram_reels') => {
    const project = createProject(name, platform);
    set((state) => ({ projects: [project, ...state.projects], activeId: project.id }));
    persist(get());
    return project;
  },

  remove: (id) => {
    set((state) => ({
      projects: state.projects.filter((project) => project.id !== id),
      activeId: state.activeId === id ? null : state.activeId,
    }));
    persist(get());
  },

  rename: (id, name) => {
    applyPatch(set, get, id, () => ({ name: name.trim() || 'Nomsiz loyiha' }));
  },

  setActive: (id) => {
    set({ activeId: id });
    persist(get());
  },

  patch: (id, patch) => applyPatch(set, get, id, () => patch),

  attachSource: (id, source) => applyPatch(set, get, id, (project) => withSource(project, source)),

  setSegments: (id, segments) => applyPatch(set, get, id, () => ({ segments })),

  setTranscript: (id, transcript) => applyPatch(set, get, id, () => ({ transcript })),

  setAiPlan: (id, aiPlan) => applyPatch(set, get, id, () => ({ aiPlan })),

  setOverlays: (id, overlays) => applyPatch(set, get, id, () => ({ overlays })),

  removeOverlay: (id, overlayId) =>
    applyPatch(set, get, id, (project) => ({
      overlays: project.overlays.filter((overlay) => overlay.id !== overlayId),
    })),

  updateOverlay: (id, overlayId, patch) =>
    applyPatch(set, get, id, (project) => ({
      overlays: project.overlays.map((overlay) =>
        overlay.id === overlayId ? { ...overlay, ...patch } : overlay
      ),
    })),

  addLibraryAssets: (id, assets) =>
    applyPatch(set, get, id, (project) => ({ library: [...project.library, ...assets] })),

  removeLibraryAsset: (id, assetId) =>
    applyPatch(set, get, id, (project) => ({
      library: project.library.filter((asset) => asset.id !== assetId),
      // An overlay pointing at a deleted file would render as a black hole.
      overlays: project.overlays.filter((overlay) => overlay.assetId !== assetId),
    })),

  updateLibraryAsset: (id, assetId, patch) =>
    applyPatch(set, get, id, (project) => ({
      library: project.library.map((asset) =>
        asset.id === assetId ? { ...asset, ...patch } : asset
      ),
    })),

  setVoiceovers: (id, voiceovers) => applyPatch(set, get, id, () => ({ voiceovers })),

  removeVoiceover: (id, voiceId) =>
    applyPatch(set, get, id, (project) => ({
      voiceovers: project.voiceovers.filter((clip) => clip.id !== voiceId),
    })),

  /**
   * Applies an agent run and records what the project looked like beforehand.
   *
   * The snapshot is taken here rather than in the agent so it cannot drift:
   * whatever is in the store at this instant is exactly what undo restores.
   */
  applyAiEdit: (id, patch, meta) => {
    const editId = uid('aiedit_');
    applyPatch(set, get, id, (project) => {
      const edit: AiEdit = {
        id: editId,
        createdAt: Date.now(),
        instruction: meta.instruction,
        summary: meta.summary,
        changes: meta.changes,
        before: snapshot(project),
      };
      return { ...patch, aiEdits: [edit, ...(project.aiEdits ?? [])].slice(0, 10) };
    });
    return editId;
  },

  /**
   * Puts the project back to just before an agent run.
   *
   * Runs made after it go too — they were built on top of state that is about
   * to disappear, so keeping them would let a later undo restore a mixture of
   * two different histories.
   */
  undoAiEdit: (id, editId) =>
    applyPatch(set, get, id, (project) => {
      const edits = project.aiEdits ?? [];
      const index = edits.findIndex((edit) => edit.id === editId);
      if (index < 0) return {};
      return { ...edits[index].before, aiEdits: edits.slice(index + 1) };
    }),

  updateSubtitle: (id, patch) =>
    applyPatch(set, get, id, (project) => ({ subtitle: { ...project.subtitle, ...patch } })),

  updateMusic: (id, patch) =>
    applyPatch(set, get, id, (project) => ({ music: { ...project.music, ...patch } })),

  updateEffects: (id, patch) =>
    applyPatch(set, get, id, (project) => {
      const effects = { ...project.effects, ...patch };
      // The cached camera-motion analysis is only valid while stabilisation is on.
      const analysis =
        patch.stabilize === false ? { ...project.analysis, stabilizeTrfPath: undefined } : project.analysis;
      return { effects, analysis };
    }),

  updateAudio: (id, patch) =>
    applyPatch(set, get, id, (project) => ({ audio: { ...project.audio, ...patch } })),

  updateExport: (id, patch) =>
    applyPatch(set, get, id, (project) => ({ export: { ...project.export, ...patch } })),

  setPlatform: (id, platform) =>
    applyPatch(set, get, id, (project) => ({
      export: exportConfigFor(platform, project.export.encoder),
      audio: { ...project.audio, targetLufs: defaultAudioConfig(platform).targetLufs },
    })),

  addRender: (id, render) =>
    applyPatch(set, get, id, (project) => ({ renders: [render, ...project.renders].slice(0, 20) })),

  markRenderSaved: (id, renderId) =>
    applyPatch(set, get, id, (project) => ({
      renders: project.renders.map((render) =>
        render.id === renderId ? { ...render, savedToGallery: true } : render
      ),
    })),

  removeRender: (id, renderId) =>
    applyPatch(set, get, id, (project) => ({
      renders: project.renders.filter((render) => render.id !== renderId),
    })),
}));

function snapshot(project: Project): AiSnapshot {
  return {
    segments: project.segments,
    subtitle: project.subtitle,
    music: project.music,
    effects: project.effects,
    audio: project.audio,
    export: project.export,
    overlays: project.overlays,
    voiceovers: project.voiceovers,
    transcript: project.transcript,
  };
}

type SetState = (partial: Partial<ProjectsState> | ((state: ProjectsState) => Partial<ProjectsState>)) => void;

function applyPatch(
  set: SetState,
  get: () => ProjectsState,
  id: string,
  producer: (project: Project) => Partial<Project>
): void {
  set((state) => ({
    projects: state.projects.map((project) =>
      project.id === id ? { ...project, ...producer(project), updatedAt: Date.now() } : project
    ),
  }));
  persist(get());
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Writes are debounced because the editor patches the active project on every
 * slider tick, and each write serialises the whole project list.
 */
function persist(state: ProjectsState): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ projects: state.projects, activeId: state.activeId })
    ).catch(() => undefined);
  }, 400);
}
