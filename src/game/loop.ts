import { performance } from 'node:perf_hooks';
import { type GameState } from './state.js';
import { type Intent, SIM_DT, update } from './update.js';

export interface LoopHooks {
  /** Pull (and clear) the intents collected since the last tick. */
  drainIntents: () => readonly Intent[];
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
    while (acc >= SIM_DT) {
      state = update(state, hooks.drainIntents());
      acc -= SIM_DT;
      advanced = true;
    }

    if (advanced) hooks.render(state);
    setTimeout(tick, Math.max(0, SIM_DT - acc));
  };

  hooks.render(state); // first frame
  setTimeout(tick, SIM_DT);
}
