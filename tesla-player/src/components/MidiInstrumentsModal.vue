<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import axios from 'axios';
import { analyzeMidi } from '@/midi/analyze';
import { ENVELOPES, envelope, envelopeIcon } from '@/sysex/envelopes';
import { notify } from '@/utils/toast';
import type { MidiFile } from '@/types/domain';
import SmfParser from '@/smfplayer/js/smfParser.js';

const props = defineProps<{ open: boolean; file: MidiFile | null }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved', file: MidiFile): void }>();

interface Row { channel: number; original: number; current: number }
const rows = ref<Row[]>([]);
const loading = ref(false);
const error = ref(false);
const saving = ref(false);

const dirty = computed(() => rows.value.some((r) => r.current !== r.original));

/** Instrument options for a row: the named envelopes (0-19), plus the channel's
 *  original/current program if either falls outside that set (so any value the
 *  channel holds stays selectable and revertable). */
function optionsFor(row: Row): { value: number; label: string }[] {
  const opts = ENVELOPES.map((e) => ({ value: e.program, label: `P${e.program} · ${e.name}` }));
  const seen = new Set(ENVELOPES.map((e) => e.program));
  for (const p of [row.original, row.current]) {
    if (!seen.has(p)) { opts.unshift({ value: p, label: `P${p} · ${envelope(p).name}` }); seen.add(p); }
  }
  return opts;
}

function bufferToString(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  try { return decodeURIComponent(escape(binary)); } catch { return binary; }
}

async function load(): Promise<void> {
  if (!props.file) return;
  loading.value = true; error.value = false; rows.value = [];
  try {
    // cache-bust so a re-open after an edit reads the freshly written file
    const url = `${props.file.path.replace(/^\./, '')}?t=${Date.now()}`;
    const { data } = await axios.get(url, { responseType: 'arraybuffer' });
    const parser = new SmfParser();
    const analysis = analyzeMidi(parser.parse(bufferToString(data as ArrayBuffer)));
    rows.value = analysis.channels.map((ch) => {
      const p = analysis.programByChannel[ch] ?? 0;
      return { channel: ch, original: p, current: p };
    });
  } catch {
    error.value = true;
  } finally {
    loading.value = false;
  }
}

watch(() => [props.open, props.file?.id], () => { if (props.open) load(); }, { immediate: true });

async function save(): Promise<void> {
  if (!props.file || !dirty.value || saving.value) return;
  saving.value = true;
  try {
    const programs = rows.value
      .filter((r) => r.current !== r.original)
      .map((r) => ({ channel: r.channel, program: r.current }));
    await axios.patch(`/api/midi/${props.file.id}/programs`, { programs });
    notify('label.instrumentsSaved');
    emit('saved', props.file);
    emit('close');
  } catch (err) {
    console.error('MIDI instrument edit failed', err);
    error.value = true;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-overlay" @click.self="emit('close')">
      <div class="modal-card modal-card--instruments">
        <div class="modal-card__head">
          <span class="modal-card__title">
            <span class="icon"><i class="fas fa-guitar"></i></span>{{ $t('title.editInstruments') }}
          </span>
          <button class="icon-btn" type="button" :aria-label="$t('label.cancel')" @click="emit('close')">
            <i class="fas fa-xmark"></i>
          </button>
        </div>

        <p v-if="file" class="instr-file"><i class="fas fa-file-audio"></i> {{ file.name }}</p>

        <p class="instr-warning" role="alert">
          <span class="icon"><i class="fas fa-triangle-exclamation"></i></span>
          {{ $t('label.instrumentsFileWarning') }}
        </p>

        <div class="instr-body">
          <div v-if="loading" class="instr-state">{{ $t('label.loading') }}…</div>
          <div v-else-if="error" class="instr-state is-error">
            <i class="fas fa-circle-exclamation"></i> {{ $t('label.instrumentsLoadError') }}
          </div>
          <div v-else-if="rows.length === 0" class="instr-state">{{ $t('label.noChannelsInFile') }}</div>
          <div v-else class="instr-list">
            <div v-for="row in rows" :key="row.channel" class="instr-row" :class="{ 'is-changed': row.current !== row.original }">
              <span class="instr-row__ch">{{ $t('label.channel') }} {{ row.channel }}</span>
              <span class="instr-row__icon"><i class="fas" :class="envelopeIcon(row.current)"></i></span>
              <div class="select-field instr-row__select">
                <select v-model.number="row.current" :aria-label="`${$t('label.channel')} ${row.channel}`">
                  <option v-for="o in optionsFor(row)" :key="o.value" :value="o.value">{{ o.label }}</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div class="instr-actions">
          <button class="btn btn--ghost" type="button" @click="emit('close')">{{ $t('label.cancel') }}</button>
          <button class="btn btn--volt" type="button" :disabled="!dirty || saving || loading" @click="save">
            <span class="icon"><i class="fas fa-floppy-disk"></i></span>{{ $t('label.save') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-card--instruments { max-width: 540px; width: 100%; }
.instr-file {
  margin: -0.4rem 0 0.8rem; font-family: var(--font-mono); font-size: 0.82rem; color: var(--text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.instr-file i { color: var(--volt); margin-right: 0.35rem; }
.instr-warning {
  display: flex; align-items: flex-start; gap: 0.5rem; margin: 0 0 1rem; padding: 0.6rem 0.8rem;
  border: 1px solid var(--danger); border-radius: 8px; background: rgba(255, 90, 90, 0.08);
  color: var(--text); font-size: 0.8rem; line-height: 1.4;
}
.instr-warning .icon { color: var(--danger); flex: 0 0 auto; margin-top: 0.05rem; }
.instr-body { max-height: 46vh; overflow-y: auto; }
.instr-state { padding: 1.4rem; text-align: center; color: var(--text-mute); font-family: var(--font-mono); font-size: 0.85rem; }
.instr-state.is-error { color: var(--danger); }
.instr-list { display: flex; flex-direction: column; gap: 0.45rem; }
.instr-row {
  display: grid; grid-template-columns: auto auto 1fr; align-items: center; gap: 0.6rem;
  padding: 0.4rem 0.5rem; border: 1px solid var(--line); border-radius: 8px;
}
.instr-row.is-changed { border-color: var(--volt); background: rgba(70, 224, 255, 0.05); }
.instr-row__ch { font-family: var(--font-mono); font-size: 0.78rem; font-weight: 600; color: var(--text-dim); white-space: nowrap; }
.instr-row__icon { color: var(--volt); width: 1.1rem; text-align: center; }
.instr-row__select select { width: 100%; }
.instr-actions { display: flex; justify-content: flex-end; gap: 0.6rem; margin-top: 1.2rem; }
</style>
