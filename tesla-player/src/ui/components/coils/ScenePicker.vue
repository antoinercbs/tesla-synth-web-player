<script setup lang="ts">
import { computed } from 'vue';
import { useScenesStore } from '@/app/stores/scenes';
import { DECOR_ICONS, PhyScene } from '@/model/coils/scene-data';
import type { SceneRecord } from '@/api/scenes';
import DropMenu from '@/ui/components/ui/DropMenu.vue';

/**
 * A 3D view's scene (the Coils page's Scènes tab makes them): none, the coils
 * alone in the dark hall, or one of the club's. `only`: just the scenes a coil
 * is posed in. `song`: the song's coils (and their caps' colours); the scenes
 * that pose the most of them come first, those with the fewest others among
 * them, then the ones that pose none, after a line; a dot each, full when it
 * is posed.
 */
const props = defineProps<{ only?: string | null; song?: { uuid: string; color: string }[] }>();
const model = defineModel<string | null>({ required: true });
const scenes = useScenesStore();
const poses = (s: SceneRecord, uuid: string) => s.data.coils.some((p) => p.coil === uuid);
const songUuids = computed(() => (props.song ?? []).map((c) => c.uuid));
const fit = (s: SceneRecord) => new PhyScene(s.data).posed(songUuids.value);
const list = computed(() => PhyScene.bySong(scenes.list.filter((s) => !props.only || poses(s, props.only)), songUuids.value));
// where the scenes that pose none of the song's coils begin
const firstOff = computed(() => (props.song?.length ? list.value.findIndex((s) => !fit(s)) : -1));
const current = computed(() => list.value.find((s) => s.uuid === model.value) ?? null);
</script>

<template>
  <drop-menu v-if="list.length" trigger-class="scenes-chip" menu-class="scenes-list" :label="$t('scenes.view.pick')">
    <template #trigger><i class="fas" :class="current ? DECOR_ICONS[current.data.decor] : 'fa-cubes'"></i><span>{{ $t('scenes.view.pick') }} : <b>{{
      current?.name ?? $t('scenes.view.none') }}</b></span><i class="fas fa-chevron-down scenes-chip__dd"></i></template>
    <button class="dropdown__item" :class="{ 'is-on': !current }" type="button" :title="$t('scenes.view.noneHint')" @click="model = null"><i
        class="fas fa-cube"></i><span>{{ $t('scenes.view.none') }}</span></button>
    <template v-for="(s, k) in list" :key="s.uuid">
      <div v-if="k === firstOff && k > 0" class="dropdown__divider"></div>
      <button class="dropdown__item" :class="{ 'is-on': s.uuid === model }" type="button" @click="model = s.uuid"><i class="fas"
          :class="DECOR_ICONS[s.data.decor]"></i><span>{{ s.name }}</span>
        <span v-if="song?.length" class="scenes-fit"><i v-for="c in song" :key="c.uuid" :class="{ 'is-in': poses(s, c.uuid) }" :style="{ '--c': c.color }"></i></span>
      </button>
    </template>
  </drop-menu>
</template>
