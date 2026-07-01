#!/usr/bin/env node
/**
 * Diagnostic: prints the raw bytes your terminal sends for each key with the
 * kitty keyboard protocol enabled — used to confirm/lock the arrow-key
 * codepoints in src/input/keyDecoder.ts (TQ-019).
 *
 * Run it in the terminal you actually play in:  node scripts/capture-keys.mjs
 * Press the arrows + WASD (hold and release them), then press Ctrl-C to quit.
 * Each line shows the bytes as hex and as a printable string. For an arrow you
 * should see something like `1b 5b 35 37 32 39 37 3b 31 3a 31 75` = ESC[57297;1:1u
 * (press) and `...:3u` (release). If the number differs from 57297-57300,
 * update ARROW_CODEPOINT_TO_NAME with what you see.
 */
import process from 'node:process';

const { stdin, stdout } = process;
const ENABLE = '\x1b[>10u'; // push: report event types + all keys as escape codes
const DISABLE = '\x1b[<u'; // pop

function restore() {
  stdout.write(DISABLE);
  if (stdin.isTTY) stdin.setRawMode(false);
  stdin.pause();
}

process.on('exit', restore);
process.on('SIGINT', () => process.exit(0));

if (stdin.isTTY) stdin.setRawMode(true);
stdin.resume();
stdout.write(ENABLE);
stdout.write('Press keys (arrows + WASD, hold & release). Ctrl-C to quit.\r\n');

stdin.on('data', (chunk) => {
  // Ctrl-C in raw mode arrives as 0x03 (and as CSI 99;5u with the protocol).
  if (chunk.includes(0x03)) process.exit(0);
  const hex = [...chunk].map((b) => b.toString(16).padStart(2, '0')).join(' ');
  // Built via fromCharCode so the ESC control byte never appears literally
  // in source (eslint no-control-regex) — the pattern still matches it.
  const printable = chunk
    .toString('latin1')
    .replaceAll(String.fromCharCode(0x1b), 'ESC');
  stdout.write(`${hex}    ${printable}\r\n`);
});
