import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CEILING, type BoxKind, type DecorId } from '@/model/coils/scene-data';
import type { PhySceneThings, ThingsData } from '@/model/coils/staging';
import { GfxCoil, type GfxCoilHost } from '../coil/coil';
import { gfxDecor, type GfxDecor } from '../decor';
import { disposeTree } from '../dispose';
import { GFX_PALETTE } from '../palette';
import { GfxProps, type PropHit } from '../props/props';
import { GfxShared } from '../shared';
import type { ArcState, SceneColors, SceneEditing, SceneTool, StageCoil } from '../types';
import { GfxBudget, PIXEL_RATIO_CAP } from './budget';
import { GfxEditor } from './editor';
import { GfxOrbit, type OrbitAim } from './orbit';

// frames drawn after a change: the arcs' last image cleared, a handle let go settled
const WAKE_MS = 600;

export interface GfxSceneOptions {
  /** The hand turns, slides and zooms the view, and sets a scene; false: a camera on a stand (aim), nothing to drag. */
  hand?: boolean;
}

/**
 * Coils in 3D, each drawn from its sheet and posed as its scene says
 * (GfxCoil), in a décor (GfxDecor: the dark hall when there is no scene),
 * with the scene's things on the floor (GfxProps). No bloom nor shadows: they
 * cost more frames than they add (the sparks' halos stand for the bloom).
 *
 * One coil (its sheet), a stage of them (the player), or a scene being set
 * (the Scènes tab: handles on the picture, GfxEditor). Each coil's arcs are
 * set from outside: their reach (each tube's), their bang rate, how much
 * energy each bang has (a weak one violet, a strong one white), and whether
 * they strike (the physics says so).
 *
 * A picture of the real thing: copper, aluminium and the sparks keep their own
 * colours (GFX_PALETTE); the mats take the theme's lines, the chosen handle
 * its accent (SceneColors). Drag to turn, right or middle button to slide,
 * wheel to zoom.
 *
 * Drawn only while something moves (a hand on it, arcs, a lone coil turning,
 * the knights, a change a moment ago): a still picture costs the page nothing.
 */
export class GfxScene implements GfxCoilHost {
  readonly scene = new THREE.Scene();
  readonly orbit = new GfxOrbit();
  readonly shared = new GfxShared();
  readonly props = new GfxProps(this.shared);
  coils: GfxCoil[] = [];
  /** Each coil's reach drawn around its tip: the coil sheet's view. */
  reachRing = false;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly envMap: THREE.Texture;
  private readonly budget: GfxBudget;
  private readonly editor: GfxEditor;
  private decor: GfxDecor | null = null;
  private decorId: DecorId | null | undefined;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  private drag: { x: number; y: number; yaw: number; pitch: number; pan: THREE.Vector3 | null; empty: boolean } | null = null;
  private lastArc = 0;
  private idle = 0;
  private raf = 0;
  private wakeUntil = 0;
  private autoTurn = true;
  private visible = true;
  private readonly io: IntersectionObserver;
  private readonly ro: ResizeObserver;

  /** Mounted in `el`. */
  constructor(private readonly el: HTMLElement, readonly colors: SceneColors, o: GfxSceneOptions = {}) {
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer = renderer;
    renderer.setPixelRatio(Math.min(PIXEL_RATIO_CAP, window.devicePixelRatio || 1));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // the frame's size from the start: a view mounted before its layout settles would keep the canvas's default
    Object.assign(renderer.domElement.style, { display: 'block', width: '100%', height: '100%' });
    el.appendChild(renderer.domElement);
    // the metals' reflections: a room's light, faint
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    const scene = this.scene, light = GFX_PALETTE.light;
    scene.environment = this.envMap;
    scene.environmentIntensity = 0.2;
    scene.add(new THREE.HemisphereLight(light.sky, light.ground, 0.9));
    const key = new THREE.DirectionalLight(light.key, 1.5);
    key.position.set(3, 5, 4);
    const fill = new THREE.DirectionalLight(light.fill, 0.6);
    fill.position.set(-4, 2, -3);
    scene.add(key, fill);
    this.setDecor(null);
    scene.add(this.props.group);
    const h = GFX_PALETTE.handle;
    this.editor = new GfxEditor(this, { grip: h.grip, bright: h.bright, size: h.size, chosen: colors.handle ?? h.chosen });
    scene.add(this.editor.handles);
    this.budget = new GfxBudget(renderer, this.resize);

    if (o.hand === false) this.autoTurn = false;
    else {
      el.addEventListener('pointerdown', this.onDown);
      el.addEventListener('pointermove', this.onMove);
      el.addEventListener('pointerup', this.onUp);
      el.addEventListener('wheel', this.onWheel, { passive: false });
      el.addEventListener('contextmenu', this.onMenu);
    }
    this.io = new IntersectionObserver((es) => {
      this.visible = es[0].isIntersecting;
      if (this.visible) this.wake();
    });
    this.io.observe(el);
    this.ro = new ResizeObserver(this.resize);
    this.ro.observe(el);
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** The scene's things, as the physics sees them. */
  get things(): PhySceneThings {
    return this.props.things;
  }

  get ceiling(): number {
    return this.decor?.ceiling ?? CEILING;
  }

  pixelAt(p: THREE.Vector3): number {
    return this.orbit.pixelAt(p);
  }

  bangsCap(): number {
    return this.budget.bangsCap(this.coils.length);
  }

  /** The coils, in a décor (undefined: the one already there; null: the dark hall), with the scene's things on the floor; framed unless `keepView` (a scene being set). */
  setCoils(list: readonly StageCoil[], decor?: DecorId | null, keepView = false, props: ThingsData = {}): void {
    const keep = this.coils.map((c) => c.state);
    for (const c of this.coils) c.dispose();
    if (decor !== undefined) this.setDecor(decor);
    this.props.set(props);
    this.editor.prune();
    this.coils = [];
    this.coils = list.map((sc, i) => this.addCoil(sc, list.length > 1, keep[i] ?? { on: false, reach: 0, strike: 'air' }, true));
    if (!keepView) this.orbit.frame(this.coils);
    for (const c of this.coils) c.draw();
    this.editor.place();
    this.wake();
  }

  /** Frame them all again. */
  reframe(): void {
    this.orbit.frame(this.coils);
    this.wake();
  }

  /** One coil's arcs, from now on. */
  setArcs(i: number, arcs: ArcState): void {
    const c = this.coils[i];
    if (!c) return;
    c.state = arcs;
    this.wake();
  }

  /** On a stand from now on (GfxOrbit.aim): the coils no longer frame it, nor does it turn by itself. */
  aim(a: OrbitAim): void {
    this.orbit.aim(a);
    this.autoTurn = false;
    this.wake();
  }

  /** A coil's arcs in this image, each a path of points in the view as fractions of its width and height from its top left. */
  arcsInView(i: number): { x: number; y: number }[][] {
    const cam = this.orbit.camera, v = new THREE.Vector3();
    this.orbit.place();
    cam.updateMatrixWorld();
    return (this.coils[i]?.arcPaths ?? []).map((pts) => pts.map((p) => {
      v.copy(p).project(cam);
      return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
    }));
  }

  /** Something changed in the picture: frames are drawn for a moment. */
  wake(ms = WAKE_MS): void {
    this.wakeUntil = Math.max(this.wakeUntil, performance.now() + ms);
  }

  /** Whether a strike is drawn on a coil now. */
  striking(i: number): boolean {
    return !!this.coils[i]?.striking;
  }

  /** The coil under a point of the page (client px); null: none. */
  pick(x: number, y: number): number | null {
    return this.pickCoil(x, y)?.i ?? null;
  }

  /** Handles on the picture to set a scene; null: none. */
  edit(handlers: SceneEditing | null): void {
    this.editor.edit(handlers);
    this.wake();
  }

  /** The coil whose handles show, and its tube; null: none. */
  select(i: number | null, tube = 0): void {
    this.editor.select(i, tube);
    this.wake();
  }

  /** The tool the hand holds. */
  tool(t: SceneTool): void {
    this.editor.tool(t);
    this.wake();
  }

  /** The thing whose handles show; null: none (a coil's do, or nothing). */
  selectBox(kind: BoxKind | null, i = 0): void {
    this.editor.selectBox(kind, i);
    this.wake();
  }

  /** A coil changed by hand: drawn again now, its field worked out once let go. */
  reshape(i: number, sc: StageCoil, done: boolean): void {
    const old = this.coils[i];
    old.dispose();
    this.coils[i] = this.addCoil(sc, this.coils.length > 1, old.state, done);
    this.coils[i].draw();
    this.editor.place();
    this.editor.handlers?.change(i, sc, done);
    this.wake();
  }

  /** The ray under a point of the page; null: the view has no size yet. */
  rayAt(x: number, y: number): THREE.Raycaster | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    this.pointer.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.orbit.camera);
    return this.raycaster;
  }

  /** The coil under a point of the page, and where the ray meets it. */
  pickCoil(x: number, y: number): { i: number; at: THREE.Vector3 } | null {
    const rc = this.rayAt(x, y);
    if (!rc) return null;
    let best: { i: number; at: THREE.Vector3 } | null = null, bestD = Infinity;
    this.coils.forEach((c, i) => {
      const at = rc.ray.intersectBox(c.body.box, new THREE.Vector3()), d = at ? at.distanceTo(this.orbit.camera.position) : Infinity;
      if (at && d < bestD) {
        bestD = d;
        best = { i, at };
      }
    });
    return best;
  }

  /** The thing on the floor under a point of the page, nearer than `than` (m from the eye). */
  pickProp(x: number, y: number, than = Infinity): PropHit | null {
    const rc = this.rayAt(x, y);
    return rc ? this.props.pick(rc.ray, this.orbit.camera.position, than) : null;
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.io.disconnect();
    this.ro.disconnect();
    const el = this.el;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('contextmenu', this.onMenu);
    for (const c of this.coils) c.dispose();
    this.editor.dispose();
    this.props.dispose();
    this.decor?.dispose();
    disposeTree(this.scene, (m) => this.shared.owns(m));
    this.shared.dispose();
    this.envMap.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private addCoil(sc: StageCoil, many: boolean, state: ArcState, withField: boolean): GfxCoil {
    const c = new GfxCoil(sc, this, { many, state, withField });
    this.scene.add(c.group);
    return c;
  }

  private setDecor(id: DecorId | null): void {
    if (this.decor && this.decorId === id) return;
    this.decor?.dispose();
    const d = gfxDecor(id);
    this.decor = d;
    this.decorId = id;
    this.scene.add(d.group);
    this.scene.background = new THREE.Color(d.background);
    this.scene.fog = d.fog ? new THREE.FogExp2(d.background, d.fog) : null;
  }

  private readonly resize = (): void => {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.orbit.resize(w, h);
    this.wake();
  };

  private readonly frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    this.idle += 1;
    // a lone coil turns slowly when left alone; a stage stays facing the audience, a scene being set too
    const turning = !this.drag && !this.still && this.autoTurn && !this.editor.handlers && this.coils.length === 1 && this.idle > 120;
    const moving = turning || !!this.drag || now < this.wakeUntil || this.coils.some((c) => c.state.on) || (!this.still && this.props.animated);
    if (!this.visible || !moving) {
      this.budget.frame(null);
      return;
    }
    this.budget.frame(now);
    if (turning) this.orbit.yaw += 0.0025;
    this.orbit.place();
    if (!this.still) this.props.animate(now / 1000);
    this.editor.scale();
    for (const c of this.coils) c.light();
    if (now - this.lastArc > this.budget.imageMs(this.still)) {
      const t0 = performance.now();
      for (const c of this.coils) c.draw();
      this.budget.arcsTook(performance.now() - t0);
      this.lastArc = now;
    }
    this.budget.adapt(now);
    this.renderer.render(this.scene, this.orbit.camera);
  };

  private readonly onDown = (e: PointerEvent): void => {
    this.idle = 0;
    this.autoTurn = false;
    this.wake();
    // right or middle button: the view slides, whatever is under the hand
    const pan = e.button === 1 || e.button === 2;
    if (!pan && e.button === 0 && this.editor.grab(e)) return;
    // on nothing at all: let go when it was a click, not a turn of the view
    const empty = !pan && !!this.editor.handlers && this.pickCoil(e.clientX, e.clientY) == null && this.pickProp(e.clientX, e.clientY) == null;
    this.drag = { x: e.clientX, y: e.clientY, yaw: this.orbit.yaw, pitch: this.orbit.pitch, pan: pan ? this.orbit.target.clone() : null, empty };
    this.el.setPointerCapture(e.pointerId);
  };

  private readonly onMove = (e: PointerEvent): void => {
    const d = this.drag;
    // a handle under the hand lights up
    if (d || this.editor.handlers) this.wake();
    if (!d) {
      // the cursor tells what a drag would do there
      const cursor = this.editor.cursor(e);
      if (cursor != null) this.el.style.cursor = cursor;
      return;
    }
    if (d.pan) this.orbit.pan(d.pan, e.clientX - d.x, e.clientY - d.y);
    else this.orbit.turn(d, e.clientX - d.x, e.clientY - d.y);
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (this.drag?.empty && Math.hypot(e.clientX - this.drag.x, e.clientY - this.drag.y) < 4) this.editor.deselect();
    this.drag = null;
    this.wake();
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.orbit.zoom(e.deltaY);
    this.idle = 0;
    this.wake();
  };

  private readonly onMenu = (e: Event): void => e.preventDefault();
}
