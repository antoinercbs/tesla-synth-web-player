<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import type { TeslaAuthStatus } from '@/types/electron';
import BaseModal from '@/components/ui/BaseModal.vue';
import FormField from '@/components/ui/FormField.vue';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved'): void }>();

const draft = reactive({ url: '' });
const savedUrl = ref('');
const status = ref<TeslaAuthStatus | null>(null);
const saving = ref(false);
const signingIn = ref(false);
const error = ref('');

// The auth row reflects the SAVED server; if the URL was edited but not saved,
// prompt to save first so sign-in always targets the right server.
const urlDirty = computed(() => draft.url.trim() !== savedUrl.value);

async function refreshStatus(): Promise<void> {
  try {
    status.value = (await window.teslaElectron?.getAuthStatus()) ?? null;
  } catch {
    status.value = null;
  }
}

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    error.value = '';
    try {
      const cfg = await window.teslaElectron?.getServerConfig();
      draft.url = cfg?.url ?? '';
      savedUrl.value = draft.url;
    } catch {
      /* first run: leave blank */
    }
    await refreshStatus();
  },
  { immediate: true },
);

async function save(): Promise<void> {
  saving.value = true;
  error.value = '';
  try {
    await window.teslaElectron?.setServerConfig({ url: draft.url.trim() });
    savedUrl.value = draft.url.trim();
    emit('saved');
    await refreshStatus();
  } catch (e) {
    error.value = String(e);
  } finally {
    saving.value = false;
  }
}

async function signIn(): Promise<void> {
  signingIn.value = true;
  error.value = '';
  try {
    status.value = (await window.teslaElectron?.login()) ?? status.value;
  } catch (e) {
    error.value = String(e);
  } finally {
    signingIn.value = false;
  }
}

async function signOut(): Promise<void> {
  try {
    await window.teslaElectron?.logout();
  } finally {
    await refreshStatus();
  }
}
</script>

<template>
  <BaseModal :open="open" :title="$t('desktop.serverConfig')" icon="fa-server" card-class="srv-modal"
    :close-label="$t('label.cancel')" @close="emit('close')">
    <p class="srv-modal__hint">{{ $t('desktop.serverConfigHint') }}</p>

    <div class="srv-modal__body">
      <form-field v-model="draft.url" type="url" :label="$t('desktop.serverUrl')"
        placeholder="https://tesla-player.example.com" />

      <!-- Sign-in row, driven by the saved server's /api/auth/config. -->
      <div v-if="status" class="srv-auth">
        <p v-if="urlDirty && status.enabled" class="srv-auth__note">{{ $t('desktop.saveUrlFirst') }}</p>
        <template v-else-if="status.enabled">
          <template v-if="status.signedIn">
            <span class="srv-auth__who">
              <i class="fas fa-circle-check"></i>{{ $t('auth.signedInAs', { name: status.displayName || $t('auth.signedIn') }) }}
            </span>
            <button class="btn btn--ghost" type="button" @click="signOut">
              <span class="icon"><i class="fas fa-right-from-bracket"></i></span>{{ $t('auth.signOut') }}
            </button>
          </template>
          <template v-else>
            <span class="srv-auth__req">{{ signingIn ? $t('desktop.signingInBrowser') : $t('desktop.authRequired') }}</span>
            <button class="btn btn--volt" type="button" :disabled="signingIn" @click="signIn">
              <span class="icon"><i class="fas fa-right-to-bracket"></i></span>{{ $t('desktop.signInToServer') }}
            </button>
          </template>
        </template>
        <p v-else-if="savedUrl" class="srv-auth__note">{{ $t('desktop.authNotRequired') }}</p>
      </div>
    </div>

    <p v-if="error" class="srv-modal__error" role="alert">{{ error }}</p>

    <template #actions>
      <button class="btn btn--ghost" type="button" @click="emit('close')">{{ $t('label.cancel') }}</button>
      <button class="btn btn--volt" type="button" :disabled="saving" @click="save">{{ $t('label.save') }}</button>
    </template>
  </BaseModal>
</template>

<style scoped>
.srv-modal__hint { color: var(--text-mute); font-size: 0.85rem; margin: 0 0 1.1rem; }
.srv-modal__body { display: flex; flex-direction: column; gap: 1rem; margin-bottom: 1.2rem; }
.srv-modal__error { color: var(--danger); font-size: 0.82rem; margin: 0 0 0.8rem; }
.srv-auth {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
  padding: 0.7rem 0.85rem;
  border: 1px solid var(--line, rgba(255, 255, 255, 0.1));
  border-radius: 8px;
  background: var(--line-005, rgba(255, 255, 255, 0.03));
}
.srv-auth__who { display: flex; align-items: center; gap: 0.45rem; color: var(--volt, #ffd24d); font-size: 0.85rem; }
.srv-auth__req { color: var(--text-mute); font-size: 0.85rem; flex: 1; }
.srv-auth__note { color: var(--text-mute); font-size: 0.8rem; margin: 0; }
</style>
