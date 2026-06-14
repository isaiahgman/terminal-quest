import { type GameState, isWalkable } from './state.js';

/** A player-issued action for one tick. (More variants land in later PRs.) */
export interface MoveIntent {
  type: 'move';
  dx: number;
  dy: number;
}
export type Intent = MoveIntent;

/** Constant simulation step (ms). The loop always advances by exactly this. */
export const SIM_DT = 1000 / 15;

/**
 * Advance the simulation by one tick. PURE: the same (state, intents) always
 * produces the same result — no I/O, no drawing, no Math.random. This is the
 * heart of the game; the renderer only ever reads what this returns.
 *
 * `dt` is accepted (and fixed to SIM_DT by the loop) so the signature stays
 * loop-agnostic and deterministic; movement is grid-stepped, so it's unused today.
 */
export function update(
  state: GameState,
  intents: readonly Intent[],
  _dt: number,
): GameState {
  let { x, y } = state.player.pos;

  for (const intent of intents) {
    if (intent.type === 'move') {
      const nx = x + intent.dx;
      const ny = y + intent.dy;
      if (isWalkable(state.world, nx, ny)) {
        x = nx;
        y = ny;
      }
    }
  }

  return {
    ...state,
    player: { ...state.player, pos: { x, y } },
    tick: state.tick + 1,
  };
}
