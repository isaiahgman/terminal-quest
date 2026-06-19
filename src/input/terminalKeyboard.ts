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

interface ProbeResult {
  supported: boolean;
  /** Keystroke bytes that arrived after the reply, to replay into the decoder. */
  leftover: string;
}

function probeKittySupport(io: KeyboardIo): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let buffer = '';
    let settled = false;

    const finish = (supported: boolean, leftover: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      io.stdin.off('data', onData);
      resolve({ supported, leftover });
    };

    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('latin1');
      // Bytes after the reply are real keystrokes (typed during the probe) —
      // hand them back so the first keystroke isn't swallowed. Any trailing DA
      // reply in there is harmless: the decoder ignores `CSI … c`.
      const kitty = KITTY_REPLY.exec(buffer);
      if (kitty) {
        finish(true, buffer.slice(kitty.index + kitty[0].length));
        return;
      }
      const da = DA_REPLY.exec(buffer);
      if (da) finish(false, buffer.slice(da.index + da[0].length));
    };

    // No response at all (legacy terminal) → unsupported; surface whatever was
    // typed during the wait so it still reaches the game.
    const timer = setTimeout(() => finish(false, buffer), PROBE_TIMEOUT_MS);
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

  const { supported: protocolEnabled, leftover } = await probeKittySupport(io);

  const decoder = new KeyDecoder();
  const onData = (chunk: Buffer): void => {
    for (const event of decoder.decode(chunk)) input.apply(event);
  };

  // Teardown, defined *before* we enable anything so a failed startup can pop
  // the protocol too (see the try/catch below). It pops exactly the one entry
  // we push, so calling it once on the error path can't double-pop.
  let restored = false;
  const restore = (): void => {
    if (restored) return;
    restored = true;
    io.stdin.off('data', onData);
    if (protocolEnabled) io.stdout.write(DISABLE);
    setRawMode(io.stdin, false);
    io.stdin.pause();
  };

  // Everything from the ENABLE write onward must undo itself if it throws: once
  // the protocol is pushed, a failure here would reject *before* the handle
  // exists, so the caller's exit path has no `restore()` to call and the
  // terminal is left in kitty enhanced mode — violating the always-restore rule.
  try {
    if (protocolEnabled) {
      io.stdout.write(ENABLE);
      input.useReleaseEvents();
    }
    io.stdin.on('data', onData);
    // Replay any keystrokes that arrived during the probe (after its reply).
    if (leftover !== '') {
      for (const event of decoder.decode(leftover)) input.apply(event);
    }
  } catch (err: unknown) {
    restore();
    throw err;
  }

  return { protocolEnabled, restore };
}
