import { reactive } from 'vue';

/**
 * The Play page on stage: full screen where the browser allows it, the
 * sidebar out of the way, the transport and the power within reach
 * (html[data-stage], features/player/_stage.scss). The page keeps the screen
 * on meanwhile, and leaves the stage with it.
 */
export const stage = reactive({ on: false });

interface KeyboardLock {
  lock?(keys?: string[]): Promise<void>;
  unlock?(): void;
}
const keyboard = (): KeyboardLock | undefined => (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;

export const fullscreenAvailable = typeof document !== 'undefined' && !!document.fullscreenEnabled;

export async function enterStage(): Promise<void> {
  if (stage.on) return;
  stage.on = true;
  document.documentElement.dataset.stage = '';
  if (!fullscreenAvailable) return;
  try {
    await document.documentElement.requestFullscreen();
    // Esc is the Panic key: in full screen the browser would take it to leave
    // (once locked, holding it down still leaves)
    await keyboard()?.lock?.(['Escape']);
  } catch { /* refused: on stage, in the window */ }
}

export function leaveStage(): void {
  if (!stage.on) return;
  stage.on = false;
  delete document.documentElement.dataset.stage;
  keyboard()?.unlock?.();
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
}

export function toggleStage(): void {
  if (stage.on) leaveStage();
  else void enterStage();
}

// left by the browser (Esc held, F11, its own button): off the stage too
if (typeof document !== 'undefined') {
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) leaveStage();
  });
}
