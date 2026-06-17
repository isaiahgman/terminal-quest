import { performance } from 'node:perf_hooks';
import type { Intent } from '../game/update.js';
import type { KeyEvent } from './keyDecoder.js';

/**
 * How long (ms) a direction stays "held" after its most recent key event —
 * used **only in the timeout (fallback) tier**, when the terminal can't tell us
 * a key was released.
 *
 * Terminals without the kitty keyboard protocol emit key-DOWN only (see tdd
 * §12), so "still holding" is indistinguishable from "pressed once" except by a
 * timeout. This window is that timeout, and it does double duty:
 *
 *  - **Kills the initial-repeat stall.** When you hold a key the OS sends one
 *    event, waits its *initial-repeat delay* (~250–500 ms, OS-dependent), then
 *    streams auto-repeats. The window must exceed that first gap, or movement
 *    would expire before the repeats arrive and we'd be back to "move once,
 *    pause, then go." 300 ms sits just above the common macOS/Windows defaults.
 *  - **Defines the coast after release.** Because release is only inferred by
 *    timeout, the player keeps moving for up to one window after letting go.
 *    That coast is the unavoidable cost of removing the stall in this tier.
 *
 * When the kitty protocol is active ({@link Input.useReleaseEvents}) real
 * key-up events arrive, so this window is bypassed — release removes a
 * direction immediately and there is no coast.
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

function isQuit(name: string): boolean {
  return name === 'q' || name === 'CTRL_C';
}

/**
 * Translates key events into game intents using **held-direction state**, fed
 * by logical key events from whichever source the CLI wired up:
 *
 *  - **Timeout tier (fallback):** only presses/repeats arrive; a direction is
 *    held for {@link HELD_WINDOW_MS} after its last event and `drain()` expires
 *    the stale ones. Bridges the OS initial-repeat gap at the cost of a coast.
 *  - **Release tier (kitty protocol):** real press/repeat/**release** events
 *    arrive; {@link useReleaseEvents} switches off the timeout so a release
 *    removes its direction at once — crisp switching, no coast.
 *
 * Either way `drain()` (once per tick) emits one move intent per still-held
 * direction, so cadence is the game's tick, never the OS key-repeat rate. The
 * clock is injected so the timing is unit-testable.
 */
export class Input {
  private readonly held = new Map<Direction, number>();
  private quitRequested = false;
  private releaseDriven = false;
  private readonly now: () => number;

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
  }

  /**
   * Switch to release-driven mode: directions are removed on a real key-up
   * rather than by timeout. Call this once when the kitty protocol is active.
   */
  useReleaseEvents(): void {
    this.releaseDriven = true;
  }

  /** Apply a decoded key event (press, repeat, or release). */
  apply(event: KeyEvent): void {
    if (event.kind === 'release') {
      this.onRelease(event.name);
    } else {
      this.onPressOrRepeat(event.name);
    }
  }

  private onPressOrRepeat(name: string): void {
    if (isQuit(name)) {
      this.quitRequested = true;
      return;
    }
    const dir = KEY_TO_DIRECTION[name];
    if (dir !== undefined) {
      // Re-seat the direction at the end of the Map so the most-recently
      // pressed direction is always last in iteration order. `update()` applies
      // only the *last* move intent per tick, so without the delete a re-press
      // of an already-held direction keeps its old slot and a quick reversal
      // (up → down → up) stays stuck on the previous direction. delete-then-set
      // makes "last pressed wins" actually true.
      this.held.delete(dir);
      this.held.set(dir, this.now());
    }
  }

  private onRelease(name: string): void {
    if (isQuit(name)) return; // releasing q / Ctrl-C is a no-op
    const dir = KEY_TO_DIRECTION[name];
    if (dir !== undefined) this.held.delete(dir);
  }

  /**
   * Emit one move intent per still-held direction. In the timeout tier this
   * also expires directions whose last event is older than the window; in the
   * release tier expiry is driven by real key-up events instead.
   */
  drain(): Intent[] {
    const now = this.now();
    const intents: Intent[] = [];
    for (const [dir, lastSeen] of this.held) {
      if (!this.releaseDriven && now - lastSeen > HELD_WINDOW_MS) {
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
