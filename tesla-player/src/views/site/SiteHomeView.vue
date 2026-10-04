<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import SiteVideo from '@/components/site/SiteVideo.vue';
import { HERO, shownDemos, TAG_COLOR } from '@/site/demos';
import { OS_EXT, OS_ICON, OS_NAME, useDesktopOffer } from '@/site/downloads';
import { shot } from '@/site/shots';
import { appTarget, RELEASES_URL, useInstanceInfo, useSiteContext } from '@/site/site';
import { useAuthStore } from '@/stores/auth';
import { ICONS } from '@/ui/icons';

/** The home page: the essentials, each block leading to its page. */
const { t, locale } = useI18n();
const route = useRoute();
const context = useSiteContext();
const auth = useAuthStore();
const instance = useInstanceInfo(context.value === 'instance');
const { os, mine, others } = useDesktopOffer();
const desktopOs = os === 'windows' || os === 'linux';
const version = __APP_VERSION__;

const demos = computed(() => shownDemos().slice(0, 3));
const pic = (key: string): string => shot(key, locale.value);
const ESSENTIALS = [
  { key: 'play', shot: 'play' },
  { key: 'edit', shot: 'edit' },
  { key: 'synth', shot: 'synth' },
  { key: 'tune', shot: 'tune' },
  { key: 'midi', shot: 'midi-edit' },
  { key: 'usb', shot: 'syntherrupter' },
];

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
</script>

<template>
  <div class="site-home">
    <section class="site-hero">
      <div class="site-wrap site-hero__grid">
        <div>
          <p v-if="context === 'instance' && instance" class="player-hint site-hero__instance">
            <span class="icon"><i class="fas fa-building-columns"></i></span>
            <span><b>{{ instance.name }}</b><template v-if="instance.name && instance.tagline"> · </template>{{ instance.tagline }}</span>
          </p>
          <div v-else-if="context !== 'instance'" class="site-badges">
            <span class="player-synth-badge"><i class="fas fa-code-branch"></i>{{ t('site.license') }}</span>
            <span class="player-synth-badge">v{{ version }}</span>
          </div>

          <h1 class="site-hero__title">{{ t('site.hero.title') }}</h1>
          <p class="site-lead">{{ t('site.hero.lead') }}</p>

          <template v-if="context === 'site'">
            <div class="site-cta">
              <a v-if="mine" class="btn btn--volt" :href="mine.url">
                <span class="icon"><i :class="OS_ICON[mine.os]"></i></span>{{ t('site.hero.downloadFor', { os: OS_NAME[mine.os] }) }}
              </a>
              <router-link v-else-if="desktopOs" class="btn btn--volt" :to="{ name: 'site-download' }">
                <span class="icon"><i :class="OS_ICON[os as 'windows' | 'linux']"></i></span>{{ t('site.hero.downloadFor', { os: OS_NAME[os as 'windows' | 'linux'] }) }}
              </router-link>
              <router-link class="btn" :class="{ 'btn--volt': !desktopOs }" :to="demos.length ? { name: 'site-demos' } : { name: 'site-features' }">
                <span class="icon"><i class="fas" :class="demos.length ? 'fa-circle-play' : 'fa-bolt'"></i></span>{{ demos.length ? t('site.hero.seeDemos') : t('site.nav.features') }}
              </router-link>
              <button v-if="os === 'mobile'" class="btn" type="button" @click="shareLink">
                <span class="icon"><i class="fas" :class="linkCopied ? 'fa-check' : 'fa-share-nodes'"></i></span>{{ linkCopied ? t('site.download.copied') : t('site.hero.sendLink') }}
              </button>
            </div>
            <p v-if="os === 'macos'" class="player-hint"><span class="icon"><i class="fab fa-apple"></i></span>{{ t('site.hero.macos') }}</p>
            <p v-if="os === 'mobile'" class="player-hint"><span class="icon"><i class="fas fa-mobile-screen"></i></span>{{ t('site.hero.mobile') }}</p>
            <p class="site-links">
              <router-link v-for="b in others" :key="b.os" :to="{ name: 'site-download' }">{{ t('site.hero.otherOs', { os: OS_NAME[b.os], ext: OS_EXT[b.os] }) }}</router-link>
              <router-link :to="{ name: 'site-download', hash: '#server' }">{{ t('site.hero.host') }}</router-link>
              <a :href="RELEASES_URL" target="_blank" rel="noopener">{{ t('site.hero.allVersions') }}</a>
            </p>
          </template>

          <template v-else-if="context === 'instance'">
            <div class="site-cta">
              <button class="btn btn--volt" type="button" @click="signIn">
                <span class="icon"><i class="fas fa-right-to-bracket"></i></span>{{ t('site.nav.signIn') }}
              </button>
              <router-link v-if="desktopOs" class="btn" :to="{ name: 'site-download' }">
                <span class="icon"><i :class="OS_ICON[os as 'windows' | 'linux']"></i></span>{{ t('site.download.desktop') }}
              </router-link>
            </div>
            <p class="site-links"><span class="site-mute">{{ t('site.hero.noAccount') }}</span></p>
          </template>

          <div v-else class="site-cta">
            <router-link class="btn btn--volt" :to="appTarget(route)">
              <span class="icon"><i class="fas fa-arrow-right"></i></span>{{ t('site.nav.openApp') }}
            </router-link>
            <router-link class="btn" :to="{ name: 'site-download', hash: '#notes' }">
              <span class="icon"><i class="fas fa-wand-magic-sparkles"></i></span>{{ t('site.hero.whatsNew') }}
            </router-link>
          </div>

          <p class="player-hint site-hero__credit">
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

        <site-video :demo="HERO" :poster="pic('play')" caption />
      </div>
    </section>

    <div class="site-facts">
      <div class="site-wrap site-facts__grid">
        <div class="site-fact"><span class="icon"><i class="fas" :class="ICONS.synth"></i></span><span><b>{{ t('site.facts.synth') }}</b>{{ t('site.facts.synthText') }}</span></div>
        <div class="site-fact"><span class="icon"><i class="fas" :class="ICONS.coil"></i></span><span><b>{{ t('site.facts.coils') }}</b>{{ t('site.facts.coilsText') }}</span></div>
        <div class="site-fact"><span class="icon"><i class="fas fa-laptop"></i></span><span><b>{{ t('site.facts.offline') }}</b>{{ t('site.facts.offlineText') }}</span></div>
        <div class="site-fact"><span class="icon"><i class="fas" :class="ICONS.tuning"></i></span><span><b>{{ t('site.facts.tuning') }}</b>{{ t('site.facts.tuningText') }}</span></div>
      </div>
    </div>

    <section class="site-section">
      <div class="site-wrap">
        <div class="site-section__head">
          <div>
            <h2 class="view-head__title">{{ t('site.home.essentials') }}</h2>
            <p class="site-lead">{{ t('site.home.essentialsLead') }}</p>
          </div>
          <router-link class="site-more" :to="{ name: 'site-features' }">{{ t('site.home.allFeatures') }} →</router-link>
        </div>
        <div class="site-cards site-cards--3">
          <router-link v-for="e in ESSENTIALS" :key="e.key" class="player-panel site-card site-card--shot"
            :to="{ name: 'site-features', hash: `#f-${e.key}` }">
            <img :src="pic(e.shot)" alt="" loading="lazy">
            <span class="site-card__body"><b>{{ t(`site.features.${e.key}`) }}</b><span>{{ t(`site.home.short.${e.key}`) }}</span></span>
          </router-link>
        </div>
      </div>
    </section>

    <section v-if="demos.length" class="site-section">
      <div class="site-wrap">
        <div class="site-section__head">
          <div>
            <h2 class="view-head__title">{{ t('site.nav.demos') }}</h2>
            <p class="site-lead">{{ t('site.home.demosLead') }}</p>
          </div>
          <router-link class="site-more" :to="{ name: 'site-demos' }">{{ t('site.home.allDemos') }} →</router-link>
        </div>
        <div class="site-vgrid">
          <router-link v-for="d in demos" :key="d.key" class="player-panel site-vcard" :to="{ name: 'site-demos', query: { v: d.key } }">
            <span class="site-vcard__thumb"><img :src="pic(d.shot)" alt="" loading="lazy"><span class="row-btn row-btn--play"><i class="fas fa-play"></i></span></span>
            <span class="site-vcard__text">
              <b>{{ t(`site.demos.items.${d.key}`) }}</b>
              <span class="site-vcard__meta">
                <span class="song-tag-pill" :style="{ '--tag-c': TAG_COLOR[d.tag] }">{{ d.youtube ? t(`site.demos.tags.${d.tag}`) : t('site.demos.toFilm') }}</span>
                <span v-if="d.duration" class="play-row__dur">{{ d.duration }}</span>
              </span>
            </span>
          </router-link>
        </div>
      </div>
    </section>

    <section class="site-section">
      <div class="site-wrap">
        <div class="site-section__head"><h2 class="view-head__title">{{ t('site.home.start') }}</h2></div>
        <div class="site-cards site-cards--3">
          <article class="player-panel site-card">
            <span class="icon"><i class="fas fa-laptop"></i></span>
            <b>{{ t('site.download.desktop') }}</b>
            <p>{{ t('site.home.desktop') }}</p>
            <span class="site-card__end">
              <router-link class="btn btn--volt" :to="{ name: 'site-download' }"><span class="icon"><i class="fas fa-download"></i></span>{{ t('site.nav.download') }}</router-link>
            </span>
          </article>
          <article class="player-panel site-card">
            <span class="icon"><i class="fab fa-docker"></i></span>
            <b>{{ t('site.download.server') }}</b>
            <p>{{ t('site.home.server') }}</p>
            <span class="site-card__end"><router-link class="site-more" :to="{ name: 'site-docs', params: { page: 'deployment' } }">{{ t('site.home.deployGuide') }} →</router-link></span>
          </article>
          <article class="player-panel site-card">
            <span class="icon"><i class="fas fa-book"></i></span>
            <b>{{ t('site.nav.docs') }}</b>
            <p>{{ t('site.home.docs') }}</p>
            <span class="site-card__end"><router-link class="site-more" :to="{ name: 'site-docs', params: { page: 'user-guide' } }">{{ t('site.home.userGuide') }} →</router-link></span>
          </article>
        </div>
      </div>
    </section>

    <section class="site-section">
      <div class="site-wrap">
        <article class="player-panel site-lead-credit">
          <div class="credits__item">
            <span class="player-panel__title site-lead-credit__kicker"><span class="icon"><i class="fas" :class="ICONS.interrupter"></i></span>{{ t('credits.heart') }}</span>
            <h2 class="site-lead-credit__name">Syntherrupter</h2>
            <p class="credits__by">{{ t('credits.by') }} <strong>Max Zuidberg</strong> (MMMZZZZ)</p>
            <p>{{ t('credits.syntherrupter') }}</p>
            <p><router-link class="site-more" :to="{ name: 'site-credits' }">{{ t('site.home.allCredits') }} →</router-link></p>
          </div>
          <div class="dl-modal__options">
            <a class="dl-option" href="https://github.com/MMMZZZZ/Syntherrupter" target="_blank" rel="noopener">
              <span class="dl-option__icon"><i class="fab fa-github"></i></span>
              <span class="dl-option__label">Syntherrupter<small class="site-small">{{ t('credits.links.github') }}</small></span>
              <span class="dl-option__go"><i class="fas fa-up-right-from-square"></i></span>
            </a>
            <a class="dl-option" href="https://github.com/MMMZZZZ/Syntherrupter/wiki" target="_blank" rel="noopener">
              <span class="dl-option__icon"><i class="fas fa-book-open"></i></span>
              <span class="dl-option__label">Wiki<small class="site-small">{{ t('credits.links.wiki') }}</small></span>
              <span class="dl-option__go"><i class="fas fa-up-right-from-square"></i></span>
            </a>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>
