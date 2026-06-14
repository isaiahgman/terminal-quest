import type { Tile, World } from '../state.js';

/**
 * A hand-made sample world for PR-001 so we can render something real.
 * Replaced by procedural generation (rot.js) in PR-004 — the World shape
 * stays identical, so the renderer never changes.
 */
export function sampleWorld(width = 80, height = 40): World {
  const tiles: Tile[][] = [];
  for (let y = 0; y < height; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < width; x++) {
      const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      // scattered pillars for "open world with cover" feel — but keep the
      // center spawn area clear.
      const nearCenter =
        Math.abs(x - Math.floor(width / 2)) < 4 &&
        Math.abs(y - Math.floor(height / 2)) < 4;
      const pillar = x % 11 < 2 && y % 6 < 2 && !nearCenter;
      row.push(border || pillar ? 'wall' : 'floor');
    }
    tiles.push(row);
  }
  return { width, height, tiles, seed: 0 };
}
