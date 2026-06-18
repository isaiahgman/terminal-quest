import { describe, it, expect } from 'vitest';
import { Input, HELD_WINDOW_MS, RELEASE_SAFETY_NET_MS } from './input.js';
import type { KeyKind } from './keyDecoder.js';

/**
 * Drive {@link Input} through its logical event API with an injected clock so
 * timing is verified deterministically, never by feel. `press`/`repeat`/
 * `release` mirror the events the decoder feeds it from a real terminal.
 */
function makeInput(): {
  input: Input;
  press: (name: string) => void;
  repeat: (name: string) => void;
  release: (name: string) => void;
  advance: (ms: number) => void;
  useReleaseEvents: () => void;
} {
  const clock = { ms: 0 };
  const input = new Input(() => clock.ms);
  const fire = (name: string, kind: KeyKind): void =>
    input.apply({ name, kind });
  return {
    input,
    press: (name) => fire(name, 'press'),
    repeat: (name) => fire(name, 'repeat'),
    release: (name) => fire(name, 'release'),
    advance: (ms) => {
      clock.ms += ms;
    },
    useReleaseEvents: () => input.useReleaseEvents(),
  };
}

const SIM_DT = 1000 / 15; // one game tick (~66.7 ms)

describe('Input — timeout tier (no release events)', () => {
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
    for (let t = SIM_DT; t <= HELD_WINDOW_MS; t += SIM_DT) {
      advance(SIM_DT);
      expect(input.drain()).toEqual([{ type: 'move', dx: 1, dy: 0 }]);
    }
  });

  it('cadence follows the game tick, not the key-event spacing', () => {
    const { input, press, advance } = makeInput();

    press('d');
    advance(SIM_DT);
    expect(input.drain()).toEqual([{ type: 'move', dx: 1, dy: 0 }]);
    advance(SIM_DT);
    expect(input.drain()).toEqual([{ type: 'move', dx: 1, dy: 0 }]);
  });

  it('keeps moving with no gap when auto-repeat events refresh the hold', () => {
    const { input, press, repeat, advance } = makeInput();

    press('UP');
    for (let i = 0; i < 5; i++) {
      advance(HELD_WINDOW_MS - 1);
      expect(input.drain()).toEqual([{ type: 'move', dx: 0, dy: -1 }]);
      repeat('UP');
    }
  });

  it('treats exactly HELD_WINDOW_MS as still held, and expires just past it', () => {
    const { input, press, advance } = makeInput();

    press('RIGHT');
    advance(HELD_WINDOW_MS);
    expect(input.drain()).toEqual([{ type: 'move', dx: 1, dy: 0 }]);

    advance(1);
    expect(input.drain()).toEqual([]);
  });

  it('stops within one window after the last event (release inferred by timeout)', () => {
    const { input, press, advance } = makeInput();

    press('LEFT');
    advance(SIM_DT);
    expect(input.drain()).toEqual([{ type: 'move', dx: -1, dy: 0 }]);

    advance(HELD_WINDOW_MS + 1);
    expect(input.drain()).toEqual([]);
  });

  it('opposing directions on one axis resolve to the last pressed — no cancel, no stall', () => {
    const { input, press, advance } = makeInput();

    press('UP');
    advance(SIM_DT);
    expect(input.drain()).toEqual([{ type: 'move', dx: 0, dy: -1 }]);

    press('DOWN'); // newer than the still-held UP → DOWN wins the vertical axis
    advance(SIM_DT);
    expect(input.drain()).toEqual([{ type: 'move', dx: 0, dy: 1 }]);

    press('UP'); // re-press makes UP newest again → UP wins (a quick reversal)
    advance(SIM_DT);
    expect(input.drain()).toEqual([{ type: 'move', dx: 0, dy: -1 }]);
  });

  it('combines a horizontal and a vertical hold into one diagonal intent per tick', () => {
    const { input, press, advance } = makeInput();

    press('UP');
    press('RIGHT');
    advance(SIM_DT);
    // A single intent with both dx and dy set — not two separate orthogonal steps.
    expect(input.drain()).toEqual([{ type: 'move', dx: 1, dy: -1 }]);
  });

  it('reaches all four diagonals from a horizontal + vertical hold', () => {
    const cases: Array<[string, string, number, number]> = [
      ['UP', 'RIGHT', 1, -1],
      ['UP', 'LEFT', -1, -1],
      ['DOWN', 'RIGHT', 1, 1],
      ['DOWN', 'LEFT', -1, 1],
    ];
    for (const [vertical, horizontal, dx, dy] of cases) {
      const { input, press } = makeInput();
      press(vertical);
      press(horizontal);
      expect(input.drain()).toEqual([{ type: 'move', dx, dy }]);
    }
  });

  it('resolves the contested axis by recency while the free axis still moves', () => {
    const { input, press, advance } = makeInput();

    press('LEFT');
    advance(SIM_DT);
    press('RIGHT'); // contests the horizontal axis; RIGHT is newer → +x
    press('DOWN'); // vertical axis is uncontested
    advance(SIM_DT);
    expect(input.drain()).toEqual([{ type: 'move', dx: 1, dy: 1 }]);
  });

  it('breaks an exact-timestamp tie toward the positive direction', () => {
    // Same-tick presses (no clock advance between them) tie on lastSeen; the
    // resolver must still pick deterministically — the positive axis wins
    // (+x for left/right, +y for up/down). Pins the `>=` tiebreak: a strict `>`
    // would flip these to the negative direction.
    {
      const { input, press } = makeInput();
      press('RIGHT');
      press('LEFT'); // ties the horizontal axis
      expect(input.drain()).toEqual([{ type: 'move', dx: 1, dy: 0 }]);
    }
    {
      const { input, press } = makeInput();
      press('DOWN');
      press('UP'); // ties the vertical axis
      expect(input.drain()).toEqual([{ type: 'move', dx: 0, dy: 1 }]);
    }
  });

  it('expires one axis of a held diagonal independently', () => {
    const { input, press, repeat, advance } = makeInput();

    press('UP');
    press('RIGHT'); // both held from t=0 → diagonal
    advance(200);
    expect(input.drain()).toEqual([{ type: 'move', dx: 1, dy: -1 }]);

    // RIGHT keeps auto-repeating; UP gets no further event. Past UP's window
    // (measured from its only event at t=0) the vertical axis expires, while the
    // fresh RIGHT repeat keeps the horizontal alive → the diagonal decays to a
    // single horizontal step rather than sticking or stopping.
    repeat('RIGHT'); // RIGHT refreshed at t=200
    advance(HELD_WINDOW_MS - 50); // t=450: UP 450ms stale (gone), RIGHT 250ms (held)
    expect(input.drain()).toEqual([{ type: 'move', dx: 1, dy: 0 }]);
  });
});

describe('Input — attacks (one-shot)', () => {
  it('maps the attack keys to one-shot attack intents', () => {
    const cases: Array<[string, string]> = [
      ['j', 'quick-jab'],
      ['k', 'wide-cleave'],
      ['l', 'whirling-maelstrom'],
    ];

    for (const [key, attackId] of cases) {
      const { input, press } = makeInput();
      press(key);
      expect(input.drain()).toEqual([{ type: 'attack', attackId }]);
    }
  });

  it('fires an attack exactly once — not re-emitted next tick like a held move', () => {
    const { input, press, advance } = makeInput();

    press('j');
    expect(input.drain()).toEqual([{ type: 'attack', attackId: 'quick-jab' }]);
    // No re-press: unlike a held direction, the attack does not repeat next tick.
    advance(SIM_DT);
    expect(input.drain()).toEqual([]);
  });

  it('emits a held move and a queued attack together in one drain', () => {
    const { input, press, advance } = makeInput();

    press('RIGHT');
    press('k');
    advance(SIM_DT);
    expect(input.drain()).toEqual([
      { type: 'move', dx: 1, dy: 0 },
      { type: 'attack', attackId: 'wide-cleave' },
    ]);
  });
});

describe('Input — release tier (kitty protocol)', () => {
  it('removes a direction immediately on key-up, with no coast', () => {
    const { input, press, release, advance, useReleaseEvents } = makeInput();
    useReleaseEvents();

    press('RIGHT');
    advance(SIM_DT);
    expect(input.drain()).toEqual([{ type: 'move', dx: 1, dy: 0 }]);

    release('RIGHT');
    advance(SIM_DT);
    expect(input.drain()).toEqual([]); // gone at once — no HELD_WINDOW coast
  });

  it('a key kept alive by repeat events moves on past the safety net', () => {
    const { input, press, repeat, advance, useReleaseEvents } = makeInput();
    useReleaseEvents();

    press('UP');
    // Repeats (event type 2) stream while physically held; each refreshes the
    // hold, so movement continues well past RELEASE_SAFETY_NET_MS with no coast.
    for (let elapsed = 0; elapsed < RELEASE_SAFETY_NET_MS * 3; elapsed += 100) {
      advance(100);
      expect(input.drain()).toEqual([{ type: 'move', dx: 0, dy: -1 }]);
      repeat('UP');
    }
  });

  it('recovers from a lost release (focus loss): expires at the safety net', () => {
    const { input, press, advance, useReleaseEvents } = makeInput();
    useReleaseEvents();

    press('UP'); // held, then focus is lost — no repeats, no release ever arrives
    advance(RELEASE_SAFETY_NET_MS);
    expect(input.drain()).toEqual([{ type: 'move', dx: 0, dy: -1 }]); // still held at the window

    advance(1);
    expect(input.drain()).toEqual([]); // force-expired — no "moving forever"
  });

  it('switches direction crisply: releasing up while pressing right yields only right', () => {
    const { input, press, release, advance, useReleaseEvents } = makeInput();
    useReleaseEvents();

    press('UP');
    press('RIGHT'); // both briefly held
    release('UP'); // let go of up
    advance(SIM_DT);

    // Only right survives — the up coast that plagued the timeout tier is gone.
    expect(input.drain()).toEqual([{ type: 'move', dx: 1, dy: 0 }]);
  });

  it('ignores a release for a direction that was never held', () => {
    const { input, release, advance, useReleaseEvents } = makeInput();
    useReleaseEvents();

    release('LEFT');
    advance(SIM_DT);
    expect(input.drain()).toEqual([]);
  });
});

describe('Input — quit', () => {
  it("treats 'q' press as quit and enqueues no move", () => {
    const { input, press } = makeInput();
    expect(input.shouldQuit).toBe(false);
    press('q');
    expect(input.shouldQuit).toBe(true);
    expect(input.drain()).toEqual([]);
  });

  it("treats 'CTRL_C' press as quit", () => {
    const { input, press } = makeInput();
    press('CTRL_C');
    expect(input.shouldQuit).toBe(true);
  });

  it('does not quit on a release of q (only the press quits)', () => {
    const { input, release, useReleaseEvents } = makeInput();
    useReleaseEvents();
    release('q');
    expect(input.shouldQuit).toBe(false);
  });

  it('ignores unmapped keys', () => {
    const { input, press } = makeInput();
    press('x');
    press('ENTER');
    expect(input.drain()).toEqual([]);
    expect(input.shouldQuit).toBe(false);
  });
});
