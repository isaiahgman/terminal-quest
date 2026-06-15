import { EventEmitter } from 'node:events';
import { describe, it, expect } from 'vitest';
import terminalKit from 'terminal-kit';
import { Input } from './input.js';

type Term = typeof terminalKit.terminal;

/**
 * Input only ever calls `term.on('key', handler)`, so a Node EventEmitter is a
 * faithful stand-in: we `emit('key', name)` to simulate a press. The cast funnels
 * through `unknown` because EventEmitter is a structural subset of the terminal-kit
 * type (it has the one method Input uses).
 */
function makeTerm(): { term: Term; press: (name: string) => void } {
  const emitter = new EventEmitter();
  const term = emitter as unknown as Term;
  return { term, press: (name: string) => emitter.emit('key', name) };
}

describe('Input', () => {
  it('maps each movement key to the right {dx, dy} delta', () => {
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
      const { term, press } = makeTerm();
      const input = new Input(term);
      press(key);
      expect(input.drain()).toEqual([{ type: 'move', dx, dy }]);
    }
  });

  it('buffers presses in order so the loop can drain them per tick', () => {
    const { term, press } = makeTerm();
    const input = new Input(term);

    press('UP');
    press('RIGHT');

    expect(input.drain()).toEqual([
      { type: 'move', dx: 0, dy: -1 },
      { type: 'move', dx: 1, dy: 0 },
    ]);
  });

  it('buffers nothing for an unmapped key', () => {
    const { term, press } = makeTerm();
    const input = new Input(term);

    press('x');
    press('ENTER');

    expect(input.drain()).toEqual([]);
  });

  it('drain returns the buffered intents then clears (a second drain is empty)', () => {
    const { term, press } = makeTerm();
    const input = new Input(term);

    press('LEFT');

    expect(input.drain()).toEqual([{ type: 'move', dx: -1, dy: 0 }]);
    expect(input.drain()).toEqual([]);
  });

  it("treats 'q' as quit and enqueues no move", () => {
    const { term, press } = makeTerm();
    const input = new Input(term);

    expect(input.shouldQuit).toBe(false);
    press('q');

    expect(input.shouldQuit).toBe(true);
    expect(input.drain()).toEqual([]);
  });

  it("treats 'CTRL_C' as quit and enqueues no move", () => {
    const { term, press } = makeTerm();
    const input = new Input(term);

    press('CTRL_C');

    expect(input.shouldQuit).toBe(true);
    expect(input.drain()).toEqual([]);
  });
});
