import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
} from "vue-router";
import { siteRoutes } from "@/site/routes";
import { useAuthStore } from "@/app/stores/auth";

const routes: RouteRecordRaw[] = [
  // a visitor who isn't signed in to a server that requires it lands on the
  // project's home; anyone else goes straight to the player
  {
    path: "/",
    redirect: () => {
      const auth = useAuthStore();
      return auth.enabled && !auth.authenticated ? { name: "site-home" } : "/play";
    },
  },
  {
    path: "/play",
    name: "play",
    component: () => import("@/ui/views/PlayView.vue"),
  },
  {
    path: "/edit/:id?",
    name: "edit",
    component: () => import("@/ui/views/EditView.vue"),
  },
  {
    path: "/playlists/:id?",
    name: "playlists",
    component: () => import("@/ui/views/PlaylistsView.vue"),
  },
  // a song's notes; `nav` lights the sidebar entry the page belongs to (it isn't a child route of it)
  {
    path: "/edit/:id/midi",
    name: "midi-edit",
    component: () => import("@/ui/views/MidiEditView.vue"),
    meta: { nav: "edit" },
  },
  // the MIDI files had a page of their own before each song owned its file
  { path: "/midi/:rest(.*)*", redirect: { name: "edit" } },
  {
    path: "/envelopes/:program?",
    name: "envelopes",
    component: () => import("@/ui/views/EnvelopesView.vue"),
  },
  // the scenes the coils are posed in, for the 3D views (before /coils/:id, which would take "scenes")
  {
    path: "/coils/scenes/:id?",
    name: "coilScenes",
    component: () => import("@/ui/views/ScenesView.vue"),
  },
  // how a coil's figures are worked out (?hz=: the note shown)
  {
    path: "/coils/:id/calculs",
    name: "coilsCalc",
    component: () => import("@/ui/views/CoilsCalcView.vue"),
  },
  // the real coils, and the sheet of one (/coils/new: a coil being added)
  {
    path: "/coils/:id?",
    name: "coils",
    component: () => import("@/ui/views/CoilsView.vue"),
  },
  {
    path: "/syntherrupter",
    name: "syntherrupter",
    component: () => import("@/ui/views/SyntherrupterView.vue"),
  },
  // Camera-assisted primary tuning (player side).
  {
    path: "/tune",
    name: "tune",
    component: () => import("@/ui/views/TuneView.vue"),
  },
  // The phone's camera page of a tuning session: no app chrome, and PUBLIC —
  // the session token in the URL fragment is its credential (the phone has no
  // account), so the auth gate below lets it through.
  {
    path: "/tune/cam/:sessionId",
    name: "tune-camera",
    component: () => import("@/ui/views/TuneCameraView.vue"),
    meta: { bare: true, public: true },
  },
  // The same camera without a session: nothing drives the coil, nothing is saved.
  // Bare too (dark, all screen to the picture), but behind the auth gate.
  {
    path: "/tune/meter",
    name: "arc-meter",
    component: () => import("@/ui/views/ArcMeterView.vue"),
    meta: { bare: true },
  },
  // Auth (only ever reached when the server has OIDC enabled).
  {
    path: "/login",
    name: "login",
    component: () => import("@/ui/views/LoginView.vue"),
  },
  {
    path: "/auth/callback",
    name: "auth-callback",
    component: () => import("@/ui/views/AuthCallbackView.vue"),
  },
  // The project's pages (the GitHub Pages site, the same views): public, no sidebar.
  siteRoutes("/about"),
  // Dev-only reference sheet of the tokens + shared pieces (dropped from builds).
  ...(import.meta.env.DEV
    ? [{ path: "/styleguide", name: "styleguide", component: () => import("@/ui/views/StyleGuideView.vue") }]
    : []),
  // an address no route knows (a typo, an old link) would show an empty page
  { path: "/:pathMatch(.*)*", redirect: "/play" },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

// Auth gate: when the server requires login, every route needs an authenticated
// user except the public ones (the site, the phone's camera page) and the login
// + callback pages. Fully inert when auth is disabled (the common case).
//
// Unauthenticated → the project's home, whose "Sign in" goes to the IdP and back
// to the page asked for (?redirect=). The manual /login page stays for the
// access-denied wall and for a sign-in the IdP round-trip couldn't complete.
router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.enabled) return true;
  if (to.name === "login" || to.name === "auth-callback" || to.meta.public) return true;
  if (auth.authenticated) {
    // Authenticated but the API refused (missing role) → access-denied wall.
    return auth.accessDenied ? { name: "login" } : true;
  }
  // signed in on this browser before: the IdP may still hold the session
  if (await auth.checkSso(to.fullPath)) return false;
  return { name: "site-home", query: to.fullPath === "/play" ? {} : { redirect: to.fullPath } };
});

export default router;
