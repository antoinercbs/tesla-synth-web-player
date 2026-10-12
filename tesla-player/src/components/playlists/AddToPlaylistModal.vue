<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import axios from 'axios';
import BaseModal from '@/components/ui/BaseModal.vue';
import { coilColor } from '@/ui/coil-colors';
import { notify } from '@/utils/toast';
import { serverMessage } from '@/utils/http';
import type { Playlist, Song } from '@/types/domain';

/**
 * Puts songs (one, or a table's selection) at the end of a playlist, or of a
 * new one. A song already in it stays where it is; a song made for another
 * coil count goes in but is said to be skipped when the playlist plays.
 */
const props = defineProps<{ open: boolean; songs: Song[] }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'added', playlist: Playlist): void }>();
const { t } = useI18n();

const playlists = ref<Playlist[]>([]);
const loading = ref(false);
const busy = ref(false);
const newName = ref('');

watch(() => props.open, (open) => {
  if (!open) return;
  newName.value = '';
  loading.value = true;
  axios.get<Playlist[]>('/api/playlists')
    .then((r) => { playlists.value = [...r.data].sort((a, b) => a.name.localeCompare(b.name)); })
    .catch(() => { playlists.value = []; })
    .finally(() => { loading.value = false; });
}, { immediate: true });

// the coil count most of the songs are made for: a new playlist takes it
const coilCount = computed(() => {
  const counts = new Map<number, number>();
  for (const s of props.songs) counts.set(s.coilCount, (counts.get(s.coilCount) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 3;
});
function newIn(p: Playlist): number {
  return props.songs.filter((s) => !p.songIds.includes(s.id)).length;
}
function skippedIn(p: Playlist): number {
  return props.songs.filter((s) => s.coilCount !== p.coilCount).length;
}

async function addTo(p: Playlist): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  const songIds = [...p.songIds, ...props.songs.map((s) => s.id).filter((id) => !p.songIds.includes(id))];
  try {
    const { data } = await axios.put<Playlist>(`/api/playlists/${p.id}`, { name: p.name, coilCount: p.coilCount, songIds });
    notify(t('playlistAdd.added', { name: p.name }, props.songs.length));
    emit('added', data);
    emit('close');
  } catch (err) {
    const why = serverMessage(err);
    notify(why ? `${t('label.saveFailed')} : ${why}` : 'label.saveFailed', 'error');
  } finally {
    busy.value = false;
  }
}
async function createWith(): Promise<void> {
  const name = newName.value.trim();
  if (!name || busy.value) return;
  busy.value = true;
  try {
    const { data } = await axios.post<Playlist>('/api/playlists', { name, coilCount: coilCount.value, songIds: props.songs.map((s) => s.id) });
    notify(t('playlistAdd.added', { name }, props.songs.length));
    emit('added', data);
    emit('close');
  } catch (err) {
    const why = serverMessage(err);
    notify(why ? `${t('label.saveFailed')} : ${why}` : 'label.saveFailed', 'error');
  } finally {
    busy.value = false;
  }
}
function coilChips(n: number): number[] { return Array.from({ length: n }, (_, i) => i); }
</script>

<template>
  <base-modal :open="open" :title="$t('playlistAdd.title', songs.length)" icon="fa-list-ul" card-class="pl-add-modal"
    :close-label="$t('label.close')" @close="emit('close')">
    <p class="pl-add__lead" :title="songs.map((s) => s.name).join(', ')">{{ songs.map((s) => s.name).join(' · ') }}</p>
    <span v-if="loading" class="arc-loader" role="status" :aria-label="$t('label.loading')"></span>
    <ul v-else class="pl-add__list">
      <li v-for="p in playlists" :key="p.id">
        <button class="pl-add__item" type="button" :disabled="busy || newIn(p) === 0" @click="addTo(p)">
          <span class="pl-add__name">{{ p.name }}</span>
          <span class="pl-add__meta">
            <template v-if="newIn(p) === 0">{{ $t('playlistAdd.already') }}</template>
            <template v-else>{{ $t('label.songsCount', p.songIds.length) }}</template>
            <span v-if="newIn(p) > 0 && skippedIn(p)" class="pl-add__warn" :title="$t('playlistAdd.skippedHint', { n: p.coilCount })">
              <i class="fas fa-triangle-exclamation"></i>{{ $t('playlistAdd.skipped', skippedIn(p)) }}
            </span>
          </span>
          <span class="coil-dots">
            <span v-for="i in coilChips(p.coilCount)" :key="i" class="coil-dot" :style="{ '--c': coilColor(i) }"></span>
          </span>
        </button>
      </li>
      <li v-if="!playlists.length" class="pl-add__empty">{{ $t('label.noPlaylistsYet') }}</li>
    </ul>
    <form class="pl-add__new" @submit.prevent="createWith">
      <input v-model="newName" class="text-field" type="text" maxlength="80" :placeholder="$t('playlistAdd.newName')"
        :aria-label="$t('playlistAdd.newName')" />
      <button class="btn btn--volt" type="submit" :disabled="!newName.trim() || busy">
        <span class="icon"><i class="fas fa-plus"></i></span>{{ $t('playlistAdd.create') }}
      </button>
    </form>
  </base-modal>
</template>
