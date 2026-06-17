import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { startKeyboard, type KeyboardIo } from './terminalKeyboard.js';
import { Input } from './input.js';

const ESC = '\x1b';
const KITTY_REPLY = `${ESC}[?10u`; // CSI ? flags u  — terminal supports the protocol
const DA_REPLY = `${ESC}[?62c`; // CSI ? … c     — only the DA sentinel answered
const ENABLE = `${ESC}[>10u`;
const DISABLE = `${ESC}[<u`;

/**
 * Fake stdin/stdout: an EventEmitter we can `feed()` bytes into, plus recorders
 * for raw-mode toggles and written escape sequences. Cast through `unknown` to
 * the Node stream types (it implements exactly the members startKeyboard uses).
 */
class FakeStdin extends EventEmitter {
  isTTY = true;
  readonly rawModes: boolean[] = [];
  resumed = 0;
  paused = 0;
  setRawMode(on: boolean): this {
    this.rawModes.push(on);
    return this;
  }
  resume(): this {
    this.resumed += 1;
    return this;
  }
  pause(): this {
    this.paused += 1;
    return this;
  }
  feed(bytes: string): void {
    this.emit('data', Buffer.from(bytes, 'latin1'));
  }
}

class FakeStdout {
  readonly writes: string[] = [];
  write(s: string): boolean {
    this.writes.push(s);
    return true;
  }
  get all(): string {
    return this.writes.join('');
  }
}

function makeIo(): { io: KeyboardIo; stdin: FakeStdin; stdout: FakeStdout } {
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();
  const io: KeyboardIo = {
    stdin: stdin as unknown as KeyboardIo['stdin'],
    stdout: stdout as unknown as KeyboardIo['stdout'],
  };
  return { io, stdin, stdout };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('startKeyboard — protocol negotiation', () => {
  it('enables the protocol and raw mode when the terminal replies', async () => {
    const { io, stdin, stdout } = makeIo();
    const promise = startKeyboard(new Input(() => 0), io);
    stdin.feed(KITTY_REPLY);
    const handle = await promise;

    expect(handle.protocolEnabled).toBe(true);
    expect(stdin.rawModes[0]).toBe(true);
    expect(stdout.all).toContain(ENABLE);
  });

  it('falls back (no enable) when only the DA sentinel replies', async () => {
    const { io, stdin, stdout } = makeIo();
    const promise = startKeyboard(new Input(() => 0), io);
    stdin.feed(DA_REPLY);
    const handle = await promise;

    expect(handle.protocolEnabled).toBe(false);
    expect(stdout.all).not.toContain(ENABLE);
  });

  it('falls back when nothing replies within the timeout', async () => {
    vi.useFakeTimers();
    const { io, stdout } = makeIo();
    const promise = startKeyboard(new Input(() => 0), io);
    await vi.advanceTimersByTimeAsync(250);
    const handle = await promise;

    expect(handle.protocolEnabled).toBe(false);
    expect(stdout.all).not.toContain(ENABLE);
  });
});

describe('startKeyboard — input forwarding', () => {
  it('forwards a keystroke that arrives in the same chunk as the reply', async () => {
    const { io, stdin } = makeIo();
    const input = new Input(() => 0);
    const promise = startKeyboard(input, io);
    stdin.feed(`${KITTY_REPLY}d`); // 'd' typed during the probe — must not be lost
    await promise;

    expect(input.drain()).toEqual([{ type: 'move', dx: 1, dy: 0 }]);
  });

  it('forwards keystrokes that arrive after negotiation', async () => {
    const { io, stdin } = makeIo();
    const input = new Input(() => 0);
    const promise = startKeyboard(input, io);
    stdin.feed(KITTY_REPLY);
    await promise;

    stdin.feed('w');
    expect(input.drain()).toEqual([{ type: 'move', dx: 0, dy: -1 }]);
  });
});

describe('startKeyboard — restore (the terminal-safety contract)', () => {
  it('pops the protocol, exits raw mode, pauses stdin — and is idempotent', async () => {
    const { io, stdin, stdout } = makeIo();
    const input = new Input(() => 0);
    const promise = startKeyboard(input, io);
    stdin.feed(KITTY_REPLY);
    const handle = await promise;

    handle.restore();
    handle.restore(); // second call must be a no-op

    expect(stdout.all.split(DISABLE).length - 1).toBe(1); // popped exactly once
    expect(stdin.rawModes).toEqual([true, false]); // on at start, off once on restore
    expect(stdin.paused).toBe(1);

    // After restore the listener is gone: further bytes don't reach the game.
    stdin.feed('w');
    expect(input.drain()).toEqual([]);
  });

  it('does not pop the protocol when it was never enabled', async () => {
    const { io, stdin, stdout } = makeIo();
    const promise = startKeyboard(new Input(() => 0), io);
    stdin.feed(DA_REPLY);
    const handle = await promise;

    handle.restore();
    expect(stdout.all).not.toContain(DISABLE);
    expect(stdin.rawModes).toEqual([true, false]);
  });
});
