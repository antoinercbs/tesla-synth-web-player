<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMidiStore } from '@/stores/midi';
import { coilColor } from '@/ui/coil-colors';
import { noteHzLabel, noteName } from '@/ui/piano-layout';
import SegmentedControl from '@/components/ui/SegmentedControl.vue';
import ArcHeatmap from './ArcHeatmap.vue';
import LocationMap from './LocationMap.vue';
import TapRulerChart from './TapRulerChart.vue';
import { formatTurns, type Trial, type TuningRecord } from './api';
import { bestTrial } from './suggest';
import { weatherFamily, weatherIcon } from './weather';

/**
 * The History tab: every saved tuning, across coils, with a coil filter and a
 * place search; a row opens into the full record (map, trials curve on the
 * primary, silhouettes, tone, comment). "Use this position" hands the tap back
 * to the tuning tool.
 */
const props = defineProps<{ items: TuningRecord[]; loading: boolean }>();
const emit = defineEmits<{ (e: 'recall', item: TuningRecord): void; (e: 'delete', item: TuningRecord): void }>();
const { t, locale } = useI18n();
const midiStore = useMidiStore();

const coilFilter = ref<number>(-1);
const search = ref('');
const openId = ref<number | null>(null);

const coilOptions = computed(() => {
  const present = new Set(props.items.map((i) => i.coilIndex));
  const opts: { value: number; label: string }[] = [{ value: -1, label: t('tune.hist.allCoils') }];
  for (const i of [...present].sort((a, b) => a - b)) opts.push({ value: i, label: midiStore.coilName(i) || `${t('tune.coilN')} ${i + 1}` });
  return opts;
});
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return props.items
    .filter((i) => coilFilter.value < 0 || i.coilIndex === coilFilter.value)
    .filter((i) => !q || (i.location ?? '').toLowerCase().includes(q) || (i.comment ?? '').toLowerCase().includes(q) || (i.coilName ?? '').toLowerCase().includes(q))
    .sort((a, b) => b.createdAt - a.createdAt);
});
function date(ms: number): string {
  return new Date(ms).toLocaleString(locale.value, { dateStyle: 'medium', timeStyle: 'short' });
}
function coilLabel(i: TuningRecord): string {
  return midiStore.coilName(i.coilIndex) || i.coilName || `${t('tune.coilN')} ${i.coilIndex + 1}`;
}
function trialsOf(i: TuningRecord): Trial[] { return Array.isArray(i.trials) ? i.trials : []; }
function toneText(i: TuningRecord): string {
  const tn = i.tone;
  if (!tn) return '—';
  const notes = (tn.notes ?? []).map((n) => `${noteName(n)} ${noteHzLabel(n)}`).join(', ');
  return `${notes} · ${(tn.holdMs / 1000).toFixed(0)} s / ${(tn.gapMs / 1000).toFixed(1)} s · ${tn.ontimeUs} µs · ${(tn.duty * 100).toFixed(1)} %`;
}
function toggle(i: TuningRecord): void { openId.value = openId.value === i.id ? null : i.id; }
</script>

<template>
  <div class="hist-view">
    <div class="hist-toolbar">
      <segmented-control v-model="coilFilter" pressed :options="coilOptions" :aria-label="t('tune.coil')" />
      <input class="text-field hist-search" type="search" v-model="search" :placeholder="t('tune.hist.search')" />
      <span class="dim mono">{{ t('tune.hist.count', { n: filtered.length }) }}</span>
      <span v-if="loading" class="dim"><i class="fas fa-spinner fa-spin"></i></span>
    </div>

    <p v-if="!loading && !filtered.length" class="hist-empty">{{ t('tune.hist.empty') }}</p>

    <div v-else class="hist-table-wrap">
      <table class="hist-table">
        <thead>
          <tr>
            <th>{{ t('tune.hist.date') }}</th>
            <th>{{ t('tune.hist.coil') }}</th>
            <th>{{ t('tune.hist.place') }}</th>
            <th class="num">{{ t('tune.hist.tap') }}</th>
            <th class="num">{{ t('tune.hist.arc') }}</th>
            <th>{{ t('tune.hist.conditions') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="it in filtered" :key="it.id">
            <tr class="hist-row" :class="{ 'is-open': openId === it.id }" @click="toggle(it)">
              <td class="mono nowrap">{{ date(it.createdAt) }}</td>
              <td class="nowrap"><span class="coil-dot" :style="{ background: coilColor(it.coilIndex) }"></span>{{ coilLabel(it) }}</td>
              <td class="hist-place">{{ it.location || (it.lat != null ? `${it.lat.toFixed(4)}, ${it.lon?.toFixed(4)}` : '—') }}</td>
              <td class="num mono strong">{{ formatTurns(it.tapTurns, it.tapStep ?? 0.125) }} tr</td>
              <td class="num mono">{{ it.bestPx != null ? it.bestPx.toFixed(0) + ' px' : '—' }}</td>
              <td class="mono">
                <div class="hist-cond">
                <span v-if="it.indoor != null" :title="it.indoor ? t('tune.form.indoor') : t('tune.form.outdoor')"><i class="fas" :class="it.indoor ? 'fa-warehouse' : 'fa-tree'"></i></span>
                <span v-if="it.weatherCode != null" :title="t('tune.weather.' + weatherFamily(it.weatherCode))"><i class="fas" :class="weatherIcon(it.weatherCode)"></i></span>
                <span v-if="it.tempC != null">{{ it.tempC.toFixed(0) }} °C</span>
                <span v-if="it.humidityPct != null">{{ it.humidityPct.toFixed(0) }} %</span>
                <span v-if="it.ground" :title="it.ground === 'wet' ? t('tune.form.wet') : t('tune.form.dry')"><i class="fas" :class="it.ground === 'wet' ? 'fa-droplet' : 'fa-sun'"></i></span>
                </div>
              </td>
              <td class="hist-actions" @click.stop>
                <div class="hist-actions__inner">
                  <button class="btn btn--ghost btn--xs" type="button" @click="emit('recall', it)"><span class="icon"><i class="fas fa-crosshairs"></i></span>{{ t('tune.recall') }}</button>
                  <button class="icon-btn icon-btn--sm" type="button" :title="t('label.delete')" @click="emit('delete', it)"><i class="fas fa-trash"></i></button>
                  <i class="fas hist-chevron" :class="openId === it.id ? 'fa-chevron-up' : 'fa-chevron-down'"></i>
                </div>
              </td>
            </tr>
            <tr v-if="openId === it.id" class="hist-detail">
              <td colspan="7">
                <div class="hist-detail__grid">
                  <section class="hist-detail__block">
                    <h4>{{ t('tune.hist.place') }}</h4>
                    <location-map v-if="it.lat != null && it.lon != null" :lat="it.lat" :lon="it.lon" :interactive="false" height="200px" :zoom="14" />
                    <p v-else class="dim">{{ t('tune.form.noPosition') }}</p>
                    <p v-if="it.comment" class="hist-comment">{{ it.comment }}</p>
                    <p class="dim small">{{ t('tune.hist.tone') }} · {{ toneText(it) }}<template v-if="it.tone?.fiberIndex != null"> · {{ t('tune.fiber') }} {{ it.tone.fiberIndex }}</template></p>
                    <p v-if="it.editorName" class="dim small">{{ it.editorName }}</p>
                  </section>
                  <section class="hist-detail__block hist-detail__chart">
                    <h4>{{ t('tune.hist.trials', { n: trialsOf(it).length }) }}</h4>
                    <tap-ruler-chart v-if="trialsOf(it).length" :model-value="it.tapTurns" :interactive="false" :trials="trialsOf(it)" :notes="it.tone?.notes ?? []"
                      :min="it.tapMin ?? Math.max(0, it.tapTurns - 2)" :max="it.tapMax ?? it.tapTurns + 2" :step="it.tapStep ?? 0.125" :turns="it.primaryTurns ?? it.tapTurns"
                      :best="bestTrial(trialsOf(it))?.tapTurns ?? null"
                      :labels="{ score: t('tune.score'), empty: t('tune.chartEmpty'), tap: t('tune.tap'), length: t('tune.length'), best: t('tune.best'), previous: t('tune.previousHere'), suggested: t('tune.suggested'), turnsCaption: t('tune.turnsCaption', { n: it.primaryTurns ?? '?' }) }" />
                    <p v-else class="dim">{{ t('tune.hist.noTrials') }}</p>
                  </section>
                  <section class="hist-detail__block">
                    <h4>{{ t('tune.heat.title') }}</h4>
                    <div class="hist-heats">
                      <arc-heatmap v-for="tr in trialsOf(it).filter((x) => x.heat).slice(0, 6)" :key="tr.id" :heat="tr.heat ?? null" :width="120"
                        :title="`${formatTurns(tr.tapTurns, it.tapStep ?? 0.125)} tr · ${tr.score.toFixed(0)} px`" :overlay="false" />
                      <p v-if="!trialsOf(it).some((x) => x.heat)" class="dim">—</p>
                    </div>
                  </section>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.hist-view { display: flex; flex-direction: column; gap: 1rem; }
.hist-toolbar { display: flex; align-items: center; gap: 0.8rem; flex-wrap: wrap; }
.hist-search { max-width: 20rem; }
.hist-empty { color: var(--text-dim); background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 1.2rem; }
.hist-table-wrap { overflow-x: auto; background: linear-gradient(180deg, var(--panel-2), var(--panel)); border: 1px solid var(--line); border-radius: var(--radius); }
.hist-table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
.hist-table th, .hist-table td { padding: 0.6rem 0.9rem; border-bottom: 1px solid var(--line); text-align: left; vertical-align: middle; }
.hist-table thead th { font-family: var(--font-mono); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-mute); font-weight: 500; white-space: nowrap; }
.hist-table .num { text-align: right; }
.hist-row { cursor: pointer; transition: background 0.12s; }
.hist-row:hover td { background: var(--volt-05); }
.hist-row.is-open td { background: var(--volt-06); border-bottom-color: transparent; }
.nowrap { white-space: nowrap; }
.mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.strong { color: var(--volt); font-weight: 600; }
.dim { color: var(--text-dim); margin: 0; }
.small { font-size: 0.78rem; }
.coil-dot { display: inline-block; width: 0.6rem; height: 0.6rem; border-radius: 50%; margin-right: 0.45rem; vertical-align: middle; }
.hist-place { max-width: 22rem; }
.hist-cond { display: flex; gap: 0.7rem; align-items: center; color: var(--text-dim); font-size: 0.8rem; white-space: nowrap; }
.hist-actions { text-align: right; white-space: nowrap; }
.hist-actions__inner { display: inline-flex; align-items: center; gap: 0.5rem; }
.hist-chevron { color: var(--text-mute); margin-left: 0.3rem; font-size: 0.75rem; }
.btn--xs { padding: 0.25rem 0.6rem; font-size: 0.75rem; }
.icon-btn--sm { width: 1.9rem; height: 1.9rem; font-size: 0.75rem; }
.hist-detail td { background: var(--bg-2); padding: 1rem 1.1rem 1.2rem; }
.hist-detail__grid { display: grid; grid-template-columns: minmax(16rem, 22rem) minmax(0, 1fr) minmax(14rem, 20rem); gap: 1.2rem; align-items: start; }
@media (max-width: 1200px) { .hist-detail__grid { grid-template-columns: minmax(0, 1fr); } }
.hist-detail__block { display: flex; flex-direction: column; gap: 0.5rem; min-width: 0; }
.hist-detail__block h4 { margin: 0; font-family: var(--font-display); font-size: 0.74rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-mute); font-weight: 600; }
.hist-comment { margin: 0; white-space: pre-wrap; font-size: 0.9rem; }
.hist-heats { display: flex; flex-wrap: wrap; gap: 0.6rem; }
</style>
