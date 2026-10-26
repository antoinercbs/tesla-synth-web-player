import { CalRoles, type ChannelProfile, type ChannelRole } from '@/model/calib/roles';
import type { CalibRequest } from './types';

/** How a coil sounds with some channels: its level (dB) and how uneven its notes are. */
export interface CalSetup { level: number; spread: number }

// what a line costs on a coil given another role: less than leaving a line unheard
const FOREIGN_LINE = 8;

/**
 * Channels onto coils: louder and more even lines, each coil on a tight
 * register and within its voices, every line heard; then a line doubled on
 * another coil while it helps. Every routing when they are few, else a greedy
 * start improved by moves and swaps. A coil given a role plays its channels:
 * they are placed, the search places the others.
 */
export class CalRouting {
  private readonly all: readonly ChannelProfile[];
  private readonly N: number;
  private readonly forced: number[];
  /** The channels left to place. */
  private readonly chans: ChannelProfile[];
  /** The coils left to the search. */
  private readonly autoN: number;

  /** setupOf: how coil k sounds with the channels of `mask`; null: it can't. */
  constructor(private readonly req: CalibRequest, private readonly setupOf: (k: number, mask: number) => CalSetup | null) {
    this.all = req.profiles;
    this.N = req.coilCount;
    this.forced = CalRouting.forcedMasks(this.all, req.coilRoles, this.N);
    const pinned = this.forced.reduce((m, f) => m | f, 0);
    this.chans = this.all.filter((c) => !(pinned & (1 << c.ch)));
    this.autoN = this.forced.filter((f) => !f).length;
  }

  /** The channels each coil must play, by coil index (0: free), from the roles given to the coils. */
  static forcedMasks(profiles: readonly ChannelProfile[], coilRoles: readonly (ChannelRole | null)[] | undefined, coilCount: number): number[] {
    return Array.from({ length: coilCount }, (_, k) => {
      const role = coilRoles?.[k];
      return role ? profiles.filter((c) => c.role === role).reduce((m, c) => m | (1 << c.ch), 0) : 0;
    });
  }

  /** The routing found: one mask of channels per coil. */
  masks(): number[] {
    const { all, N, chans } = this, K = chans.length;
    if (!all.length) return new Array(N).fill(0);
    let best: { assign: number[]; masks: number[]; score: number } | null = null;
    if (N ** K <= 3000) {
      for (let code = 0; code < N ** K; code++) {
        const assign: number[] = [];
        for (let i = 0, x = code; i < K; i++, x = Math.floor(x / N)) assign.push(x % N);
        const masks = this.masksOf(assign);
        const score = this.evaluate(masks);
        if (score != null && (!best || score > best.score)) best = { assign, masks, score };
      }
    } else {
      const order = chans.map((_, i) => i).sort((i, j) => chans[j].count - chans[i].count);
      const assign = new Array(K).fill(-1);
      order.forEach((i, n) => {
        let pick = 0, top = -Infinity;
        for (let k = 0; k < N; k++) {
          // the busiest channels first, one per coil while some stay empty
          if (n < N && assign.includes(k)) continue;
          assign[i] = k;
          const score = this.evaluate(this.masksOf(assign), true) ?? -Infinity;
          if (score > top) { top = score; pick = k; }
        }
        assign[i] = pick;
      });
      best = { assign: [...assign], masks: this.masksOf(assign), score: this.evaluate(this.masksOf(assign)) ?? -Infinity };
      for (let round = 0, better = true; better && round < 40; round++) {
        better = false;
        for (let i = 0; i < K; i++) {
          for (let k = 0; k < N; k++) {
            if (best.assign[i] === k) continue;
            const moved: number[] = [...best.assign];
            moved[i] = k;
            const score = this.evaluate(this.masksOf(moved));
            if (score != null && score > best.score + 1e-6) { best = { assign: moved, masks: this.masksOf(moved), score }; better = true; }
          }
          for (let j = i + 1; j < K; j++) {
            if (best.assign[i] === best.assign[j]) continue;
            const swapped: number[] = [...best.assign];
            [swapped[i], swapped[j]] = [swapped[j], swapped[i]];
            const score = this.evaluate(this.masksOf(swapped));
            if (score != null && score > best.score + 1e-6) { best = { assign: swapped, masks: this.masksOf(swapped), score }; better = true; }
          }
        }
      }
    }
    if (!best) return new Array(N).fill(0);
    // doubling: a line onto another coil too, the weightiest first, while it clearly helps
    const byWeight = [...all].sort((x, y) => CalRoles.WEIGHT[y.role] - CalRoles.WEIGHT[x.role]);
    for (let round = 0, better = true; better && round < 6; round++) {
      better = false;
      for (const c of byWeight) {
        for (let k = 0; k < N && !better; k++) {
          if (best.masks[k] & (1 << c.ch)) continue;
          const masks: number[] = [...best.masks];
          masks[k] |= 1 << c.ch;
          const score = this.evaluate(masks);
          if (score != null && score > best.score + 0.5) { best = { ...best, masks, score }; better = true; }
        }
        if (better) break;
      }
    }
    // a coil left idle on stage plays the line it adds most to, the weightiest first
    for (let k = 0; k < N; k++) {
      if (best.masks[k]) continue;
      let pick: { masks: number[]; score: number } | null = null;
      for (const c of byWeight) {
        const masks: number[] = [...best.masks];
        masks[k] |= 1 << c.ch;
        const score = this.evaluate(masks);
        if (score != null && (!pick || score > pick.score)) pick = { masks, score };
      }
      if (pick) best = { ...best, ...pick };
    }
    return best.masks;
  }

  /** A routing's worth; null: it leaves a coil idle while lines could fill it. partial: some channels not placed yet. */
  private evaluate(masks: number[], partial = false): number | null {
    const { all, forced, req } = this;
    if (!partial && this.chans.length >= this.autoN && masks.some((m, k) => !forced[k] && !m)) return null;
    let cost = 0;
    masks.forEach((m, k) => {
      const cs = all.filter((c) => m & (1 << c.ch));
      if (!cs.length) return;
      const lo = Math.min(...cs.map((c) => c.lo)), hi = Math.max(...cs.map((c) => c.hi));
      const poly = cs.reduce((t, c) => t + c.maxPoly, 0);
      // each more line on a coil blurs the lines apart
      cost += (hi - lo) / 12 + Math.max(0, poly - req.limits[k].voices) * 2 + (cs.length - 1) * 2;
      if (forced[k]) cost += FOREIGN_LINE * cs.filter((c) => !(forced[k] & (1 << c.ch))).length;
    });
    const setups = masks.map((m, k) => (m ? this.setupOf(k, m) : null));
    let level = 0;
    for (const c of all) {
      let power = 0;
      setups.forEach((st, k) => { if (st && masks[k] & (1 << c.ch)) power += 10 ** (st.level / 10); });
      if (power) level += CalRoles.WEIGHT[c.role] * 10 * Math.log10(power);
      else if (!partial) level -= 30 * CalRoles.WEIGHT[c.role];
    }
    level -= setups.reduce((t, st) => t + (st ? st.spread * 0.5 : 0), 0);
    return level - cost;
  }

  /** The masks of an assignment (a coil per channel to place, −1: none yet), over the forced ones. */
  private masksOf(assign: number[]): number[] {
    const masks = [...this.forced];
    assign.forEach((k, i) => { if (k >= 0) masks[k] |= 1 << this.chans[i].ch; });
    return masks;
  }
}
