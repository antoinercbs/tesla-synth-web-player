<script setup lang="ts">
import { reactive, ref, watch } from 'vue';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved'): void }>();

const draft = reactive({ url: '', username: '', password: '' });
const hasPassword = ref(false);
const saving = ref(false);
const error = ref('');

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    error.value = '';
    draft.password = '';
    try {
      const cfg = await window.teslaElectron?.getServerConfig();
      draft.url = cfg?.url ?? '';
      draft.username = cfg?.username ?? '';
      hasPassword.value = cfg?.hasPassword ?? false;
    } catch {
      /* first-run: leave blank */
    }
  },
  { immediate: true },
);

async function save(): Promise<void> {
  saving.value = true;
  error.value = '';
  try {
    await window.teslaElectron?.setServerConfig({
      url: draft.url.trim(),
      username: draft.username.trim(),
      password: draft.password, // blank => keep the existing password
    });
    emit('saved');
    emit('close');
  } catch (e) {
    error.value = String(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-overlay" @click.self="emit('close')">
      <div class="modal-card srv-modal">
        <div class="modal-card__head">
          <span class="modal-card__title">
            <span class="icon"><i class="fas fa-server"></i></span>{{ $t('desktop.serverConfig') }}
          </span>
          <button class="icon-btn" type="button" :aria-label="$t('label.cancel')" @click="emit('close')">
            <i class="fas fa-xmark"></i>
          </button>
        </div>

        <p class="srv-modal__hint">{{ $t('desktop.serverConfigHint') }}</p>

        <div class="srv-modal__body">
          <label class="srv-field">
            <span class="field-label">{{ $t('desktop.serverUrl') }}</span>
            <input class="text-field" type="url" v-model="draft.url"
              placeholder="https://tesla-player.example.com" autocomplete="off">
          </label>
          <label class="srv-field">
            <span class="field-label">{{ $t('desktop.username') }}</span>
            <input class="text-field" type="text" v-model="draft.username" autocomplete="off">
          </label>
          <label class="srv-field">
            <span class="field-label">{{ $t('desktop.password') }}</span>
            <input class="text-field" type="password" v-model="draft.password"
              :placeholder="hasPassword ? '••••••••' : ''" autocomplete="off">
            <span class="srv-field__sub">{{ $t('desktop.passwordKeep') }}</span>
          </label>
        </div>

        <p v-if="error" class="srv-modal__error" role="alert">{{ error }}</p>

        <div class="srv-modal__actions">
          <button class="btn btn--ghost" type="button" @click="emit('close')">{{ $t('label.cancel') }}</button>
          <button class="btn btn--volt" type="button" :disabled="saving" @click="save">{{ $t('label.save') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.srv-modal { max-width: 460px; width: 100%; }
.srv-modal__hint { color: var(--text-mute); font-size: 0.85rem; margin: 0 0 1.1rem; }
.srv-modal__body { display: flex; flex-direction: column; gap: 1rem; margin-bottom: 1.2rem; }
.srv-field { display: flex; flex-direction: column; gap: 0.4rem; }
.srv-field .text-field { width: 100%; }
.field-label {
  font-family: var(--font-mono); font-size: 0.72rem; text-transform: uppercase;
  letter-spacing: 0.07em; color: var(--text-mute);
}
.srv-field__sub { font-size: 0.72rem; color: var(--text-mute); }
.srv-modal__error { color: var(--danger, #ff6b6b); font-size: 0.82rem; margin: 0 0 0.8rem; }
.srv-modal__actions { display: flex; justify-content: flex-end; gap: 0.6rem; }
</style>
