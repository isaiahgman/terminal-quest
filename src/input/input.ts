import { performance } from 'node:perf_hooks';
import type { Intent, MoveIntent } from '../game/update.js';
import type { KeyEvent } from './keyDecoder.js';
import { ATTACK_KEYS } from '../data/attacks.js';

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

/**
 * Safety net (ms) for the **release tier** only: the longest a direction may
 * stay held without *any* fresh event (press/repeat) before it is force-expired.
 *
 * The release tier trusts real key-up events, but a key-up can be lost — most
 * commonly when the window **loses focus while a key is held** (alt-tab away):
 * the terminal sends no release, so without this the player would return moving
 * forever. The kitty protocol streams `repeat` events while a key is physically
 * held, so a genuinely-held direction keeps refreshing its timestamp and never
 * trips this; only a direction whose stream has gone silent (focus lost) does.
 *
 * It must sit **above the OS initial-repeat delay** (the gap between the first
 * press and the first repeat, up to ~660 ms on old X11) so a normally-held key
 * isn't expired during that pre-repeat lull — hence 1 s, comfortably clear of
 * it. The cost is that a lost release coasts ≤ 1 s before auto-recovering,
 * versus the instant stop of a real release.
 */
export const RELEASE_SAFETY_NET_MS = 1000;

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
 *    arrive; {@link useReleaseEvents} switches expiry to the long
 *    {@link RELEASE_SAFETY_NET_MS} backstop so a release removes its direction
 *    at once — crisp switching, no coast — while a lost key-up still recovers.
 *
 * Movement is held state (re-emitted every tick); **attacks are one-shot** —
 * each press queues a single intent that fires once on the next `drain()`. Both
 * cross into the sim only as `Intent`s, keeping `update()` pure.
 */
export class Input {
  private readonly held = new Map<Direction, number>();
  /**
   * Directions PRESSED since the last drain, kept even if already released —
   * the release tier deletes a direction from `held` the instant the key-up
   * arrives, so a tap whose press and release both land inside one ~66 ms
   * inter-drain window would otherwise leave no trace and move zero tiles
   * (the audit's "the better tier drops taps" finding). resolveMove unions
   * this with `held`; drain clears it, so every press moves at least once.
   */
  private readonly tapped = new Map<Direction, number>();
  /**
   * Attack intents pressed since the last drain. Unlike movement, attacks are
   * one-shot — a press is a single swing, not a held state — so they queue here
   * and are emitted (and cleared) once. Mashing queues several; the stamina gate
   * in `update()`, not this layer, is what limits the mash.
   */
  private attackIntents: Intent[] = [];
  private quitRequested = false;
  private releaseDriven = false;
  private readonly now: () => number;

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
  }

  /**
   * Switch to release-driven mode: directions are removed on a real key-up and
   * expiry relaxes to the {@link RELEASE_SAFETY_NET_MS} backstop. Call this once
   * when the kitty protocol is active.
   */
  useReleaseEvents(): void {
    this.releaseDriven = true;
  }

  /** Apply a decoded key event (press, repeat, or release). */
  apply(event: KeyEvent): void {
    // Single-character names normalize to lowercase so Shift/CapsLock WASD
    // (and Q) still play — legacy terminals send the shifted byte as the name.
    // Multi-character names (UP, CTRL_C, …) are already canonical.
    const name =
      event.name.length === 1 ? event.name.toLowerCase() : event.name;
    if (event.kind === 'release') {
      this.onRelease(name);
    } else {
      this.onPressOrRepeat(name, event.kind === 'press');
    }
  }

  private onPressOrRepeat(name: string, isPress: boolean): void {
    if (isQuit(name)) {
      this.quitRequested = true;
      return;
    }
    const dir = KEY_TO_DIRECTION[name];
    if (dir !== undefined) {
      // Refresh this direction's timestamp. `resolveAxis()` decides a contested
      // axis by comparing these stamps (last-pressed-wins), so a re-press of the
      // newer key is what flips a quick reversal — `set` updates the value in
      // place, no Map re-seating needed. The fresh stamp also resets expiry.
      const stamp = this.now();
      this.held.set(dir, stamp);
      // Only a genuine PRESS earns the tap guarantee. A repeat must not — a
      // held key streams repeats, and a repeat-refreshed tap would survive the
      // key's release for one drain, re-introducing exactly the coast the
      // release tier exists to kill.
      if (isPress) this.tapped.set(dir, stamp);
      return;
    }
    const attackId = ATTACK_KEYS[name];
    if (attackId !== undefined) {
      this.attackIntents.push({ type: 'attack', attackId });
    }
  }

  private onRelease(name: string): void {
    // Only movement holds care about release; quit and one-shot attacks don't.
    const dir = KEY_TO_DIRECTION[name];
    if (dir !== undefined) this.held.delete(dir);
  }

  /**
   * Emit the single combined move intent for the still-held directions (see
   * {@link resolveMove} — true 8-direction movement), then any attack intents
   * pressed since the last drain. Stale directions expire after the active
   * window — {@link HELD_WINDOW_MS} in the timeout tier, the long
   * {@link RELEASE_SAFETY_NET_MS} backstop in the release tier (where real
   * key-up normally removes them first). Attacks fire exactly once.
   */
  drain(): Intent[] {
    this.expireStaleHolds();

    const intents: Intent[] = [];
    const move = this.resolveMove();
    if (move !== undefined) intents.push(move);
    intents.push(...this.attackIntents);
    this.attackIntents = [];
    this.tapped.clear(); // every press has now produced its guaranteed move
    return intents;
  }

  /**
   * Drop directions whose last event is older than the active window —
   * {@link HELD_WINDOW_MS} in the timeout tier, the long
   * {@link RELEASE_SAFETY_NET_MS} backstop in the release tier (where a real
   * key-up has normally removed them already).
   */
  private expireStaleHolds(): void {
    const now = this.now();
    const expiry = this.releaseDriven ? RELEASE_SAFETY_NET_MS : HELD_WINDOW_MS;
    for (const [dir, lastSeen] of this.held) {
      if (now - lastSeen > expiry) this.held.delete(dir);
    }
  }

  /**
   * Collapse the still-held directions into a **single** move intent — true
   * 8-direction movement (TQ-017). Each axis is resolved independently by
   * **last-pressed-wins**: when both opposing directions are held, the
   * more-recently-pressed one takes that axis (never both, never a cancelling
   * standstill). A naive `right − left` sum would instead cancel to zero, which
   * in the timeout tier — where a release is only inferred by timeout — would
   * stall a quick reversal for up to one {@link HELD_WINDOW_MS} while the stale
   * opposite still lingers; last-pressed-wins keeps TQ-016's crisp reversal.
   * Returns undefined when nothing resolves to a step.
   */
  private resolveMove(): MoveIntent | undefined {
    const dx = this.resolveAxis('right', 'left');
    const dy = this.resolveAxis('down', 'up');
    if (dx === 0 && dy === 0) return undefined;
    return { type: 'move', dx, dy };
  }

  /**
   * Resolve one axis to +1 (the positive direction), −1 (the negative), or 0
   * (neither held). When both are held the larger timestamp — the more recent
   * press or repeat — wins; an exact tie falls to the positive direction (real
   * presses never tie, so this only pins determinism for the clock-injected
   * tests).
   */
  private resolveAxis(positive: Direction, negative: Direction): number {
    const pos = this.stampFor(positive);
    const neg = this.stampFor(negative);
    if (pos === undefined && neg === undefined) return 0;
    if (neg === undefined) return 1;
    if (pos === undefined) return -1;
    return pos >= neg ? 1 : -1;
  }

  /**
   * A direction's freshest stamp across `held` and the tap-preserving
   * `tapped` map — present in either counts, so a released-before-drain tap
   * still resolves its axis exactly once.
   */
  private stampFor(dir: Direction): number | undefined {
    const held = this.held.get(dir);
    const tap = this.tapped.get(dir);
    if (held === undefined) return tap;
    if (tap === undefined) return held;
    return Math.max(held, tap);
  }

  get shouldQuit(): boolean {
    return this.quitRequested;
  }
}
