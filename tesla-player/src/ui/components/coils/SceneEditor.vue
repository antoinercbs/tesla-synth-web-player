<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useMidiStore } from '@/app/stores/midi';
import { useScenesStore } from '@/app/stores/scenes';
import { createScene, deleteScene, updateScene, type SceneRecord } from '@/api/scenes';
import { BOX_KINDS, DECOR_ICONS, DECOR_IDS, NEW_BOX, type BoxKind, type DecorId, type SceneBox, type SceneData, type ScenePose } from '@/model/coils/scene-data';
import { PhyPosedCoil, PhySceneThings, PhyTable } from '@/model/coils/staging';
import { PhySpec } from '@/model/coils/spec';
import { REF_HZ } from '@/model/coils/summary';
import type { GfxScene, SceneTool } from '@/engine/gfx';
import { COIL_COLOR_COUNT } from '@/ui/helpers/coil-colors';
import { tokenColor } from '@/ui/helpers/token-color';
import { notify } from '@/ui/helpers/toast';
import { serverMessage } from '@/api/http';
import { useLeaveGuard } from '@/ui/helpers/leave-guard';
import ConfirmModal from '@/ui/components/ui/ConfirmModal.vue';
import DropMenu from '@/ui/components/ui/DropMenu.vue';
import SegmentedControl from '@/ui/components/ui/SegmentedControl.vue';
import CoilField from './CoilField.vue';
import OutletIcon from './OutletIcon.vue';
import SceneCoilPanel from './SceneCoilPanel.vue';

/**
 * One scene, set in the 3D itself (the Scènes tab's list opens it). A scene is
 * a décor and coils of the list posed in it (model/coils/scene-data.ts); the 3D
 * views pick one. The hand's tool over the picture says what a drag does on a
 * coil, a cage or a table: turn the view, move it, turn it, set its outlet
 * points (the accessories' handles show with every tool but the view's);
 * the panel at the right lists the scene's coils and its things on the
 * floor, adds them ("+ Bobine", "+ Accessoire": tables, cages,
 * counter-points, knights; a coil's ring is in its own settings), and sets
 * the chosen one to the degree and the millimetre. A coil whose middle is over a table stands on it, and goes
 * with it when it moves. Every
 * change can be undone. Its arcs fire at the setting over the picture, each
 * tube's from the model with all of them on its top.
 */
const props = defineProps<{ id: number | 'new'; decor?: DecorId }>();
const router = useRouter();
const { t, locale } = useI18n();
const midiStore = useMidiStore();
const scenes = useScenesStore();

/* ------------------------------------------------------------ the scene open */
const record = computed<SceneRecord | null>(() => (props.id === 'new' ? null : scenes.list.find((s) => s.id === props.id) ?? null));
const draft = reactive<{ id: number | null; name: string; data: SceneData }>({ id: null, name: '', data: { decor: 'concert', coils: [], cages: [], tables: [], counters: [], knights: [] } });
const payload = () => JSON.stringify({ name: draft.name.trim(), data: draft.data });
const baseline = ref(payload());
const dirty = computed(() => payload() !== baseline.value);
const { pending: leavePending, answer: answerLeave } = useLeaveGuard(() => dirty.value);

function open(r: SceneRecord | null): void {
  draft.id = r?.id ?? null;
  draft.name = r?.name ?? '';
  draft.data = JSON.parse(JSON.stringify(r?.data ?? { decor: 'concert', coils: [], cages: [], tables: [], counters: [], knights: [] }));
  baseline.value = payload();
  forget();
  choose(null);
  place(false);
}
function create(decor: DecorId): void {
  const wired = midiStore.wiring.map((u) => midiStore.coilByUuid(u)).filter((c) => c != null);
  draft.id = null;
  draft.name = t('scenes.newName', { n: scenes.list.length + 1 });
  draft.data = { decor, coils: PhyPosedCoil.lineUp(wired.length ? wired : midiStore.coilList), cages: [], tables: [], counters: [], knights: [] };
  baseline.value = '';
  forget();
  choose(null);
  place(false);
}
// the list came (a reload on this page), or a sync changed the scene while it is untouched
watch(record, (r) => {
  if (props.id === 'new') return;
  if (draft.id !== props.id || (r && !dirty.value && JSON.stringify(r.data) !== JSON.stringify(draft.data))) open(r);
});

/* ------------------------------------------------------------ undo: the poses and the décor, the name has its field's own */
const past: string[] = [], future: string[] = [];
const canUndo = ref(false), canRedo = ref(false);
let seen = '', lastAt = 0, lastKey = '';
function forget(): void {
  past.length = future.length = 0;
  seen = JSON.stringify(draft.data);
  canUndo.value = canRedo.value = false;
}
/** After a change: one step back to undo; a value typed key after key is one step. */
function remember(key = ''): void {
  const now = JSON.stringify(draft.data);
  if (now === seen) return;
  const same = key && key === lastKey && performance.now() - lastAt < 800;
  if (!same) past.push(seen);
  if (past.length > 100) past.shift();
  future.length = 0;
  seen = now;
  lastKey = key;
  lastAt = performance.now();
  canUndo.value = past.length > 0;
  canRedo.value = false;
}
function travel(from: string[], to: string[]): void {
  const back = from.pop();
  if (back == null) return;
  to.push(seen);
  seen = back;
  lastKey = '';
  draft.data = JSON.parse(back);
  if ((sel.value != null && sel.value >= shown.value.length) || (selBox.value && !box.value)) choose(null);
  place();
  canUndo.value = past.length > 0;
  canRedo.value = future.length > 0;
}
const undo = () => travel(past, future);
const redo = () => travel(future, past);

/* ------------------------------------------------------------ the coils in it */
const coilOf = (p: ScenePose) => midiStore.coilByUuid(p.coil);
const capOf = (uuid: string) => { const o = midiStore.outputOf(uuid); return o >= 0 ? tokenColor(`--coil-${o % COIL_COLOR_COUNT}`) : tokenColor('--text-mute'); };
// the poses whose coil is still in the list, and where each one is among the scene's
const shown = computed(() => draft.data.coils.map((p, i) => ({ p, i, coil: coilOf(p) })).filter((x) => x.coil != null));
const missing = computed(() => draft.data.coils.length - shown.value.length);
const free = computed(() => midiStore.coilList.filter((c) => !draft.data.coils.some((p) => p.coil === c.uuid)));
const sel = ref<number | null>(null);
const selTube = ref(0);
const selected = computed(() => (sel.value != null ? shown.value[sel.value] ?? null : null));
// or a cage or a table: one or the other is chosen
const selBox = ref<{ kind: BoxKind; i: number } | null>(null);
const boxesOf = (kind: BoxKind) => ({ cage: draft.data.cages, table: draft.data.tables, counter: draft.data.counters, knight: draft.data.knights })[kind];
const box = computed(() => (selBox.value ? boxesOf(selBox.value.kind)[selBox.value.i] ?? null : null));
const BOX_ICONS: Record<BoxKind, string> = { cage: 'fa-border-all', table: 'fa-chair', counter: 'fa-location-arrow', knight: 'fa-chess-knight' };
// to the centimetre and the degree, as the fields show them
const cm = (v: number) => Math.round(v * 100) / 100;
const roundBox = (b: SceneBox): SceneBox => ({ x: cm(b.x), z: cm(b.z), rot: Math.round(b.rot), w: cm(b.w), d: cm(b.d), h: cm(b.h) });
const metres = (v: number) => v.toLocaleString(locale.value, { maximumFractionDigits: 2 });
// what a row says of each: a box's three sizes, a counter-point's rod and height, a knight's height
const sizeOf = (kind: BoxKind, b: SceneBox) => (kind === 'knight' ? `${metres(b.h)} m` : kind === 'counter' ? `${metres(b.w)} m · ↑ ${metres(b.h)} m`
  : `${metres(b.w)} × ${metres(b.d)} × ${metres(b.h)} m`);
const H_RANGE: Record<BoxKind, [number, number]> = { table: [0.2, 2], cage: [0.5, 4], counter: [0.2, 3.5], knight: [1.2, 2.2] };

// what a drag on a coil does, as in a 3D editor; a key each
const tool = ref<SceneTool>('move');
const TOOLS: { id: SceneTool; icon: string; key: string }[][] = [
  [{ id: 'view', icon: 'fa-hand', key: 'v' }],
  [{ id: 'move', icon: 'fa-up-down-left-right', key: 'd' }, { id: 'rotate', icon: 'fa-rotate', key: 'r' }],
  [{ id: 'tubes', icon: '', key: 'p' }],
];
watch(tool, (v) => scene3d.value?.tool(v));

// the setting the coils fire at while the scene is set
const setting = ref<number | 'max'>(80);
const settingOptions = computed(() => [
  { value: 40, label: '40 µs' },
  { value: 80, label: '80 µs' },
  { value: 'max' as const, label: t('coils.view3d.boardMax') },
]);

/* ------------------------------------------------------------ the 3D */
const view = ref<HTMLElement | null>(null);
const scene3d = shallowRef<GfxScene | null>(null);
const failed = ref(false);

const arcsAt = (k: number) => {
  const x = shown.value[k], spec = PhySpec.resolve(x.coil!.spec);
  return new PhyPosedCoil(x.p, spec).arcs(setting.value === 'max' ? spec.board.ontime : setting.value, REF_HZ, draft.data);
};
function arcsOf(k: number): void {
  if (shown.value[k]) scene3d.value?.setArcs(k, { on: true, ...arcsAt(k) });
}
// the arcs worked out first: the view is framed with them (only when the scene opens: an edit keeps the view)
function place(keepView = true): void {
  const s = scene3d.value;
  if (!s) return;
  const arcs = shown.value.map((_, k) => arcsAt(k));
  s.setCoils(shown.value.map((x, k) => ({ ...new PhyPosedCoil(x.p, PhySpec.resolve(x.coil!.spec)).stage(capOf(x.p.coil)), reach: arcs[k].reach })), draft.data.decor, keepView, draft.data);
  arcs.forEach((a, k) => s.setArcs(k, { on: true, ...a }));
  if (selBox.value) s.selectBox(selBox.value.kind, selBox.value.i);
  else s.select(sel.value, selTube.value);
}
watch(setting, () => shown.value.forEach((_, k) => arcsOf(k)));

onMounted(async () => {
  if (props.id === 'new') create(props.decor ?? 'concert');
  else open(record.value);
  try {
    const { GfxScene } = await import('@/engine/gfx');
    if (!view.value) return;
    const s = new GfxScene(view.value, { mat: tokenColor('--text-mute'), handle: tokenColor('--volt') });
    scene3d.value = s;
    s.tool(tool.value);
    s.edit({
      pick(k, tube) { sel.value = k; selBox.value = null; selTube.value = tube; },
      change(k, sc, done) {
        const x = shown.value[k];
        if (!x) return;
        draft.data.coils[x.i] = PhyPosedCoil.fromStage(sc, x.p.coil);
        if (done) { arcsOf(k); remember(); }
      },
      pickBox(kind, k) { selBox.value = { kind, i: k }; sel.value = null; },
      // the coils' arcs see it once it is let go (the coils a table carries came by change)
      changeBox(kind, k, c, done) {
        boxesOf(kind)[k] = roundBox(c);
        if (done) { place(); remember(); }
      },
    });
    place(false);
  } catch (err) {
    console.error('3D view', err);
    failed.value = true;
  }
});
onBeforeUnmount(() => scene3d.value?.dispose());
// on the window: a click on a button of the panel that goes away leaves the focus on <body>
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

/* ------------------------------------------------------------ the chosen coil */
function setPose(k: number, pose: ScenePose, key = ''): void {
  const x = shown.value[k];
  if (!x) return;
  draft.data.coils[x.i] = pose;
  place();
  remember(key);
}
function chooseTube(j: number): void {
  selTube.value = j;
  scene3d.value?.select(sel.value, j);
}
function choose(k: number | null): void {
  sel.value = k;
  selBox.value = null;
  selTube.value = 0;
  scene3d.value?.select(k, 0);
}
function chooseBox(kind: BoxKind, k: number): void {
  sel.value = null;
  const same = selBox.value?.kind === kind && selBox.value.i === k;
  selBox.value = same ? null : { kind, i: k };
  scene3d.value?.selectBox(same ? null : kind, k);
}
function removeCoil(): void {
  const x = selected.value;
  if (!x) return;
  draft.data.coils.splice(x.i, 1);
  choose(null);
  place();
  remember();
}
function addCoil(uuid: string): void {
  const coil = midiStore.coilByUuid(uuid);
  if (!coil) return;
  const xs = draft.data.coils.map((p) => p.x);
  draft.data.coils.push(PhyPosedCoil.place(coil, xs.length ? Math.min(5, Math.max(...xs) + 1.6) : 0, 0.6, 30));
  sel.value = shown.value.length - 1;
  selTube.value = 0;
  place();
  remember();
}
/* ------------------------------------------------------------ the scene's accessories: tables, cages, counter-points, knights (a coil's ring is its panel's) */
/**
 * Where a new thing goes with a coil chosen: a table under it (it stands on
 * it at once), a counter-point facing its first tube, a knight before it;
 * else in front of the stage.
 */
function newBox(kind: BoxKind): SceneBox {
  const x = selected.value, list = boxesOf(kind), d = NEW_BOX[kind], cm = (v: number) => Math.round(v * 100) / 100;
  const things = new PhySceneThings(draft.data);
  if (x && kind === 'table' && !x.p.hang && !things.topUnder(x.p.x, x.p.z)) return { ...d, x: x.p.x, z: x.p.z };
  if (x && kind === 'counter') return new PhyPosedCoil(x.p, PhySpec.resolve(x.coil!.spec)).counterPole(things);
  if (x && kind === 'knight') return { ...d, x: cm(x.p.x + 1.2), z: cm(x.p.z + 0.6) };
  return { ...d, x: cm(d.x + (list.length % 3) * 1.5) };
}
function addBox(kind: BoxKind): void {
  const list = boxesOf(kind);
  list.push(newBox(kind));
  sel.value = null;
  selBox.value = { kind, i: list.length - 1 };
  place();
  remember();
  tool.value = 'move';
}
/** A box set from its fields; a table carries the coils standing on it. */
function setBox(c: SceneBox, key: string): void {
  const b = selBox.value;
  if (!b) return;
  const list = boxesOf(b.kind), from = list[b.i];
  if (b.kind === 'table') {
    draft.data.coils = draft.data.coils.map((p) => {
      const to = p.hang ? null : new PhyTable(from).carry(c, p.x, p.z);
      return to ? { ...p, x: Math.round(to.x * 100) / 100, z: Math.round(to.z * 100) / 100, rot: Math.round(((((p.rot + to.turn) % 360) + 540) % 360) - 180) } : p;
    });
  }
  list[b.i] = roundBox(c);
  place();
  remember(key);
}
const editBox = (key: keyof SceneBox, v: number | undefined) => { if (v != null && box.value) setBox({ ...box.value, [key]: v }, `box.${key}`); };
function removeBox(): void {
  const b = selBox.value;
  if (!b) return;
  boxesOf(b.kind).splice(b.i, 1);
  choose(null);
  place();
  remember();
}

function setDecor(id: DecorId): void {
  draft.data.decor = id;
  place();
  remember();
}

/* ------------------------------------------------------------ saving */
const saving = ref(false);
const nameOk = computed(() => draft.name.trim().length > 0);
async function save(): Promise<void> {
  if (saving.value || !nameOk.value) return;
  saving.value = true;
  try {
    const input = { name: draft.name.trim(), data: draft.data };
    const saved = draft.id != null ? await updateScene(draft.id, input) : await createScene(input);
    scenes.upsert(saved);
    draft.id = saved.id;
    baseline.value = payload();
    notify('scenes.saved');
    if (props.id !== saved.id) await router.replace({ name: 'coilScenes', params: { id: String(saved.id) } });
  } catch (err) {
    console.error('Save scene failed', serverMessage(err) ?? err);
    notify('label.saveFailed', 'error');
  } finally {
    saving.value = false;
  }
}
function duplicate(): void {
  draft.id = null;
  draft.name = t('scenes.copyName', { name: draft.name.trim() });
  baseline.value = '';
}
const confirmDelete = ref(false);
async function remove(): Promise<void> {
  confirmDelete.value = false;
  const id = draft.id;
  baseline.value = payload();
  if (id != null) {
    try {
      await deleteScene(id);
      scenes.remove(id);
    } catch (err) {
      console.error('Delete scene failed', err);
      notify('label.deleteFailed', 'error');
      return;
    }
  }
  await router.replace({ name: 'coilScenes' });
}

/* ------------------------------------------------------------ the keys */
const NUDGE = { move: [0.05, 0.25], rotate: [5, 15] } as const;
function onKey(e: KeyboardEvent): void {
  const mod = e.ctrlKey || e.metaKey, typing = !!(e.target as HTMLElement).closest?.('input, textarea, select, [role="dialog"]');
  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (!leavePending.value && !confirmDelete.value) void save();
    return;
  }
  if (e.defaultPrevented || e.altKey || leavePending.value || confirmDelete.value || typing) return;
  if (mod) {
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    return;
  }
  if (e.key === 'Escape' && (sel.value != null || selBox.value)) { choose(null); return; }
  if (e.key === 'f' || e.key === 'F') { scene3d.value?.reframe(); return; }
  if (box.value && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); removeBox(); return; }
  const x = selected.value;
  if (x && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); removeCoil(); return; }
  // the arrows nudge the chosen coil: moved (up: away from the audience) or turned
  if (x && e.key.startsWith('Arrow') && (tool.value === 'move' || tool.value === 'rotate')) {
    e.preventDefault();
    const step = NUDGE[tool.value][e.shiftKey ? 1 : 0], p: ScenePose = { ...x.p };
    const sx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0, sz = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    if (tool.value === 'move') {
      p.x = Math.round(Math.max(-6, Math.min(6, p.x + sx * step)) * 100) / 100;
      p.z = Math.round(Math.max(-4, Math.min(4, p.z + sz * step)) * 100) / 100;
    } else p.rot = Math.round(((((p.rot + (sx || -sz) * step) % 360) + 540) % 360) - 180);
    setPose(sel.value!, p, `nudge-${tool.value}`);
    return;
  }
  const k = TOOLS.flat().find((y) => y.key === e.key.toLowerCase());
  if (k) tool.value = k.id;
}
</script>

<template>
  <div class="screen scene-edit">
    <header class="screen-head coil-sheet__head">
      <div class="coil-sheet__title">
        <router-link class="icon-btn" :to="{ name: 'coilScenes' }" :title="$t('scenes.back')" :aria-label="$t('scenes.back')"><i
            class="fas fa-arrow-left"></i></router-link>
        <input v-model="draft.name" class="coil-sheet__name" type="text" maxlength="40" :aria-label="$t('scenes.name')"
          :class="{ 'is-invalid': !nameOk }" :placeholder="$t('scenes.name')">
        <drop-menu trigger-class="scenes-chip" menu-class="scenes-list" :label="$t('scenes.decorPick')">
          <template #trigger><i class="fas" :class="DECOR_ICONS[draft.data.decor]"></i><span>{{ $t(`scenes.decor.${draft.data.decor}`) }}</span><i
              class="fas fa-chevron-down scenes-chip__dd"></i></template>
          <button v-for="d in DECOR_IDS" :key="d" class="dropdown__item" :class="{ 'is-on': d === draft.data.decor }" type="button" @click="setDecor(d)"><i class="fas"
              :class="DECOR_ICONS[d]"></i><span>{{ $t(`scenes.decor.${d}`) }}</span></button>
        </drop-menu>
      </div>
      <div class="coil-sheet__actions">
        <button class="icon-btn icon-btn--sm" type="button" :disabled="!canUndo" :title="`${$t('label.undo')} (Ctrl+Z)`" :aria-label="$t('label.undo')" @click="undo"><i
            class="fas fa-rotate-left"></i></button>
        <button class="icon-btn icon-btn--sm" type="button" :disabled="!canRedo" :title="`${$t('label.redo')} (Ctrl+Y)`" :aria-label="$t('label.redo')" @click="redo"><i
            class="fas fa-rotate-right"></i></button>
        <span v-if="dirty" class="coil-sheet__dirty"><i class="fas fa-circle"></i>{{ $t('coils.unsaved') }}</span>
        <drop-menu trigger-class="icon-btn icon-btn--sm" :label="$t('label.moreOptions')">
          <button class="dropdown__item" type="button" @click="duplicate"><i class="fas fa-copy"></i><span>{{ $t('scenes.duplicate') }}</span></button>
          <button class="dropdown__item is-danger" type="button" @click="confirmDelete = true"><i class="fas fa-trash"></i><span>{{ $t('label.delete') }}</span></button>
        </drop-menu>
        <button class="btn btn--volt" type="button" :disabled="(!dirty && draft.id != null) || saving || !nameOk" :title="$t('coils.saveShortcut')" @click="save">
          <span class="icon"><i class="fas" :class="saving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'"></i></span>{{ $t('label.save') }}
        </button>
      </div>
    </header>

    <div class="scenes-main">
      <div class="scenes-stage">
        <div ref="view" class="scenes-view"></div>
        <!-- the hand's tools, and what the picture shows -->
        <div v-if="shown.length" class="scenes-overlay">
          <div class="scenes-tools3d" role="toolbar" :aria-label="$t('scenes.tools.label')">
            <template v-for="(group, g) in TOOLS" :key="g">
              <span v-if="g" class="scenes-tools3d__sep" aria-hidden="true"></span>
              <button v-for="x in group" :key="x.id" type="button" :class="{ 'is-on': tool === x.id }" :aria-pressed="tool === x.id"
                :title="`${$t(`scenes.tools.${x.id}`)} (${x.key.toUpperCase()}) · ${$t(`scenes.tools.${x.id}Hint`)}`" :aria-label="$t(`scenes.tools.${x.id}`)"
                @click="tool = x.id"><outlet-icon v-if="!x.icon" /><i v-else class="fas" :class="x.icon"></i></button>
            </template>
          </div>
          <div class="scenes-overlay__end">
            <segmented-control v-model="setting" class="scenes-setting" :options="settingOptions" :aria-label="$t('coils.view3d.setting')" />
            <button class="scenes-tools3d__one" type="button" :title="`${$t('scenes.reframe')} (F)`" :aria-label="$t('scenes.reframe')"
              @click="scene3d?.reframe()"><i class="fas fa-expand"></i></button>
          </div>
        </div>
        <p v-if="failed" class="scenes-note">{{ $t('coils.view3d.failed') }}</p>
        <p v-else-if="!shown.length" class="scenes-note">{{ $t('scenes.noCoil') }}</p>
      </div>

      <!-- the scene's coils and accessories, then the chosen one's settings -->
      <aside class="scene-panel">
        <h4 class="scene-panel__title">{{ $t('scenes.panel.contents') }}</h4>
        <ul class="scene-panel__rows">
          <li v-for="(x, k) in shown" :key="x.p.coil">
            <button class="scene-row" :class="{ 'is-on': sel === k }" type="button" :aria-pressed="sel === k" @click="choose(sel === k ? null : k)">
              <i class="scene-panel__cap" :style="{ '--c': capOf(x.p.coil) }"></i>
              <span class="scene-row__name">{{ x.coil!.name }}</span>
              <span class="scene-row__marks">
                <i v-if="x.p.hang" class="fas fa-arrow-down" :title="$t('scenes.panel.hung')"></i>
                <span :title="$t('scenes.panel.tubes')"><outlet-icon />{{ x.p.tubes.length }}</span>
                <i v-if="x.p.ring" class="fas fa-ring" :title="$t('scenes.props.ring')"></i>
              </span>
            </button>
          </li>
        </ul>
        <p v-if="missing" class="scene-panel__missing">{{ $t('scenes.missing', missing) }}</p>
        <ul v-if="BOX_KINDS.some((kind) => boxesOf(kind).length)" class="scene-panel__rows">
          <template v-for="kind in BOX_KINDS" :key="kind">
            <li v-for="(c, k) in boxesOf(kind)" :key="`${kind}${k}`">
              <button class="scene-row" :class="{ 'is-on': selBox?.kind === kind && selBox.i === k }" type="button" :aria-pressed="selBox?.kind === kind && selBox.i === k"
                @click="chooseBox(kind, k)">
                <i class="fas scene-row__icon" :class="BOX_ICONS[kind]"></i>
                <span class="scene-row__name">{{ $t(`scenes.props.${kind}N`, { n: k + 1 }) }}</span>
                <span class="scene-row__marks">{{ sizeOf(kind, c) }}</span>
              </button>
            </li>
          </template>
        </ul>
        <div class="scene-panel__adds">
          <drop-menu trigger-class="scene-add" menu-class="scenes-list" :label="$t('scenes.panel.addCoil')">
            <template #trigger><i class="fas fa-plus"></i><span>{{ $t('scenes.panel.coil') }}</span></template>
            <button v-for="c in free" :key="c.uuid" class="dropdown__item" type="button" @click="addCoil(c.uuid)"><i class="scene-panel__cap"
                :style="{ '--c': capOf(c.uuid) }"></i><span>{{ c.name }}</span></button>
            <p v-if="!free.length" class="dropdown__empty">{{ $t('scenes.panel.allIn') }}</p>
          </drop-menu>
          <drop-menu trigger-class="scene-add" menu-class="scenes-list" :label="$t('scenes.props.add')">
            <template #trigger><i class="fas fa-plus"></i><span>{{ $t('scenes.props.title') }}</span></template>
            <button v-for="kind in BOX_KINDS" :key="kind" class="dropdown__item" type="button" @click="addBox(kind)"><span>{{
              $t(`scenes.props.${kind}`) }}</span></button>
          </drop-menu>
        </div>

        <scene-coil-panel v-if="selected" :key="selected.i" :pose="selected.p" :spec="PhySpec.resolve(selected.coil!.spec)" :name="selected.coil!.name"
          :tube="selTube" @change="(p, key) => setPose(sel!, p, key)" @tube="chooseTube" @tool="tool = $event" @remove="removeCoil" />
        <div v-else-if="box && selBox" :key="`${selBox.kind}${selBox.i}`" class="scene-insp">
          <header class="scene-insp__head">
            <b>{{ $t(`scenes.props.${selBox.kind}N`, { n: selBox.i + 1 }) }}</b>
            <button class="icon-btn icon-btn--sm" type="button" :title="$t('scenes.props.remove')" :aria-label="$t('scenes.props.remove')" @click="removeBox"><i
                class="fas fa-trash"></i></button>
          </header>
          <section class="scene-insp__sec">
            <div class="scene-insp__grid">
              <coil-field :label="$t('scenes.panel.x')" unit="m" :digits="2" :min="-6" :max="6" :model-value="box.x" @update:model-value="editBox('x', $event)" />
              <coil-field :label="$t('scenes.panel.z')" unit="m" :digits="2" :min="-4" :max="4" :model-value="box.z" @update:model-value="editBox('z', $event)" />
              <coil-field :label="$t('scenes.panel.rot')" unit="°" :digits="0" :min="-180" :max="180" :model-value="box.rot" @update:model-value="editBox('rot', $event)" />
              <coil-field v-if="selBox.kind !== 'knight'" :label="$t(selBox.kind === 'counter' ? 'scenes.panel.length' : 'scenes.props.w')" unit="m" :digits="2" :min="0.1"
                :max="selBox.kind === 'counter' ? 1.5 : 6" :model-value="box.w" @update:model-value="editBox('w', $event)" />
              <coil-field v-if="selBox.kind === 'cage' || selBox.kind === 'table'" :label="$t('scenes.props.d')" unit="m" :digits="2" :min="0.1" :max="6" :model-value="box.d"
                @update:model-value="editBox('d', $event)" />
              <coil-field :label="$t('scenes.props.h')" unit="m" :digits="2" :min="H_RANGE[selBox.kind][0]" :max="H_RANGE[selBox.kind][1]" :model-value="box.h"
                @update:model-value="editBox('h', $event)" />
            </div>
          </section>
        </div>
      </aside>
    </div>

    <confirm-modal :open="confirmDelete" :title="$t('scenes.deleteTitle', { name: draft.name })" warn :message="$t('scenes.deleteMessage')"
      :confirm-label="$t('label.delete')" :cancel-label="$t('label.cancel')" @confirm="remove" @close="confirmDelete = false" />
    <confirm-modal :open="leavePending" :title="$t('label.unsavedChanges')" :message="$t('scenes.discard')"
      :confirm-label="$t('label.discard')" :cancel-label="$t('label.cancel')" @confirm="answerLeave(true)" @close="answerLeave(false)" />
  </div>
</template>
