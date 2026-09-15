<script setup lang="ts">
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

/**
 * OpenStreetMap (Leaflet) with one draggable marker: where the tuning was done.
 * Tiles need Internet; without them the map stays blank but the coordinates
 * still work. The marker is a CSS dot (no image assets to bundle).
 */
const props = withDefaults(defineProps<{
  lat: number | null;
  lon: number | null;
  /** Fallback centre when no position is known. */
  fallback?: [number, number];
  zoom?: number;
  interactive?: boolean;
  height?: string;
}>(), { fallback: () => [46.6, 2.4], zoom: 15, interactive: true, height: '240px' });
const emit = defineEmits<{ (e: 'update', p: { lat: number; lon: number }): void }>();

const el = ref<HTMLDivElement | null>(null);
let map: L.Map | null = null;
let marker: L.Marker | null = null;

const icon = L.divIcon({ className: 'tune-marker', iconSize: [18, 18], iconAnchor: [9, 9] });

function place(lat: number, lon: number): void {
  if (!map) return;
  if (!marker) {
    marker = L.marker([lat, lon], { icon, draggable: props.interactive, keyboard: false }).addTo(map);
    marker.on('dragend', () => {
      const p = marker!.getLatLng();
      emit('update', { lat: round(p.lat), lon: round(p.lng) });
    });
  } else {
    marker.setLatLng([lat, lon]);
  }
}
const round = (v: number): number => Math.round(v * 1e5) / 1e5;

onMounted(() => {
  if (!el.value) return;
  const has = props.lat != null && props.lon != null;
  map = L.map(el.value, { zoomControl: true, attributionControl: true, scrollWheelZoom: false })
    .setView(has ? [props.lat!, props.lon!] : props.fallback, has ? props.zoom : 5);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  if (has) place(props.lat!, props.lon!);
  if (props.interactive) {
    map.on('click', (e: L.LeafletMouseEvent) => {
      place(e.latlng.lat, e.latlng.lng);
      emit('update', { lat: round(e.latlng.lat), lon: round(e.latlng.lng) });
    });
  }
  // the modal animates in: give Leaflet its real size once painted
  setTimeout(() => map?.invalidateSize(), 60);
});

watch(() => [props.lat, props.lon] as const, ([lat, lon]) => {
  if (!map || lat == null || lon == null) return;
  place(lat, lon);
  map.setView([lat, lon], Math.max(map.getZoom(), props.zoom));
});

onBeforeUnmount(() => { map?.remove(); map = null; marker = null; });
</script>

<template>
  <div ref="el" class="location-map" :style="{ height }"></div>
</template>

<style>
/* global: Leaflet injects the marker outside this component's scope */
.tune-marker {
  width: 18px; height: 18px; border-radius: 50%;
  background: var(--volt); border: 3px solid var(--bg);
  box-shadow: 0 0 0 2px var(--volt), 0 0 14px var(--volt);
}
.location-map { width: 100%; border-radius: var(--radius-sm); overflow: hidden; border: 1px solid var(--line); background: var(--panel-2); z-index: 0; }
.location-map .leaflet-container { background: var(--panel-2); font-family: var(--font-body); }
.location-map .leaflet-control-attribution { background: rgba(0, 0, 0, 0.55); color: var(--text-dim); font-size: 10px; }
.location-map .leaflet-control-attribution a { color: var(--volt); }
.location-map .leaflet-bar a { background: var(--panel); color: var(--text); border-color: var(--line-strong); }
</style>
