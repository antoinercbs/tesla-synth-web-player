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

<style scoped>
.toaster {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 1.4rem;
  z-index: 200;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  pointer-events: none;
}

.toast {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.6rem 1rem 0.6rem 1.15rem;
  border-radius: var(--radius);
  background: var(--panel-2);
  border: 1px solid var(--line-strong);
  box-shadow: 0 16px 40px -16px rgba(0, 0, 0, 0.7);
  font-size: var(--fs-md);
  color: var(--text);
  max-width: 90vw;
  overflow: hidden;
}

/* the micro-arc on the left edge, like the active nav item; an error keeps the shape in red */
.toast::before {
  content: "";
  position: absolute;
  left: 1px;
  top: 0;
  bottom: 0;
  width: 7px;
  background: linear-gradient(180deg, var(--arc-core), var(--arc-mid) 45%, var(--arc-deep));
  -webkit-mask: var(--micro-arc-v) center / 100% 100% no-repeat;
  mask: var(--micro-arc-v) center / 100% 100% no-repeat;
}

.toast--success .icon {
  color: var(--volt);
}

.toast--error::before {
  background: var(--danger);
}

.toast--error .icon {
  color: var(--danger);
}

.toast--info .icon {
  color: var(--text-dim);
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
</style>
