import { describe, expect, it } from 'vitest';
import type { Tile } from '../game/state.js';
import { glyphForTile, PLAYER_GLYPH } from './sprites.js';

const ALL_TILES: readonly Tile[] = ['floor', 'wall'];

describe('tileset palette', () => {
  it('maps every tile to a non-empty glyph with a foreground colour', () => {
    for (const tile of ALL_TILES) {
      const g = glyphForTile(tile);
      expect(g.char.length).toBeGreaterThan(0);
      expect(g.color.length).toBeGreaterThan(0);
    }
  });

  it('gives every tile a background colour for a filled, readable look', () => {
    for (const tile of ALL_TILES) {
      expect(glyphForTile(tile).bg).toBeTruthy();
    }
  });

  it('renders walkable and blocking tiles as visually distinct', () => {
    expect(glyphForTile('floor').char).not.toBe(glyphForTile('wall').char);
    expect(glyphForTile('floor').bg).not.toBe(glyphForTile('wall').bg);
  });
});

describe('player glyph', () => {
  it('is a non-empty glyph with a foreground colour', () => {
    expect(PLAYER_GLYPH.char.length).toBeGreaterThan(0);
    expect(PLAYER_GLYPH.color.length).toBeGreaterThan(0);
  });

  it('stands out from the tiles it walks over', () => {
    expect(PLAYER_GLYPH.color).not.toBe(glyphForTile('floor').color);
    expect(PLAYER_GLYPH.color).not.toBe(glyphForTile('wall').color);
  });
});
