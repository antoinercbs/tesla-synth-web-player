<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import SiteFeatures from '@/components/site/SiteFeatures.vue';
import SiteWelcome from '@/components/site/SiteWelcome.vue';
import { shownDemos, TAG_COLOR } from '@/site/demos';
import { shot } from '@/site/shots';
import { featuresInView, scrollToHash } from '@/site/site';
import { ICONS } from '@/ui/icons';

/**
 * The home page: its first screen (SiteWelcome), then the features at length,
 * the demos, how to start, the credits. The menu's "Features" is #features.
 */
const { t, locale } = useI18n();
const route = useRoute();
const demos = computed(() => shownDemos().slice(0, 3));
const pic = (key: string): string => shot(key, locale.value);

// the features across the window's middle: the bar marks them as the page
const features = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;
onMounted(() => {
  observer = new IntersectionObserver(([e]) => (featuresInView.value = e.isIntersecting), { rootMargin: '-50% 0px -50% 0px' });
  if (features.value) observer.observe(features.value);
  void nextTick(() => scrollToHash(route.hash));
});
onBeforeUnmount(() => {
  observer?.disconnect();
  featuresInView.value = false;
});
</script>

<template>
  <div class="site-home">
    <site-welcome />

    <section id="features" ref="features" class="site-section">
      <div class="site-wrap">
        <div class="site-section__head">
          <div>
            <h2 class="view-head__title">{{ t('site.nav.features') }}</h2>
            <p class="site-lead">{{ t('site.features.lead') }}</p>
          </div>
        </div>
        <site-features :level="3" />
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
