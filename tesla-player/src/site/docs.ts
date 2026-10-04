import { Marked, type Tokens } from 'marked';
import { REPO_URL } from './site';

/**
 * The documentation is docs/*.md at the repository root: the one source, read on
 * GitHub as it is, and rendered here as the site's Documentation pages. Links
 * between the guides become the site's pages, the others point at the repository.
 */
export const DOC_IDS = ['README', 'user-guide', 'desktop-app', 'syntherrupter', 'tuning', 'deployment', 'authentication', 'development'] as const;
export type DocId = (typeof DOC_IDS)[number];

/** The table of contents, by readers (a group's label under site.docs.groups). */
export const DOC_GROUPS: readonly { id: string; docs: readonly DocId[] }[] = [
  { id: 'everyone', docs: ['README', 'user-guide', 'desktop-app'] },
  { id: 'coils', docs: ['syntherrupter', 'tuning'] },
  { id: 'admin', docs: ['deployment', 'authentication'] },
  { id: 'contrib', docs: ['development'] },
];

export function isDocId(v: unknown): v is DocId {
  return typeof v === 'string' && (DOC_IDS as readonly string[]).includes(v);
}

const SOURCES = import.meta.glob('../../../docs/*.md', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;

export function loadDoc(id: DocId): Promise<string> {
  return SOURCES[`../../../docs/${id}.md`]();
}

export type DocLink =
  | { kind: 'doc'; doc: DocId; anchor?: string }
  | { kind: 'home' }
  | { kind: 'external'; url: string };

const BLOB = `${REPO_URL}/blob/main/`;
const RAW = 'https://raw.githubusercontent.com/antoinercbs/tesla-synth-web-player/main/';

/** Where a link written in docs/<current>.md leads on the site. */
export function resolveDocLink(href: string, current: DocId): DocLink {
  if (/^[a-z][a-z\d+.-]*:/i.test(href)) return { kind: 'external', url: href };
  if (href.startsWith('#')) return { kind: 'doc', doc: current, anchor: href.slice(1) || undefined };
  const guide = href.match(/^(?:\.\/)?([\w-]+)\.md(?:#(.*))?$/);
  if (guide && isDocId(guide[1])) return { kind: 'doc', doc: guide[1], anchor: guide[2] || undefined };
  if (/^\.\.\/readme\.md$/i.test(href)) return { kind: 'home' };
  if (href.startsWith('../')) return { kind: 'external', url: BLOB + href.slice(3) };
  return { kind: 'external', url: `${BLOB}docs/${href.replace(/^\.\//, '')}` };
}

/** GitHub's anchor for a heading, so the guides' own links keep working. */
export function slug(text: string): string {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const plain = (html: string): string => html.replace(/<[^>]+>/g, '').replace(/&(?:amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e]);
const attr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * Markdown fetched from GitHub (a release's notes): its links open a new tab,
 * raw HTML shows as text, never as markup.
 */
export function renderMarkdown(md: string): string {
  const marked = new Marked({
    gfm: true,
    renderer: {
      html({ text }: Tokens.HTML | Tokens.Tag) {
        return attr(text);
      },
      link({ href, title: tip, tokens }: Tokens.Link) {
        const safe = /^https?:/i.test(href) ? href : '#';
        return `<a href="${attr(safe)}"${tip ? ` title="${attr(tip)}"` : ''} target="_blank" rel="noopener">${this.parser.parseInline(tokens)}</a>`;
      },
    },
  });
  return marked.parse(md) as string;
}

export interface RenderedDoc {
  html: string;
  title: string;
  /** its second-level headings, for the table of contents */
  sections: { id: string; title: string }[];
}

/**
 * The guide as HTML. A link to another page of the site carries `data-site-link`
 * (the page routes it); one leaving the site opens in a new tab.
 */
export function renderDoc(md: string, current: DocId, hrefOf: (link: DocLink) => string): RenderedDoc {
  const sections: RenderedDoc['sections'] = [];
  let title = '';
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }: Tokens.Heading) {
        const inner = this.parser.parseInline(tokens);
        const text = plain(inner);
        const id = slug(text);
        if (depth === 1 && !title) title = text;
        if (depth === 2) sections.push({ id, title: text });
        return `<h${depth} id="${attr(id)}">${inner}</h${depth}>\n`;
      },
      link({ href, title: tip, tokens }: Tokens.Link) {
        const inner = this.parser.parseInline(tokens);
        const link = resolveDocLink(href, current);
        const t = tip ? ` title="${attr(tip)}"` : '';
        if (link.kind === 'external') return `<a href="${attr(link.url)}"${t} target="_blank" rel="noopener">${inner}</a>`;
        return `<a href="${attr(hrefOf(link))}"${t} data-site-link>${inner}</a>`;
      },
      image({ href, title: tip, text }: Tokens.Image) {
        const src = href.startsWith('../') ? RAW + href.slice(3) : href;
        return `<img src="${attr(src)}" alt="${attr(text)}"${tip ? ` title="${attr(tip)}"` : ''} loading="lazy">`;
      },
    },
  });
  const source = md
    .replace(/^← .*$/m, '') // the guide's way back to the README: the site has its own
    .replace(/\*\*Contents\*\*[\s\S]*?\r?\n---\r?\n/, ''); // its contents: the side table lists them
  const html = (marked.parse(source) as string)
    .replace(/<table>/g, '<div class="site-doc__table"><table>')
    .replace(/<\/table>/g, '</table></div>');
  return { html, title, sections };
}
