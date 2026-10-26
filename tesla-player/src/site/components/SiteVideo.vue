<script setup lang="ts">
import { ref, watch } from 'vue';
import { embedUrl, filmed, TAG_COLOR, type Demo } from '@/site/demos';

/**
 * A demo video: its poster (a screenshot) until it is clicked, then YouTube's
 * player, no-cookie, created only then. Not filmed yet (no id): the poster alone.
 */
const props = defineProps<{ demo: Demo; poster: string; caption?: boolean }>();
const playing = ref(false);
watch(() => props.demo, () => (playing.value = false));
</script>

<template>
  <div class="site-video">
    <iframe v-if="playing && demo.youtube" class="site-video__frame" :src="embedUrl(demo.youtube)"
      :title="$t(`site.demos.items.${demo.key}`)" allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
      allowfullscreen></iframe>
    <template v-else>
      <img class="site-video__poster" :src="poster" :alt="$t(`site.demos.items.${demo.key}`)">
      <div v-if="demo.youtube" class="site-video__scrim">
        <button class="btn btn--volt" type="button" @click="playing = true">
          <span class="icon"><i class="fas fa-play"></i></span>{{ $t('site.demos.play') }}
        </button>
      </div>
      <div v-if="caption && filmed(demo)" class="site-video__cap">
        <span class="site-badges">
          <span class="player-synth-badge"><i class="fas fa-video"></i>{{ $t(`site.demos.items.${demo.key}`) }}</span>
          <span v-if="!demo.youtube" class="song-tag-pill" :style="{ '--tag-c': TAG_COLOR[demo.tag] }">{{ $t('site.demos.toFilm') }}</span>
        </span>
        <span v-if="demo.duration" class="site-video__dur">{{ demo.duration }}</span>
      </div>
    </template>
  </div>
</template>
