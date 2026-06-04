<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const router = useRouter();
const failed = ref(false);

onMounted(async () => {
  try {
    const returnTo = await auth.completeLogin();
    await router.replace(returnTo || '/');
  } catch {
    failed.value = true;
  }
});

function retry(): void {
  void router.replace({ name: 'login' });
}
</script>

<template>
  <div class="auth-cb">
    <template v-if="!failed">
      <span class="icon"><i class="fas fa-circle-notch fa-spin"></i></span>
      <p>{{ $t('auth.signingIn') }}</p>
    </template>
    <template v-else>
      <p class="auth-cb__error">{{ $t('auth.loginFailed') }}</p>
      <button class="btn btn--volt" type="button" @click="retry">{{ $t('auth.retry') }}</button>
    </template>
  </div>
</template>

<style scoped>
.auth-cb {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.8rem;
  min-height: 100%;
  color: var(--text-mute);
}
.auth-cb .icon { font-size: 1.6rem; }
.auth-cb__error { color: var(--danger, #ff6b6b); }
</style>
