import type { Tile } from '../game/state.js';

/** Glyph + colours for one cell. Colour values are terminal-kit colour names. */
export interface Glyph {
  char: string;
  /** Foreground colour. */
  color: string;
  /** Background colour; omitted = the terminal's default background. */
  bg?: string;
}

/**
 * Palette — the single source of truth for the game's visual identity.
 * Tune the look here; nothing else in the render layer hard-codes a colour.
 *
 * Frozen so each entry is a single shared, immutable instance: `glyphForTile`
 * returns the same reference on every call (no per-cell allocation in the hot
 * render path) and no caller can mutate the shared glyph.
 */
const PALETTE = {
  /** Recessive dotted ground so the eye reads it as empty, walkable space. */
  floor: { char: '·', color: 'gray', bg: 'black' },
  /** Solid, lit stone — a hatched block on a raised grey background. */
  wall: { char: '▓', color: 'white', bg: 'brightBlack' },
  /** Deliberately the brightest thing on screen, so it is instantly findable. */
  player: { char: '@', color: 'brightYellow', bg: 'black' },
} as const satisfies Record<string, Glyph>;

export function glyphForTile(tile: Tile): Readonly<Glyph> {
  switch (tile) {
    case 'floor':
      return PALETTE.floor;
    case 'wall':
      return PALETTE.wall;
  }
}

/** The player's glyph — high-contrast against every tile background. */
export const PLAYER_GLYPH: Readonly<Glyph> = PALETTE.player;

/**
 * Build a terminal-kit cell attribute from a glyph. `bgColor` is included only
 * when the glyph defines a background, so a bg-less glyph falls back to the
 * terminal's default background (AC: backgrounds applied only when present).
 */
export function cellAttr(
  g: Glyph,
  bold: boolean,
): { color: string; bold: boolean; bgColor?: string } {
  return g.bg === undefined
    ? { color: g.color, bold }
    : { color: g.color, bold, bgColor: g.bg };
}
