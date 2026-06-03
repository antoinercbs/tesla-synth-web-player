import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/play' },
  { path: '/play', name: 'play', component: () => import('@/views/PlayView.vue') },
  { path: '/edit/:id?', name: 'edit', component: () => import('@/views/EditView.vue') },
  { path: '/playlists/:id?', name: 'playlists', component: () => import('@/views/PlaylistsView.vue') },
  { path: '/midi', name: 'midi', component: () => import('@/views/MidiFilesView.vue') },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
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
