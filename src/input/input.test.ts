import { EventEmitter } from 'node:events';
import { describe, it, expect } from 'vitest';
import terminalKit from 'terminal-kit';
import { Input, HELD_WINDOW_MS } from './input.js';

type Term = typeof terminalKit.terminal;

/**
 * Input only ever calls `term.on('key', handler)`, so a Node EventEmitter is a
 * faithful stand-in: we `emit('key', name)` to simulate a press. The cast funnels
 * through `unknown` because EventEmitter is a structural subset of the terminal-kit
 * type (it has the one method Input uses).
 *
 * The clock is injected via a mutable `clock` object so tests advance time
 * explicitly — timing behaviour is verified deterministically, never by feel.
 */
function makeInput(): {
  input: Input;
  press: (name: string) => void;
  advance: (ms: number) => void;
} {
  const emitter = new EventEmitter();
  const term = emitter as unknown as Term;
  const clock = { ms: 0 };
  const input = new Input(term, () => clock.ms);
  return {
    input,
    press: (name: string) => emitter.emit('key', name),
    advance: (ms: number) => {
      clock.ms += ms;
    },
  };
}

const SIM_DT = 1000 / 15; // one game tick (~66.7 ms)

describe('Input', () => {
  it('maps each movement key (arrows + WASD) to the right {dx, dy} delta', () => {
    const cases: Array<[string, number, number]> = [
      ['UP', 0, -1],
      ['DOWN', 0, 1],
      ['LEFT', -1, 0],
      ['RIGHT', 1, 0],
      ['w', 0, -1],
      ['s', 0, 1],
      ['a', -1, 0],
      ['d', 1, 0],
    ];

    for (const [key, dx, dy] of cases) {
      const { input, press } = makeInput();
      press(key);
      expect(input.drain()).toEqual([{ type: 'move', dx, dy }]);
    }
  });

  it('holding a direction moves on the very next tick — no initial stall', () => {
    const { input, press, advance } = makeInput();

    press('RIGHT');
    // The single keypress alone (no OS auto-repeat yet) must already move, and
    // keep moving each tick, all the way up to the held window. This is the bug
    // TQ-016 fixes: previously the gap before auto-repeat produced empty drains.
    for (let t = SIM_DT; t <= HELD_WINDOW_MS; t += SIM_DT) {
      advance(SIM_DT);
      expect(input.drain()).toEqual([{ type: 'move', dx: 1, dy: 0 }]);
    }
  });

  it('cadence follows the game tick, not the key-event spacing', () => {
    const { input, press, advance } = makeInput();

    press('d');
    // No further key events: with the old "repeat on press" model this drained
    // empty after the first tick. Now every tick within the window emits exactly
    // one move — the loop drives cadence, not the OS repeat rate.
    advance(SIM_DT);
    expect(input.drain()).toEqual([{ type: 'move', dx: 1, dy: 0 }]);
    advance(SIM_DT);
    expect(input.drain()).toEqual([{ type: 'move', dx: 1, dy: 0 }]);
  });

  it('keeps moving with no gap when auto-repeat events refresh the hold', () => {
    const { input, press, advance } = makeInput();

    press('UP');
    // Re-press just before the window would expire (an OS auto-repeat event):
    // the hold is refreshed, so movement continues indefinitely with no gap.
    for (let i = 0; i < 5; i++) {
      advance(HELD_WINDOW_MS - 1);
      expect(input.drain()).toEqual([{ type: 'move', dx: 0, dy: -1 }]);
      press('UP');
    }
  });

  it('treats exactly HELD_WINDOW_MS as still held, and expires just past it', () => {
    const { input, press, advance } = makeInput();

    press('RIGHT');
    // Boundary is inclusive: `now - lastSeen > HELD_WINDOW_MS` expires, so at
    // exactly the window the direction still moves. (Pins the `>` vs `>=` choice.)
    advance(HELD_WINDOW_MS);
    expect(input.drain()).toEqual([{ type: 'move', dx: 1, dy: 0 }]);

    advance(1);
    expect(input.drain()).toEqual([]);
  });

  it('expires only the stale direction when two are held with different ages', () => {
    const { input, press, advance } = makeInput();

    // UP pressed first, then RIGHT 200 ms later.
    press('UP');
    advance(200);
    press('RIGHT');

    // Advance so UP is now 200 + 150 = 350 ms old (stale, > window) but RIGHT is
    // only 150 ms old (still held). Exercises deleting one Map entry mid-iteration
    // while keeping another.
    advance(150);
    expect(input.drain()).toEqual([{ type: 'move', dx: 1, dy: 0 }]);
  });

  it('stops within one window after release (release inferred by timeout)', () => {
    const { input, press, advance } = makeInput();

    press('LEFT');
    advance(SIM_DT);
    expect(input.drain()).toEqual([{ type: 'move', dx: -1, dy: 0 }]);

    // No more events: once past the window the direction expires and movement
    // stops. The coast is bounded by HELD_WINDOW_MS.
    advance(HELD_WINDOW_MS + 1);
    expect(input.drain()).toEqual([]);
  });

  it('emits one intent per direction held at the same time', () => {
    const { input, press, advance } = makeInput();

    press('UP');
    press('RIGHT');
    advance(SIM_DT);

    // Both are still held, so both are emitted (in press order). Collapsing
    // these into a single diagonal intent is TQ-017's job, not this layer's yet.
    expect(input.drain()).toEqual([
      { type: 'move', dx: 0, dy: -1 },
      { type: 'move', dx: 1, dy: 0 },
    ]);
  });

  it('re-pressing an already-held direction re-seats it as last (last pressed wins)', () => {
    const { input, press, advance } = makeInput();

    // Reverse up → down → up, all inside one window. `update()` applies the
    // LAST move intent, so the freshest press must land last in drain order.
    // Before the delete-then-set fix, re-pressing UP kept its original slot and
    // the player stayed stuck moving DOWN until DOWN expired.
    press('UP');
    advance(SIM_DT);
    expect(input.drain()).toEqual([{ type: 'move', dx: 0, dy: -1 }]);

    press('DOWN'); // newer than UP → DOWN is last
    advance(SIM_DT);
    expect(input.drain()).toEqual([
      { type: 'move', dx: 0, dy: -1 },
      { type: 'move', dx: 0, dy: 1 },
    ]);

    press('UP'); // re-press: UP must jump back to last so update() applies it
    advance(SIM_DT);
    expect(input.drain()).toEqual([
      { type: 'move', dx: 0, dy: 1 },
      { type: 'move', dx: 0, dy: -1 },
    ]);
  });

  it('buffers nothing for an unmapped key', () => {
    const { input, press } = makeInput();

    press('x');
    press('ENTER');

    expect(input.drain()).toEqual([]);
  });

  it("treats 'q' as quit and enqueues no move", () => {
    const { input, press } = makeInput();

    expect(input.shouldQuit).toBe(false);
    press('q');

    expect(input.shouldQuit).toBe(true);
    expect(input.drain()).toEqual([]);
  });

  it("treats 'CTRL_C' as quit and enqueues no move", () => {
    const { input, press } = makeInput();

    press('CTRL_C');

    expect(input.shouldQuit).toBe(true);
    expect(input.drain()).toEqual([]);
  });
});
