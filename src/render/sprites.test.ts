import { describe, expect, it } from 'vitest';
import type { Tile } from '../game/state.js';
import {
  cellAttr,
  glyphForTile,
  PICKUP_GLYPH,
  PLAYER_GLYPH,
} from './sprites.js';

// Compiler-enforced exhaustiveness: a Record<Tile, …> forces every Tile variant
// to be listed, so adding a tile without updating this fails to typecheck rather
// than silently skipping the new variant in the tests below.
const TILE_PRESENCE: Record<Tile, true> = { floor: true, wall: true };
const ALL_TILES = Object.keys(TILE_PRESENCE) as Tile[];

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

  it('returns the same shared instance per tile across calls (no per-cell allocation)', () => {
    for (const tile of ALL_TILES) {
      expect(glyphForTile(tile)).toBe(glyphForTile(tile));
    }
  });

  it('returns stable char/color values across calls', () => {
    const first = glyphForTile('floor');
    const second = glyphForTile('floor');
    expect(second.char).toBe(first.char);
    expect(second.color).toBe(first.color);
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

describe('pickup glyph (TQ-010)', () => {
  it('is a non-empty glyph with a foreground colour', () => {
    expect(PICKUP_GLYPH.char.length).toBeGreaterThan(0);
    expect(PICKUP_GLYPH.color.length).toBeGreaterThan(0);
  });

  it('is visually distinct from the player and the tiles it lies on', () => {
    expect(PICKUP_GLYPH.char).not.toBe(PLAYER_GLYPH.char);
    expect(PICKUP_GLYPH.char).not.toBe(glyphForTile('floor').char);
    expect(PICKUP_GLYPH.char).not.toBe(glyphForTile('wall').char);
  });
});

describe('cellAttr', () => {
  it('includes bgColor when the glyph defines a background', () => {
    const attr = cellAttr({ char: '#', color: 'white', bg: 'blue' }, false);
    expect(attr).toEqual({ color: 'white', bold: false, bgColor: 'blue' });
  });

  it('omits bgColor entirely when the glyph has no background', () => {
    const attr = cellAttr({ char: '#', color: 'white' }, true);
    expect(attr).toEqual({ color: 'white', bold: true });
    expect('bgColor' in attr).toBe(false);
  });
});
