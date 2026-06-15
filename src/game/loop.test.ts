import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Drives the loop's `performance.now()`. The loop banks elapsed wall-clock time
// into its accumulator, so to exercise the fixed-timestep math we control time
// explicitly rather than relying on real clocks.
let nowMs = 0;
vi.mock('node:perf_hooks', () => ({
  performance: { now: () => nowMs },
}));

import { runLoop, type LoopHooks } from './loop.js';
import { SIM_DT } from './update.js';
import type { GameState } from './state.js';

function makeState(): GameState {
  return {
    world: { width: 1, height: 1, tiles: [['floor']], seed: 0 },
    player: { pos: { x: 0, y: 0 } },
    tick: 0,
  };
}

/**
 * A recording hooks stub. `lastTick` is the `tick` of the most recently
 * rendered state — since `update` is pure and bumps `tick`, it doubles as the
 * count of update steps that have run. `renders`/`onStops` count those calls.
 */
function recorder(stop = false): LoopHooks & {
  lastTick: number;
  renders: number;
  onStops: number;
} {
  const rec = {
    drainIntents: (): [] => [],
    render(state: GameState): void {
      this.lastTick = state.tick;
      this.renders += 1;
    },
    shouldStop: (): boolean => stop,
    onStop(): void {
      this.onStops += 1;
    },
    lastTick: -1,
    renders: 0,
    onStops: 0,
  };
  return rec;
}

describe('runLoop', () => {
  beforeEach(() => {
    nowMs = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('renders the first frame immediately and schedules the first tick', () => {
    const rec = recorder();
    runLoop(makeState(), rec);
    // First frame is drawn (tick 0) before any tick runs.
    expect(rec.renders).toBe(1);
    expect(rec.lastTick).toBe(0);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('advancing exactly SIM_DT runs update once and render once', () => {
    const rec = recorder();
    runLoop(makeState(), rec);

    nowMs += SIM_DT;
    vi.advanceTimersByTime(SIM_DT);

    expect(rec.lastTick).toBe(1); // one update step (tick 0 -> 1)
    expect(rec.renders).toBe(2); // initial frame + this frame
  });

  it('a 3*SIM_DT gap runs update 3x but renders only once (catch-up)', () => {
    const rec = recorder();
    runLoop(makeState(), rec);

    // +1ms over three steps so float error in the accumulator can't drop the
    // third step; still well under a fourth step.
    nowMs += 3 * SIM_DT + 1;
    vi.advanceTimersByTime(SIM_DT); // fire the scheduled tick

    expect(rec.lastTick).toBe(3); // three update steps in the catch-up loop
    expect(rec.renders).toBe(2); // initial frame + one render after catching up
  });

  it('a gap shorter than SIM_DT runs neither update nor render', () => {
    const rec = recorder();
    runLoop(makeState(), rec);

    nowMs += SIM_DT / 2; // not enough to advance one step
    vi.advanceTimersByTime(SIM_DT);

    expect(rec.lastTick).toBe(0); // never advanced past the initial state
    expect(rec.renders).toBe(1); // only the initial frame; no second draw
  });

  it('clamps a long stall to MAX_FRAME_MS — no runaway catch-up', () => {
    const rec = recorder();
    runLoop(makeState(), rec);

    // A 1000ms stall (e.g. a GC pause). Without the clamp this would run
    // 1000/SIM_DT ≈ 15 updates; MAX_FRAME_MS (250ms) caps the catch-up.
    nowMs += 1000;
    vi.advanceTimersByTime(SIM_DT);

    const maxSteps = Math.floor(250 / SIM_DT); // 250 / 66.6 = 3
    expect(rec.lastTick).toBe(maxSteps);
    expect(rec.renders).toBe(2); // initial frame + one render
  });

  it('calls onStop and schedules no further tick when shouldStop is true', () => {
    const rec = recorder(true);
    runLoop(makeState(), rec);
    expect(rec.renders).toBe(1); // first frame still drawn
    expect(vi.getTimerCount()).toBe(1); // the first tick is scheduled

    nowMs += SIM_DT;
    vi.advanceTimersByTime(SIM_DT); // fires the tick, which sees shouldStop

    expect(rec.onStops).toBe(1);
    expect(vi.getTimerCount()).toBe(0); // returned early — no further tick
    expect(rec.renders).toBe(1); // never advanced the sim / drew again
  });
});
