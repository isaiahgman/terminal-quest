/**
 * Decodes a raw terminal input byte-stream into normalised key events.
 *
 * This exists because the **kitty keyboard protocol** (TQ-019) reports real
 * key-press/repeat/**release** events as `CSI u` escape sequences, and
 * `terminal-kit`'s parser does not understand them — it emits `'unknown'` and
 * aborts the chunk (see tdd §12). So when the protocol is active the input
 * layer owns stdin and parses the sequences itself; this module is that parser,
 * kept pure (bytes in → events out) so it is unit-testable without a terminal.
 *
 * It handles exactly the keys the game uses (movement + quit); anything else —
 * other CSI sequences, query responses, mouse — is ignored, not mis-fired.
 */

/** Press = key went down, repeat = OS auto-repeat, release = key came up. */
export type KeyKind = 'press' | 'repeat' | 'release';

/**
 * A logical key event. `name` uses the same vocabulary the rest of the input
 * layer already speaks (`'UP'`/`'DOWN'`/`'LEFT'`/`'RIGHT'`, the WASD letters,
 * `'q'`, `'CTRL_C'`) so {@link Input} can consume it unchanged.
 */
export interface KeyEvent {
  name: string;
  kind: KeyKind;
}

const ESC = 0x1b;
const CSI_FINAL_MIN = 0x40; // '@' — CSI sequences end on a byte in 0x40..0x7e
const CSI_FINAL_MAX = 0x7e; // '~'

/** Unicode codepoints for the printable keys we care about. */
const CODEPOINT_TO_NAME: Record<number, string> = {
  119: 'w',
  97: 'a',
  115: 's',
  100: 'd',
  113: 'q',
  99: 'c', // only meaningful with the Ctrl modifier → CTRL_C
};

/**
 * Functional-key codepoints kitty uses for the arrows when "report all keys as
 * escape codes" is set. Terminals *may* instead send the legacy letter form
 * (`CSI 1 ; mods : event A`), which {@link arrowFromFinalByte} covers — both are
 * decoded. If a terminal reports different codepoints, this is the one knob to
 * adjust (confirm with the capture script).
 */
const ARROW_CODEPOINT_TO_NAME: Record<number, string> = {
  57297: 'UP',
  57298: 'DOWN',
  57299: 'RIGHT',
  57300: 'LEFT',
};

/** Legacy / letter-terminated arrows: `CSI A/B/C/D` (optionally with params). */
function arrowFromFinalByte(final: string): string | undefined {
  switch (final) {
    case 'A':
      return 'UP';
    case 'B':
      return 'DOWN';
    case 'C':
      return 'RIGHT';
    case 'D':
      return 'LEFT';
    default:
      return undefined;
  }
}

/** Ctrl is bit 0x4 of the kitty modifier field, which is stored as `mask + 1`. */
function hasCtrl(modifiers: number): boolean {
  return ((modifiers - 1) & 0x4) !== 0;
}

/**
 * Parse the parameter string of a CSI sequence into numeric groups, preserving
 * the `:`-separated sub-fields. `"119;1:3"` → `[[119], [1, 3]]`. Empty groups
 * become an empty array so callers can apply defaults.
 */
function parseParams(params: string): number[][] {
  if (params === '') return [];
  return params.split(';').map((group) =>
    group.split(':').map((n) => {
      const v = Number.parseInt(n, 10);
      return Number.isNaN(v) ? 0 : v;
    }),
  );
}

function kindFromEventType(eventType: number | undefined): KeyKind {
  if (eventType === 2) return 'repeat';
  if (eventType === 3) return 'release';
  return 'press'; // 1 or absent
}

/**
 * Resolve a fully-parsed CSI sequence to a {@link KeyEvent}, or `undefined` if
 * it isn't a key we track (query responses, mouse, cursor reports, etc.).
 */
function decodeCsi(params: string, final: string): KeyEvent | undefined {
  // Query/response sequences (e.g. the `CSI ? <flags> u` protocol reply) start
  // with a private marker — never a key.
  if (
    params.startsWith('?') ||
    params.startsWith('>') ||
    params.startsWith('=')
  ) {
    return undefined;
  }

  const groups = parseParams(params);
  const modifiers = groups[1]?.[0] ?? 1;
  const eventType = groups[1]?.[1];
  const kind = kindFromEventType(eventType);

  if (final === 'u') {
    const codepoint = groups[0]?.[0];
    if (codepoint === undefined) return undefined;

    const arrow = ARROW_CODEPOINT_TO_NAME[codepoint];
    if (arrow !== undefined) return { name: arrow, kind };

    const name = CODEPOINT_TO_NAME[codepoint];
    if (name === undefined) return undefined;
    if (name === 'c') {
      return hasCtrl(modifiers) ? { name: 'CTRL_C', kind } : undefined;
    }
    return { name, kind };
  }

  const arrow = arrowFromFinalByte(final);
  if (arrow !== undefined) return { name: arrow, kind };

  return undefined;
}

/**
 * Stateful decoder: feed it raw stdin chunks; it returns the key events it can
 * fully parse and buffers any incomplete trailing escape sequence until the
 * rest arrives on the next chunk.
 */
export class KeyDecoder {
  private pending = '';

  /** Decode one chunk, returning every complete event it contains. */
  decode(chunk: Buffer | string): KeyEvent[] {
    this.pending +=
      typeof chunk === 'string' ? chunk : chunk.toString('latin1');
    const events: KeyEvent[] = [];

    let i = 0;
    const buf = this.pending;
    while (i < buf.length) {
      const byte = buf.charCodeAt(i);

      // Raw Ctrl-C (0x03) — still emitted by terminals without the protocol, and
      // a safe belt-and-braces even with it.
      if (byte === 0x03) {
        events.push({ name: 'CTRL_C', kind: 'press' });
        i += 1;
        continue;
      }

      if (byte === ESC) {
        if (i + 1 >= buf.length) break; // need at least the next byte
        if (buf[i + 1] !== '[') {
          // Not a CSI sequence we handle (lone ESC, alt-combo) — skip the ESC.
          i += 1;
          continue;
        }

        // Scan params until the CSI final byte (0x40..0x7e).
        let j = i + 2;
        while (
          j < buf.length &&
          (buf.charCodeAt(j) < CSI_FINAL_MIN ||
            buf.charCodeAt(j) > CSI_FINAL_MAX)
        ) {
          j += 1;
        }
        if (j >= buf.length) break; // incomplete sequence — wait for more bytes

        const params = buf.slice(i + 2, j);
        const final = buf.charAt(j);
        const event = decodeCsi(params, final);
        if (event !== undefined) events.push(event);
        i = j + 1;
        continue;
      }

      // Plain printable byte (terminals without the protocol send these directly).
      const name = CODEPOINT_TO_NAME[byte];
      if (name !== undefined && name !== 'c') {
        events.push({ name, kind: 'press' });
      }
      i += 1;
    }

    this.pending = buf.slice(i);
    return events;
  }
}
