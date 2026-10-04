import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOC_GROUPS, DOC_IDS, renderDoc, resolveDocLink, slug, type DocLink } from './docs';

const DOCS = new URL('../../../docs/', import.meta.url);
const read = (id: string): string => readFileSync(new URL(`${id}.md`, DOCS), 'utf8');
const href = (l: DocLink): string => (l.kind === 'doc' ? `/docs/${l.doc}${l.anchor ? '#' + l.anchor : ''}` : l.kind === 'home' ? '/' : l.url);

describe('docs', () => {
  it('list every guide of docs/, once in the table of contents', () => {
    const inToc = DOC_GROUPS.flatMap((g) => g.docs);
    expect([...inToc].sort()).toEqual([...DOC_IDS].sort());
    for (const id of DOC_IDS) expect(read(id).length).toBeGreaterThan(0);
  });

  it('send a link between guides to the site, the others to the repository', () => {
    expect(resolveDocLink('./tuning.md', 'user-guide')).toEqual({ kind: 'doc', doc: 'tuning', anchor: undefined });
    expect(resolveDocLink('./development.md#desktop-binaries', 'deployment')).toEqual({ kind: 'doc', doc: 'development', anchor: 'desktop-binaries' });
    expect(resolveDocLink('#saving-a-tuning', 'tuning')).toEqual({ kind: 'doc', doc: 'tuning', anchor: 'saving-a-tuning' });
    expect(resolveDocLink('./README.md', 'tuning')).toEqual({ kind: 'doc', doc: 'README', anchor: undefined });
    expect(resolveDocLink('../readme.md', 'tuning')).toEqual({ kind: 'home' });
    expect(resolveDocLink('../docker-compose.yml', 'deployment')).toEqual({ kind: 'external', url: 'https://github.com/antoinercbs/tesla-synth-web-player/blob/main/docker-compose.yml' });
    expect(resolveDocLink('https://github.com/FiloSottile/mkcert', 'development')).toEqual({ kind: 'external', url: 'https://github.com/FiloSottile/mkcert' });
  });

  it('give headings the anchors GitHub gives them', () => {
    expect(slug('MIDI files & the MIDI editor')).toBe('midi-files--the-midi-editor');
    expect(slug('Building & publishing the image (GitHub Actions)')).toBe('building--publishing-the-image-github-actions');
    expect(slug('Linux: making the serial port work')).toBe('linux-making-the-serial-port-work');
  });

  it('keep every anchor a guide links to', () => {
    const rendered = Object.fromEntries(DOC_IDS.map((id) => [id, renderDoc(read(id), id, href).html]));
    const missing: string[] = [];
    for (const id of DOC_IDS) {
      for (const m of rendered[id].matchAll(/href="\/docs\/([\w-]+)#([^"]+)"/g)) {
        if (!rendered[m[1] as keyof typeof rendered]?.includes(`id="${m[2]}"`)) missing.push(`${id} → ${m[1]}#${m[2]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('drop the parts the site shows its own way, and list the sections', () => {
    const doc = renderDoc(read('tuning'), 'tuning', href);
    expect(doc.html).not.toContain('Back to');
    expect(doc.html).not.toContain('<strong>Contents</strong>');
    expect(doc.title).toBe('Camera-assisted tuning');
    expect(doc.sections.map((s) => s.id)).toContain('saving-a-tuning');
  });
});
