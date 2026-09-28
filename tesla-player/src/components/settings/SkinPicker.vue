<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId } from 'vue';
import { SKIN_GROUPS, SKIN_TOP, currentSkin, setSkin, type SkinId } from '@/ui/skins';

/**
 * The look switch (sidebar menu, welcome dialog): the top looks, then a submenu per
 * group of looks. The menu and its submenu are manual popovers: in the top layer,
 * neither the sidebar's menu nor a dialog clips them, and staying in this
 * component's DOM, a click in them is still a click inside the sidebar's menu (which
 * closes on a click outside it).
 */
const uid = useId();
const trigger = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const sub = ref<HTMLElement | null>(null);
const open = ref(false);
const openGroup = ref<string | null>(null);

const currentGroup = computed(() => SKIN_GROUPS.find((g) => g.skins.includes(currentSkin.value))?.id ?? null);
const subSkins = computed(() => SKIN_GROUPS.find((g) => g.id === openGroup.value)?.skins ?? []);

const GAP = 4;
const EDGE = 8;

// pinned in viewport coordinates, flipped to the other side when the viewport has no room
function placeBelow(el: HTMLElement, r: DOMRect): void {
  el.style.minWidth = `${r.width}px`;
  const { width, height } = el.getBoundingClientRect();
  const below = r.bottom + GAP + height <= window.innerHeight - EDGE;
  el.style.top = `${below ? r.bottom + GAP : Math.max(EDGE, r.top - GAP - height)}px`;
  el.style.left = `${Math.max(EDGE, Math.min(r.left, window.innerWidth - EDGE - width))}px`;
}

function placeBeside(el: HTMLElement, item: DOMRect, box: DOMRect): void {
  const { width, height } = el.getBoundingClientRect();
  const right = box.right + width <= window.innerWidth - EDGE;
  el.style.left = `${right ? box.right - 1 : Math.max(EDGE, box.left - width + 1)}px`;
  // its first item level with the group's, its padding above
  const pad = parseFloat(getComputedStyle(el).paddingTop) + parseFloat(getComputedStyle(el).borderTopWidth);
  el.style.top = `${Math.max(EDGE, Math.min(item.top - pad, window.innerHeight - EDGE - height))}px`;
}

function items(el: HTMLElement | null): HTMLElement[] {
  return el ? [...el.querySelectorAll<HTMLElement>('.skin-menu__item')] : [];
}

function groupItem(id: string): HTMLElement | undefined {
  return menu.value?.querySelector<HTMLElement>(`[data-group="${id}"]`) ?? undefined;
}

// --- open / close ---------------------------------------------------------------------
async function openMenu(): Promise<void> {
  if (!menu.value || !trigger.value) return;
  open.value = true;
  menu.value.showPopover();
  placeBelow(menu.value, trigger.value.getBoundingClientRect());
  bind(true);
  await nextTick();
  const top = items(menu.value);
  const start = currentGroup.value
    ? groupItem(currentGroup.value)
    : (top.find((el) => el.dataset.look === currentSkin.value) ?? top[0]);
  start?.focus();
}

async function showSub(id: string, focusIn = false): Promise<void> {
  const item = groupItem(id);
  if (!sub.value || !menu.value || !item) return;
  openGroup.value = id;
  await nextTick();
  if (!sub.value.matches(':popover-open')) sub.value.showPopover();
  placeBeside(sub.value, item.getBoundingClientRect(), menu.value.getBoundingClientRect());
  if (focusIn) {
    const list = items(sub.value);
    // data-look, not data-skin: the looks' rules are scoped by data-skin, and would
    // reach an item's children
    (list.find((el) => el.dataset.look === currentSkin.value) ?? list[0])?.focus();
  }
}

function hideSub(): void {
  clearTimeout(hoverTimer);
  openGroup.value = null;
  if (sub.value?.matches(':popover-open')) sub.value.hidePopover();
}

function close(refocus = false): void {
  hideSub();
  if (menu.value?.matches(':popover-open')) menu.value.hidePopover();
  open.value = false;
  bind(false);
  if (refocus) trigger.value?.focus();
}

function toggle(): void {
  if (open.value) close();
  else openMenu();
}

function pick(id: SkinId): void {
  // put on once its stylesheet is in; the menu closes now
  void setSkin(id);
  close(true);
}

// --- pointer: a group opens on hover, after a moment once a submenu is shown, so a
// diagonal path to it across the next group does not switch it
let hoverTimer = 0;

function hover(id: string | null): void {
  clearTimeout(hoverTimer);
  if (id === openGroup.value) return;
  const act = (): void => { if (id) showSub(id); else hideSub(); };
  if (openGroup.value) hoverTimer = window.setTimeout(act, 150);
  else act();
}

function onGroupClick(id: string, e: MouseEvent): void {
  clearTimeout(hoverTimer);
  // a keyboard's click (Enter, Space) carries no pointer detail: it moves into the submenu
  showSub(id, e.detail === 0);
}

function onDocPointer(e: PointerEvent): void {
  const t = e.target as Node;
  if (trigger.value?.contains(t) || menu.value?.contains(t) || sub.value?.contains(t)) return;
  close();
}

function onScroll(e: Event): void {
  const t = e.target as Node;
  if (menu.value?.contains(t) || sub.value?.contains(t)) return;
  close();
}

function onResize(): void {
  close();
}

function bind(on: boolean): void {
  if (on) {
    document.addEventListener('pointerdown', onDocPointer, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
  } else {
    document.removeEventListener('pointerdown', onDocPointer, true);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onResize);
  }
}

onBeforeUnmount(() => {
  clearTimeout(hoverTimer);
  bind(false);
});

// --- keyboard: arrows move, right enters a submenu, left and Escape step back out ---------
function move(list: HTMLElement[], e: KeyboardEvent): boolean {
  const i = list.indexOf(document.activeElement as HTMLElement);
  const n = list.length;
  const to = { ArrowDown: (i + 1) % n, ArrowUp: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
  if (to === undefined) return false;
  list[to]?.focus();
  return true;
}

function onTriggerKey(e: KeyboardEvent): void {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  if (!open.value) openMenu();
}

function onMenuKey(e: KeyboardEvent): void {
  const group = (document.activeElement as HTMLElement | null)?.dataset.group;
  if (move(items(menu.value), e)) {
    hideSub();
  } else if (e.key === 'ArrowRight' && group) {
    showSub(group, true);
  } else if (e.key === 'Escape') {
    // this Escape is the look menu's: the sidebar's menu around it stays open
    e.stopPropagation();
    close(true);
  } else if (e.key === 'Tab') {
    close();
    return;
  } else {
    return;
  }
  e.preventDefault();
}

function onSubKey(e: KeyboardEvent): void {
  if (move(items(sub.value), e)) {
    // moved
  } else if (e.key === 'ArrowLeft' || e.key === 'Escape') {
    e.stopPropagation();
    const id = openGroup.value;
    hideSub();
    if (id) groupItem(id)?.focus();
  } else if (e.key === 'Tab') {
    close();
    return;
  } else {
    return;
  }
  e.preventDefault();
}
</script>

<template>
  <div class="select-field">
    <button ref="trigger" class="select-field__button" type="button" aria-haspopup="menu"
      :aria-label="`${$t('skin.title')}, ${$t(`skin.${currentSkin}`)}`" :aria-expanded="open"
      :aria-controls="`${uid}-menu`" @click="toggle" @keydown="onTriggerKey">
      {{ $t(`skin.${currentSkin}`) }}
    </button>

    <div :id="`${uid}-menu`" ref="menu" class="skin-menu" popover="manual" role="menu"
      :aria-label="$t('skin.title')" @keydown="onMenuKey">
      <button v-for="id in SKIN_TOP" :key="id" class="skin-menu__item" :class="{ 'is-current': currentSkin === id }"
        type="button" role="menuitemradio" :aria-checked="currentSkin === id" :data-look="id"
        @pointerenter="hover(null)" @click="pick(id)">
        <span class="skin-menu__check"><i v-if="currentSkin === id" class="fas fa-check"></i></span>
        {{ $t(`skin.${id}`) }}
      </button>
      <div class="skin-menu__sep" role="separator"></div>
      <button v-for="g in SKIN_GROUPS" :key="g.id" class="skin-menu__item"
        :class="{ 'is-current': currentGroup === g.id, 'is-open': openGroup === g.id }" type="button"
        role="menuitem" aria-haspopup="menu" :aria-expanded="openGroup === g.id" :aria-controls="`${uid}-sub`"
        :data-group="g.id" @pointerenter="hover(g.id)" @click="onGroupClick(g.id, $event)">
        <span class="skin-menu__check"></span>
        {{ $t(`skinGroup.${g.id}`) }}
        <i class="fas fa-chevron-right skin-menu__chevron"></i>
      </button>
    </div>

    <div :id="`${uid}-sub`" ref="sub" class="skin-menu" popover="manual" role="menu"
      :aria-label="openGroup ? $t(`skinGroup.${openGroup}`) : undefined" @keydown="onSubKey"
      @pointerenter="hover(openGroup)">
      <button v-for="id in subSkins" :key="id" class="skin-menu__item" :class="{ 'is-current': currentSkin === id }"
        type="button" role="menuitemradio" :aria-checked="currentSkin === id" :data-look="id" @click="pick(id)">
        <span class="skin-menu__check"><i v-if="currentSkin === id" class="fas fa-check"></i></span>
        {{ $t(`skin.${id}`) }}
      </button>
    </div>
  </div>
</template>
