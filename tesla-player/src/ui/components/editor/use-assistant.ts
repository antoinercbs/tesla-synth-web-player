import { computed, reactive, ref, watch, type Ref } from 'vue';
import type { CoilConfig, MidiFile } from '@/model/domain';
import type { CoilSpec } from '@/model/coils/spec';
import type { MidiAnalysis } from '@/model/midi/analyze';
import type { ChannelProfile, ChannelRole } from '@/model/calib/roles';
import { CalSong, type CalibRequest, type CalibResult, type HwLimits, type Limits } from '@/model/calib';
import { CalAssistant, type Intention, type PadPos, type Preset } from '@/model/calib/assistant';
import { SongDraft } from '@/model/songs/draft';
import { calRunner, Superseded } from '@/engine/calib/run';
import { fileUrl } from '@/app/song-file';
import { notify } from '@/ui/helpers/toast';

export interface AssistantInputs {
  draft: SongDraft;
  analysis: Ref<MidiAnalysis | null>;
  /** The channels, their roles and envelopes as set here. */
  profiles: Ref<ChannelProfile[]>;
  songCoils: Ref<CoilConfig[]>;
  /** By place: the limits and the sheet of its coil. */
  places: Ref<{ limits: Limits[]; specs: (CoilSpec | null)[] }>;
  file: Ref<MidiFile | null>;
  hw: () => HwLimits | null;
  /** Its tab is open: it works out the pads even while it drives nothing. */
  open: () => boolean;
}

/**
 * The Assistant in the atelier: it sets the coils from the song itself
 * (model/calib/), in its worker. While the coils stay as it last wrote them,
 * it drives them: what it needs changed, it computes and applies again.
 */
export function useAssistant(i: AssistantInputs) {
  const { draft } = i;
  const assist = reactive({
    result: null as CalibResult | null,
    /** The inputs `result` was computed from. */
    key: '',
    busy: false,
    intention: 'clean' as Intention,
    preset: 'balanced' as Preset,
    pads: { clean: [] as PadPos[], loud: [] as PadPos[] },
    priority: true,
    /** The routing is the user's: the Assistant sets the numbers on it. */
    routingKept: false,
    /** The next result goes into the draft (a new song, "calibrate", a change while it drives). */
    applyNext: false,
    /** A role per coil, for this song only (null: the Assistant's choice); never saved. */
    coilRoles: [] as (ChannelRole | null)[],
  });
  // the coils as the Assistant last wrote them: while they stay so, it drives them
  const lastApplied = ref('');
  const coilsKey = (coils: readonly CoilConfig[] = i.songCoils.value): string => JSON.stringify(coils.map((c) => [c.channelMask, c.ontimeUs, c.duty]));
  const driven = computed(() => lastApplied.value !== '' && lastApplied.value === coilsKey());

  /** Another song: it starts from nothing. */
  function reset(): void {
    Object.assign(assist, {
      result: null, key: '', busy: false, intention: 'clean', preset: 'balanced', pads: { clean: [], loud: [] },
      priority: true, routingKept: false, applyNext: false, coilRoles: [],
    });
    lastApplied.value = '';
  }
  /** Another way of the song opened: it starts over on its coils. */
  function restart(): void {
    lastApplied.value = '';
    Object.assign(assist, { result: null, key: '', applyNext: false, routingKept: false, coilRoles: [] });
  }

  // the places' sheets, plain: they go to the Assistant's worker
  const limits = computed(() => i.places.value.limits);
  const specs = computed(() => JSON.parse(JSON.stringify(i.places.value.specs)) as (CoilSpec | null)[]);
  /** The song on its places' coils, as the searches take it; null without notes. */
  const song = computed(() => {
    const a = i.analysis.value;
    return a?.notes.length ? CalSong.fromAnalysis(a, limits.value, specs.value) : null;
  });
  const coilRoles = (): (ChannelRole | null)[] => Array.from({ length: draft.coilCount }, (_, k) => assist.coilRoles[k] ?? null);
  function request(): CalibRequest | null {
    const a = i.analysis.value;
    if (!a?.notes.length) return null;
    return {
      durationMs: a.durationMs,
      notes: CalSong.notesOfAnalysis(a),
      profiles: i.profiles.value.map((p) => ({ ...p, why: [...p.why] })),
      coilCount: draft.coilCount,
      limits: limits.value,
      specs: specs.value,
      hw: i.hw(),
      masks: assist.routingKept ? i.songCoils.value.map((c) => c.channelMask) : undefined,
      coilRoles: coilRoles(),
    };
  }
  const key = computed(() => JSON.stringify({
    file: i.file.value ? fileUrl(i.file.value) : null,
    n: draft.coilCount,
    roles: i.profiles.value.map((p) => p.role),
    limits: limits.value,
    specs: specs.value,
    programs: draft.programs,
    masks: assist.routingKept ? i.songCoils.value.map((c) => c.channelMask) : null,
    coilRoles: coilRoles(),
  }));

  const plan = computed(() => assist.result?.[assist.intention] ?? null);
  const proposals = computed(() => (plan.value
    ? CalAssistant.proposal(plan.value, assist.pads[assist.intention], i.profiles.value, { priority: assist.priority, intention: assist.intention })
    : []));

  /** Its coils into the draft. */
  function apply(): void {
    if (!plan.value) return;
    draft.coils = proposals.value.map((p, k) => ({ ...(draft.coils[k] ?? SongDraft.newCoil(k)), coilIndex: k, channelMask: p.channelMask, ontimeUs: p.ontimeUs, duty: p.duty }));
    lastApplied.value = coilsKey();
  }

  let seq = 0;
  async function calibrate(): Promise<void> {
    const req = request();
    if (!req) return;
    const k = key.value;
    const run = ++seq;
    assist.busy = true;
    try {
      const res = await calRunner.run(req);
      if (k !== key.value) return;
      assist.result = res;
      assist.key = k;
      if (assist.applyNext) {
        assist.applyNext = false;
        // a preset follows the new numbers; spots picked by hand stay where they were
        assist.pads[assist.intention] = assist.preset !== 'custom'
          ? new CalAssistant(res).presetPads(assist.intention, assist.preset)
          : res[assist.intention].pick.map((p, c) => assist.pads[assist.intention][c] ?? p);
        apply();
      } else {
        // where the setting in the editor sits on the pads
        const placed = new CalAssistant(res).placeSetting(i.songCoils.value);
        assist.intention = placed.intention;
        assist.pads = placed.pads;
        assist.preset = new CalAssistant(res).presetOf(placed.intention, placed.pads[placed.intention]);
      }
    } catch (err) {
      if (err instanceof Superseded) return;
      console.error('Calibration failed', err);
      notify('atelier.assist.failed', 'error');
    } finally {
      if (run === seq) assist.busy = false;
    }
  }
  // what it needs changed: computed again, applied again while it drives the coils
  watch(key, () => {
    if (!i.analysis.value) return;
    if (driven.value || assist.applyNext) {
      assist.applyNext = true;
      calibrate();
    } else if (i.open()) {
      calibrate();
    } else {
      assist.result = null;
    }
  });
  watch([i.open, i.analysis], () => {
    if (i.open() && i.analysis.value && (!assist.result || assist.key !== key.value || assist.applyNext)) calibrate();
  }, { immediate: true });

  function setIntention(v: Intention): void {
    if (!assist.result) return;
    assist.intention = v;
    assist.preset = v === 'clean' ? 'balanced' : 'loud';
    assist.pads[v] = new CalAssistant(assist.result).presetPads(v, assist.preset);
    apply();
  }
  function setPreset(p: Preset): void {
    if (!assist.result) return;
    assist.preset = p;
    assist.pads[assist.intention] = new CalAssistant(assist.result).presetPads(assist.intention, p);
    apply();
  }
  function setPad(k: number, pos: PadPos): void {
    const pads = [...assist.pads[assist.intention]];
    pads[k] = pos;
    assist.pads[assist.intention] = pads;
    assist.preset = assist.result ? new CalAssistant(assist.result).presetOf(assist.intention, pads) : 'custom';
    apply();
  }
  function setPriority(v: boolean): void {
    assist.priority = v;
    apply();
  }
  /** A role for a coil: it routes again around it, and sets the coils. */
  function setCoilRole(k: number, role: ChannelRole | null): void {
    const roles = coilRoles();
    roles[k] = role;
    assist.coilRoles = roles;
    assist.routingKept = false;
    assist.applyNext = true;
  }
  /** The place `k` gone: its role goes with it. */
  function dropPlace(k: number): void {
    assist.coilRoles = assist.coilRoles.filter((_, c) => c !== k);
  }
  /** Its next result goes into the draft. */
  function applyNext(): void {
    assist.applyNext = true;
  }
  function reroute(): void {
    assist.routingKept = false;
    assist.applyNext = true;
    calibrate();
  }
  /** The routing changed by hand: it sets the numbers on it, at once while it drove the coils (`wasDriven`). */
  function routed(wasDriven: boolean): void {
    assist.routingKept = true;
    if (wasDriven) {
      assist.applyNext = true;
      calibrate();
    }
  }
  /** The coil count changed from `old`: it drove the coils as they were, it sets the new ones too. */
  function recounted(old: number): void {
    if (lastApplied.value && lastApplied.value === coilsKey(draft.coils.slice(0, old))) assist.applyNext = true;
  }

  return {
    assist, driven, song, proposals, coilRoles,
    reset, restart, applyNext, reroute, routed, recounted, dropPlace,
    setIntention, setPreset, setPad, setPriority, setCoilRole,
  };
}
