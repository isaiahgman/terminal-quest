import { describe, it, expect } from 'vitest';
import { computeCamera } from './camera.js';

describe('computeCamera', () => {
  it('centers on the target when there is room', () => {
    const cam = computeCamera({ x: 50, y: 50 }, 20, 10, 100, 100);
    expect(cam.x).toBe(40); // 50 - floor(20/2)
    expect(cam.y).toBe(45); // 50 - floor(10/2)
  });

  it('clamps at the top-left edge (never negative)', () => {
    const cam = computeCamera({ x: 0, y: 0 }, 20, 10, 100, 100);
    expect(cam.x).toBe(0);
    expect(cam.y).toBe(0);
  });

  it('clamps at the bottom-right edge', () => {
    const cam = computeCamera({ x: 99, y: 99 }, 20, 10, 100, 100);
    expect(cam.x).toBe(80); // worldW - viewW
    expect(cam.y).toBe(90); // worldH - viewH
  });

  it('pins to origin when the world is smaller than the viewport', () => {
    const cam = computeCamera({ x: 2, y: 2 }, 50, 50, 10, 10);
    expect(cam.x).toBe(0);
    expect(cam.y).toBe(0);
  });

  it('passes the viewport dimensions through as the camera size', () => {
    const cam = computeCamera({ x: 50, y: 50 }, 20, 10, 100, 100);
    expect(cam.width).toBe(20);
    expect(cam.height).toBe(10);
  });

  it('floors the centering offset for odd viewport dimensions', () => {
    const cam = computeCamera({ x: 50, y: 50 }, 21, 11, 100, 100);
    expect(cam.x).toBe(40); // 50 - floor(21/2) = 50 - 10
    expect(cam.y).toBe(45); // 50 - floor(11/2) = 50 - 5
  });

  it('pins to 0 when the world is exactly as wide as the viewport', () => {
    const cam = computeCamera({ x: 50, y: 50 }, 20, 10, 20, 100);
    expect(cam.x).toBe(0); // maxX = max(0, worldW - viewW) = 0
    expect(cam.y).toBe(45); // y unaffected: 50 - floor(10/2)
  });
});
