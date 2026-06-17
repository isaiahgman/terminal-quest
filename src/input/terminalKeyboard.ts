import process from 'node:process';
import type { Input } from './input.js';
import { KeyDecoder } from './keyDecoder.js';

/**
 * Wires raw terminal input into {@link Input}, negotiating the **kitty keyboard
 * protocol** (TQ-019) when the terminal supports it.
 *
 * The input layer owns stdin directly rather than going through terminal-kit:
 * terminal-kit's key parser can't read the protocol's `CSI u` sequences (it
 * drops them as `'unknown'` — see tdd §12), and the {@link KeyDecoder} already
 * handles both the protocol form and the legacy form (plain bytes + letter
 * arrows + raw Ctrl-C), so one path covers supported and unsupported terminals.
 *
 * Supported → real press/repeat/**release** events, so a key-up removes its
 * direction at once (no coast). Unsupported → exactly the prior timeout
 * behaviour, with no protocol bytes ever sent.
 */

/** Push flags: report event types (2) + report all keys as escape codes (8). */
const ENABLE = '\x1b[>10u';
/** Pop the pushed entry, restoring whatever keyboard mode was there before. */
const DISABLE = '\x1b[<u';
/**
 * Probe: ask for the current protocol flags (`CSI ? u`), then Primary Device
 * Attributes (`CSI c`) as a sentinel. A terminal that supports the protocol
 * answers the first query *before* the DA reply; one that doesn't answers only
 * the DA — so the DA reply arriving with no kitty reply means "unsupported".
 */
const PROBE = '\x1b[?u\x1b[c';

// Built via String.fromCharCode so the ESC control byte never appears as a
// literal in source (eslint no-control-regex) — the pattern still matches it.
const ESC = String.fromCharCode(0x1b);
const KITTY_REPLY = new RegExp(`${ESC}\\[\\?[0-9;]*u`);
const DA_REPLY = new RegExp(`${ESC}\\[[?>0-9;]*c`);
const PROBE_TIMEOUT_MS = 200;

type InStream = NodeJS.ReadStream;
type OutStream = NodeJS.WriteStream;

export interface KeyboardIo {
  stdin: InStream;
  stdout: OutStream;
}

export interface KeyboardHandle {
  /** True when the kitty protocol was negotiated (release-driven input). */
  readonly protocolEnabled: boolean;
  /** Tear down: stop listening, pop the protocol, leave the terminal clean. */
  restore: () => void;
}

function setRawMode(stdin: InStream, on: boolean): void {
  if (stdin.isTTY) stdin.setRawMode(on);
}

function probeKittySupport(io: KeyboardIo): Promise<boolean> {
  return new Promise((resolve) => {
    let buffer = '';
    let settled = false;

    const finish = (supported: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      io.stdin.off('data', onData);
      resolve(supported);
    };

    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('latin1');
      if (KITTY_REPLY.test(buffer)) finish(true);
      else if (DA_REPLY.test(buffer)) finish(false);
    };

    const timer = setTimeout(() => finish(false), PROBE_TIMEOUT_MS);
    io.stdin.on('data', onData);
    io.stdout.write(PROBE);
  });
}

/**
 * Start feeding terminal input into `input`. Returns a handle whose `restore()`
 * MUST run on every exit path (the project's "always restore the terminal"
 * rule) — it pops the protocol and turns raw mode off.
 */
export async function startKeyboard(
  input: Input,
  io: KeyboardIo = { stdin: process.stdin, stdout: process.stdout },
): Promise<KeyboardHandle> {
  setRawMode(io.stdin, true);
  io.stdin.resume();

  const protocolEnabled = await probeKittySupport(io);
  if (protocolEnabled) {
    io.stdout.write(ENABLE);
    input.useReleaseEvents();
  }

  const decoder = new KeyDecoder();
  const onData = (chunk: Buffer): void => {
    for (const event of decoder.decode(chunk)) input.apply(event);
  };
  io.stdin.on('data', onData);

  let restored = false;
  return {
    protocolEnabled,
    restore: () => {
      if (restored) return;
      restored = true;
      io.stdin.off('data', onData);
      if (protocolEnabled) io.stdout.write(DISABLE);
      setRawMode(io.stdin, false);
      io.stdin.pause();
    },
  };
}
