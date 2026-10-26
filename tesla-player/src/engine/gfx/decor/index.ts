import type { DecorId } from '@/model/coils/scene-data';
import { GfxConcertDecor } from './concert';
import { GfxCycloDecor } from './cyclo';
import type { GfxDecor } from './decor';
import { GfxHallDecor } from './hall';
import { GfxLabDecor } from './lab';

export { GfxDecor } from './decor';

/** A scene's décor; none: the dark hall. */
export function gfxDecor(id: DecorId | null): GfxDecor {
  switch (id) {
    case 'lab': return new GfxLabDecor();
    case 'concert': return new GfxConcertDecor();
    case 'cyclo': return new GfxCycloDecor();
    default: return new GfxHallDecor();
  }
}
