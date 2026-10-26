import axios from 'axios';
import { useMidiStore } from '@/app/stores/midi';
import { DEFAULT_TAG_COLOR, type AppTag } from '@/model/domain';

/** Two tag names that read the same (case aside, accents not). */
export const sameTagName = (a: string, b: string): boolean => a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;

/**
 * The tag named `name`: the server's own when it has one already, else a new
 * one. The store's list follows the server's. Null: the server made none.
 */
export async function tagNamed(name: string): Promise<AppTag | null> {
  const store = useMidiStore();
  // the sync deletes whatever the list leaves out: start from the server's, not from a stale copy
  const { data: current } = await axios.get<AppTag[]>('/api/tags');
  const taken = current.find((t) => sameTagName(t.name, name));
  if (taken) {
    store.setTagList(current);
    return taken;
  }
  const { data } = await axios.put<AppTag[]>('/api/tags/sync', [...current, { name, color: DEFAULT_TAG_COLOR }]);
  store.setTagList(data);
  const before = new Set(current.map((t) => t.id));
  return data.find((t) => !before.has(t.id)) ?? null;
}
