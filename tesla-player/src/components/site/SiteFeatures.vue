<script setup lang="ts">
import { computed } from 'vue';
import { type RouteLocationRaw } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { lookShots, shot } from '@/site/shots';
import { ICONS } from '@/ui/icons';

/**
 * Each feature at length, then the smaller ones, then the looks: the Features
 * page, and the home page's section of the same name. `level` is the features'
 * heading level (the home puts them under its own section title).
 */
const props = withDefaults(defineProps<{ level?: 2 | 3 }>(), { level: 2 });
const { t, locale } = useI18n();
const pic = (key: string): string => shot(key, locale.value);
const heading = computed(() => `h${props.level}`);

const guide = (page: string, hash?: string): RouteLocationRaw => ({ name: 'site-docs', params: { page }, hash });
const ROWS = [
  { key: 'play', shot: 'play', points: 4, link: { to: guide('user-guide', '#playing-a-song-or-playlist'), label: 'site.features.inGuide' } },
  { key: 'edit', shot: 'edit', points: 3, link: { to: guide('user-guide', '#editing-a-song'), label: 'site.features.inGuide' } },
  { key: 'synth', shot: 'synth', points: 4, link: { to: guide('user-guide', '#choosing-your-outputs'), label: 'site.features.inGuide' } },
  { key: 'tune', shot: 'tune', points: 2, link: { to: guide('tuning'), label: 'site.features.tuneGuide' } },
  { key: 'midi', shot: 'midi-edit', points: 0, link: { to: guide('user-guide', '#midi-files--the-midi-editor'), label: 'site.features.inGuide' } },
  { key: 'usb', shot: 'syntherrupter', points: 0, link: { to: guide('syntherrupter'), label: 'site.features.usbGuide' } },
];
const EXTRAS = [
  { key: 'speakers', icon: ICONS.speakers },
  { key: 'sync', icon: 'fa-rotate' },
  { key: 'oidc', icon: 'fa-user-shield' },
  { key: 'tour', icon: 'fa-route' },
  { key: 'languages', icon: 'fa-language' },
];
const looks = computed(() => lookShots(locale.value));
</script>

<template>
  <section v-for="(row, i) in ROWS" :id="`f-${row.key}`" :key="row.key" class="site-feat" :class="{ 'site-feat--flip': i % 2 === 1 }">
    <div class="site-feat__text">
      <component :is="heading" class="site-feat__title">{{ t(`site.features.${row.key}`) }}</component>
      <p class="site-lead">{{ t(`site.features.${row.key}Text`) }}</p>
      <ul v-if="row.points" class="site-ticks">
        <li v-for="n in row.points" :key="n"><i class="fas fa-check"></i>{{ t(`site.features.${row.key}Points.${n - 1}`) }}</li>
      </ul>
      <p class="site-links"><router-link :to="row.link.to">{{ t(row.link.label) }} →</router-link></p>
    </div>
    <div class="site-shot"><img :src="pic(row.shot)" :alt="t(`site.features.${row.key}`)" loading="lazy"></div>
  </section>

  <component :is="heading" class="site-sub">{{ t('site.features.more') }}</component>
  <div class="site-cards site-cards--3">
    <article v-for="x in EXTRAS" :key="x.key" class="player-panel site-card">
      <span class="icon"><i class="fas" :class="x.icon"></i></span>
      <b>{{ t(`site.features.${x.key}`) }}</b>
      <p>{{ t(`site.features.${x.key}Text`) }}</p>
    </article>
  </div>

  <section id="f-looks" class="site-section">
    <div class="site-section__head">
      <div>
        <component :is="heading" class="view-head__title">{{ t('site.features.looks') }}</component>
        <p class="site-lead">{{ t('site.features.looksText') }}</p>
      </div>
    </div>
    <div class="site-looks">
      <figure v-for="l in looks" :key="l.skin" class="site-look">
        <img :src="l.src" alt="" loading="lazy">
        <figcaption>{{ t(`skin.${l.skin}`) }}</figcaption>
      </figure>
      <!-- the fancier ones: told of, left for the app -->
      <figure class="site-look site-look--more">
        <span class="site-look__more"><i class="fas fa-masks-theater"></i>{{ t('site.features.looksMore') }}</span>
      </figure>
    </div>
  </section>
</template>
