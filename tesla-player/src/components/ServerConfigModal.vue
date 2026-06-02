<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import BaseModal from './ui/BaseModal.vue';
import FormField from './ui/FormField.vue';

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
  <BaseModal :open="open" :title="$t('desktop.serverConfig')" icon="fa-server" card-class="srv-modal"
    :close-label="$t('label.cancel')" @close="emit('close')">
    <p class="srv-modal__hint">{{ $t('desktop.serverConfigHint') }}</p>

    <div class="srv-modal__body">
      <form-field v-model="draft.url" type="url" :label="$t('desktop.serverUrl')"
        placeholder="https://tesla-player.example.com" />
      <form-field v-model="draft.username" :label="$t('desktop.username')" />
      <form-field v-model="draft.password" type="password" :label="$t('desktop.password')"
        :placeholder="hasPassword ? '••••••••' : ''" :hint="$t('desktop.passwordKeep')" />
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
</style>
