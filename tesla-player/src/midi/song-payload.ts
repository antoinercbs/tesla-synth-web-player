import type { Song } from '@/types/domain';

/**
 * What PUT /api/songs/:id takes for a song as the library holds it, with its
 * tags replaced when `tagIds` is given: a change made from a list (tagging a
 * selection) sends the rest of the song back as it was. The song editor builds
 * its own from its draft (SongEditor's buildPayload). The file is not in it: it
 * changes through PUT /api/songs/:id/midi (midi/song-file.ts).
 */
export function songPayload(song: Song, tagIds?: number[]) {
  return {
    name: song.name,
    coilCount: song.coilCount,
    mode: song.mode,
    output2Mask: song.output2Mask ?? 0,
    coils: [...(song.coils ?? [])]
      .sort((a, b) => a.coilIndex - b.coilIndex)
      .slice(0, song.coilCount)
      .map((c, i) => ({ coilIndex: i, channelMask: c.channelMask, ontimeUs: c.ontimeUs, duty: c.duty })),
    events: (song.events ?? [])
      .filter((e) => e.coilIndex < song.coilCount)
      .map((e) => ({ coilIndex: e.coilIndex, atMs: Math.round(e.atMs), param: e.param, value: e.value, ...(e.ramp ? { ramp: true } : {}) })),
    tagIds: tagIds ?? (song.tags ?? []).map((t) => t.id).filter((id): id is number => id != null),
    stereo: song.stereo ?? null,
  };
}
