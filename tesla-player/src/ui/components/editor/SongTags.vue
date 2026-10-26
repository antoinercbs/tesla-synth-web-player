<script setup lang="ts">
import { computed, ref } from 'vue';
import { useMidiStore } from '@/app/stores/midi';
import { sameTagName, tagNamed } from '@/app/tags';
import type { AppTag } from '@/model/domain';
import { notify } from '@/ui/helpers/toast';
import { useDropdown } from '@/ui/components/ui/dropdown';

/**
 * A song's tags, under its name in the atelier's head: the cross takes one off,
 * the tag button's menu ticks them and makes new ones.
 */
const tags = defineModel<AppTag[]>({ required: true });
const midiStore = useMidiStore();

const allTags = computed<AppTag[]>(() => midiStore.tagList || []);
// two under the name, the others behind "…": their names in its tooltip, all of them in the menu
const TAGS_SHOWN = 2;
const hiddenTags = computed(() => tags.value.slice(TAGS_SHOWN));
const hasTag = (tag: AppTag): boolean => tags.value.some((x) => x.id === tag.id);
// the menu ticks the song's tags, in a steady order: a click puts one on or takes it off
const tagChoices = computed(() => [...allTags.value, ...tags.value.filter((x) => !allTags.value.some((a) => a.id === x.id))]);
function toggleTag(tag: AppTag): void {
  if (hasTag(tag)) removeTag(tag.id);
  else tags.value = [...tags.value, { ...tag }];
}
function removeTag(tagId: number | undefined): void {
  if (tagId !== undefined) tags.value = tags.value.filter((t) => t.id !== tagId);
}

const { open: openMenu, toggle: toggleMenu, onKeydown: onMenuKey, onFocusIn: onMenuFocusIn, onFocusOut: onMenuFocusOut } = useDropdown();
const newTagName = ref('');
const creatingTag = ref(false);
function addExisting(tag: AppTag): void {
  if (!hasTag(tag)) tags.value = [...tags.value, { ...tag }];
  newTagName.value = '';
}
async function createTag(): Promise<void> {
  const name = newTagName.value.trim();
  if (!name || creatingTag.value) return;
  const known = allTags.value.find((t) => sameTagName(t.name, name));
  if (known) {
    addExisting(known);
    return;
  }
  creatingTag.value = true;
  try {
    const tag = await tagNamed(name);
    if (tag) addExisting(tag);
  } catch (err) {
    console.error('Tag creation failed', err);
    notify('label.saveFailed', 'error');
  } finally {
    creatingTag.value = false;
  }
}
</script>

<template>
  <span class="atelier__tags">
    <span v-if="tags.length" class="atelier__tag-list">
      <span v-for="tag in tags.slice(0, TAGS_SHOWN)" :key="tag.id ?? tag.name" class="editor-tag-pill" :style="{ '--tag-c': tag.color }">
        {{ tag.name }}
        <button class="tag-rm" type="button" :title="$t('label.removeTag')" :aria-label="$t('label.removeTag')"
          @click="removeTag(tag.id)"><i class="fas fa-xmark"></i></button>
      </span>
    </span>
    <span class="dropdown" :class="{ 'is-open': openMenu === 'tags' }" @keydown="onMenuKey"
      @focusin="onMenuFocusIn('tags', $event)" @focusout="onMenuFocusOut">
      <button v-if="hiddenTags.length" class="atelier__tags-more" type="button"
        :title="hiddenTags.map((x) => x.name).join(', ')"
        :aria-label="`${$t('atelier.moreTags', hiddenTags.length)} : ${hiddenTags.map((x) => x.name).join(', ')}`"
        aria-haspopup="true" :aria-expanded="openMenu === 'tags'" @click="toggleMenu('tags', $event)">…</button>
      <button class="editor-tags__add" type="button" :title="$t('label.addTag')" :aria-label="$t('label.addTag')"
        aria-haspopup="true" :aria-expanded="openMenu === 'tags'" @click="toggleMenu('tags', $event)">
        <i class="fas fa-tag"></i><span v-if="!tags.length">{{ $t('label.addTag') }}</span>
      </button>
      <span class="dropdown__menu">
        <span class="dropdown__header">{{ $t('label.tags') }}</span>
        <button v-for="t in tagChoices" :key="t.id ?? t.name" class="dropdown__item tag-dropdown-item"
          type="button" :aria-pressed="hasTag(t)" @click="toggleTag(t)">
          <i class="far" :class="hasTag(t) ? 'fa-square-check' : 'fa-square'"></i>
          <span class="song-tag-pill" :style="{ '--tag-c': t.color }">{{ t.name }}</span>
        </button>
        <span v-if="tagChoices.length" class="dropdown__divider"></span>
        <form class="tag-new" @submit.prevent="createTag">
          <input v-model="newTagName" class="text-field tag-new__input" type="text" maxlength="24"
            :placeholder="$t('label.newTag')" :aria-label="$t('label.newTag')">
          <button class="tag-new__add" type="submit" :disabled="!newTagName.trim() || creatingTag"
            :title="$t('label.createTag')" :aria-label="$t('label.createTag')">
            <i class="fas" :class="creatingTag ? 'fa-spinner fa-spin' : 'fa-check'"></i>
          </button>
        </form>
      </span>
    </span>
  </span>
</template>
