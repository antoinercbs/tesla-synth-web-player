import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

/**
 * Opens the `.midi-lib__dropdown` menus on a click, a tap or Enter (a mouse
 * still opens them on hover, see _midi-library.scss): one at a time, keyed by
 * the caller, closed by a click elsewhere, by tabbing out, or by Esc, which
 * gives the focus back to the button.
 */
export function useDropdown() {
  const open = ref<string | null>(null);
  let root: HTMLElement | null = null;

  const focusables = (): HTMLElement[] =>
    [...(root?.querySelectorAll<HTMLElement>('.midi-lib__dropdown-menu :is(button, a, input):not(:disabled)') ?? [])];

  function close(refocus = false): void {
    if (refocus) root?.querySelector<HTMLElement>('[aria-haspopup]')?.focus();
    open.value = null;
    root = null;
  }
  function toggle(key: string, e: MouseEvent): void {
    if (open.value === key) {
      close();
      return;
    }
    open.value = key;
    root = (e.currentTarget as HTMLElement).closest<HTMLElement>('.midi-lib__dropdown');
    // detail 0: pressed from the keyboard, whose user needs the focus in the menu
    if (e.detail === 0) nextTick(() => focusables()[0]?.focus());
  }
  function onKeydown(e: KeyboardEvent): void {
    if (!open.value) return;
    if (e.key === 'Escape') {
      e.stopPropagation(); // a modal around it (the editor's library) closes on Esc too
      close(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = focusables();
      if (!items.length) return;
      e.preventDefault();
      const at = items.indexOf(document.activeElement as HTMLElement);
      const down = e.key === 'ArrowDown';
      const next = at < 0 ? (down ? 0 : items.length - 1) : (at + (down ? 1 : -1) + items.length) % items.length;
      items[next].focus();
    }
  }
  // into a menu shown by hover (its field typed in, an item tabbed to): it stays when the mouse leaves
  function onFocusIn(key: string, e: FocusEvent): void {
    if (open.value === key || !(e.target as HTMLElement).closest('.midi-lib__dropdown-menu')) return;
    open.value = key;
    root = e.currentTarget as HTMLElement;
  }
  // Tab away only: a click on something unfocusable inside blurs to nothing (relatedTarget null)
  function onFocusOut(e: FocusEvent): void {
    const to = e.relatedTarget as Node | null;
    if (root && to && !root.contains(to)) close();
  }
  function onDocPointer(e: PointerEvent): void {
    if (root && !root.contains(e.target as Node)) close();
  }
  onMounted(() => document.addEventListener('pointerdown', onDocPointer));
  onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocPointer));

  return { open, toggle, close, onKeydown, onFocusIn, onFocusOut };
}
