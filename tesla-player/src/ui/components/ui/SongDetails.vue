<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMidiStore } from '@/app/stores/midi';
import { PhyStage } from '@/model/coils/stage';
import { COIL_COLOR_COUNT, coilColor, UNPLUGGED_COLOR } from '@/ui/helpers/coil-colors';
import { ICONS } from '@/ui/helpers/icons';
import { formatEditDate, pctLabel } from '@/utils/format';
import type { Song, SongVariant } from '@/model/domain';
import { beginner } from '@/ui/helpers/ui-mode';

/**
 * A song unfolded in a list: each of its variants on a line, the one the coils
 * wired now play first and marked, with their coils (the colour of the output
 * they are on, as on stage), the channels each plays and its settings, and
 * what the variant adds (spatialisation, power over time). Then the song's
 * file, speakers, playlists and last edit.
 */
const props = defineProps<{ song: Song; playlists?: string[] }>();
const midiStore = useMidiStore();
const { t, locale } = useI18n();

const capLabel = (o: number): string => t('player.wiring.cap', { n: o, color: t(`player.wiring.caps.${o % COIL_COLOR_COUNT}`) });
const bits = (mask: number): number[] => Array.from({ length: 16 }, (_, ch) => ch).filter((ch) => mask & (1 << ch));

const ways = computed(() => {
  const s = props.song;
  const inv = midiStore.coilList;
  const chosen = inv.length ? new PhyStage(inv).chooseWay(s, midiStore.outputOf) : null;
  const all: (SongVariant | null)[] = [null, ...(s.variants ?? [])];
  return all.map((v) => {
    const way = PhyStage.asWay(s, v);
    const coils = way.coils.slice(0, way.coilCount);
    const stage = inv.length ? new PhyStage(inv).onStage(way, midiStore.outputOf) : null;
    return {
      key: v?.id ?? 'own',
      // its coils are the lines under it: only a name given by hand
      name: v?.name?.trim() ?? '',
      plays: !!chosen?.fits && chosen.variant === v,
      fits: !stage || !stage.missing.length,
      stereo: !!way.stereo,
      points: way.events?.length ?? 0,
      coils: coils.map((c) => {
        const k = c.coilIndex;
        const coil = inv.length ? new PhyStage(inv).placeCoil(coils, k) : null;
        const twin = stage?.twins.find((x) => x.place === k)?.twin ?? null;
        const out = !inv.length ? k : twin ? midiStore.outputOf(twin.uuid) : coil ? midiStore.outputOf(coil.uuid) : -1;
        const name = coil?.name ?? `${t('label.coil')} ${k}`;
        return {
          k,
          name,
          color: out >= 0 ? coilColor(out) : UNPLUGGED_COLOR,
          where: twin ? `${t('player.twinPlays', { twin: twin.name, coil: name })} · ${capLabel(out)}`
            : out >= 0 ? capLabel(out) : t('player.wiring.none'),
          off: out < 0,
          channels: bits(c.channelMask),
          ontimeUs: Math.round(c.ontimeUs),
          duty: pctLabel(c.duty),
        };
      }),
    };
  }).sort((a, b) => Number(b.plays) - Number(a.plays));
});
const speakers = computed(() => bits(props.song.output2Mask ?? 0));
const edited = computed(() => {
  const s = props.song;
  if (!s.updatedAt && !s.editorName) return '';
  return [s.updatedAt ? formatEditDate(s.updatedAt, locale.value) : '', s.editorName ?? ''].filter(Boolean).join(' · ');
});
</script>

<template>
  <div class="song-details" :class="{ 'is-simple': beginner }">
    <div class="song-coil song-coil--head" aria-hidden="true">
      <span class="song-coil__h-coil">{{ $t('label.coil') }}</span>
      <span>{{ $t('label.channels') }}</span>
      <template v-if="!beginner">
        <span class="song-coil__h-num" :title="$t('ontime.bassHint')">{{ $t('ontime.bass') }}<small>duty</small></span>
        <span class="song-coil__h-num" :title="$t('ontime.trebleHint')">{{ $t('ontime.treble') }}<small>ontime</small></span>
      </template>
    </div>
    <div v-for="w in ways" :key="w.key" class="song-way" :class="{ 'is-playing': w.plays, 'is-misfit': !w.fits }">
      <div class="song-way__head">
        <i class="fas fa-code-branch"></i>
        <b>{{ $t('atelier.ways.count', w.coils.length) }}</b>
        <span v-if="w.name" class="song-way__name">{{ w.name }}</span>
        <span v-if="w.plays" class="song-way__here"><i class="fas fa-plug"></i>{{ $t('stage.playsHere') }}</span>
        <span class="song-way__opts">
          <i v-if="w.stereo" class="fas" :class="ICONS.stereo" :title="$t('atelier.tool.space')"></i>
          <span v-if="w.points" :title="$t('atelier.tool.dyn')"><i class="fas" :class="ICONS.dynamics"></i>{{ w.points }}</span>
        </span>
      </div>
      <ul class="song-way__coils">
        <li v-for="c in w.coils" :key="c.k" class="song-coil" :class="{ 'is-off': c.off }" :style="{ '--c': c.color }">
          <span class="song-coil__dot" :title="c.where"></span>
          <span class="song-coil__name" :title="c.where">{{ c.name }}</span>
          <span class="song-coil__chs" :title="$t('label.channels')">
            <span v-for="ch in c.channels" :key="ch" class="song-coil__ch">{{ ch }}</span>
            <span v-if="!c.channels.length" class="song-coil__none">—</span>
          </span>
          <template v-if="!beginner">
            <span class="song-coil__num" :title="$t('ontime.bassHint')">{{ c.duty }} %</span>
            <span class="song-coil__num" :title="$t('ontime.trebleHint')">{{ c.ontimeUs }} µs</span>
          </template>
        </li>
      </ul>
    </div>
    <div class="song-details__facts">
      <span v-if="song.midiFile?.name" :title="song.midiFile.name"><i class="fas fa-file-audio"></i>{{ song.midiFile.name }}</span>
      <span v-if="speakers.length" :title="$t('label.usesSpeaker')"><i class="fas" :class="ICONS.speakers"></i><span
          v-for="ch in speakers" :key="ch" class="song-coil__ch">{{ ch }}</span></span>
      <span v-if="playlists?.length" :title="$t('label.inPlaylists')"><i class="fas fa-list"></i>{{ playlists.join(', ') }}</span>
      <span v-if="edited" :title="$t('label.lastEdit')"><i class="fas fa-clock-rotate-left"></i>{{ edited }}</span>
    </div>
  </div>
</template>
