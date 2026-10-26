import { nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue';
import { useRoute } from 'vue-router';
import { mobileLayout } from '@/ui/helpers/viewport';

export type OutMenu = 'coils' | 'speakers';

export interface SidebarMenuEls {
  aside: Ref<HTMLElement | null>;
  moreBtn: Ref<HTMLElement | null>;
  menu: Ref<HTMLElement | null>;
  outMenuEl: Ref<HTMLElement | null>;
}

/**
 * The sidebar's two floating menus, teleported out of it (it scrolls, an
 * in-flow popover would be clipped): the footer's (the rarely used settings)
 * and an output's (beside the sidebar, level with its row). One at a time;
 * a click outside, Escape or another page closes them.
 */
export function useSidebarMenus(els: SidebarMenuEls, compact: Ref<boolean>) {
  const menuOpen = ref(false);
  const menuStyle = ref<Record<string, string>>({});
  const outMenu = ref<OutMenu | null>(null);
  const outMenuStyle = ref<Record<string, string>>({});
  let outAnchor: HTMLElement | null = null;
  let menuWidth = 0;

  function toggleMenu(): void {
    if (menuOpen.value) {
      menuOpen.value = false;
      return;
    }
    // pinned in viewport coords (the menu is teleported out of the sidebar): above
    // the button when expanded and in the phone's bottom bar, beside the rail when compact
    const r = (els.moreBtn.value as HTMLElement).getBoundingClientRect();
    menuStyle.value = compact.value && !mobileLayout.value
      ? { left: `${r.right + 10}px`, bottom: `${window.innerHeight - r.bottom}px` }
      : { right: `${Math.max(8, window.innerWidth - r.right)}px`, bottom: `${window.innerHeight - r.top + 8}px` };
    menuWidth = window.innerWidth;
    outMenu.value = null;
    menuOpen.value = true;
  }
  function closeMenu(): void {
    // a phone's toolbars showing and hiding change the height only: the menu stays put
    if (window.innerWidth !== menuWidth) {
      menuOpen.value = false;
      outMenu.value = null;
    }
  }
  // beside the sidebar, level with its button, kept on screen once its height is known
  function toggleOutMenu(id: OutMenu, e: MouseEvent): void {
    if (outMenu.value === id) {
      closeOutMenu();
      return;
    }
    menuOpen.value = false;
    outAnchor = e.currentTarget as HTMLElement;
    const btn = outAnchor.getBoundingClientRect();
    const side = (els.aside.value as HTMLElement).getBoundingClientRect();
    outMenuStyle.value = { left: `${side.right + 8}px`, top: `${btn.top}px` };
    menuWidth = window.innerWidth;
    outMenu.value = id;
    void nextTick(() => {
      const el = els.outMenuEl.value;
      if (!el) return;
      const top = Math.max(8, Math.min(btn.top, window.innerHeight - 8 - el.offsetHeight));
      outMenuStyle.value = { ...outMenuStyle.value, top: `${top}px` };
      const items = el.querySelectorAll<HTMLElement>('.sidebar-menu__item:not(:disabled)');
      ([...items].find((i) => i.classList.contains('is-current')) || items[0])?.focus();
    });
  }
  function closeOutMenu(refocus = false): void {
    if (!outMenu.value) return;
    outMenu.value = null;
    if (refocus) outAnchor?.focus();
  }
  function onOutDocPointer(e: Event): void {
    const target = e.target as Node;
    if (els.outMenuEl.value?.contains(target) || outAnchor?.contains(target)) return;
    closeOutMenu();
  }
  function onOutDocKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') closeOutMenu(true);
  }
  // up and down through the items; the timbre and the offset keep their own arrows
  function onOutMenuKey(e: KeyboardEvent): void {
    if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || (e.target as HTMLElement).closest('.segmented, input')) return;
    const items = [...(els.outMenuEl.value as HTMLElement).querySelectorAll<HTMLElement>('.sidebar-menu__item:not(:disabled)')];
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  }
  function setOutMenuListeners(on: boolean): void {
    const fn = on ? 'addEventListener' : 'removeEventListener';
    document[fn]('pointerdown', onOutDocPointer, true);
    document[fn]('keydown', onOutDocKey as EventListener);
    window[fn]('resize', closeMenu);
  }
  function onDocPointer(e: Event): void {
    const target = e.target as Node;
    if (els.menu.value?.contains(target) || els.moreBtn.value?.contains(target)) return;
    menuOpen.value = false;
  }
  function onMenuKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape') return;
    menuOpen.value = false;
    els.moreBtn.value?.focus();
  }
  function setMenuListeners(on: boolean): void {
    const fn = on ? 'addEventListener' : 'removeEventListener';
    document[fn]('pointerdown', onDocPointer, true);
    document[fn]('keydown', onMenuKey as EventListener);
    window[fn]('resize', closeMenu);
  }
  watch(menuOpen, (open) => setMenuListeners(open));
  watch(outMenu, (id, was) => { if (!id !== !was) setOutMenuListeners(!!id); });
  const route = useRoute();
  watch(() => route.fullPath, () => {
    menuOpen.value = false;
    outMenu.value = null;
  });
  onBeforeUnmount(() => {
    setMenuListeners(false);
    setOutMenuListeners(false);
  });

  return { menuOpen, menuStyle, outMenu, outMenuStyle, toggleMenu, toggleOutMenu, closeOutMenu, onOutMenuKey };
}
