<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import FormField from '@/components/ui/FormField.vue';
import SegmentedControl from '@/components/ui/SegmentedControl.vue';
import LocationMap from './LocationMap.vue';
import { formatTurns } from './api';
import { currentPosition, fetchCurrentWeather, reverseGeocode, weatherFamily, weatherIcon } from './weather';

/**
 * The last step of a tuning session: where, under which conditions, with which
 * comment. Position comes from the phone (or this device) and can be corrected
 * on the map; the weather can be fetched for that position; everything stays
 * editable. Emits `save` with the fields; the parent persists.
 */
export interface SaveFields {
  tapTurns: number;
  bestPx: number | null;
  location: string | null;
  lat: number | null;
  lon: number | null;
  indoor: boolean | null;
  tempC: number | null;
  humidityPct: number | null;
  pressureHpa: number | null;
  weatherCode: number | null;
  ground: 'dry' | 'wet' | null;
  comment: string | null;
}

const props = defineProps<{
  initial: SaveFields;
  step: number;
  saving: boolean;
  /** Fetch position + weather on mount when nothing is known yet. */
  autoFill?: boolean;
  /** Leave the Save button to the caller (the wizard's action bar). */
  hideActions?: boolean;
}>();
const emit = defineEmits<{ (e: 'save', fields: SaveFields): void }>();
const { t } = useI18n();

const f = reactive<SaveFields>({ ...props.initial });
watch(() => props.initial, (v) => Object.assign(f, v));

const setting = ref<'indoor' | 'outdoor' | 'unknown'>('unknown');
watch(() => f.indoor, (v) => { setting.value = v == null ? 'unknown' : v ? 'indoor' : 'outdoor'; }, { immediate: true });
watch(setting, (s) => { f.indoor = s === 'unknown' ? null : s === 'indoor'; });
const ground = ref<'dry' | 'wet' | 'unknown'>('unknown');
watch(() => f.ground, (v) => { ground.value = v ?? 'unknown'; }, { immediate: true });
watch(ground, (g) => { f.ground = g === 'unknown' ? null : g; });

const tapText = computed({
  get: () => String(f.tapTurns),
  set: (v: string) => { const n = parseFloat(v.replace(',', '.')); if (Number.isFinite(n)) f.tapTurns = n; },
});
const hasPos = computed(() => f.lat != null && f.lon != null);

const busyLocate = ref(false), busyWeather = ref(false), busyName = ref(false);
const weatherMsg = ref<string | null>(null);

async function locateHere(): Promise<void> {
  busyLocate.value = true;
  try {
    const p = await currentPosition();
    if (p) { f.lat = p.lat; f.lon = p.lon; if (!f.location) void fetchName(); }
  } finally { busyLocate.value = false; }
}
async function fetchName(): Promise<void> {
  if (!hasPos.value) return;
  busyName.value = true;
  try { const n = await reverseGeocode(f.lat!, f.lon!); if (n) f.location = n; } catch { /* offline */ } finally { busyName.value = false; }
}
async function fetchWeather(): Promise<void> {
  if (!hasPos.value) return;
  busyWeather.value = true; weatherMsg.value = null;
  try {
    const w = await fetchCurrentWeather(f.lat!, f.lon!);
    f.tempC = w.tempC; f.humidityPct = w.humidityPct; f.pressureHpa = w.pressureHpa; f.weatherCode = w.weatherCode;
    if (f.indoor == null) f.indoor = false;
    weatherMsg.value = t('tune.form.weatherFetched');
  } catch { weatherMsg.value = t('tune.form.weatherFailed'); } finally { busyWeather.value = false; }
}
// pre-fill what can be fetched: a position from this device if the phone gave none, then the weather
if (props.autoFill) {
  void (async () => {
    if (!hasPos.value) await locateHere();
    if (hasPos.value) { if (!f.location) await fetchName(); if (f.tempC == null) await fetchWeather(); }
  })();
}
function onMap(p: { lat: number; lon: number }): void { f.lat = p.lat; f.lon = p.lon; }
const numOrNull = (v: string | number | null | undefined): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const bestPx = computed({ get: () => f.bestPx ?? '', set: (v: string | number | null) => { f.bestPx = numOrNull(v); } });
const temp = computed({ get: () => f.tempC ?? '', set: (v: string | number | null) => { f.tempC = numOrNull(v); } });
const hum = computed({ get: () => f.humidityPct ?? '', set: (v: string | number | null) => { f.humidityPct = numOrNull(v); } });
const pres = computed({ get: () => f.pressureHpa ?? '', set: (v: string | number | null) => { f.pressureHpa = numOrNull(v); } });
const family = computed(() => weatherFamily(f.weatherCode));

function submit(): void {
  emit('save', { ...f, location: f.location?.trim() || null, comment: f.comment?.trim() || null });
}
defineExpose({ submit });
</script>

<template>
  <div class="save-grid">
    <section class="save-col">
      <div class="save-row">
        <form-field v-model="tapText" :label="t('tune.form.tapTurns')" type="text" :hint="formatTurns(f.tapTurns, step) + ' tr'" />
        <form-field v-model="bestPx" :label="t('tune.form.bestPx')" type="number" :hint="t('tune.form.bestPxHint')" />
      </div>
      <label class="form-field">
        <span class="tf-label">{{ t('tune.form.location') }}</span>
        <div class="save-inline">
          <input class="text-field" type="text" v-model="f.location" :placeholder="t('tune.form.locationPlaceholder')" />
          <button class="btn btn--ghost" type="button" :disabled="!hasPos || busyName" :title="t('tune.form.nameFromMap')" @click="fetchName"><i class="fas" :class="busyName ? 'fa-spinner fa-spin' : 'fa-signature'"></i></button>
          <button class="btn btn--ghost" type="button" :disabled="busyLocate" :title="t('tune.form.locate')" @click="locateHere"><i class="fas" :class="busyLocate ? 'fa-spinner fa-spin' : 'fa-location-crosshairs'"></i></button>
        </div>
        <span class="form-field__hint">{{ hasPos ? `${f.lat!.toFixed(5)}, ${f.lon!.toFixed(5)}` : t('tune.form.noPosition') }} · {{ t('tune.form.positionHint') }}</span>
      </label>
      <location-map :lat="f.lat" :lon="f.lon" height="240px" @update="onMap" />
    </section>

    <section class="save-col">
      <div class="save-field">
        <span class="tf-label">{{ t('tune.form.setting') }}</span>
        <segmented-control v-model="setting" pressed fill :options="[
          { value: 'outdoor', label: t('tune.form.outdoor'), icon: 'fa-tree' },
          { value: 'indoor', label: t('tune.form.indoor'), icon: 'fa-warehouse' },
          { value: 'unknown', label: '—' },
        ]" />
      </div>
      <div class="save-row three">
        <form-field v-model="temp" :label="t('tune.form.temp')" type="number" />
        <form-field v-model="hum" :label="t('tune.form.humidity')" type="number" />
        <form-field v-model="pres" :label="t('tune.form.pressure')" type="number" />
      </div>
      <div class="save-inline wrap">
        <button class="btn btn--ghost" type="button" :disabled="!hasPos || busyWeather" @click="fetchWeather">
          <span class="icon"><i class="fas" :class="busyWeather ? 'fa-spinner fa-spin' : 'fa-cloud-sun'"></i></span>{{ t('tune.form.weather') }}
        </button>
        <span v-if="family" class="weather-chip"><i class="fas" :class="weatherIcon(f.weatherCode)"></i>{{ t('tune.weather.' + family) }}</span>
        <span v-if="weatherMsg" class="form-field__hint">{{ weatherMsg }}</span>
      </div>
      <div class="save-field">
        <span class="tf-label">{{ t('tune.form.ground') }}</span>
        <segmented-control v-model="ground" pressed fill :options="[
          { value: 'dry', label: t('tune.form.dry'), icon: 'fa-sun' },
          { value: 'wet', label: t('tune.form.wet'), icon: 'fa-droplet' },
          { value: 'unknown', label: '—' },
        ]" />
      </div>
      <label class="form-field">
        <span class="tf-label">{{ t('tune.form.comment') }}</span>
        <textarea class="text-field save-comment" rows="5" v-model="f.comment" :placeholder="t('tune.form.commentPlaceholder')"></textarea>
      </label>
      <div v-if="!hideActions" class="save-actions">
        <slot name="actions"></slot>
        <button class="btn btn--volt" type="button" :disabled="saving" @click="submit">
          <span class="icon"><i class="fas" :class="saving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'"></i></span>{{ t('tune.saveNow') }}
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.save-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.4rem; }
.save-col { display: flex; flex-direction: column; gap: 0.9rem; min-width: 0; }
.save-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.7rem; align-items: start; }
.save-row.three { grid-template-columns: repeat(3, 1fr); align-items: end; }
.save-row :deep(.form-field) { min-width: 0; }
.save-row :deep(.field-label) { display: block; text-align: left; padding: 0; line-height: 1.3; }
.save-inline { display: flex; gap: 0.4rem; align-items: center; margin-top: 0.3rem; }
.save-inline.wrap { flex-wrap: wrap; }
.save-inline .text-field { flex: 1; min-width: 0; }
.save-field { display: flex; flex-direction: column; gap: 0.35rem; }
.tf-label { display: block; width: 100%; padding: 0; margin: 0; text-align: left; font-family: var(--font-mono); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-mute); line-height: 1.3; }
label.form-field, label.form-field:hover { display: block; padding: 0; margin: 0; }
.form-field .text-field { width: 100%; margin-top: 0.3rem; }
.form-field__hint { display: block; margin-top: 0.3rem; font-size: 0.74rem; color: var(--text-mute); }
.save-comment { resize: vertical; font-family: var(--font-body); }
.weather-chip { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; color: var(--text-dim); }
.save-actions { display: flex; justify-content: flex-end; gap: 0.6rem; margin-top: auto; padding-top: 0.4rem; }
</style>
