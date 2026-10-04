import type { RouteRecordRaw } from 'vue-router';

/**
 * The site's pages, under `base`: the root of the GitHub Pages build, /about in
 * the app. They are reached by name, so the same pages serve both. Public (no
 * sign-in needed) and bare (no app sidebar: the site has its own bar).
 */
export function siteRoutes(base: string): RouteRecordRaw {
  return {
    path: base,
    component: () => import('@/views/site/SiteLayout.vue'),
    meta: { bare: true, public: true },
    children: [
      { path: '', name: 'site-home', component: () => import('@/views/site/SiteHomeView.vue') },
      { path: 'features', name: 'site-features', component: () => import('@/views/site/SiteFeaturesView.vue') },
      { path: 'demos', name: 'site-demos', component: () => import('@/views/site/SiteDemosView.vue') },
      { path: 'download', name: 'site-download', component: () => import('@/views/site/SiteDownloadView.vue') },
      { path: 'docs/:page?', name: 'site-docs', component: () => import('@/views/site/SiteDocsView.vue') },
      { path: 'credits', name: 'site-credits', component: () => import('@/views/site/SiteCreditsView.vue') },
    ],
  };
}

/** The menu's pages, in its order (a page's label under site.nav). */
export const SITE_PAGES = [
  { name: 'site-features', label: 'features' },
  { name: 'site-demos', label: 'demos' },
  { name: 'site-download', label: 'download' },
  { name: 'site-docs', label: 'docs' },
  { name: 'site-credits', label: 'credits' },
] as const;
