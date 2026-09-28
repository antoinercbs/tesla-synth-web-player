<script setup lang="ts">
import logoSrc from '@/assets/logo_tesla_player.svg';
import BaseModal from '@/components/ui/BaseModal.vue';
import LocalePicker from '@/components/settings/LocalePicker.vue';
import SkinPicker from '@/components/settings/SkinPicker.vue';
import ThemePicker from '@/components/settings/ThemePicker.vue';
import { dismissWelcome, startTour, tour } from '@/tour/tour';

/**
 * First visit on a device: language, look and colours (applied as they are picked),
 * then the guided tour or straight in. Closing it any way counts as seen.
 */
const emblemStyle = { '--emblem-src': `url("${logoSrc}")` };
</script>

<template>
  <BaseModal :open="tour.welcome" :title="$t('welcome.title')" icon="fa-bolt" card-class="welcome-modal"
    :close-label="$t('welcome.skip')" @close="dismissWelcome">
    <div class="welcome">
      <span class="brand__emblem welcome__logo" :style="emblemStyle" aria-hidden="true"></span>
      <p class="welcome__intro">{{ $t('welcome.intro') }}</p>
      <div class="welcome__row">
        <span>{{ $t('label.language') }}</span>
        <locale-picker />
      </div>
      <div class="welcome__row">
        <span>{{ $t('skin.title') }}</span>
        <skin-picker />
      </div>
      <theme-picker />
      <p class="welcome__later">{{ $t('welcome.later') }}</p>
    </div>
    <template #actions>
      <button class="btn btn--ghost" type="button" @click="dismissWelcome">{{ $t('welcome.skip') }}</button>
      <button class="btn btn--volt" type="button" @click="startTour()">
        <span class="icon"><i class="fas fa-route"></i></span>{{ $t('welcome.tour') }}
      </button>
    </template>
  </BaseModal>
</template>
