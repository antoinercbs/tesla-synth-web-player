<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import SiteVideo from '@/components/site/SiteVideo.vue';
import { HERO, shownDemos } from '@/site/demos';
import { OS_EXT, OS_ICON, OS_NAME, useDesktopOffer } from '@/site/downloads';
import { shot } from '@/site/shots';
import { appTarget, RELEASES_URL, useSiteContext, visitorOs, welcomeCtaInView, welcomeShown, welcomeWide } from '@/site/site';
import { useAuthStore } from '@/stores/auth';

/**
 * The home page's first screen, one window tall, the rest of the page below it.
 * Its big button is the context's way in: signing in on a server (centred, the
 * page kept bare), downloading on the project's site, back to the app from
 * "About" (the app's preview beside these two).
 */
const { t, locale } = useI18n();
const route = useRoute();
const context = useSiteContext();
const auth = useAuthStore();
const os = visitorOs();
const desktopIcon = os === 'windows' || os === 'linux' ? OS_ICON[os] : null;
const preview = context.value !== 'instance';
// the builds only where they're offered here (a server's welcome links to its download page)
const offer = context.value === 'site' ? useDesktopOffer() : null;
const mine = computed(() => offer?.mine.value ?? null);
const others = computed(() => offer?.others.value ?? []);
const demos = shownDemos();
const version = __APP_VERSION__;

function signIn(): void {
  void auth.login(appTarget(route));
}

/** A phone can't run the app: the link goes to the computer that will. */
const linkCopied = ref(false);
async function shareLink(): Promise<void> {
  const url = window.location.href.split('#')[0];
  try {
    if (navigator.share) await navigator.share({ title: 'Tesla Player', url });
    else {
      await navigator.clipboard.writeText(url);
      linkCopied.value = true;
    }
  } catch {
    /* dismissed */
  }
}

// while its buttons show, the bar's own would be a second one; the footer stays pinned below
const cta = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;
onMounted(() => {
  welcomeShown.value = true;
  welcomeWide.value = preview;
  observer = new IntersectionObserver(([e]) => (welcomeCtaInView.value = e.isIntersecting));
  if (cta.value) observer.observe(cta.value);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  welcomeCtaInView.value = false;
  welcomeShown.value = false;
  welcomeWide.value = false;
});

/** The rest of the home page below this screen: the features first. */
const root = ref<HTMLElement | null>(null);
function more(): void {
  (root.value?.nextElementSibling as HTMLElement | null)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
</script>

<template>
  <section ref="root" class="site-welcome" :class="{ 'site-welcome--split': preview }">
    <div class="site-wrap site-welcome__inner" :class="{ 'site-wrap--wide': preview }">
      <div class="site-welcome__text">
        <div v-if="context !== 'instance'" class="site-badges">
          <span class="player-synth-badge"><i class="fas fa-code-branch"></i>{{ t('site.license') }}</span>
          <span class="player-synth-badge">v{{ version }}</span>
        </div>
        <h1 class="site-welcome__title">{{ t('site.hero.title') }}</h1>
        <p class="site-lead">{{ context === 'instance' ? t('site.welcome.lead') : t('site.hero.lead') }}</p>

        <div ref="cta" class="site-welcome__cta">
          <!-- a server: signing in first -->
          <template v-if="context === 'instance'">
            <button class="btn btn--volt site-welcome__primary" type="button" @click="signIn">
              <span class="icon"><i class="fas fa-right-to-bracket"></i></span>{{ t('site.nav.signIn') }}
            </button>
            <router-link v-if="desktopIcon" class="btn" :to="{ name: 'site-download' }">
              <span class="icon"><i :class="desktopIcon"></i></span>{{ t('site.welcome.desktop') }}
            </router-link>
            <button v-else class="btn" type="button" @click="more">
              <span class="icon"><i class="fas fa-bolt"></i></span>{{ t('site.welcome.discover') }}
            </button>
          </template>

          <!-- the project's site: the build for this system first -->
          <template v-else-if="context === 'site'">
            <a v-if="mine" class="btn btn--volt site-welcome__primary" :href="mine.url">
              <span class="icon"><i :class="OS_ICON[mine.os]"></i></span>{{ t('site.hero.downloadFor', { os: OS_NAME[mine.os] }) }}
            </a>
            <router-link v-else-if="desktopIcon" class="btn btn--volt site-welcome__primary" :to="{ name: 'site-download' }">
              <span class="icon"><i :class="desktopIcon"></i></span>{{ t('site.hero.downloadFor', { os: OS_NAME[os as 'windows' | 'linux'] }) }}
            </router-link>
            <button v-else-if="os === 'mobile'" class="btn btn--volt site-welcome__primary" type="button" @click="shareLink">
              <span class="icon"><i class="fas" :class="linkCopied ? 'fa-check' : 'fa-share-nodes'"></i></span>{{ linkCopied ? t('site.download.copied') : t('site.hero.sendLink') }}
            </button>
            <router-link v-else class="btn btn--volt site-welcome__primary" :to="{ name: 'site-download', hash: '#server' }">
              <span class="icon"><i class="fab fa-docker"></i></span>{{ t('site.hero.host') }}
            </router-link>
            <router-link v-if="demos.length" class="btn" :to="{ name: 'site-demos' }">
              <span class="icon"><i class="fas fa-circle-play"></i></span>{{ t('site.hero.seeDemos') }}
            </router-link>
            <router-link v-else-if="desktopIcon" class="btn" :to="{ name: 'site-download', hash: '#server' }">
              <span class="icon"><i class="fab fa-docker"></i></span>{{ t('site.hero.host') }}
            </router-link>
          </template>

          <!-- "About": back to the app -->
          <template v-else>
            <router-link class="btn btn--volt site-welcome__primary" :to="appTarget(route)">
              <span class="icon"><i class="fas fa-arrow-right"></i></span>{{ t('site.nav.openApp') }}
            </router-link>
            <router-link class="btn" :to="{ name: 'site-download', hash: '#notes' }">
              <span class="icon"><i class="fas fa-wand-magic-sparkles"></i></span>{{ t('site.hero.whatsNew') }}
            </router-link>
          </template>
        </div>

        <p v-if="context === 'instance'" class="site-mute">{{ t('site.hero.noAccount') }}</p>
        <template v-else-if="context === 'site'">
          <p v-if="os === 'macos'" class="player-hint"><span class="icon"><i class="fab fa-apple"></i></span>{{ t('site.hero.macos') }}</p>
          <p v-if="os === 'mobile'" class="player-hint"><span class="icon"><i class="fas fa-mobile-screen"></i></span>{{ t('site.hero.mobile') }}</p>
          <p class="site-links">
            <router-link v-for="b in others" :key="b.os" :to="{ name: 'site-download' }">{{ t('site.hero.otherOs', { os: OS_NAME[b.os], ext: OS_EXT[b.os] }) }}</router-link>
            <router-link v-if="demos.length && desktopIcon" :to="{ name: 'site-download', hash: '#server' }">{{ t('site.hero.host') }}</router-link>
            <a :href="RELEASES_URL" target="_blank" rel="noopener">{{ t('site.hero.allVersions') }}</a>
          </p>
        </template>

        <p v-if="context !== 'instance'" class="player-hint site-welcome__credit">
          <span class="icon"><i class="fas fa-heart"></i></span>
          <span>
            <i18n-t keypath="site.hero.builtOn" tag="span">
              <template #syntherrupter><b>Syntherrupter</b></template>
              <template #author><b>Max Zuidberg</b></template>
            </i18n-t>
            {{ ' ' }}<router-link :to="{ name: 'site-credits' }">{{ t('site.nav.credits') }}</router-link>
          </span>
        </p>
      </div>

      <site-video v-if="preview" class="site-welcome__preview" :demo="HERO" :poster="shot('play', locale)" caption />
    </div>

    <button class="site-welcome__more" type="button" @click="more">
      {{ t('site.welcome.more') }}<i class="fas fa-chevron-down"></i>
    </button>
  </section>
</template>
