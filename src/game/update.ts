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
 */
export function update(
  state: GameState,
  intents: readonly Intent[],
): GameState {
  let { x, y } = state.player.pos;

  // Cap movement at one tile per tick. Auto-repeat (holding a key) and the
  // input buffer can queue several move intents per simulation step; applying
  // all of them would let the player jump multiple tiles in a single tick,
  // breaking the fixed-timestep model. Take the last move intent — the player's
  // most recent direction — and apply at most that single step.
  let move: MoveIntent | undefined;
  for (const intent of intents) {
    if (intent.type === 'move') {
      move = intent;
    }
  }

  if (move !== undefined) {
    const nx = x + move.dx;
    const ny = y + move.dy;
    if (isWalkable(state.world, nx, ny)) {
      x = nx;
      y = ny;
    }
  }

  return {
    ...state,
    player: { ...state.player, pos: { x, y } },
    tick: state.tick + 1,
  };
}
