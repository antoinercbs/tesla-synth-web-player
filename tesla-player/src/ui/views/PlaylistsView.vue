<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import axios from 'axios';
import { useMidiStore } from '@/app/stores/midi';
import PlaylistManager from '@/ui/components/playlists/PlaylistManager.vue';
import PlaylistLibrary from '@/ui/components/playlists/PlaylistLibrary.vue';
import PageTourButton from '@/ui/components/tour/PageTourButton.vue';
import type { Playlist } from '@/model/domain';

const route = useRoute();
const router = useRouter();
const midiStore = useMidiStore();
const playlists = ref<Playlist[]>([]);
const loading = ref(true);

const routeId = computed(() => route.params.id as string | undefined);
const isChooser = computed(() => !routeId.value);

function loadPlaylists(): void {
  axios.get('/api/playlists').then((r) => {
    playlists.value = (r.data as Playlist[]).map((p) => ({
      ...p,
      songIds: (p.songIds ?? []).filter((id) => id != null),
    }));
    checkValidId();
  }).finally(() => { loading.value = false; });
}
loadPlaylists();
// Re-read after a desktop sync may have changed playlists locally.
watch(() => midiStore.dataRevision, loadPlaylists);

function checkValidId(): void {
  const id = routeId.value;
  if (!id || id === 'new') return;
  if (playlists.value.length === 0) return;
  const exists = playlists.value.some((x) => x.id === Number(id));
  if (!exists) {
    router.replace({ name: 'playlists', params: {} });
  }
}

watch(routeId, () => {
  checkValidId();
});


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
  if (!isChooser.value) router.push({ name: 'playlists', params: {} });
}
</script>

<template>
  <!-- no playlist open: the playlists, listed like the MIDI files (search, new playlist, table) -->
  <div v-if="isChooser" class="screen">
    <header class="screen-head">
      <h1 class="view-head__title">{{ $t('nav.playlists') }}<page-tour-button id="playlists" /></h1>
    </header>
    <div class="screen-body lib-page">
      <playlist-library :playlists="playlists" :loading="loading" @deleted="onDeleted" />
    </div>
  </div>

  <!-- editor: its head (the playlist's name) and body -->
  <div v-else class="screen pl-screen">
    <playlist-manager :playlists="playlists" :playlist-id="routeId ?? null" @saved="onSaved" @deleted="onDeleted" />
  </div>
</template>
