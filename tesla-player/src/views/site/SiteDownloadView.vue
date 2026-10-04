<script setup lang="ts">
import axios from 'axios';
import { computed, nextTick, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import SiteCode from '@/components/site/SiteCode.vue';
import { renderMarkdown } from '@/site/docs';
import { formatSize, OS_EXT, OS_ICON, OS_NAME, useDesktopOffer } from '@/site/downloads';
import { appTarget, DOCKER_IMAGE, inDesktopApp, RELEASES_URL, REPO_URL, scrollToHash, SITE_BUILD, useSiteContext } from '@/site/site';
import { useAuthStore } from '@/stores/auth';

/** One column: the desktop app, a server, the source, the release notes. */
const { t, locale } = useI18n();
const route = useRoute();
const context = useSiteContext();
const auth = useAuthStore();
const { os, release, loading, mine, others } = useDesktopOffer();

const DOCKER_RUN = `docker run -d -p 5000:5000 \\\n  -v tesla-data:/data \\\n  ${DOCKER_IMAGE}`;
const GIT_CLONE = `git clone ${REPO_URL}`;

/** This server, as the desktop app's sync setting wants it. */
const syncUrl = !SITE_BUILD && !inDesktopApp() ? (axios.defaults.baseURL || window.location.origin) : '';

const date = computed(() =>
  release.value?.date ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'long' }).format(new Date(release.value.date)) : '',
);
const notes = computed(() => (release.value?.notes ? renderMarkdown(release.value.notes) : ''));

function signIn(): void {
  void auth.login(appTarget(route));
}

onMounted(() => nextTick(() => scrollToHash(route.hash)));
watch(() => route.hash, (h) => scrollToHash(h));
// the notes arrive after the page: a #notes link waits for them
watch(notes, () => nextTick(() => route.hash === '#notes' && scrollToHash(route.hash)));
</script>

<template>
  <div class="site-wrap site-narrow">
    <header class="site-page-head">
      <h1 class="view-head__title">{{ context === 'instance' ? t('site.download.instanceTitle') : t('site.nav.download') }}</h1>
      <p class="site-lead">{{ context === 'instance' ? t('site.download.instanceLead') : t('site.download.lead') }}</p>
    </header>

    <section id="desktop" class="site-dl">
      <h2 class="site-dl__title"><span class="icon"><i class="fas fa-laptop"></i></span>{{ t('site.download.desktop') }}</h2>
      <p class="site-lead">{{ t('site.download.desktopText') }}</p>
      <p v-if="os === 'macos'" class="player-hint"><span class="icon"><i class="fab fa-apple"></i></span>{{ t('site.download.noMac') }}</p>

      <p v-if="loading" class="dl-modal__note"><span class="arc-loader" aria-hidden="true"></span>{{ t('site.download.loading') }}</p>
      <template v-else-if="release && release.builds.length">
        <a v-if="mine" class="btn btn--volt site-dl__big" :href="mine.url">
          <span class="icon"><i :class="OS_ICON[mine.os]"></i></span>
          <span>{{ t('site.hero.downloadFor', { os: OS_NAME[mine.os] }) }}<small>v{{ release.version }} · {{ OS_EXT[mine.os] }} · {{ formatSize(mine.size) }}</small></span>
        </a>
        <div v-if="others.length" class="dl-modal__options">
          <a v-for="b in others" :key="b.os" class="dl-option" :href="b.url">
            <span class="dl-option__icon"><i :class="OS_ICON[b.os]"></i></span>
            <span class="dl-option__label">{{ OS_NAME[b.os] }}</span>
            <span class="dl-option__size">{{ OS_EXT[b.os] }} · {{ formatSize(b.size) }}</span>
            <span class="dl-option__go"><i class="fas fa-download"></i></span>
          </a>
        </div>
        <p class="site-meta">
          <span>v{{ release.version }}<template v-if="date"> · {{ date }}</template><template v-if="release.source === 'server'"> · {{ t('site.download.fromServer') }}</template></span>
          <router-link v-if="notes" :to="{ hash: '#notes' }">{{ t('site.download.notes') }}</router-link>
          <a :href="RELEASES_URL" target="_blank" rel="noopener">{{ t('site.hero.allVersions') }}</a>
        </p>
      </template>
      <p v-else class="player-hint">
        <span class="icon"><i class="fas fa-circle-info"></i></span>
        <span>{{ t('site.download.none') }} <a :href="RELEASES_URL" target="_blank" rel="noopener">{{ t('site.hero.allVersions') }}</a></span>
      </p>

      <div v-if="syncUrl && context !== 'site'" class="site-dl__sync">
        <label class="field-label" for="site-sync-url">{{ t('site.download.syncUrl') }}</label>
        <site-code id="site-sync-url" :code="syncUrl" />
        <p class="site-mute">{{ t('site.download.syncHint') }}</p>
      </div>
      <p class="site-links"><router-link :to="{ name: 'site-docs', params: { page: 'desktop-app' } }">{{ t('site.download.installGuide') }} →</router-link></p>
    </section>

    <section v-if="context === 'instance'" class="site-dl">
      <h2 class="site-dl__title"><span class="icon"><i class="fas fa-globe"></i></span>{{ t('site.download.browser') }}</h2>
      <p class="site-lead">{{ t('site.download.browserText') }}</p>
      <div><button class="btn btn--volt" type="button" @click="signIn"><span class="icon"><i class="fas fa-right-to-bracket"></i></span>{{ t('site.nav.signIn') }}</button></div>
    </section>

    <section id="server" class="site-dl">
      <h2 class="site-dl__title"><span class="icon"><i class="fab fa-docker"></i></span>{{ context === 'instance' ? t('site.download.ownServer') : t('site.download.server') }}</h2>
      <p class="site-lead">{{ context === 'instance' ? t('site.download.ownServerText') : t('site.download.serverText') }}</p>
      <site-code :code="DOCKER_RUN" />
      <p class="site-meta">{{ t('site.download.serverOpen', { url: 'http://localhost:5000' }) }}</p>
      <p class="site-links">
        <router-link :to="{ name: 'site-docs', params: { page: 'deployment' } }">{{ t('site.home.deployGuide') }} →</router-link>
        <router-link :to="{ name: 'site-docs', params: { page: 'authentication' } }">{{ t('site.download.oidcGuide') }} →</router-link>
      </p>
    </section>

    <section v-if="context !== 'instance'" class="site-dl">
      <h2 class="site-dl__title"><span class="icon"><i class="fas fa-code"></i></span>{{ t('site.download.source') }}</h2>
      <p class="site-lead">{{ t('site.download.sourceText') }}</p>
      <site-code :code="GIT_CLONE" />
      <p class="site-links"><router-link :to="{ name: 'site-docs', params: { page: 'development' } }">{{ t('site.download.devGuide') }} →</router-link></p>
    </section>

    <section v-if="release" id="notes" class="site-dl">
      <h2 class="site-dl__title">
        <span class="icon"><i class="fas fa-wand-magic-sparkles"></i></span>{{ t('site.download.notes') }}
        <span v-if="release.version" class="player-synth-badge">v{{ release.version }}</span>
      </h2>
      <!-- eslint-disable-next-line vue/no-v-html -- GitHub's release notes, rendered with raw HTML escaped (renderMarkdown) -->
      <div v-if="notes" class="site-doc site-doc--notes" v-html="notes"></div>
      <p v-else class="site-mute">{{ t('site.download.notesNone') }}</p>
      <p class="site-links"><a :href="release.url" target="_blank" rel="noopener">{{ t('site.download.allVersions') }} →</a></p>
    </section>
  </div>
</template>
