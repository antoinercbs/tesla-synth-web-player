import { createApp, watchEffect } from 'vue';
import { createPinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import { createRouter, createWebHistory } from 'vue-router';

import { messages } from '@/assets/translations';
import { applySkin, DEFAULT_SKIN } from '@/ui/skins';
import { applyTheme, defaultTheme } from '@/ui/themes';
import SiteApp from './SiteApp.vue';
import { siteRoutes } from './routes';

// The showcase site on its own (GitHub Pages): the app's pages of the site,
// without the app. The same faces, stylesheet and icons as the app (main.js).
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/chakra-petch/700.css';
import '@/assets/main.scss';
import '@fortawesome/fontawesome-free/css/all.css';

// the default look: a visitor's look is the app's business
applySkin(DEFAULT_SKIN);
applyTheme(defaultTheme(DEFAULT_SKIN));

function firstLocale(): string {
  try {
    const stored = localStorage.getItem('locale');
    if (stored === 'en' || stored === 'fr') return stored;
  } catch {
    /* storage blocked */
  }
  return navigator.language.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

const i18n = createI18n({ legacy: false, globalInjection: true, locale: firstLocale(), fallbackLocale: 'en', messages });
watchEffect(() => {
  document.documentElement.lang = i18n.global.locale.value;
});

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [siteRoutes('/'), { path: '/:pathMatch(.*)*', redirect: '/' }],
});

createApp(SiteApp).use(createPinia()).use(router).use(i18n).mount('#app');
