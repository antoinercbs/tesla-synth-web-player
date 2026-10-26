import { defineStore } from 'pinia';
import type { SceneRecord } from '@/api/scenes';

interface ScenesState {
  /** The club's scenes, in list order; empty from a server that predates them. */
  list: SceneRecord[];
  /** Once the server answered: a scene asked by its id before that is not missing yet. */
  loaded: boolean;
  /** The scene the player's 3D shows the coils in (its uuid; null: none), kept on the device. */
  played: string | null;
}

const PLAYED_KEY = 'scene3d.play';

export const useScenesStore = defineStore('scenes', {
  state: (): ScenesState => ({
    list: [],
    loaded: false,
    played: (() => { try { return localStorage.getItem(PLAYED_KEY); } catch { return null; } })(),
  }),
  getters: {
    byUuid: (state) => (uuid: string | null | undefined): SceneRecord | null =>
      (uuid ? state.list.find((s) => s.uuid === uuid) ?? null : null),
  },
  actions: {
    setList(list: SceneRecord[]) {
      this.list = [...list].sort((a, b) => a.position - b.position || a.id - b.id);
      this.loaded = true;
    },
    upsert(scene: SceneRecord) {
      this.setList([...this.list.filter((s) => s.id !== scene.id), scene]);
    },
    remove(id: number) {
      this.list = this.list.filter((s) => s.id !== id);
    },
    play(uuid: string | null) {
      this.played = uuid;
      try {
        if (uuid) localStorage.setItem(PLAYED_KEY, uuid);
        else localStorage.removeItem(PLAYED_KEY);
      } catch { /* a private window: not kept */ }
    },
  },
});
