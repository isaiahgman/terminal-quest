import { performance } from 'node:perf_hooks';
import { type GameState } from './state.js';
import { type Rng } from './combat.js';
import { type Intent, SIM_DT, SIM_DT_SECONDS, update } from './update.js';

export interface LoopHooks {
  /** Pull (and clear) the intents collected since the last tick. */
  drainIntents: () => readonly Intent[];
  /** Injected seeded randomness for the sim (attack rolls); see `combat.ts`. */
  rng: Rng;
  /** Draw the current state (read-only). */
  render: (state: GameState) => void;
  /** Return true to end the loop. */
  shouldStop: () => boolean;
  /** Called once when the loop stops. */
  onStop: () => void;
}

/** Clamp on accumulated time so a GC pause can't trigger the "spiral of death". */
const MAX_FRAME_MS = 250;

/**
 * Fixed-timestep game loop. Advances the simulation in constant `SIM_DT` steps
 * (banking leftover time in an accumulator), then renders. Using a constant step
 * — not wall-clock — is what keeps the simulation deterministic.
 */
export function runLoop(initial: GameState, hooks: LoopHooks): void {
  let state = initial;
  let last = performance.now();
  let acc = 0;

  const tick = (): void => {
    if (hooks.shouldStop()) {
      hooks.onStop();
      return;
    }

    const now = performance.now();
    acc += Math.min(now - last, MAX_FRAME_MS);
    last = now;

    let advanced = false;
    if (acc >= SIM_DT) {
      // Drain once per frame, not per sub-step: a multi-step catch-up frame must
      // apply the same buffered intents to every step. Draining inside the loop
      // would feed the intents to the first step and an empty list to the rest.
      // Guarded by `acc >= SIM_DT` so a sub-step frame (no step runs) never
      // drains and silently discards intents that arrived too early.
      const intents = hooks.drainIntents();
      while (acc >= SIM_DT) {
        state = update(state, intents, SIM_DT_SECONDS, hooks.rng);
        acc -= SIM_DT;
        advanced = true;
      }
    }

    if (advanced) hooks.render(state);
    setTimeout(tick, Math.max(0, SIM_DT - acc));
  };

  hooks.render(state); // first frame
  setTimeout(tick, SIM_DT);
}
