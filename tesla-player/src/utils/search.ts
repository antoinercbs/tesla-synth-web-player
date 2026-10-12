/**
 * The app's text search. The words of a query match in any order, each in one
 * of an item's fields (its name, a tag, its file…), whatever the case, the
 * accents or the punctuation: "joie ode" finds « Ode à la joie », "fur elise"
 * « Für Elise », "tetris jeu" a song named Tetris tagged « Jeu vidéo ». A word
 * is matched inside a field, never across two (a name ending in "c" and a tag
 * "rock" don't make "crock"). A quoted phrase keeps its words together
 * ("la joie"); a word after a minus leaves out what holds it (-classique).
 */

export interface ParsedQuery {
  /** What every match holds: words, or phrases of several words. */
  include: string[];
  /** What no match holds. */
  exclude: string[];
}

type Field = string | null | undefined;

const LIGATURES: Record<string, string> = { œ: 'oe', æ: 'ae', ß: 'ss' };

/** Lower case, no accents, any run of punctuation or spaces as one space. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[œæß]/g, (c) => LIGATURES[c])
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// a word typed with punctuation inside ("l'antre", "AC/DC") stays one piece: a phrase
const TOKEN = /(-?)"([^"]*)"?|(-?)(\S+)/g;

export function parseQuery(query: string): ParsedQuery {
  const parsed: ParsedQuery = { include: [], exclude: [] };
  for (const m of query.matchAll(TOKEN)) {
    const quoted = m[2] !== undefined;
    const minus = (quoted ? m[1] : m[3]) === '-';
    const text = normalize(quoted ? m[2] : m[4]);
    if (!text) continue;
    (minus ? parsed.exclude : parsed.include).push(text);
  }
  return parsed;
}

export function isEmptyQuery(q: ParsedQuery): boolean {
  return q.include.length === 0 && q.exclude.length === 0;
}

// "acdc" finds « AC/DC », "remix" « Re-mix »: each field is also read without its spaces
function holds(field: { spaced: string; joined: string }, term: string): boolean {
  return field.spaced.includes(term) || field.joined.includes(term.replaceAll(' ', ''));
}

/** Does an item, through its fields, answer the query? */
export function matches(q: ParsedQuery, fields: Field[]): boolean {
  if (isEmptyQuery(q)) return true;
  const prepared = fields
    .filter((f): f is string => !!f)
    .map((f) => {
      const spaced = normalize(f);
      return { spaced, joined: spaced.replaceAll(' ', '') };
    });
  return (
    q.include.every((term) => prepared.some((f) => holds(f, term))) &&
    !q.exclude.some((term) => prepared.some((f) => holds(f, term)))
  );
}

/** The items answering `query`, in their order. */
export function search<T>(items: readonly T[], query: string, fields: (item: T) => Field[]): T[] {
  const q = parseQuery(query);
  return isEmptyQuery(q) ? [...items] : items.filter((item) => matches(q, fields(item)));
}
