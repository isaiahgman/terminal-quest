import { performance } from 'node:perf_hooks';
import { type GameState } from './state.js';
import { type RngFn } from './combat.js';
import { type Intent, SIM_DT, SIM_DT_SECONDS, update } from './update.js';

export interface LoopHooks {
  /** Pull (and clear) the intents collected since the last tick. */
  drainIntents: () => readonly Intent[];
  /** Injected seeded randomness for the sim (attack rolls); see `combat.ts`. */
  rng: RngFn;
  /** Draw the current state (read-only). */
  render: (state: GameState) => void;
  /** Return true to end the loop. */
  shouldStop: () => boolean;
  /** Called once when the loop stops. */
  onStop: () => void;
}

/** Clamp on accumulated time so a GC pause can't trigger the "spiral of death". */
const MAX_FRAME_MS = 250;

/** A run is over once it reaches a terminal status (TQ-020) — halt the sim then. */
function isOver(state: GameState): boolean {
  return state.status === 'victory' || state.status === 'defeat';
}

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
    const elapsed = Math.min(now - last, MAX_FRAME_MS);
    last = now;

    // Once the run is over (victory/defeat, TQ-020), freeze the simulation: bank
    // no time and run no update, so enemies stop and the end screen stays put.
    // Keep the loop alive at the frame cadence so quit (shouldStop) still works;
    // the frame that ended the run already rendered it, so nothing to redraw.
    if (isOver(state)) {
      setTimeout(tick, SIM_DT);
      return;
    }

    acc += elapsed;
    let advanced = false;
    // Drain once per simulation step, not once per frame: each fixed step is a
    // discrete tick of simulated time and must consume its own intents. The
    // input layer's `drain()` re-emits each still-held direction every call (so a
    // held move advances one tile per step, staying in lockstep with the enemies
    // that also step here), while a one-shot intent (a single attack/tap) is
    // returned by exactly one drain and never replayed — so a multi-step catch-up
    // frame can't turn one keypress into several swings. A sub-step frame
    // (`acc < SIM_DT`) runs the loop zero times, so it never drains; held intents
    // simply persist to the next frame, and one-shots are still buffered.
    while (acc >= SIM_DT) {
      const intents = hooks.drainIntents();
      state = update(state, intents, SIM_DT_SECONDS, hooks.rng);
      acc -= SIM_DT;
      advanced = true;
      if (isOver(state)) break; // ended this step — stop advancing immediately
    }

    if (advanced) hooks.render(state);
    setTimeout(tick, Math.max(0, SIM_DT - acc));
  };

  hooks.render(state); // first frame
  setTimeout(tick, SIM_DT);
}
