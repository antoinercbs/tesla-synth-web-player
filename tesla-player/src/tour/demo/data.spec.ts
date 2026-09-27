import { describe, expect, it } from 'vitest';
import SmfParser from '@/smfplayer/js/smfParser.js';
import { analyzeMidi } from '@/midi/analyze';
import { buildDemoLibrary } from './data';

// the app reads MIDI as a binary string (see SongEditor's refreshPreview)
const asString = (bytes: Uint8Array): string => String.fromCharCode(...bytes);

describe('tour demo library', () => {
  const lib = buildDemoLibrary('fr');

  it('generates MIDI the app itself can read, matching what the library says', () => {
    for (const f of lib.files) {
      const bytes = lib.bytes.get(f.path.replace(/^\./, ''));
      expect(bytes, f.name).toBeDefined();
      const a = analyzeMidi(new SmfParser().parse(asString(bytes!)));
      expect(a.channels.length, f.name).toBe(f.channels);
      for (const ch of a.channels) expect(a.programByChannel[ch] ?? 0, `${f.name} ch ${ch}`).toBe(f.programs?.[ch]);
      expect(Math.abs(a.durationMs - (f.durationMs ?? 0)), f.name).toBeLessThan(1000);
    }
  });

  it('only points at things that exist', () => {
    const fileIds = new Set(lib.files.map((f) => f.id));
    const songIds = new Set(lib.songs.map((s) => s.id));
    for (const s of lib.songs) {
      expect(fileIds.has(s.midiFile!.id), s.name).toBe(true);
      expect(s.coils.length, s.name).toBe(s.coilCount);
    }
    for (const p of lib.playlists) for (const id of p.songIds) expect(songIds.has(id), p.name).toBe(true);
  });
});
