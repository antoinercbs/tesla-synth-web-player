<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import LocalePicker from '@/components/settings/LocalePicker.vue';
import logoSrc from '@/assets/logo_tesla_player.svg';
import labelSrc from '@/assets/label_high_black.svg';
import { shownDemos } from '@/site/demos';
import { SITE_PAGES } from '@/site/routes';
import { appTarget, centerInRow, REPO_URL, useSiteContext } from '@/site/site';
import { useAuthStore } from '@/stores/auth';

/**
 * The site's bar: the app's brand lockup, the pages (the current one under the
 * tabs' micro-arc), the language, GitHub, and the one action of the context.
 * On a phone the pages go in a row of their own below it.
 */
const route = useRoute();
const context = useSiteContext();
const auth = useAuthStore();

const pages = computed(() => SITE_PAGES.filter((p) => p.name !== 'site-demos' || shownDemos().length > 0));
const emblemStyle = { '--emblem-src': `url("${logoSrc}")` };

const nav = ref<HTMLElement | null>(null);
const arc = ref({ x: 0, w: 0, shown: false });
function placeArc(): void {
  const a = nav.value?.querySelector<HTMLElement>('.nav-item.is-current');
  arc.value = a ? { x: a.offsetLeft, w: a.offsetWidth, shown: true } : { ...arc.value, shown: false };
}
const pagesRow = ref<HTMLElement | null>(null);
watch(() => route.name, () => nextTick(() => {
  placeArc();
  centerInRow(pagesRow.value);
}));
let observer: ResizeObserver | null = null;
onMounted(() => {
  void document.fonts?.ready.then(placeArc);
  observer = new ResizeObserver(placeArc);
  if (nav.value) observer.observe(nav.value);
  placeArc();
  centerInRow(pagesRow.value);
});
onBeforeUnmount(() => observer?.disconnect());

function signIn(): void {
  void auth.login(appTarget(route));
}
</script>

<template>
  <header class="site-top">
    <div class="site-wrap site-top__bar">
      <div class="brand">
        <router-link class="brand__emblem" :to="{ name: 'site-home' }" aria-label="Tesla Player" :style="emblemStyle" />
        <span class="brand__sep" aria-hidden="true"></span>
        <div class="brand__text">
          <router-link class="brand__app" :to="{ name: 'site-home' }">Tesla Player</router-link>
          <a class="brand__club" href="https://clubelek.fr" target="_blank" rel="noopener" title="clubelek.fr">
            <img class="brand__label" :src="labelSrc" alt="Clubelek" />
          </a>
        </div>
      </div>

      <nav ref="nav" class="nav site-top__nav" :aria-label="$t('site.nav.pages')">
        <router-link v-for="p in pages" :key="p.name" class="nav-item" :class="{ 'is-current': route.name === p.name }"
          :to="{ name: p.name }">{{ $t(`site.nav.${p.label}`) }}</router-link>
        <span v-show="arc.shown" class="segmented__arc is-ready site-top__arc" aria-hidden="true"
          :style="{ transform: `translateX(${arc.x}px)`, width: `${arc.w}px` }"></span>
      </nav>

      <div class="site-top__end">
        <locale-picker class="site-top__lang" />
        <a class="icon-btn site-top__gh" :href="REPO_URL" target="_blank" rel="noopener" :title="$t('site.nav.github')"
          :aria-label="$t('site.nav.github')"><i class="fab fa-github"></i></a>
        <router-link v-if="context === 'site'" class="btn btn--volt" :to="{ name: 'site-download' }">
          <span class="icon"><i class="fas fa-download"></i></span>{{ $t('site.nav.download') }}
        </router-link>
        <button v-else-if="context === 'instance'" class="btn btn--volt" type="button" @click="signIn">
          <span class="icon"><i class="fas fa-right-to-bracket"></i></span>{{ $t('site.nav.signIn') }}
        </button>
        <router-link v-else class="btn btn--volt" :to="appTarget(route)">
          <span class="icon"><i class="fas fa-arrow-right"></i></span>{{ $t('site.nav.openApp') }}
        </router-link>
      </div>
    </div>

    <nav ref="pagesRow" class="site-top__pages" :aria-label="$t('site.nav.pages')">
      <div class="site-wrap">
        <router-link class="nav-item" :class="{ 'is-current': route.name === 'site-home' }" :to="{ name: 'site-home' }">
          {{ $t('site.nav.home') }}</router-link>
        <router-link v-for="p in pages" :key="p.name" class="nav-item" :class="{ 'is-current': route.name === p.name }"
          :to="{ name: p.name }">{{ $t(`site.nav.${p.label}`) }}</router-link>
      </div>
    </nav>
  </header>
</template>
