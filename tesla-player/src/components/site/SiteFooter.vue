<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { ISSUES_URL, REPO_URL, welcomeShown, welcomeWide } from '@/site/site';

// pinned under the welcome screen: its height is what that screen leaves for itself
const foot = ref<HTMLElement | null>(null);
let observer: ResizeObserver | null = null;
onMounted(() => {
  observer = new ResizeObserver(() =>
    document.documentElement.style.setProperty('--site-foot-h', `${foot.value?.offsetHeight ?? 0}px`));
  if (foot.value) observer.observe(foot.value);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  document.documentElement.style.removeProperty('--site-foot-h');
});
</script>

<template>
  <footer ref="foot" class="site-foot" :class="{ 'site-foot--pinned': welcomeShown }">
    <div class="site-wrap site-foot__inner" :class="{ 'site-wrap--wide': welcomeWide }">
      <p class="site-foot__text">{{ $t('site.footer.text') }}</p>
      <nav class="site-foot__links">
        <a :href="REPO_URL" target="_blank" rel="noopener">GitHub</a>
        <router-link :to="{ name: 'site-docs' }">{{ $t('site.nav.docs') }}</router-link>
        <a :href="ISSUES_URL" target="_blank" rel="noopener">{{ $t('site.footer.bug') }}</a>
        <a :href="ISSUES_URL" target="_blank" rel="noopener">{{ $t('site.footer.idea') }}</a>
        <router-link :to="{ name: 'site-credits' }">{{ $t('site.nav.credits') }}</router-link>
      </nav>
    </div>
  </footer>
</template>
