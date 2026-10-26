/**
 * The little markup of the tour cards' texts (tour.steps.* translations):
 * **bold** for what is on screen (a button, a tab), [key] for a keyboard key.
 * Everything else is plain text: nothing is read as HTML.
 */
export interface RichPart {
  kind: 'text' | 'bold' | 'key';
  value: string;
}

const MARKUP = /\*\*(.+?)\*\*|\[([^\]\n]+)\]/g;

export function parseRich(text: string): RichPart[] {
  const out: RichPart[] = [];
  let last = 0;
  for (const m of text.matchAll(MARKUP)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: 'text', value: text.slice(last, at) });
    out.push(m[1] !== undefined ? { kind: 'bold', value: m[1] } : { kind: 'key', value: m[2] });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', value: text.slice(last) });
  return out;
}
