<script setup lang="ts">
import DropMenu from './DropMenu.vue';
import type { Usage } from './data-table';
import { ICONS } from '@/ui/icons';

/**
 * Who depends on an item, before anyone deletes it: a count ("2 songs") that
 * opens their list, each a link to it; "—" for none.
 */
defineProps<{ items: Usage[]; count: string; header: string }>();
</script>

<template>
  <drop-menu v-if="items.length" class="uses" trigger-class="uses__count" menu-class="uses__menu" :refocus="false">
    <template #trigger>{{ count }}</template>
    <div class="dropdown__header">{{ header }}</div>
    <router-link v-for="u in items" :key="u.key" class="dropdown__item" :to="u.to">
      <span class="uses__title">{{ u.label }}</span>
      <span v-if="u.coils != null" class="uses__coils">&middot; {{ u.coils }} <i class="fas" :class="ICONS.coil"></i></span>
    </router-link>
  </drop-menu>
  <span v-else class="uses__count is-none">—</span>
</template>
