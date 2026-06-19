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
 * It is **policy-free**: it emits a named event for every printable key, the
 * arrows, and Ctrl-C — and lets {@link Input} decide which ones are movement,
 * attacks, or quit. (So adding a keybinding never touches the decoder.) It
 * handles three forms: the kitty `CSI u` form, the legacy CSI form (`CSI A`),
 * and the SS3 form (`ESC O A`, application-cursor-key mode).
 */

/** Press = key went down, repeat = OS auto-repeat, release = key came up. */
export type KeyKind = 'press' | 'repeat' | 'release';

/**
 * A logical key event. `name` is the arrow name (`'UP'`/`'DOWN'`/`'LEFT'`/
 * `'RIGHT'`), `'CTRL_C'`, or the literal character for a printable key (`'w'`,
 * `'j'`, `'q'`, …) — the vocabulary {@link Input}'s key maps already speak.
 */
export interface KeyEvent {
  name: string;
  kind: KeyKind;
}

const ESC = 0x1b;
const CSI_FINAL_MIN = 0x40; // '@' — CSI sequences end on a byte in 0x40..0x7e
const CSI_FINAL_MAX = 0x7e; // '~'
const CTRL_C_BYTE = 0x03;
const C_CODEPOINT = 99; // 'c' — becomes CTRL_C only with the Ctrl modifier

/**
 * Upper bound on the bytes a single not-yet-terminated CSI escape sequence may
 * buffer before it is treated as a desynced/garbage stream and discarded. Every
 * key sequence we decode (kitty `CSI … u`, legacy `CSI … A`, SS3 `ESC O A`) is
 * an order of magnitude shorter than this, so a "sequence" that grows past it
 * has no final byte coming — most likely line noise or a protocol desync. Left
 * unbounded, such a run grows `pending` without limit (every later chunk is
 * prepended and re-scanned) and silently swallows every keystroke behind it, so
 * we cut it loose. 64 is comfortably above any real sequence and well below a
 * size worth worrying about.
 */
const MAX_PENDING_SEQUENCE_BYTES = 64;

function isPrintableAscii(codepoint: number): boolean {
  return codepoint >= 0x20 && codepoint <= 0x7e;
}

/**
 * Functional-key codepoints kitty uses for the arrows when "report all keys as
 * escape codes" is set. Terminals *may* instead send the legacy letter form
 * (`CSI 1 ; mods : event A`) or SS3 (`ESC O A`), which {@link arrowFromFinalByte}
 * covers — all three are decoded. If a terminal reports different codepoints,
 * this is the one knob to adjust (confirm with the capture script).
 */
const ARROW_CODEPOINT_TO_NAME: Record<number, string> = {
  57297: 'UP',
  57298: 'DOWN',
  57299: 'RIGHT',
  57300: 'LEFT',
};

/** Letter-terminated arrows: `CSI A/B/C/D` and SS3 `ESC O A/B/C/D`. */
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
  const kind = kindFromEventType(groups[1]?.[1]);

  if (final === 'u') {
    const codepoint = groups[0]?.[0];
    if (codepoint === undefined) return undefined;

    const arrow = ARROW_CODEPOINT_TO_NAME[codepoint];
    if (arrow !== undefined) return { name: arrow, kind };

    if (codepoint === C_CODEPOINT && hasCtrl(modifiers)) {
      return { name: 'CTRL_C', kind };
    }
    if (isPrintableAscii(codepoint)) {
      return { name: String.fromCharCode(codepoint), kind };
    }
    return undefined;
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
      if (byte === CTRL_C_BYTE) {
        events.push({ name: 'CTRL_C', kind: 'press' });
        i += 1;
        continue;
      }

      if (byte === ESC) {
        if (i + 1 >= buf.length) break; // need at least the next byte

        // SS3 application-cursor-key arrows: ESC O A/B/C/D.
        if (buf[i + 1] === 'O') {
          if (i + 2 >= buf.length) break; // incomplete — wait for the final byte
          const arrow = arrowFromFinalByte(buf.charAt(i + 2));
          if (arrow !== undefined) events.push({ name: arrow, kind: 'press' });
          i += 3;
          continue;
        }

        if (buf[i + 1] !== '[') {
          // Not a sequence we handle (lone ESC, alt-combo) — skip the ESC.
          i += 1;
          continue;
        }

        // CSI: scan params until the final byte (0x40..0x7e).
        let j = i + 2;
        while (
          j < buf.length &&
          (buf.charCodeAt(j) < CSI_FINAL_MIN ||
            buf.charCodeAt(j) > CSI_FINAL_MAX)
        ) {
          j += 1;
        }
        if (j >= buf.length) {
          // No final byte yet. Normally wait for the next chunk to complete the
          // sequence — but if this unterminated run has already outgrown any
          // real key sequence, the stream has desynced. Drop everything from the
          // ESC onward (there is no complete sequence in it by definition) so
          // `pending` can't grow without bound and stop swallowing every later
          // keystroke behind the stuck sequence.
          if (buf.length - i > MAX_PENDING_SEQUENCE_BYTES) {
            i = buf.length;
            continue;
          }
          break; // still short — wait for more bytes
        }

        const params = buf.slice(i + 2, j);
        const event = decodeCsi(params, buf.charAt(j));
        if (event !== undefined) events.push(event);
        i = j + 1;
        continue;
      }

      // Plain printable byte (terminals without the protocol send these directly).
      if (isPrintableAscii(byte)) {
        events.push({ name: String.fromCharCode(byte), kind: 'press' });
      }
      i += 1;
    }

    this.pending = buf.slice(i);
    return events;
  }
}
