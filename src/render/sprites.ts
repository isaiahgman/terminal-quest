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
  /** A weapon lying on the ground (TQ-010) — a bright cyan marker to walk onto. */
  pickup: { char: '↑', color: 'brightCyan', bg: 'black' },
  /**
   * Home ground (TQ-013) — the base's safe area. A calm cool-blue floor so the
   * zone reads at a glance as "different, and safer" against the grey world.
   */
  baseFloor: { char: '·', color: 'brightBlue', bg: 'black' },
  /** The hearth at the base's center — the landmark you walk home toward. */
  baseHeart: { char: '⌂', color: 'brightCyan', bg: 'black' },
  /**
   * A dungeon entrance (TQ-014) — the classic roguelike down-stairs, in a hot
   * warning colour: risk lives through this door.
   */
  entrance: { char: '>', color: 'brightMagenta', bg: 'black' },
  /** The way back out of a dungeon — the up-stairs on the tile you arrived on. */
  exit: { char: '<', color: 'brightMagenta', bg: 'black' },
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
 * Foreground colours for the hit-feedback layer (TQ-015). A struck enemy briefly
 * over-draws in {@link HIT_FLASH_COLOR}; floating damage numbers draw in
 * {@link DAMAGE_NUMBER_COLOR}. Co-located with the palette so the juice shares the
 * game's visual identity and nothing else hard-codes these colours.
 */
export const HIT_FLASH_COLOR = 'brightWhite';
export const DAMAGE_NUMBER_COLOR = 'brightRed';

/** A weapon-pickup glyph — drawn on its world tile beneath enemies/player. */
export const PICKUP_GLYPH: Readonly<Glyph> = PALETTE.pickup;

/** Floor glyph for tiles inside the home base's safe area (TQ-013). */
export const BASE_FLOOR_GLYPH: Readonly<Glyph> = PALETTE.baseFloor;

/** The hearth glyph at the base's center tile (TQ-013). */
export const BASE_HEART_GLYPH: Readonly<Glyph> = PALETTE.baseHeart;

/** A dungeon entrance's down-stairs glyph (TQ-014). */
export const ENTRANCE_GLYPH: Readonly<Glyph> = PALETTE.entrance;

/** The dungeon exit's up-stairs glyph (TQ-014). */
export const EXIT_GLYPH: Readonly<Glyph> = PALETTE.exit;

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
