import type { Tile } from '../game/state.js';

/** Glyph + color for a thing on the grid. Color names are terminal-kit names. */
export interface Glyph {
  char: string;
  color: string;
}

export function glyphForTile(tile: Tile): Glyph {
  switch (tile) {
    case 'floor':
      return { char: '·', color: 'gray' };
    case 'wall':
      return { char: '#', color: 'white' };
  }
}

export const PLAYER_GLYPH = '@';
export const PLAYER_COLOR = 'brightWhite';
