import { Menu } from 'electron';

/**
 * Removes the native application menu bar. Sync + server-configuration are
 * reached from the sidebar, so the desktop app ships with no top menu.
 */
export function setupMenu(): void {
  Menu.setApplicationMenu(null);
}
