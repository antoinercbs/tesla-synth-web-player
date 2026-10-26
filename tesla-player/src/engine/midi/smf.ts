import SmfParser from '@/engine/smfplayer/js/smfParser.js';

/**
 * A standard MIDI file's bytes, parsed by the player's SmfParser (it reads a
 * string of byte codes). Read as UTF-8 when it is, so the names in its text
 * events keep their accents; as plain bytes otherwise.
 */
export function parseSmf(data: ArrayBuffer | Uint8Array): unknown {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  let text = binary;
  try {
    text = decodeURIComponent(escape(binary));
  } catch {
    /* not UTF-8: the bytes as they are */
  }
  return new SmfParser().parse(text);
}
