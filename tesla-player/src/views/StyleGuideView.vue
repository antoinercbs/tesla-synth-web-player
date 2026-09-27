<script setup lang="ts">
import { ref } from 'vue';
import { notify } from '@/utils/toast';
import SegmentedControl from '@/components/ui/SegmentedControl.vue';
import EmptyState from '@/components/ui/EmptyState.vue';

/**
 * Dev-only reference sheet (/styleguide, not routed in production builds): the
 * tokens and shared pieces rendered by the real stylesheets, to check a style
 * change everywhere at once. Labels are plain English on purpose — not app UI.
 */
const SURFACES = ['--bg', '--bg-2', '--panel', '--panel-2'];
const TEXTS = ['--text', '--text-dim', '--text-mute'];
const ARC = ['--arc-core', '--arc-mid', '--arc-deep', '--volt', '--plasma'];
const STATES = ['--ok', '--danger'];
const COILS = [0, 1, 2, 3, 4, 5].map((i) => `--coil-${i}`);
const SIZES = ['--fs-xs', '--fs-sm', '--fs-md', '--fs-lg', '--fs-xl', '--fs-2xl'];
const SPACES = ['--sp-1', '--sp-2', '--sp-3', '--sp-4', '--sp-5', '--sp-6'];
const RADII = ['--radius-sm', '--radius', '--radius-lg'];

const tab = ref('a');
const mode = ref('one');
const text = ref('');
const on = ref(true);
</script>

<template>
  <div class="screen">
    <header class="screen-head">
      <h1 class="view-head__title">Style guide</h1>
    </header>

    <div class="screen-body sg">
      <section class="sg-block">
        <h2 class="sg-title">Colours</h2>
        <div v-for="[name, set] in [['Surfaces', SURFACES], ['Text', TEXTS], ['Arc', ARC], ['States', STATES], ['Coils (VU mapping: keep)', COILS]] as const"
          :key="name" class="sg-row">
          <span class="sg-label">{{ name }}</span>
          <span v-for="v in set" :key="v" class="sg-swatch">
            <span class="sg-swatch__chip" :style="{ background: `var(${v})` }"></span><code>{{ v }}</code>
          </span>
        </div>
      </section>

      <section class="sg-block">
        <h2 class="sg-title">Type</h2>
        <p v-for="v in SIZES" :key="v" class="sg-type" :style="{ fontSize: `var(${v})` }">
          <code>{{ v }}</code> Korobeiniki · 1:17 · 42µs
        </p>
        <p class="sg-fonts">
          <span style="font-family: var(--font-display)">Display — Chakra Petch</span>
          <span style="font-family: var(--font-body)">Body — IBM Plex Sans</span>
          <span style="font-family: var(--font-mono)">Mono — IBM Plex Mono (numbers only)</span>
        </p>
      </section>

      <section class="sg-block">
        <h2 class="sg-title">Spacing &amp; radii</h2>
        <div class="sg-row">
          <span v-for="v in SPACES" :key="v" class="sg-space">
            <span :style="{ width: `var(${v})`, height: `var(${v})` }"></span><code>{{ v }}</code>
          </span>
        </div>
        <div class="sg-row">
          <span v-for="v in RADII" :key="v" class="sg-radius" :style="{ borderRadius: `var(${v})` }">
            <code>{{ v }}</code>
          </span>
        </div>
      </section>

      <section class="sg-block">
        <h2 class="sg-title">Micro-arc — the "active" mark only</h2>
        <div class="sg-row">
          <segmented-control v-model="tab" tabs :options="[
            { value: 'a', label: 'VU', icon: 'fa-chart-simple' },
            { value: 'b', label: 'Score', icon: 'fa-music' },
            { value: 'c', label: 'Coils', icon: 'fa-bolt' },
          ]" />
          <span class="sg-nav"><span class="sg-nav__arc"></span>Active nav item / row</span>
          <span class="arc-loader" aria-hidden="true"></span><span class="sg-label">loading</span>
        </div>
      </section>

      <section class="sg-block">
        <h2 class="sg-title">Actions — one solid button per group</h2>
        <div class="sg-row">
          <button class="btn btn--volt" type="button"><span class="icon"><i class="fas fa-play"></i></span>Primary</button>
          <button class="btn" type="button"><span class="icon"><i class="fas fa-pause"></i></span>Default</button>
          <button class="btn btn--ghost" type="button">Ghost</button>
          <button class="btn btn--stop" type="button"><span class="icon"><i class="fas fa-stop"></i></span>Stop</button>
          <button class="btn btn--danger-ghost" type="button"><span class="icon"><i class="fas fa-trash"></i></span>Delete</button>
          <button class="btn btn--danger" type="button">Confirm delete / emergency</button>
          <button class="btn btn--volt" type="button" disabled>Disabled</button>
          <button class="icon-btn" type="button" aria-label="Add"><span class="icon"><i class="fas fa-plus"></i></span></button>
        </div>
      </section>

      <section class="sg-block">
        <h2 class="sg-title">Controls</h2>
        <div class="sg-row">
          <segmented-control v-model="mode" :options="[
            { value: 'one', label: 'Synth' }, { value: 'two', label: 'MIDI' }, { value: 'three', label: 'Serial' },
          ]" />
          <input v-model="text" class="text-field sg-field" type="text" placeholder="Text field" />
          <div class="select-field sg-field">
            <select><option>Select field</option><option>Other</option></select>
          </div>
          <label class="switch">
            <input v-model="on" type="checkbox" />
            <span class="switch__track"></span>
            <span class="switch__text">Switch</span>
          </label>
        </div>
      </section>

      <section class="sg-block">
        <h2 class="sg-title">Coils — an edge bar in the coil's colour (its VU column)</h2>
        <div class="sg-row">
          <span class="coil-legend">
            <span v-for="i in 6" :key="i" class="coil-legend__chip" :style="{ '--c': `var(--coil-${i - 1})` }">{{ i - 1 }}</span>
          </span>
        </div>
      </section>

      <section class="sg-block">
        <h2 class="sg-title">Feedback</h2>
        <div class="sg-row">
          <button class="btn" type="button" @click="notify('label.songSaved')">Toast: success</button>
          <button class="btn" type="button" @click="notify('label.loading', 'info')">Toast: info</button>
          <button class="btn" type="button" @click="notify('label.uploadFailed', 'error')">Toast: error</button>
        </div>
        <empty-state icon="fa-circle-info">Inline hint (EmptyState variant="hint")</empty-state>
        <div class="sg-stub">
          <empty-state variant="stub" icon="fa-music">Empty pane: say what's missing and what to do next.</empty-state>
          <button class="btn btn--volt" type="button"><span class="icon"><i class="fas fa-plus"></i></span>Call to action</button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.sg {
  display: flex;
  flex-direction: column;
  gap: var(--sp-5);
  padding-bottom: var(--sp-6);
}

.sg-block {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--sp-4);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
}

.sg-title {
  margin: 0;
  font-size: var(--fs-lg);
}

.sg-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-3);
}

.sg-label {
  min-width: 11rem;
  font-size: var(--fs-sm);
  color: var(--text-mute);
}

code {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--text-dim);
  background: none;
  padding: 0;
}

.sg-swatch {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
}

.sg-swatch__chip {
  width: 1.6rem;
  height: 1.6rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--line-strong);
}

.sg-type {
  margin: 0;
  color: var(--text);
}

.sg-type code {
  display: inline-block;
  width: 5.5rem;
}

.sg-fonts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-5);
  margin: var(--sp-2) 0 0;
  color: var(--text-dim);
}

.sg-space {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
}

.sg-space > span {
  background: var(--volt-30);
}

.sg-radius {
  display: grid;
  place-items: center;
  width: 7rem;
  height: 3rem;
  border: 1px solid var(--line-strong);
  background: var(--panel-2);
}

/* mirrors .nav-item.router-link-active */
.sg-nav {
  position: relative;
  padding: 0.55rem 0.9rem;
  background: var(--volt-08);
  border-radius: 0 var(--radius) var(--radius) 0;
  color: #eef3ff;
  font-size: var(--fs-md);
}

.sg-nav__arc {
  position: absolute;
  left: -3px;
  top: 0;
  bottom: 0;
  width: 7px;
  background: linear-gradient(180deg, var(--arc-core), var(--arc-mid) 45%, var(--arc-deep));
  -webkit-mask: var(--micro-arc-v) center / 100% 100% no-repeat;
  mask: var(--micro-arc-v) center / 100% 100% no-repeat;
}

.sg-field {
  width: 12rem;
}

.sg-stub {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-bottom: var(--sp-4);
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius);
}
</style>
