import { describe, it, expect } from 'vitest';
import { Input, HELD_WINDOW_MS } from './input.js';
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
  const fire = (name: string, kind: KeyKind): void => input.apply({ name, kind });
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

  it('re-pressing an already-held direction re-seats it as last (last pressed wins)', () => {
    const { input, press, advance } = makeInput();

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

  it('keeps moving indefinitely on a single press without any timeout expiry', () => {
    const { input, press, advance, useReleaseEvents } = makeInput();
    useReleaseEvents();

    press('UP');
    // No further events and no release: far past the timeout window, still held.
    advance(HELD_WINDOW_MS * 10);
    expect(input.drain()).toEqual([{ type: 'move', dx: 0, dy: -1 }]);
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
