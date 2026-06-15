import type { Vec2 } from '../state.js';

/** The visible window into a world that may be larger than the screen. */
export interface Camera {
  x: number;
  y: number;
  viewW: number;
  viewH: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Center the camera on `target`, clamped so it never shows past the world
 * bounds. Pure — this is the testable heart of "world bigger than the screen".
 */
export function computeCamera(
  target: Vec2,
  viewW: number,
  viewH: number,
  worldW: number,
  worldH: number,
): Camera {
  const maxX = Math.max(0, worldW - viewW);
  const maxY = Math.max(0, worldH - viewH);
  const x = clamp(target.x - Math.floor(viewW / 2), 0, maxX);
  const y = clamp(target.y - Math.floor(viewH / 2), 0, maxY);
  return { x, y, viewW, viewH };
}
