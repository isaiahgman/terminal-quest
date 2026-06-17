import { type GameState, isWalkable } from './state.js';
import { createProgression, gainXp, xpForKill } from './progression.js';

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

  const advanced: GameState = {
    ...state,
    player: { ...state.player, pos: { x, y } },
    tick: state.tick + 1,
  };

  // Kill → XP hook (TQ-009). An enemy whose hp has reached 0 (combat lands the
  // killing blow in a later integration PR) is "slain": remove it from the world
  // and award its XP to the player, levelling up across any thresholds crossed.
  // No enemies or none slain ⇒ the movement-only result is returned untouched,
  // keeping this hook a tiny, behaviour-preserving addition.
  const enemies = advanced.enemies;
  if (enemies === undefined) return advanced;

  const slain = enemies.filter((enemy) => enemy.hp <= 0);
  if (slain.length === 0) return advanced;

  const awarded = slain.reduce((total, enemy) => total + xpForKill(enemy), 0);
  return {
    ...advanced,
    player: {
      ...advanced.player,
      progress: gainXp(advanced.player.progress ?? createProgression(), awarded),
    },
    enemies: enemies.filter((enemy) => enemy.hp > 0),
  };
}
