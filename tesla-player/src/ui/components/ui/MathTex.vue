<script setup lang="ts">
import { computed } from 'vue';
import katex from 'katex';
import 'katex/dist/katex.min.css';

/**
 * A formula typeset by KaTeX from TeX the app writes itself (never text
 * someone typed: names stay out of it). `\htmlClass` is the only command
 * trusted, for the styles to mark a part (the result).
 */
const props = defineProps<{ tex: string }>();
const html = computed(() => katex.renderToString(`\\displaystyle ${props.tex}`, {
  throwOnError: false,
  strict: 'ignore',
  trust: (c) => c.command === '\\htmlClass',
}));
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- KaTeX's typesetting of the app's own formulas -->
  <span class="math-tex" v-html="html"></span>
</template>
