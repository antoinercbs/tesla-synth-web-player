<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import axios from 'axios';
import { useMidiStore } from '@/stores/midi';
import SearchableSelect from '@/components/SearchableSelect.vue';
import PlaylistManager from '@/components/PlaylistManager.vue';
import type { Playlist } from '@/types/domain';

const route = useRoute();
const router = useRouter();
const midiStore = useMidiStore();
const playlists = ref<Playlist[]>([]);

const routeId = computed(() => route.params.id as string | undefined);
const isChooser = computed(() => routeId.value == null);
const playlistItems = computed(() =>
  playlists.value.map((p) => ({ id: p.id, label: `${p.name} — ${p.coilCount} ⚡` })),
);
const headTitle = computed(() => {
  if (routeId.value === 'new' || routeId.value == null) return '';
  const p = playlists.value.find((x) => x.id === Number(routeId.value));
  return p ? p.name : '';
});

function loadPlaylists(): void {
  axios.get('/api/playlists').then((r) => {
    playlists.value = (r.data as Playlist[]).map((p) => ({
      ...p,
      songIds: (p.songIds ?? []).filter((id) => id != null),
    }));
  });
}
loadPlaylists();
// Re-read after a desktop sync may have changed playlists locally.
watch(() => midiStore.dataRevision, loadPlaylists);

// picking in the chooser navigates to the editor (getter stays null so it resets)
const chooserPick = computed<number | null>({
  get: () => null,
  set: (id) => { if (id != null) router.push({ name: 'playlists', params: { id: String(id) } }); },
});
function newPlaylist(): void { router.push({ name: 'playlists', params: { id: 'new' } }); }
function close(): void { router.push({ name: 'playlists', params: {} }); }

function onSaved(p: Playlist): void {
  const i = playlists.value.findIndex((x) => x.id === p.id);
  if (i >= 0) playlists.value.splice(i, 1, p);
  else playlists.value.push(p);
  if (String(p.id) !== routeId.value) {
    router.replace({ name: 'playlists', params: { id: String(p.id) } });
  }
}
function onDeleted(id: number): void {
  playlists.value = playlists.value.filter((p) => p.id !== id);
  close();
}
</script>

<template>
  <!-- chooser: pick an existing playlist or create a new one -->
  <div v-if="isChooser" class="edit-chooser">
    <div class="edit-chooser__card">
      <h1 class="view-head__title">{{ $t('nav.playlists') }}</h1>
      <p class="edit-chooser__hint">{{ $t('label.chooseOrCreatePlaylist') }}</p>
      <div class="edit-chooser__actions">
        <searchable-select class="edit-chooser__pick" v-model="chooserPick" :items="playlistItems"
          :placeholder="$t('label.pickPlaylist')" />
        <span class="edit-chooser__or">{{ $t('label.or') }}</span>
        <button class="btn btn--volt" type="button" @click="newPlaylist">
          <span class="icon"><i class="fas fa-plus"></i></span>{{ $t('label.newPlaylist') }}
        </button>
      </div>
    </div>
  </div>

  <!-- editor -->
  <div v-else class="screen">
    <header class="screen-head">
      <h1 class="view-head__title">{{ headTitle || $t('label.newPlaylist') }}</h1>
      <button class="icon-btn" type="button" :title="$t('label.closeEditor')" :aria-label="$t('label.closeEditor')"
        @click="close">
        <i class="fas fa-xmark"></i>
      </button>
    </header>
    <div class="screen-body screen-body--fill">
      <playlist-manager :playlists="playlists" :playlist-id="routeId ?? null" @saved="onSaved" @deleted="onDeleted" />
    </div>
  </div>
</template>
