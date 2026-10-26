<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { useMidiStore } from '@/app/stores/midi';
import { useScenesStore } from '@/app/stores/scenes';
import { createScene, deleteScene, type SceneRecord } from '@/api/scenes';
import { DECOR_ICONS, DECOR_IDS, type DecorId } from '@/model/coils/scene-data';
import { notify } from '@/ui/helpers/toast';
import { formatEditDate } from '@/utils/format';
import ConfirmModal from '@/ui/components/ui/ConfirmModal.vue';
import DropMenu from '@/ui/components/ui/DropMenu.vue';
import CoilsTabs from '@/ui/components/coils/CoilsTabs.vue';
import OutletIcon from '@/ui/components/coils/OutletIcon.vue';
import SceneEditor from '@/ui/components/coils/SceneEditor.vue';

/**
 * The Coils page's second tab: the club's scenes, a line each as the coils'
 * list has (its décor, its coils by name, hung or standing and their outlet
 * points, its accessories, its last edit), each opened on a page of its own
 * to be set (ui/components/coils/SceneEditor.vue), as a coil's sheet is from
 * the coils' list. A new one starts in the décor picked.
 */
const route = useRoute();
const { t, locale } = useI18n();
const midiStore = useMidiStore();
const scenes = useScenesStore();

const opened = computed<number | 'new' | null>(() => {
  const id = route.params.id;
  if (typeof id !== 'string' || !id) return null;
  return id === 'new' ? 'new' : Number(id);
});
const newDecor = computed(() => (DECOR_IDS.includes(route.query.decor as DecorId) ? (route.query.decor as DecorId) : 'concert'));
const missing = computed(() => typeof opened.value === 'number' && scenes.loaded && !scenes.list.some((s) => s.id === opened.value));

// its coils still in the list, and how many left it
const coilsOf = (s: SceneRecord) => s.data.coils.map((p) => ({ p, coil: midiStore.coilByUuid(p.coil) })).filter((x) => x.coil != null);
const goneOf = (s: SceneRecord) => s.data.coils.length - coilsOf(s).length;
// its accessories: the coils' rings, its tables, cages, counter-points and knights; those it has
const propsOf = (s: SceneRecord) => [
  { icon: 'fa-ring', n: s.data.coils.filter((p) => p.ring).length, label: t('scenes.props.ring') },
  { icon: 'fa-chair', n: s.data.tables.length, label: t('scenes.props.table') },
  { icon: 'fa-border-all', n: s.data.cages.length, label: t('scenes.props.cage') },
  { icon: 'fa-location-arrow', n: s.data.counters.length, label: t('scenes.props.counter') },
  { icon: 'fa-chess-knight', n: s.data.knights.length, label: t('scenes.props.knight') },
].filter((x) => x.n > 0);

const busy = ref(false);
async function duplicate(s: SceneRecord): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    scenes.upsert(await createScene({ name: t('scenes.copyName', { name: s.name }), data: s.data }));
  } catch (err) {
    console.error('Duplicate scene failed', err);
    notify('label.saveFailed', 'error');
  } finally {
    busy.value = false;
  }
}
const toDelete = ref<SceneRecord | null>(null);
async function remove(): Promise<void> {
  const s = toDelete.value;
  toDelete.value = null;
  if (!s) return;
  try {
    await deleteScene(s.id);
    scenes.remove(s.id);
  } catch (err) {
    console.error('Delete scene failed', err);
    notify('label.deleteFailed', 'error');
  }
}
</script>

<template>
  <scene-editor v-if="opened != null && !missing" :id="opened" :key="String(opened)" :decor="newDecor" />
  <div v-else class="screen scenes-screen">
    <header class="screen-head coil-inv-head">
      <h1 class="view-head__title">{{ $t('coils.title') }}</h1>
      <coils-tabs />
    </header>

    <div class="screen-body scenes-body">
      <p v-if="missing" class="coil-inv-body__missing">{{ $t('scenes.missingScene') }}</p>
      <div class="scenes-list-rows">
        <!-- a line per scene: its name's link covers it, its menu sits above -->
        <article v-for="s in scenes.list" :key="s.id" class="scene-line">
          <span class="scene-line__decor" :title="$t(`scenes.decor.${s.data.decor}`)"><i class="fas" :class="DECOR_ICONS[s.data.decor]"></i></span>
          <span class="scene-line__id">
            <router-link class="scene-line__name" :to="{ name: 'coilScenes', params: { id: String(s.id) } }" :title="$t('scenes.open', { name: s.name })">{{ s.name }}</router-link>
            <small>{{ $t(`scenes.decor.${s.data.decor}`) }}</small>
          </span>
          <span class="scene-line__coils">
            <span v-for="x in coilsOf(s)" :key="x.p.coil" class="scene-line__coil">
              <b>{{ x.coil!.name }}</b>
              <i v-if="x.p.hang" class="fas fa-arrow-down" :title="$t('scenes.panel.hung')"></i>
              <span :title="$t('scenes.panel.tubes')"><outlet-icon />{{ x.p.tubes.length }}</span>
            </span>
            <span v-if="!coilsOf(s).length" class="scene-line__none">{{ $t('scenes.noCoil') }}</span>
            <small v-if="goneOf(s)" class="scene-line__gone">{{ $t('scenes.missing', goneOf(s)) }}</small>
          </span>
          <span class="scene-line__props">
            <span v-for="x in propsOf(s)" :key="x.icon" :title="x.label"><i class="fas" :class="x.icon"></i>{{ x.n }}</span>
          </span>
          <span class="scene-line__edit">
            <template v-if="s.updatedAt">{{ formatEditDate(s.updatedAt, locale) }}</template>
            <small v-if="s.editorName">{{ s.editorName }}</small>
          </span>
          <span class="scene-line__menu">
            <drop-menu trigger-class="icon-btn icon-btn--sm" :label="$t('label.moreOptions')">
              <button class="dropdown__item" type="button" :disabled="busy" @click="duplicate(s)"><i class="fas fa-copy"></i><span>{{ $t('scenes.duplicate') }}</span></button>
              <button class="dropdown__item is-danger" type="button" @click="toDelete = s"><i class="fas fa-trash"></i><span>{{ $t('label.delete') }}</span></button>
            </drop-menu>
          </span>
        </article>

        <!-- a new one, in the décor picked -->
        <div class="scene-line is-add">
          <span class="scene-line__add"><i class="fas fa-plus"></i>{{ $t('scenes.new') }}</span>
          <span class="scene-line__decors">
            <router-link v-for="d in DECOR_IDS" :key="d" class="btn btn--ghost" :to="{ name: 'coilScenes', params: { id: 'new' }, query: { decor: d } }"><i class="fas"
                :class="DECOR_ICONS[d]"></i>{{ $t(`scenes.decor.${d}`) }}</router-link>
          </span>
        </div>
      </div>
    </div>

    <confirm-modal :open="toDelete != null" :title="$t('scenes.deleteTitle', { name: toDelete?.name ?? '' })" warn :message="$t('scenes.deleteMessage')"
      :confirm-label="$t('label.delete')" :cancel-label="$t('label.cancel')" @confirm="remove" @close="toDelete = null" />
  </div>
</template>
