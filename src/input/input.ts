import terminalKit from 'terminal-kit';
import type { Intent } from '../game/update.js';

type Term = typeof terminalKit.terminal;

const KEY_TO_DELTA: Record<string, { dx: number; dy: number }> = {
  UP: { dx: 0, dy: -1 },
  DOWN: { dx: 0, dy: 1 },
  LEFT: { dx: -1, dy: 0 },
  RIGHT: { dx: 1, dy: 0 },
  w: { dx: 0, dy: -1 },
  s: { dx: 0, dy: 1 },
  a: { dx: -1, dy: 0 },
  d: { dx: 1, dy: 0 },
};

/**
 * Translates key presses into game intents.
 *
 * Terminals emit key-DOWN events only — there is no key-up — so we can't do
 * "while held, move". Instead we model movement as "repeat on press": each key
 * event (incl. OS auto-repeat while a key is held) enqueues one move intent,
 * which the loop drains once per tick.
 */
export class Input {
  private intents: Intent[] = [];
  private quitRequested = false;

  constructor(term: Term) {
    term.on('key', (name: string) => {
      if (name === 'q' || name === 'CTRL_C') {
        this.quitRequested = true;
        return;
      }
      const delta = KEY_TO_DELTA[name];
      if (delta) {
        this.intents.push({ type: 'move', dx: delta.dx, dy: delta.dy });
      }
    });
  }

  /** Return the intents collected since the last call, and clear the buffer. */
  drain(): Intent[] {
    const collected = this.intents;
    this.intents = [];
    return collected;
  }

  get shouldQuit(): boolean {
    return this.quitRequested;
  }
}
