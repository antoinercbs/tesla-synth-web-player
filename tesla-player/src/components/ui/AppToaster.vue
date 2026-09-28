<script setup lang="ts">
import { toasts } from '@/utils/toast';

const ICON: Record<string, string> = {
  success: 'fa-circle-check',
  error: 'fa-circle-exclamation',
  info: 'fa-circle-info',
};
</script>

<template>
  <Teleport to="body">
    <div class="toaster">
      <transition-group name="toast">
        <div v-for="t in toasts" :key="t.id" class="toast" :class="`toast--${t.type}`">
          <span class="icon"><i class="fas" :class="ICON[t.type]"></i></span>
          {{ $te(t.key) ? $t(t.key) : t.key }}
        </div>
      </transition-group>
    </div>
  </Teleport>
</template>
