import { describe, expect, it } from 'vitest';
import { PhyScene, type SceneData } from '@/model/coils/scene-data';

const scene = (name: string, coils: string[]): { name: string; data: SceneData } => ({ name, data: PhyScene.of({ coils: coils.map((coil) => ({ coil })) }) });

describe("a song's scenes", () => {
  it('puts first those that pose the most of its coils, then those with the fewest others', () => {
    const list = [scene('none', ['x']), scene('one', ['a']), scene('both and more', ['a', 'b', 'c']), scene('both', ['b', 'a']), scene('other one', ['b', 'x'])];
    expect(PhyScene.bySong(list, ['a', 'b']).map((s) => s.name)).toEqual(['both', 'both and more', 'one', 'other one', 'none']);
  });

  it("keeps the list's order without a song", () => {
    const list = [scene('1', ['a']), scene('2', [])];
    expect(PhyScene.bySong(list, []).map((s) => s.name)).toEqual(['1', '2']);
  });
});
