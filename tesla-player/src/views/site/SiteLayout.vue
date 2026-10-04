<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import SiteFooter from '@/components/site/SiteFooter.vue';
import SiteTopBar from '@/components/site/SiteTopBar.vue';

/**
 * The site's frame, the same in the app (under /about, in place of its
 * sidebar) and on GitHub Pages. It scrolls inside .app-main, the app's own
 * scroller: a new page starts at its top, a #section is scrolled to by its page.
 */
const route = useRoute();
const { t, locale } = useI18n();
const root = ref<HTMLElement | null>(null);

const TITLES: Record<string, string> = {
  'site-features': 'site.nav.features',
  'site-demos': 'site.nav.demos',
  'site-download': 'site.nav.download',
  'site-docs': 'site.nav.docs',
  'site-credits': 'site.nav.credits',
};

function setTitle(): void {
  const key = TITLES[String(route.name)];
  document.title = key ? `${t(key)} · Tesla Player` : 'Tesla Player';
}

watch(() => route.name, () => {
  setTitle();
  if (!route.hash) root.value?.closest('.app-main')?.scrollTo({ top: 0 });
});
watch(locale, setTitle);
onMounted(setTitle);
</script>

<template>
  <div ref="root" class="site">
    <site-top-bar />
    <div class="site__page">
      <router-view />
    </div>
    <site-footer />
  </div>
</template>
