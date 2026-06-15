import { performance } from 'node:perf_hooks';
import terminalKit from 'terminal-kit';
import type { Intent } from '../game/update.js';

type Term = typeof terminalKit.terminal;

/**
 * How long (ms) a direction stays "held" after its most recent key event.
 *
 * Terminals emit key-DOWN only — there is no key-up (see tdd input gotcha) —
 * so "still holding" is indistinguishable from "pressed once" except by a
 * timeout. This window is that timeout, and it does double duty:
 *
 *  - **Kills the initial-repeat stall.** When you hold a key the OS sends one
 *    event, waits its *initial-repeat delay* (~250–500 ms, OS-dependent), then
 *    streams auto-repeats. The window must exceed that first gap, or movement
 *    would expire before the repeats arrive and we'd be back to "move once,
 *    pause, then go." 300 ms sits just above the common macOS/Windows defaults.
 *  - **Defines the coast after release.** Because release is only inferred by
 *    timeout, the player keeps moving for up to one window after letting go.
 *    That coast is the unavoidable cost of removing the stall; the lever to
 *    tune it is this constant, not the architecture. (Linux/X11 sessions still
 *    on the old ~660 ms xset default may need a larger value to fully bridge.)
 *
 * Cadence itself is driven by the game tick (drain() runs once per SIM_DT),
 * never by the OS auto-repeat rate.
 */
export const HELD_WINDOW_MS = 300;

type Direction = 'up' | 'down' | 'left' | 'right';

/** Both arrow keys and WASD collapse onto the same four logical directions. */
const KEY_TO_DIRECTION: Record<string, Direction> = {
  UP: 'up',
  w: 'up',
  DOWN: 'down',
  s: 'down',
  LEFT: 'left',
  a: 'left',
  RIGHT: 'right',
  d: 'right',
};

const DIRECTION_DELTA: Record<Direction, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

/**
 * Translates key presses into game intents using **held-direction state**.
 *
 * Each key event records the direction and the time it was last seen; `drain()`
 * (called once per tick) emits a move intent for every direction still within
 * `HELD_WINDOW_MS` and expires the rest. This decouples movement from the OS
 * key-repeat stream: a held key moves smoothly at the game's tick cadence with
 * no mid-stall. The clock is injected so the timing is unit-testable.
 */
export class Input {
  private readonly held = new Map<Direction, number>();
  private quitRequested = false;
  private readonly now: () => number;

  constructor(term: Term, now: () => number = () => performance.now()) {
    this.now = now;
    term.on('key', (name: string) => {
      if (name === 'q' || name === 'CTRL_C') {
        this.quitRequested = true;
        return;
      }
      const dir = KEY_TO_DIRECTION[name];
      if (dir !== undefined) {
        this.held.set(dir, this.now());
      }
    });
  }

  /**
   * Emit one move intent per still-held direction and expire stale ones.
   * Re-emitting a held direction every tick is what keeps movement continuous
   * between OS auto-repeat events (and through the initial-repeat gap).
   */
  drain(): Intent[] {
    const now = this.now();
    const intents: Intent[] = [];
    for (const [dir, lastSeen] of this.held) {
      if (now - lastSeen > HELD_WINDOW_MS) {
        this.held.delete(dir);
        continue;
      }
      const delta = DIRECTION_DELTA[dir];
      intents.push({ type: 'move', dx: delta.dx, dy: delta.dy });
    }
    return intents;
  }

  get shouldQuit(): boolean {
    return this.quitRequested;
  }
}
