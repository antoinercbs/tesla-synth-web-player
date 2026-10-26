import axios from 'axios';
import { PhyScene, type SceneData } from '@/model/coils/scene-data';

/** A scene of the club, as the API returns it. */
export interface SceneRecord {
  id: number;
  uuid: string;
  name: string;
  position: number;
  data: SceneData;
  updatedAt: number | null;
  editorName: string | null;
}

/** What the editor sends (the server fills id/uuid/updatedAt/editorName). */
export interface SceneInput {
  name: string;
  data: SceneData;
  position?: number;
}

// a scene saved by another version of the app comes back whole
const record = (raw: SceneRecord): SceneRecord => ({ ...raw, data: PhyScene.of(raw.data) });

const body = (s: SceneInput) => ({ name: s.name, data: s.data, ...(s.position != null ? { position: s.position } : {}) });

export const listScenes = () => axios.get<SceneRecord[]>('/api/scenes').then((r) => r.data.map(record));
export const createScene = (s: SceneInput) => axios.post<SceneRecord>('/api/scenes', body(s)).then((r) => record(r.data));
export const updateScene = (id: number, s: SceneInput) => axios.put<SceneRecord>(`/api/scenes/${id}`, body(s)).then((r) => record(r.data));
export const deleteScene = (id: number) => axios.delete(`/api/scenes/${id}`);
