<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { DOC_GROUPS, DOC_IDS, isDocId, loadDoc, renderDoc, type DocId, type DocLink, type RenderedDoc } from '@/site/docs';
import { centerInRow, REPO_URL, scrollToHash } from '@/site/site';

/** docs/<page>.md, rendered, beside the table of every guide (the current one with its sections). */
const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();

const id = computed<DocId>(() => (isDocId(route.params.page) ? route.params.page : 'README'));
const doc = ref<RenderedDoc | null>(null);
const article = ref<HTMLElement | null>(null);
const toc = ref<HTMLElement | null>(null);

const to = (page: DocId, hash?: string): RouteLocationRaw =>
  ({ name: 'site-docs', params: { page: page === 'README' ? undefined : page }, hash });
function hrefOf(link: DocLink): string {
  if (link.kind === 'external') return link.url;
  return router.resolve(link.kind === 'home' ? { name: 'site-home' } : to(link.doc, link.anchor ? `#${link.anchor}` : undefined)).href;
}

const next = computed<DocId | undefined>(() => DOC_IDS[DOC_IDS.indexOf(id.value) + 1]);
const editUrl = computed(() => `${REPO_URL}/edit/main/docs/${id.value}.md`);

let loading = 0;
async function load(): Promise<void> {
  const mine = ++loading;
  const page = id.value;
  const md = await loadDoc(page);
  if (mine !== loading) return;
  doc.value = renderDoc(md, page, hrefOf);
  await nextTick();
  centerInRow(toc.value);
  if (route.hash) scrollToHash(route.hash);
  else article.value?.closest('.app-main')?.scrollTo({ top: 0 });
}
watch(id, load, { immediate: true });
watch(() => route.hash, (h) => scrollToHash(h));

/** A link between pages of the site stays in the app: the router takes it. */
function onClick(e: MouseEvent): void {
  const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-site-link]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  // the href carries the site's base (GitHub Pages serves it under the repository's name)
  const href = a.getAttribute('href') ?? '/';
  const base = router.options.history.base;
  void router.push(base && href.startsWith(base) ? href.slice(base.length) || '/' : href);
}
</script>

<template>
  <div class="site-wrap site-docs">
    <nav ref="toc" class="player-panel site-toc" :aria-label="t('site.docs.title')">
      <template v-for="g in DOC_GROUPS" :key="g.id">
        <h2 class="sidebar-section__title">{{ t(`site.docs.groups.${g.id}`) }}</h2>
        <template v-for="d in g.docs" :key="d">
          <router-link class="nav-item" :class="{ 'is-current': d === id }" :to="to(d)">{{ t(`site.docs.titles.${d}`) }}</router-link>
          <div v-if="d === id && d !== 'README' && doc?.sections.length" class="site-toc__sub">
            <router-link v-for="s in doc.sections" :key="s.id" :to="to(d, `#${s.id}`)">{{ s.title }}</router-link>
          </div>
        </template>
      </template>
    </nav>

    <article class="player-panel site-docs__page">
      <p v-if="locale !== 'en'" class="player-hint site-docs__lang"><span class="icon"><i class="fas fa-language"></i></span>{{ t('site.docs.english') }}</p>
      <!-- eslint-disable-next-line vue/no-v-html -- docs/*.md of this repository, rendered by renderDoc -->
      <div v-if="doc" ref="article" class="site-doc" lang="en" @click="onClick" v-html="doc.html"></div>
      <p v-else class="dl-modal__note site-docs__loading"><span class="arc-loader" aria-hidden="true"></span>{{ t('site.docs.loading') }}</p>
      <footer class="site-docs__foot">
        <a :href="editUrl" target="_blank" rel="noopener"><i class="fab fa-github"></i> {{ t('site.docs.edit') }}</a>
        <router-link v-if="next" :to="to(next)">{{ t('site.docs.next', { title: t(`site.docs.titles.${next}`) }) }} →</router-link>
      </footer>
    </article>
  </div>
</template>
