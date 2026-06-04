<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const route = useRoute();

const redirectTo = computed(() => {
  const r = route.query.redirect;
  return typeof r === 'string' && r ? r : '/';
});

function signIn(): void {
  void auth.login(redirectTo.value);
}
function signOut(): void {
  void auth.logout();
}
</script>

<template>
  <div class="login">
    <div class="login__card">
      <!-- Authenticated but the server refused (missing role): a clear wall with
           a way out, NOT a sign-in prompt (re-auth would loop with the same role). -->
      <template v-if="auth.accessDenied">
        <h1 class="login__title">{{ $t('auth.accessDeniedTitle') }}</h1>
        <p class="login__hint">{{ $t('auth.accessDeniedHint') }}</p>
        <p v-if="auth.displayName" class="login__who">
          <i class="fas fa-user"></i>{{ auth.displayName }}
        </p>
        <button class="btn btn--ghost login__btn" type="button" @click="signOut">
          <span class="icon"><i class="fas fa-right-from-bracket"></i></span>{{ $t('auth.signOut') }}
        </button>
      </template>
      <template v-else>
        <h1 class="login__title">{{ $t('auth.loginTitle') }}</h1>
        <p class="login__hint">
          {{ auth.sessionExpired ? $t('auth.sessionExpired') : $t('auth.loginHint') }}
        </p>
        <button class="btn btn--volt login__btn" type="button" @click="signIn">
          <span class="icon"><i class="fas fa-right-to-bracket"></i></span>{{ $t('auth.signIn') }}
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.login {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100%;
  padding: 2rem;
}
.login__card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.85rem;
  max-width: 22rem;
  text-align: center;
}
.login__title { font-size: 1.25rem; font-weight: 600; margin: 0; }
.login__hint { color: var(--text-mute); margin: 0 0 0.4rem; }
.login__who { display: flex; align-items: center; gap: 0.4rem; color: var(--volt, #ffd24d); font-size: 0.85rem; margin: 0 0 0.2rem; }
.login__btn { margin-top: 0.3rem; }
</style>
