<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { REPO_URL } from '@/site/site';
import { ICONS } from '@/ui/icons';

/** The Syntherrupter first and foremost, then the player, the libraries, the contributors, the license. */
const { t } = useI18n();
const MAX_LINKS = [
  { href: 'https://github.com/MMMZZZZ/Syntherrupter', icon: 'fab fa-github', name: 'Syntherrupter', key: 'github' },
  { href: 'https://github.com/MMMZZZZ/Syntherrupter/wiki', icon: 'fas fa-book-open', name: 'Wiki', key: 'wiki' },
  { href: 'https://github.com/MMMZZZZ/Syfoh', icon: 'fas fa-terminal', name: 'Syfoh', key: 'syfoh' },
  { href: 'https://highvoltageforum.net/index.php?topic=1020', icon: 'fas fa-comments', name: 'High Voltage Forum', key: 'forum' },
];
</script>

<template>
  <div class="site-wrap">
    <header class="site-page-head">
      <h1 class="view-head__title">{{ t('site.nav.credits') }}</h1>
      <p class="site-lead">{{ t('credits.lead') }}</p>
    </header>

    <article class="player-panel site-lead-credit">
      <div class="credits__item">
        <span class="player-panel__title site-lead-credit__kicker"><span class="icon"><i class="fas" :class="ICONS.interrupter"></i></span>{{ t('credits.heart') }}</span>
        <h2 class="site-lead-credit__name">Syntherrupter</h2>
        <p class="credits__by">{{ t('credits.by') }} <strong>Max Zuidberg</strong> (MMMZZZZ)</p>
        <p>{{ t('credits.syntherrupter') }}</p>
        <p>{{ t('credits.syfoh') }}</p>
      </div>
      <div class="dl-modal__options">
        <a v-for="l in MAX_LINKS" :key="l.key" class="dl-option" :href="l.href" target="_blank" rel="noopener">
          <span class="dl-option__icon"><i :class="l.icon"></i></span>
          <span class="dl-option__label">{{ l.name }}<small class="site-small">{{ t(`credits.links.${l.key}`) }}</small></span>
          <span class="dl-option__go"><i class="fas fa-up-right-from-square"></i></span>
        </a>
      </div>
    </article>

    <div class="site-cards site-cards--3 site-credits">
      <article class="player-panel site-card credits__item">
        <span class="icon"><i class="fas fa-music"></i></span>
        <b>Tesla Player</b>
        <p><i18n-t keypath="credits.app" tag="span"><template #author><strong>Antoine Rochebois</strong></template></i18n-t></p>
        <div class="credits__links">
          <a :href="REPO_URL" target="_blank" rel="noopener"><i class="fas fa-up-right-from-square"></i> GitHub</a>
          <a href="https://clubelek.fr" target="_blank" rel="noopener"><i class="fas fa-up-right-from-square"></i> Clubelek</a>
          <a href="https://highvoltageforum.net/index.php?topic=2034.0" target="_blank" rel="noopener"><i class="fas fa-up-right-from-square"></i> Forum</a>
        </div>
      </article>
      <article class="player-panel site-card credits__item">
        <span class="icon"><i class="fas fa-file-audio"></i></span>
        <b>smfplayer</b>
        <p><i18n-t keypath="credits.smfplayer" tag="span"><template #author><strong>Ryoyakawai</strong></template></i18n-t></p>
        <div class="credits__links">
          <a href="https://github.com/ryoyakawai/smfplayer" target="_blank" rel="noopener"><i class="fas fa-up-right-from-square"></i> GitHub</a>
        </div>
      </article>
      <article class="player-panel site-card credits__item">
        <span class="icon"><i class="fas fa-users"></i></span>
        <b>{{ t('credits.contributors') }}</b>
        <p>{{ t('credits.contributorsText') }}</p>
        <div class="credits__links">
          <a :href="`${REPO_URL}/pulls`" target="_blank" rel="noopener"><i class="fas fa-up-right-from-square"></i> {{ t('credits.contribute') }}</a>
          <router-link :to="{ name: 'site-docs', params: { page: 'development' }, hash: '#internationalization' }"><i class="fas fa-language"></i> {{ t('credits.translate') }}</router-link>
        </div>
      </article>
    </div>

    <article class="player-panel site-card site-credits__license">
      <span class="icon"><i class="fas fa-scale-balanced"></i></span>
      <b>{{ t('credits.license') }}</b>
      <p>{{ t('credits.licenseText') }}</p>
      <div class="credits__links">
        <a :href="`${REPO_URL}/blob/main/LICENSE`" target="_blank" rel="noopener"><i class="fas fa-up-right-from-square"></i> {{ t('credits.licenseLink') }}</a>
      </div>
    </article>
  </div>
</template>
