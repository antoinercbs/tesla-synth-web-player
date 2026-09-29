<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { dismiss, toasts, type Toast } from '@/utils/toast';

const ICON: Record<string, string> = {
  success: 'fa-circle-check',
  error: 'fa-circle-exclamation',
  info: 'fa-circle-info',
};

const { t, te } = useI18n();
const text = (toast: Toast): string => (te(toast.key) ? t(toast.key) : toast.key);
const polite = computed(() => toasts.filter((toast) => toast.type !== 'error'));
const alerts = computed(() => toasts.filter((toast) => toast.type === 'error'));
</script>

<template>
  <Teleport to="body">
    <!-- read out from the regions below instead: a look adds words of its own to a toast -->
    <div class="toaster" aria-hidden="true">
      <transition-group name="toast">
        <div v-for="toast in toasts" :key="toast.id" class="toast" :class="`toast--${toast.type}`"
          @click="toast.type === 'error' && dismiss(toast.id)">
          <span class="icon"><i class="fas" :class="ICON[toast.type]"></i></span>
          {{ text(toast) }}
        </div>
      </transition-group>
    </div>
    <div class="toaster__live" role="status" aria-atomic="false">
      <p v-for="toast in polite" :key="toast.id">{{ text(toast) }}</p>
    </div>
    <div class="toaster__live" role="alert" aria-atomic="false">
      <p v-for="toast in alerts" :key="toast.id">{{ text(toast) }}</p>
    </div>
  </Teleport>
</template>
