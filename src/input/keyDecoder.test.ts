import { describe, it, expect } from 'vitest';
import { KeyDecoder, type KeyEvent } from './keyDecoder.js';

const ESC = '\x1b';
const CSI = `${ESC}[`;
const SS3 = `${ESC}O`;

function decode(...chunks: string[]): KeyEvent[] {
  const decoder = new KeyDecoder();
  return chunks.flatMap((c) => decoder.decode(c));
}

describe('KeyDecoder — kitty CSI u key events', () => {
  it('decodes a key press, repeat, and release (event-type sub-field)', () => {
    expect(decode(`${CSI}119;1:1u`)).toEqual([{ name: 'w', kind: 'press' }]);
    expect(decode(`${CSI}119;1:2u`)).toEqual([{ name: 'w', kind: 'repeat' }]);
    expect(decode(`${CSI}119;1:3u`)).toEqual([{ name: 'w', kind: 'release' }]);
  });

  it('treats a missing event-type (and bare codepoint) as a press', () => {
    expect(decode(`${CSI}97;1u`)).toEqual([{ name: 'a', kind: 'press' }]);
    expect(decode(`${CSI}115u`)).toEqual([{ name: 's', kind: 'press' }]);
  });

  it('passes printable keys through by name (movement, attacks, quit alike)', () => {
    // Policy-free: the decoder names the key; Input decides what it means.
    expect(decode(`${CSI}106;1:1u`)).toEqual([{ name: 'j', kind: 'press' }]); // attack
    expect(decode(`${CSI}108u`)).toEqual([{ name: 'l', kind: 'press' }]); // attack
    expect(decode(`${CSI}113u`)).toEqual([{ name: 'q', kind: 'press' }]); // quit
    expect(decode(`${CSI}120;1:1u`)).toEqual([{ name: 'x', kind: 'press' }]); // unmapped
  });

  it('decodes the arrow functional codepoints for press, repeat, and release', () => {
    expect(decode(`${CSI}57297;1:1u`)).toEqual([{ name: 'UP', kind: 'press' }]);
    expect(decode(`${CSI}57298;1:2u`)).toEqual([
      { name: 'DOWN', kind: 'repeat' },
    ]);
    expect(decode(`${CSI}57299;1:1u`)).toEqual([
      { name: 'RIGHT', kind: 'press' },
    ]);
    expect(decode(`${CSI}57300;1:3u`)).toEqual([
      { name: 'LEFT', kind: 'release' },
    ]);
  });

  it('decodes the legacy / letter-terminated arrow form, with and without params', () => {
    expect(decode(`${CSI}A`)).toEqual([{ name: 'UP', kind: 'press' }]);
    expect(decode(`${CSI}1;1:2B`)).toEqual([{ name: 'DOWN', kind: 'repeat' }]);
    expect(decode(`${CSI}1;1:3C`)).toEqual([
      { name: 'RIGHT', kind: 'release' },
    ]);
    expect(decode(`${CSI}D`)).toEqual([{ name: 'LEFT', kind: 'press' }]);
  });

  it('decodes SS3 application-cursor-key arrows (ESC O A/B/C/D)', () => {
    expect(decode(`${SS3}A`)).toEqual([{ name: 'UP', kind: 'press' }]);
    expect(decode(`${SS3}B`)).toEqual([{ name: 'DOWN', kind: 'press' }]);
    expect(decode(`${SS3}C`)).toEqual([{ name: 'RIGHT', kind: 'press' }]);
    expect(decode(`${SS3}D`)).toEqual([{ name: 'LEFT', kind: 'press' }]);
    // A non-arrow SS3 (e.g. F1 = ESC O P) is consumed but emits nothing.
    expect(decode(`${SS3}P`)).toEqual([]);
  });

  it('decodes Ctrl-C in every form: raw 0x03 and CSI u press/repeat/release', () => {
    expect(decode('\x03')).toEqual([{ name: 'CTRL_C', kind: 'press' }]);
    expect(decode(`${CSI}99;5u`)).toEqual([{ name: 'CTRL_C', kind: 'press' }]);
    expect(decode(`${CSI}99;5:2u`)).toEqual([
      { name: 'CTRL_C', kind: 'repeat' },
    ]);
    expect(decode(`${CSI}99;5:3u`)).toEqual([
      { name: 'CTRL_C', kind: 'release' },
    ]);
  });

  it('decodes a plain printable byte (terminal without the protocol)', () => {
    expect(decode('w')).toEqual([{ name: 'w', kind: 'press' }]);
    expect(decode('j')).toEqual([{ name: 'j', kind: 'press' }]);
  });
});

describe('KeyDecoder — robustness', () => {
  it("decodes plain 'c' as the letter (only Ctrl+c is CTRL_C)", () => {
    expect(decode(`${CSI}99;1u`)).toEqual([{ name: 'c', kind: 'press' }]);
    expect(decode('c')).toEqual([{ name: 'c', kind: 'press' }]);
  });

  it('ignores the protocol query response and other non-key CSI sequences', () => {
    expect(decode(`${CSI}?10u`)).toEqual([]); // CSI ? flags u  (support reply)
    expect(decode(`${CSI}1;1R`)).toEqual([]); // cursor position report
    expect(decode(`${CSI}0c`)).toEqual([]); // device attributes
  });

  it('decodes several events in a single chunk, in order', () => {
    expect(decode(`${CSI}119;1:1u${CSI}119;1:3u${CSI}106;1:1u`)).toEqual([
      { name: 'w', kind: 'press' },
      { name: 'w', kind: 'release' },
      { name: 'j', kind: 'press' },
    ]);
  });

  it('buffers an escape sequence split across chunks and emits it once complete', () => {
    const decoder = new KeyDecoder();
    expect(decoder.decode(`${CSI}119;1`)).toEqual([]); // arrives mid-sequence
    expect(decoder.decode(':3u')).toEqual([{ name: 'w', kind: 'release' }]);
  });

  it('buffers a split SS3 arrow (ESC O | A) until the final byte arrives', () => {
    const decoder = new KeyDecoder();
    expect(decoder.decode(SS3)).toEqual([]);
    expect(decoder.decode('A')).toEqual([{ name: 'UP', kind: 'press' }]);
  });

  it('buffers a lone trailing ESC until its sequence arrives', () => {
    const decoder = new KeyDecoder();
    expect(decoder.decode(ESC)).toEqual([]);
    expect(decoder.decode(`[57297;1:1u`)).toEqual([
      { name: 'UP', kind: 'press' },
    ]);
  });

  it('drops a desynced unterminated CSI run instead of buffering it forever', () => {
    const decoder = new KeyDecoder();
    // A CSI that never gets a final byte (line noise / protocol desync). Once it
    // grows past the cap it must be discarded, not retained — otherwise it would
    // grow unbounded and swallow every later keystroke.
    const garbage = `${CSI}${'9'.repeat(200)}`;
    expect(decoder.decode(garbage)).toEqual([]);
    // The stuck run is gone: a normal key after it still decodes.
    expect(decoder.decode(`${CSI}119;1:1u`)).toEqual([
      { name: 'w', kind: 'press' },
    ]);
  });
});
