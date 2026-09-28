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
  <base-modal :open="open" :title="$t('credits.title')" icon="fa-heart" card-class="credits-modal"
    @close="$emit('close')">
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
