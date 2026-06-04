<script setup lang="ts">
import BaseModal from '@/components/ui/BaseModal.vue';

/**
 * Verbose credits / acknowledgements modal — opened from the synthetic credits
 * line in the sidebar footer. Foremost: the Syntherrupter (firmware + hardware)
 * by Max Zuidberg, whose SysEx protocol this player drives.
 */
defineProps<{ open: boolean }>();
defineEmits<{ (e: 'close'): void }>();
</script>

<template>
  <base-modal :open="open" :title="$t('credits.title')" icon="fa-heart"
    card-class="credits-modal" @close="$emit('close')">
    <div class="credits">
      <section class="credits__item credits__item--lead">
        <h3 class="credits__name">Syntherrupter</h3>
        <p>{{ $t('credits.syntherrupter') }}</p>
        <p class="credits__by">{{ $t('credits.by') }} <strong>Max Zuidberg</strong> (MMMZZZZ)</p>
        <div class="credits__links">
          <a href="https://github.com/MMMZZZZ/Syntherrupter" target="_blank" rel="noopener">
            <i class="fas fa-up-right-from-square"></i> GitHub
          </a>
          <a href="https://github.com/MMMZZZZ/Syntherrupter/wiki" target="_blank" rel="noopener">
            <i class="fas fa-up-right-from-square"></i> Wiki
          </a>
          <a href="https://highvoltageforum.net/index.php?topic=1020" target="_blank" rel="noopener">
            <i class="fas fa-up-right-from-square"></i> Forum
          </a>
        </div>
      </section>

      <section class="credits__item">
        <h3 class="credits__name">Tesla Player</h3>
        <p>{{ $t('credits.app') }}</p>
        <p class="credits__by">
          {{ $t('credits.by') }} <strong>Antoine Rochebois</strong>
          (<a href="https://clubelek.fr" target="_blank" rel="noopener">Clubelek</a>, INSA Lyon)
        </p>
        <div class="credits__links">
          <a href="https://github.com/antoinercbs/tesla-synth-web-player" target="_blank" rel="noopener">
            <i class="fas fa-up-right-from-square"></i> GitHub
          </a>
          <a href="https://highvoltageforum.net/index.php?topic=2034.0" target="_blank" rel="noopener">
            <i class="fas fa-up-right-from-square"></i> Forum
          </a>
        </div>
      </section>
    </div>
  </base-modal>
</template>

<style scoped>
.credits { display: flex; flex-direction: column; gap: 1.25rem; max-width: 30rem; }
.credits__item { display: flex; flex-direction: column; gap: 0.4rem; }
.credits__item--lead { padding-bottom: 1.1rem; border-bottom: 1px solid var(--line); }
.credits__name { margin: 0; font-size: 1rem; color: var(--text); }
.credits__item p { margin: 0; font-size: 0.88rem; line-height: 1.5; color: var(--text-mute); }
.credits__by { color: var(--text); }
.credits__links { display: flex; gap: 1rem; margin-top: 0.25rem; }
.credits__links a, .credits__by a { color: var(--volt); text-decoration: none; font-size: 0.85rem; }
.credits__links a:hover, .credits__by a:hover { text-decoration: underline; }
.credits__links i { font-size: 0.7rem; }
</style>
