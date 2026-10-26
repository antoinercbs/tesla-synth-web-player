import { tour } from '@/ui/tour/tour';

/** Typing in a field: its keys are its own (a slider, a checkbox and a button keep Esc for the page). */
export function inTextField(el: EventTarget | null): boolean {
  return el instanceof HTMLElement
    && !!el.closest('textarea, select, [contenteditable="true"], input:not([type="range"], [type="checkbox"], [type="radio"], [type="button"])');
}

/** A control that takes the arrows and Space itself: a field, a slider, a box to tick. */
function inControl(el: EventTarget | null): boolean {
  return el instanceof HTMLElement
    && !!el.closest('input, select, textarea, [contenteditable="true"], [role="slider"], [role="switch"], [role="combobox"]');
}

/** Something open over the page that the key is for: a dialog, a menu, a list. */
export function overlayOpen(): boolean {
  // popover menus stay in the DOM while closed: only a shown one counts
  const open = document.querySelectorAll('.modal-overlay, .sidebar-menu, [role="menu"], [role="listbox"], .col-filter__panel, .dropdown.is-open');
  return [...open].some((el) => el.getClientRects().length > 0);
}

/**
 * A page shortcut's key: no modifier but Shift, not for a control, a dialog or
 * a menu, not during the tour (its arrows turn its pages), and not already
 * taken by what has the focus.
 */
export function isPageKey(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || tour.active) return false;
  return !inControl(e.target) && !overlayOpen();
}
