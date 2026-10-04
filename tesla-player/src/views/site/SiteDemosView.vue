<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import EmptyState from '@/components/ui/EmptyState.vue';
import SiteVideo from '@/components/site/SiteVideo.vue';
import { shownDemos, TAG_COLOR, type Demo } from '@/site/demos';
import { shot } from '@/site/shots';

/** The videos: the chosen one large (?v=<key>, so a link opens it), the list beside it. */
const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const demos = shownDemos();
const current = computed<Demo | undefined>(() => demos.find((d) => d.key === route.query.v) ?? demos[0]);
const pic = (key: string): string => shot(key, locale.value);

function pick(d: Demo): void {
  void router.replace({ query: { v: d.key } });
}
</script>

<template>
  <div class="site-wrap">
    <header class="site-page-head">
      <h1 class="view-head__title">{{ t('site.nav.demos') }}</h1>
      <p class="site-lead">{{ t('site.demos.lead') }}</p>
    </header>

    <div v-if="current" class="site-demos">
      <div>
        <site-video :demo="current" :poster="pic(current.shot)" caption />
        <p class="dl-modal__note"><span class="icon"><i class="fas fa-shield-halved"></i></span>{{ t('site.demos.privacy') }}</p>
      </div>
      <div class="site-vlist">
        <button v-for="d in demos" :key="d.key" type="button" class="player-panel site-vcard"
          :class="{ 'is-current': d === current }" @click="pick(d)">
          <span class="site-vcard__thumb"><img :src="pic(d.shot)" alt="" loading="lazy"><span class="row-btn row-btn--play"><i class="fas fa-play"></i></span></span>
          <span class="site-vcard__text">
            <b>{{ t(`site.demos.items.${d.key}`) }}</b>
            <span class="site-vcard__meta">
              <span class="song-tag-pill" :style="{ '--tag-c': TAG_COLOR[d.tag] }">{{ d.youtube ? t(`site.demos.tags.${d.tag}`) : t('site.demos.toFilm') }}</span>
              <span v-if="d.duration" class="play-row__dur">{{ d.duration }}</span>
            </span>
          </span>
        </button>
      </div>
    </div>
    <empty-state v-else icon="fa-video">{{ t('site.demos.none') }}</empty-state>
  </div>
</template>
