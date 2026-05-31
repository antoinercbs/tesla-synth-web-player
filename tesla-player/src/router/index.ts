import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/play' },
  { path: '/play', name: 'play', component: () => import('@/views/PlayView.vue') },
  { path: '/edit/:id?', name: 'edit', component: () => import('@/views/EditView.vue') },
  { path: '/playlists', name: 'playlists', component: () => import('@/views/PlaylistsView.vue') },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

export default router;
