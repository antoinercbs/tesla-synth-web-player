<script setup lang="ts">
import { ref } from 'vue';

/** A command to copy: shown as written (lines and all), copied as one line. */
const props = defineProps<{ code: string }>();
const copied = ref(false);

async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.code.replace(/\s*\\\n\s*/g, ' ').trim());
    copied.value = true;
    setTimeout(() => (copied.value = false), 1600);
  } catch {
    /* no clipboard (an insecure page): the command stays there to select */
  }
}
</script>

<template>
  <div class="site-code">
    <pre class="site-code__text">{{ code }}</pre>
    <button class="icon-btn icon-btn--sm site-code__copy" type="button"
      :title="copied ? $t('site.download.copied') : $t('site.download.copy')"
      :aria-label="$t('site.download.copy')" @click="copy">
      <i class="fas" :class="copied ? 'fa-check' : 'fa-copy'"></i>
    </button>
  </div>
</template>
