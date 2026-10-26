import { describe, expect, it } from 'vitest';
import { DevBoard, type BoardCoil, type BoardNote } from './board';

const COIL: BoardCoil = { drive: { ontimeUs: 40, duty: 0.05 }, limits: { voices: 1 } };
const note = (id: number, level = 1, touched = false): BoardNote => ({ id, hz: 523.25, level, vols: [1], touched });

describe('the board\'s voices', () => {
  it('gives the only voice to the newest note', () => {
    const [step] = new DevBoard().step([note(1), note(2)], [COIL]);
    expect(step.fired).toEqual([1]);
    expect(step.cut).toEqual([0]);
  });

  it('leaves a cut note silent once the voice frees up, until it changes', () => {
    const core = new DevBoard();
    core.step([note(1), note(2)], [COIL]);
    core.forget(2);
    expect(core.step([note(1)], [COIL])[0].cut).toEqual([0]);
    expect(core.step([note(1, 0.9)], [COIL])[0].fired).toEqual([0]);
  });

  it('looks at a note again when its channel\'s controllers change', () => {
    const core = new DevBoard();
    core.step([note(1), note(2)], [COIL]);
    core.forget(2);
    expect(core.step([note(1, 1, true)], [COIL])[0].fired).toEqual([0]);
  });

  it('steps a copy on its own', () => {
    const core = new DevBoard();
    core.step([note(1), note(2)], [COIL]);
    const copy = core.clone();
    core.forget(2);
    core.step([note(1, 0.9)], [COIL]);
    copy.forget(2);
    expect(copy.step([note(1)], [COIL])[0].cut).toEqual([0]);
  });
});
