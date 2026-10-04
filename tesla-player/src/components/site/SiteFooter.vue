<script setup lang="ts">
import { ISSUES_URL, REPO_URL } from '@/site/site';
</script>

<template>
  <footer class="site-foot">
    <div class="site-wrap site-foot__inner">
      <p class="site-foot__text">{{ $t('site.footer.text') }}</p>
      <nav class="site-foot__links">
        <a :href="REPO_URL" target="_blank" rel="noopener">GitHub</a>
        <router-link :to="{ name: 'site-docs' }">{{ $t('site.nav.docs') }}</router-link>
        <a :href="ISSUES_URL" target="_blank" rel="noopener">{{ $t('site.footer.bug') }}</a>
        <a :href="ISSUES_URL" target="_blank" rel="noopener">{{ $t('site.footer.idea') }}</a>
        <router-link :to="{ name: 'site-credits' }">{{ $t('site.nav.credits') }}</router-link>
      </nav>
    </div>
  </footer>
</template>
