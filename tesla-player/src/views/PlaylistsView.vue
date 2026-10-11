<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import axios from 'axios';
import { useMidiStore } from '@/stores/midi';
import PlaylistManager from '@/components/playlists/PlaylistManager.vue';
import PlaylistLibrary from '@/components/playlists/PlaylistLibrary.vue';
import PageTourButton from '@/components/tour/PageTourButton.vue';
import type { Playlist } from '@/types/domain';

const route = useRoute();
const router = useRouter();
const midiStore = useMidiStore();
const playlists = ref<Playlist[]>([]);
const loading = ref(true);

const routeId = computed(() => route.params.id as string | undefined);
const isChooser = computed(() => !routeId.value);
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
const dirty = ref(false);

const headerScrolled = ref(false);
let scrollEl: HTMLElement | null = null;

function onScroll(): void {
  headerScrolled.value = (scrollEl?.scrollTop ?? 0) > 6;
}

onMounted(() => {
  scrollEl = document.querySelector('.app-main');
  if (scrollEl) {
    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
});

onBeforeUnmount(() => {
  if (scrollEl) {
    scrollEl.removeEventListener('scroll', onScroll);
  }
});
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

  <!-- editor -->
  <div v-else class="screen pl-screen">
    <header class="screen-head" :class="{ 'is-scrolled': headerScrolled }">
      <h1 class="view-head__title">{{ headTitle || $t('label.newPlaylist') }}<page-tour-button v-if="!dirty"
          id="playlists" /></h1>
      <RouterLink class="icon-btn" :to="{ name: 'playlists', params: {} }" :title="$t('label.closeEditor')"
        :aria-label="$t('label.closeEditor')">
        <i class="fas fa-xmark"></i>
      </RouterLink>
    </header>
    <div class="screen-body screen-body--fill">
      <playlist-manager :playlists="playlists" :playlist-id="routeId ?? null" @saved="onSaved" @deleted="onDeleted"
        @dirty="dirty = $event" />
    </div>
  </div>
</template>
