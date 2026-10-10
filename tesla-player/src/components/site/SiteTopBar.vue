<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import LocalePicker from '@/components/settings/LocalePicker.vue';
import logoSrc from '@/assets/logo_tesla_player.svg';
import labelSrc from '@/assets/label_high_black.svg';
import { shownDemos } from '@/site/demos';
import { SITE_PAGES } from '@/site/routes';
import { appTarget, centerInRow, featuresInView, REPO_URL, scrollToHash, useSiteContext, welcomeCtaInView, welcomeWide } from '@/site/site';
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
/** The page shown; on the home, its features while they fill the window ("Features" is that section). */
function isCurrent(name: string, hash?: string): boolean {
  if (route.name !== name) return false;
  return name === 'site-home' ? Boolean(hash) === featuresInView.value : true;
}
/** A link to where the visitor already is: the router stays put, the page scrolls there. */
function onPage(name: string, hash?: string): void {
  if (route.name !== name) return;
  if (hash) scrollToHash(hash, true);
  else bar.value?.closest('.app-main')?.scrollTo({ top: 0, behavior: 'smooth' });
}
const emblemStyle = { '--emblem-src': `url("${logoSrc}")` };

const nav = ref<HTMLElement | null>(null);
const bar = ref<HTMLElement | null>(null);
const arc = ref({ x: 0, w: 0, shown: false });
function placeArc(): void {
  const a = nav.value?.querySelector<HTMLElement>('.nav-item.is-current');
  arc.value = a ? { x: a.offsetLeft, w: a.offsetWidth, shown: true } : { ...arc.value, shown: false };
}
const pagesRow = ref<HTMLElement | null>(null);
watch([() => route.name, featuresInView], () => nextTick(() => {
  placeArc();
  centerInRow(pagesRow.value);
}));
let observer: ResizeObserver | null = null;
onMounted(() => {
  void document.fonts?.ready.then(placeArc);
  observer = new ResizeObserver(() => {
    placeArc();
    document.documentElement.style.setProperty('--site-top-h', `${bar.value?.offsetHeight ?? 0}px`);
  });
  if (nav.value) observer.observe(nav.value);
  if (bar.value) observer.observe(bar.value);
  placeArc();
  centerInRow(pagesRow.value);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  document.documentElement.style.removeProperty('--site-top-h');
});

// the home's first screen holds the same, large (the bar's comes back once it
// scrolls away); the download page is where the site's leads
const ctaShown = computed(() => !(route.name === 'site-home' && welcomeCtaInView.value)
  && !(context.value === 'site' && route.name === 'site-download'));

function signIn(): void {
  void auth.login(appTarget(route));
}
</script>

<template>
  <header ref="bar" class="site-top">
    <div class="site-wrap site-top__bar" :class="{ 'site-wrap--wide': welcomeWide }">
      <div class="brand">
        <router-link class="brand__emblem" :to="{ name: 'site-home' }" aria-label="Tesla Player" :style="emblemStyle" @click="onPage('site-home')" />
        <span class="brand__sep" aria-hidden="true"></span>
        <div class="brand__text">
          <router-link class="brand__app" :to="{ name: 'site-home' }" @click="onPage('site-home')">Tesla Player</router-link>
          <a class="brand__club" href="https://clubelek.fr" target="_blank" rel="noopener" title="clubelek.fr">
            <img class="brand__label" :src="labelSrc" alt="Clubelek" />
          </a>
        </div>
      </div>

      <nav ref="nav" class="nav site-top__nav" :aria-label="$t('site.nav.pages')">
        <router-link v-for="p in pages" :key="p.label" class="nav-item" :class="{ 'is-current': isCurrent(p.name, p.hash) }"
          :to="{ name: p.name, hash: p.hash }" @click="onPage(p.name, p.hash)">{{ $t(`site.nav.${p.label}`) }}</router-link>
        <span v-show="arc.shown" class="segmented__arc is-ready site-top__arc" aria-hidden="true"
          :style="{ transform: `translateX(${arc.x}px)`, width: `${arc.w}px` }"></span>
      </nav>

      <div class="site-top__end">
        <locale-picker class="site-top__lang" />
        <a class="icon-btn site-top__gh" :href="REPO_URL" target="_blank" rel="noopener" :title="$t('site.nav.github')"
          :aria-label="$t('site.nav.github')"><i class="fab fa-github"></i></a>
        <template v-if="ctaShown">
          <router-link v-if="context === 'site'" class="btn btn--volt" :to="{ name: 'site-download' }">
            <span class="icon"><i class="fas fa-download"></i></span>{{ $t('site.nav.download') }}
          </router-link>
          <button v-else-if="context === 'instance'" class="btn btn--volt" type="button" @click="signIn">
            <span class="icon"><i class="fas fa-right-to-bracket"></i></span>{{ $t('site.nav.signIn') }}
          </button>
          <router-link v-else class="btn btn--volt" :to="appTarget(route)">
            <span class="icon"><i class="fas fa-arrow-right"></i></span>{{ $t('site.nav.openApp') }}
          </router-link>
        </template>
      </div>
    </div>

    <nav ref="pagesRow" class="site-top__pages" :aria-label="$t('site.nav.pages')">
      <div class="site-wrap">
        <router-link class="nav-item" :class="{ 'is-current': isCurrent('site-home') }" :to="{ name: 'site-home' }" @click="onPage('site-home')">
          {{ $t('site.nav.home') }}</router-link>
        <router-link v-for="p in pages" :key="p.label" class="nav-item" :class="{ 'is-current': isCurrent(p.name, p.hash) }"
          :to="{ name: p.name, hash: p.hash }" @click="onPage(p.name, p.hash)">{{ $t(`site.nav.${p.label}`) }}</router-link>
      </div>
    </nav>
  </header>
</template>
