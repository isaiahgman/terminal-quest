import { describe, it, expect } from 'vitest';
import { KeyDecoder, type KeyEvent } from './keyDecoder.js';

const ESC = '\x1b';
const CSI = `${ESC}[`;

function decode(...chunks: string[]): KeyEvent[] {
  const decoder = new KeyDecoder();
  return chunks.flatMap((c) => decoder.decode(c));
}

describe('KeyDecoder — kitty CSI u key events', () => {
  it('decodes a WASD press, repeat, and release (event-type sub-field)', () => {
    expect(decode(`${CSI}119;1:1u`)).toEqual([{ name: 'w', kind: 'press' }]);
    expect(decode(`${CSI}119;1:2u`)).toEqual([{ name: 'w', kind: 'repeat' }]);
    expect(decode(`${CSI}119;1:3u`)).toEqual([{ name: 'w', kind: 'release' }]);
  });

  it('treats a missing event-type (and bare codepoint) as a press', () => {
    expect(decode(`${CSI}97;1u`)).toEqual([{ name: 'a', kind: 'press' }]);
    expect(decode(`${CSI}115u`)).toEqual([{ name: 's', kind: 'press' }]);
  });

  it('decodes the arrow functional codepoints with event types', () => {
    expect(decode(`${CSI}57297;1:1u`)).toEqual([{ name: 'UP', kind: 'press' }]);
    expect(decode(`${CSI}57298;1:3u`)).toEqual([{ name: 'DOWN', kind: 'release' }]);
    expect(decode(`${CSI}57299;1:1u`)).toEqual([{ name: 'RIGHT', kind: 'press' }]);
    expect(decode(`${CSI}57300;1:3u`)).toEqual([{ name: 'LEFT', kind: 'release' }]);
  });

  it('decodes the legacy / letter-terminated arrow form, with and without params', () => {
    expect(decode(`${CSI}A`)).toEqual([{ name: 'UP', kind: 'press' }]);
    expect(decode(`${CSI}1;1:3B`)).toEqual([{ name: 'DOWN', kind: 'release' }]);
    expect(decode(`${CSI}1;1:1C`)).toEqual([{ name: 'RIGHT', kind: 'press' }]);
    expect(decode(`${CSI}D`)).toEqual([{ name: 'LEFT', kind: 'press' }]);
  });

  it('decodes Ctrl-C: raw 0x03 and the protocol CSI u form (codepoint 99 + ctrl)', () => {
    expect(decode('\x03')).toEqual([{ name: 'CTRL_C', kind: 'press' }]);
    expect(decode(`${CSI}99;5u`)).toEqual([{ name: 'CTRL_C', kind: 'press' }]);
  });

  it("decodes 'q' (codepoint 113) as a press", () => {
    expect(decode(`${CSI}113;1:1u`)).toEqual([{ name: 'q', kind: 'press' }]);
  });

  it('decodes a plain printable byte (terminal without the protocol)', () => {
    expect(decode('w')).toEqual([{ name: 'w', kind: 'press' }]);
    expect(decode('d')).toEqual([{ name: 'd', kind: 'press' }]);
  });
});

describe('KeyDecoder — robustness', () => {
  it("ignores 'c' without the Ctrl modifier (it is not a movement or quit key)", () => {
    expect(decode(`${CSI}99;1u`)).toEqual([]);
    expect(decode('c')).toEqual([]);
  });

  it('ignores the protocol query response and other non-key CSI sequences', () => {
    expect(decode(`${CSI}?10u`)).toEqual([]); // CSI ? flags u  (support reply)
    expect(decode(`${CSI}1;1R`)).toEqual([]); // cursor position report
    expect(decode(`${CSI}0c`)).toEqual([]); // device attributes
  });

  it('ignores unmapped keys without firing anything', () => {
    expect(decode(`${CSI}120;1:1u`)).toEqual([]); // 'x'
    expect(decode('x')).toEqual([]);
  });

  it('decodes several events in a single chunk, in order', () => {
    expect(decode(`${CSI}119;1:1u${CSI}119;1:3u${CSI}100;1:1u`)).toEqual([
      { name: 'w', kind: 'press' },
      { name: 'w', kind: 'release' },
      { name: 'd', kind: 'press' },
    ]);
  });

  it('buffers an escape sequence split across chunks and emits it once complete', () => {
    const decoder = new KeyDecoder();
    expect(decoder.decode(`${CSI}119;1`)).toEqual([]); // arrives mid-sequence
    expect(decoder.decode(':3u')).toEqual([{ name: 'w', kind: 'release' }]);
  });

  it('buffers a lone trailing ESC until its sequence arrives', () => {
    const decoder = new KeyDecoder();
    expect(decoder.decode(ESC)).toEqual([]);
    expect(decoder.decode(`[57297;1:1u`)).toEqual([{ name: 'UP', kind: 'press' }]);
  });
});
