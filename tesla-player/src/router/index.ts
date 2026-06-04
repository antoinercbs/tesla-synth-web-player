import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/play' },
  { path: '/play', name: 'play', component: () => import('@/views/PlayView.vue') },
  { path: '/edit/:id?', name: 'edit', component: () => import('@/views/EditView.vue') },
  { path: '/playlists/:id?', name: 'playlists', component: () => import('@/views/PlaylistsView.vue') },
  { path: '/midi', name: 'midi', component: () => import('@/views/MidiFilesView.vue') },
  { path: '/syntherrupter', name: 'syntherrupter', component: () => import('@/views/SyntherrupterView.vue') },
  // Auth (only ever reached when the server has OIDC enabled).
  { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue') },
  { path: '/auth/callback', name: 'auth-callback', component: () => import('@/views/AuthCallbackView.vue') },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

// Auth gate: when the server requires login, every route needs an authenticated
// user except the login + callback pages. Fully inert when auth is disabled
// (the common case) — identical to before. Registered first so it runs before
// the firstNav rewrite below.
//
// Unauthenticated → redirect STRAIGHT to the IdP (no intermediate sign-in page).
// The manual /login page is only a fallback when the automatic redirect declines
// (anti-loop guard tripped, or the IdP was unreachable).
router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.enabled) return true;
  if (to.name === 'login' || to.name === 'auth-callback') return true;
  if (auth.authenticated) {
    // Authenticated but the API refused (missing role) → access-denied wall.
    return auth.accessDenied ? { name: 'login' } : true;
  }
  const redirected = await auth.requestLogin(to.fullPath);
  return redirected ? false : { name: 'login', query: { redirect: to.fullPath } };
});

// On a fresh page load (F5 / direct URL), the edit & playlist screens open on
// their chooser rather than resuming a transient editing state. Only the first
// navigation after boot is rewritten; in-app navigation (e.g. "edit this song")
// is untouched.
let firstNav = true;
router.beforeEach((to) => {
  if (firstNav) {
    firstNav = false;
    if ((to.name === 'edit' || to.name === 'playlists') && to.params.id != null) {
      return { name: to.name, params: {} };
    }
  }
  return true;
});

export default router;
