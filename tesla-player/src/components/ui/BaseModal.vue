<script lang="ts">
// the open modals, oldest first: a confirmation opened over a modal is the only one
// Esc closes and Tab stays in
const stack: symbol[] = [];
</script>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';

/**
 * The shared modal shell: Teleport + dark overlay + card + head (icon/title/×).
 * Body goes in the default slot, footer buttons in the `actions` slot. Every
 * modal in the app reuses this instead of re-implementing the overlay markup.
 * Dismissal emits `close` (backdrop click, × button, or Esc). Open, it takes the
 * focus (a slot's [data-autofocus], else its first control) and gives it back on close.
 */
const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string; // already translated
    icon?: string; // FontAwesome class, e.g. 'fa-server'
    cardClass?: string; // extra class on .modal-card (width/variant)
    closeLabel?: string; // aria-label for the × button (already translated)
    closeOnEsc?: boolean;
    closeOnBackdrop?: boolean;
    describedBy?: string; // id of the element that says what the dialog is about
  }>(),
  {
    icon: 'fa-circle-info',
    cardClass: '',
    closeLabel: '',
    closeOnEsc: true,
    closeOnBackdrop: true,
  },
);

const emit = defineEmits<{ (e: 'close'): void }>();

const titleId = `${useId()}-title`;
const card = ref<HTMLElement | null>(null);
const self = Symbol('modal');
let returnTo: HTMLElement | null = null;

const CONTROLS = 'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex], [contenteditable="true"]';

function controls(): HTMLElement[] {
  return [...(card.value?.querySelectorAll<HTMLElement>(CONTROLS) ?? [])].filter(
    (el) => el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length > 0,
  );
}

function focusIn(): void {
  const el = card.value;
  const at = document.activeElement;
  if (!el || stack[stack.length - 1] !== self || (at && el.contains(at))) return;
  // the tour's card, a dialog of its own over the app, keeps the focus it holds
  if (at?.closest('[aria-modal="true"]:not(.modal-card)')) return;
  const all = controls();
  const head = el.querySelector('.modal-card__head');
  const pick = el.querySelector<HTMLElement>('[data-autofocus]') ?? all.find((c) => !head?.contains(c)) ?? all[0];
  pick?.focus();
}

// only at the ends: in between, the browser's own order (a radio group's) is kept
function trapTab(e: KeyboardEvent): void {
  const all = controls();
  const at = document.activeElement;
  if (!all.length) return;
  const toward = e.shiftKey ? Node.DOCUMENT_POSITION_PRECEDING : Node.DOCUMENT_POSITION_FOLLOWING;
  if (at && card.value?.contains(at) && all.some((c) => at.compareDocumentPosition(c) & toward)) return;
  e.preventDefault();
  (e.shiftKey ? all[all.length - 1] : all[0]).focus();
}

function onKeydown(e: KeyboardEvent): void {
  if (stack[stack.length - 1] !== self) return;
  if (e.key === 'Escape' && props.closeOnEsc) emit('close');
  else if (e.key === 'Tab' && !e.defaultPrevented) trapTab(e);
}

function activate(): void {
  if (stack.includes(self)) return;
  returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  stack.push(self);
  window.addEventListener('keydown', onKeydown);
  void nextTick(focusIn);
}

function deactivate(): void {
  const i = stack.indexOf(self);
  if (i === -1) return;
  stack.splice(i, 1);
  window.removeEventListener('keydown', onKeydown);
  // unless the closing action sent the focus somewhere on purpose
  const at = document.activeElement;
  const lost = !at || at === document.body || !!card.value?.contains(at);
  if (lost && returnTo?.isConnected && returnTo !== document.body) returnTo.focus({ preventScroll: true });
  returnTo = null;
}

watch(() => props.open, (open) => (open ? activate() : deactivate()), { immediate: true });
onBeforeUnmount(deactivate);
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-overlay" @click.self="closeOnBackdrop && emit('close')">
      <div ref="card" class="modal-card" :class="cardClass" role="dialog" aria-modal="true" :aria-labelledby="titleId"
        :aria-describedby="describedBy">
        <div class="modal-card__head">
          <span :id="titleId" class="modal-card__title">
            <span class="icon" aria-hidden="true"><i class="fas" :class="icon"></i></span>{{ title }}
          </span>
          <button class="icon-btn" type="button" :aria-label="closeLabel" @click="emit('close')">
            <i class="fas fa-xmark"></i>
          </button>
        </div>
        <slot></slot>
        <div v-if="$slots.actions" class="modal-card__actions">
          <slot name="actions"></slot>
        </div>
      </div>
    </div>
  </Teleport>
</template>
