import { devVariant } from './site';

/**
 * The demo videos: unlisted YouTube videos, loaded only on a click
 * (youtube-nocookie). One not filmed yet has no id: it shows as "to film" while
 * developing the site, and not at all once built.
 */
export type DemoTag = 'play' | 'edit' | 'tune' | 'midi' | 'usb' | 'desktop';

export interface Demo {
  /** its title, under site.demos.items */
  key: string;
  /** the YouTube id; empty until it is filmed */
  youtube: string;
  /** its poster until it plays: a screenshot (shots.ts) */
  shot: string;
  /** m:ss */
  duration?: string;
  tag: DemoTag;
}

/** The home page's video, the long presentation. */
export const HERO: Demo = { key: 'concert', youtube: '3Z0T4t8360k', shot: 'play', duration: '3:55', tag: 'play' };

const DEMOS: readonly Demo[] = [
  { key: 'edit', youtube: '', shot: 'edit', tag: 'edit' },
  { key: 'tune', youtube: '', shot: 'tune', tag: 'tune' },
  { key: 'live', youtube: '', shot: 'live', tag: 'play' },
  { key: 'midi', youtube: '', shot: 'midi-edit', tag: 'midi' },
  { key: 'usb', youtube: '', shot: 'syntherrupter', tag: 'usb' },
  { key: 'sync', youtube: '', shot: 'playlists', tag: 'desktop' },
];

export const filmed = (d: Demo): boolean =>
  Boolean(d.youtube) || (import.meta.env.DEV && devVariant('demos', ['hidden']) === null);

/** The demos the site shows. */
export const shownDemos = (): Demo[] => DEMOS.filter(filmed);

/** The player that loads on the click: no cookie before it plays. */
export const embedUrl = (id: string): string => `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0`;

/** A tag's colour (tokens, distinct on every background). */
export const TAG_COLOR: Record<DemoTag, string> = {
  play: 'var(--demo-play)',
  edit: 'var(--demo-edit)',
  tune: 'var(--demo-tune)',
  midi: 'var(--demo-midi)',
  usb: 'var(--demo-usb)',
  desktop: 'var(--demo-desktop)',
};
