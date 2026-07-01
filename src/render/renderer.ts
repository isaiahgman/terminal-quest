import terminalKit from 'terminal-kit';
import { performance } from 'node:perf_hooks';
import { type GameState, inBase, tileAt } from '../game/state.js';
import { computeCamera } from '../game/world/camera.js';
import {
  cellAttr,
  glyphForTile,
  BASE_FLOOR_GLYPH,
  BASE_HEART_GLYPH,
  DAMAGE_NUMBER_COLOR,
  ENTRANCE_GLYPH,
  EXIT_GLYPH,
  HIT_FLASH_COLOR,
  PICKUP_GLYPH,
  PLAYER_GLYPH,
} from './sprites.js';
import { HUD_ROWS, drawHud } from './hud.js';
import {
  type FxState,
  advanceFx,
  createFx,
  riseOffset,
  shakeOffset,
  spawnHitFx,
} from './fx.js';

type Term = typeof terminalKit.terminal;

/** DEC private mode 2026 — synchronized output, so a frame composites atomically. */
const SYNC_ON = '\x1b[?2026h';
export const SYNC_OFF = '\x1b[?2026l';

/** Glyph over-drawn on a struck enemy's cell during its brief hit flash (TQ-015). */
const FLASH_CHAR = '*';

/**
 * Read-only renderer: draws a GameState into one full-screen ScreenBuffer and
 * flushes the delta. Never mutates state. Draws only the camera viewport, so
 * cost is proportional to the screen, not the (much larger) world.
 *
 * Sizing: the ScreenBuffer is sized once from the terminal at construction.
 * terminal-kit's ScreenBuffer has no resize, so mid-game terminal resize is
 * unsupported — the viewport keeps the original dimensions until restart. This
 * is safe (not garbled): `render` drives its loop off `this.screen.width/height`
 * and clamps enemies/player to that viewport, so it never draws past the buffer.
 * The buffer simply won't grow/shrink to track a resized terminal.
 */
export class Renderer {
  private readonly screen: terminalKit.ScreenBuffer;

  /**
   * The persistent hit-feedback pool (TQ-015). The sim emits transient hit
   * events on each GameState; the renderer owns the *effects* derived from them
   * across frames — spawning on this frame's events, ageing the rest by the
   * real-time gap since the last draw, and reading the derived shake offset. The
   * fx module is pure (no RNG, no I/O); this field is the only mutable juice
   * state and it lives entirely in the render layer, never in the sim.
   */
  private fx: FxState = createFx();

  /**
   * Wall-clock timestamp (ms) of the previous `render`, or `undefined` before
   * the first frame. Effects age by the real elapsed gap so they feel the same
   * regardless of how many sim ticks a frame batched.
   */
  private lastRenderMs: number | undefined;

  constructor(term: Term = terminalKit.terminal) {
    this.screen = new terminalKit.ScreenBuffer({
      dst: term,
      width: term.width,
      height: term.height,
      noFill: true,
    });
  }

  /**
   * Put one glyph at viewport cell (x, y) with the given attr. The shared shape
   * behind the handful of entity draws (each enemy, the player) — left-to-right,
   * no wrap. The per-cell tile pass deliberately does *not* use this: it reuses a
   * single options object so the hot loop allocates nothing per cell.
   */
  private putGlyph(
    x: number,
    y: number,
    attr: ReturnType<typeof cellAttr>,
    char: string,
  ): void {
    this.screen.put({ x, y, attr, wrap: false, dx: 1, dy: 0 }, char);
  }

  /**
   * Draw the live hit-feedback effects (TQ-015) over the world viewport: each
   * flash brightens its struck cell, each damage number draws its amount rising
   * from the hit cell. `originX`/`originY` is the world coordinate that maps to
   * screen cell (0,0) — i.e. the camera origin already shifted by the current
   * shake — so fx track the same kicked viewport as the entities. Everything is
   * clipped to the `[0,width) × [0,playH)` play area; shakes are not drawn (they
   * are applied as the viewport offset, not as glyphs).
   */
  private drawFx(
    originX: number,
    originY: number,
    width: number,
    playH: number,
  ): void {
    for (const fx of this.fx.effects) {
      if (fx.kind === 'flash') {
        const sx = fx.pos.x - originX;
        const sy = fx.pos.y - originY;
        if (sx < 0 || sy < 0 || sx >= width || sy >= playH) continue;
        // Over-draw the struck cell with a bright burst glyph so the enemy reads
        // as "blinking" for the flash's brief lifetime.
        this.putGlyph(
          sx,
          sy,
          { color: HIT_FLASH_COLOR, bold: true },
          FLASH_CHAR,
        );
      } else if (fx.kind === 'damage') {
        // Rise upward (toward smaller y) as the number ages; round to a cell.
        const sx = fx.pos.x - originX;
        const sy = fx.pos.y - originY - Math.round(riseOffset(fx));
        const text = String(fx.amount);
        // Clip the whole label horizontally and the row vertically; draw left to
        // right with no wrap so a number near the right edge truncates cleanly.
        if (sy < 0 || sy >= playH || sx >= width) continue;
        for (let i = 0; i < text.length; i++) {
          const cx = sx + i;
          if (cx < 0 || cx >= width) continue;
          this.putGlyph(
            cx,
            sy,
            { color: DAMAGE_NUMBER_COLOR, bold: true },
            text[i]!,
          );
        }
      }
    }
  }

  render(state: GameState): void {
    const { width, height } = this.screen;
    // Reserve the bottom `HUD_ROWS` for the HUD and pan the world inside the
    // rows above it, so the two regions never overlap (TQ-008 acceptance). The
    // camera, tile pass, and entity culling all use this reduced play height.
    const playH = Math.max(0, height - HUD_ROWS);
    const cam = computeCamera(
      state.player.pos,
      width,
      playH,
      state.world.width,
      state.world.height,
    );

    // --- Juice (TQ-015): age the effect pool by the real-time gap since the
    // last frame, then ingest this tick's hit events. Read-only w.r.t. state —
    // `hitEvents` is pure sim OUTPUT we never write back. The shake offset shifts
    // the whole world viewport (tiles + entities + fx) by a cell on a big hit.
    const now = performance.now();
    if (this.lastRenderMs !== undefined) {
      this.fx = advanceFx(this.fx, (now - this.lastRenderMs) / 1000);
    }
    this.lastRenderMs = now;
    this.fx = spawnHitFx(this.fx, state.hitEvents ?? []);
    const shake = shakeOffset(this.fx);

    // One reusable put-options object for the viewport cell loop, so the hot
    // loop allocates nothing per cell regardless of viewport size. Every glyph
    // here defines a background, so `bgColor` is always set to a valid name
    // before each put — important because terminal-kit's object2attr mutates
    // this attr object in place (e.g. rewriting colour names to numeric
    // indices); reassigning fresh valid values each iteration keeps it sound.
    const cellOpts = {
      x: 0,
      y: 0,
      attr: { color: '', bold: false, bgColor: '' },
      wrap: false,
      dx: 1,
      dy: 0,
    };
    // Sample the world offset by `-shake` so the visible content slides by
    // `+shake` while the draw positions stay inside the buffer (no off-buffer
    // puts, no gaps): a 1-cell screen shake reads as the world kicking, not the
    // frame tearing. With no live shake, `shake` is {0,0} and this is the
    // original tile pass exactly.
    const home = state.base;
    for (let sy = 0; sy < playH; sy++) {
      for (let sx = 0; sx < width; sx++) {
        const wx = cam.x + sx - shake.x;
        const wy = cam.y + sy - shake.y;
        const tile = tileAt(state.world, wx, wy);
        // Home ground (TQ-013): floor inside the base's safe area draws in the
        // base palette, so the zone — and its growth, tier by tier — is visible
        // at a glance. Walls keep their look; only the ground is home.
        const g =
          home !== undefined && tile === 'floor' && inBase(home, wx, wy)
            ? BASE_FLOOR_GLYPH
            : glyphForTile(tile);
        cellOpts.x = sx;
        cellOpts.y = sy;
        cellOpts.attr.color = g.color;
        cellOpts.attr.bgColor = g.bg ?? '';
        this.screen.put(cellOpts, g.char);
      }
    }

    // The hearth at the base's center (TQ-013) — the landmark you navigate home
    // by. Drawn like a pickup: over the tiles, under everything that moves.
    if (home !== undefined) {
      const hx = home.pos.x - cam.x + shake.x;
      const hy = home.pos.y - cam.y + shake.y;
      if (hx >= 0 && hy >= 0 && hx < width && hy < playH) {
        this.putGlyph(
          hx,
          hy,
          cellAttr(BASE_HEART_GLYPH, true),
          BASE_HEART_GLYPH.char,
        );
      }
    }

    // Stairs (TQ-014), drawn like pickups: over the tiles, under everything
    // that moves. On the surface every entrance shows its down-stairs; inside
    // a dungeon the exit tile shows the way back up.
    for (const entrance of state.entrances ?? []) {
      const ex = entrance.x - cam.x + shake.x;
      const ey = entrance.y - cam.y + shake.y;
      if (ex < 0 || ey < 0 || ex >= width || ey >= playH) continue;
      this.putGlyph(
        ex,
        ey,
        cellAttr(ENTRANCE_GLYPH, true),
        ENTRANCE_GLYPH.char,
      );
    }
    if (state.dungeon !== undefined) {
      const gx = state.dungeon.exitPos.x - cam.x + shake.x;
      const gy = state.dungeon.exitPos.y - cam.y + shake.y;
      if (gx >= 0 && gy >= 0 && gx < width && gy < playH) {
        this.putGlyph(gx, gy, cellAttr(EXIT_GLYPH, true), EXIT_GLYPH.char);
      }
    }

    // Weapon pickups, drawn after tiles but before enemies/player, so anything
    // standing on a pickup's tile covers it (the pickup is gone the tick the
    // player steps on, so the only overlap is an enemy passing over). Skip any
    // outside the viewport. (TQ-010)
    for (const pickup of state.pickups ?? []) {
      const px = pickup.pos.x - cam.x + shake.x;
      const py = pickup.pos.y - cam.y + shake.y;
      if (px < 0 || py < 0 || px >= width || py >= playH) continue;
      this.screen.put(
        {
          x: px,
          y: py,
          attr: cellAttr(PICKUP_GLYPH, true),
          wrap: false,
          dx: 1,
          dy: 0,
        },
        PICKUP_GLYPH.char,
      );
    }

    // Enemies, drawn before the player so the player glyph stays on top when an
    // enemy shares its cell. Each carries its own glyph/color (see `enemy.ts`),
    // so the renderer stays data-driven — no per-kind switch here. Skip any that
    // fall outside the viewport.
    for (const { enemy } of state.enemies ?? []) {
      const ex = enemy.pos.x - cam.x + shake.x;
      const ey = enemy.pos.y - cam.y + shake.y;
      if (ex < 0 || ey < 0 || ex >= width || ey >= playH) continue;
      this.putGlyph(
        ex,
        ey,
        cellAttr({ char: enemy.glyph, color: enemy.color }, false),
        enemy.glyph,
      );
    }

    // Cull the player against the play area too (symmetry with enemies above),
    // so a degenerate viewport — e.g. `playH === 0` on a terminal too short for
    // the world — never paints the player glyph into the HUD band.
    const px = state.player.pos.x - cam.x + shake.x;
    const py = state.player.pos.y - cam.y + shake.y;
    if (px >= 0 && py >= 0 && px < width && py < playH) {
      this.putGlyph(px, py, cellAttr(PLAYER_GLYPH, true), PLAYER_GLYPH.char);
    }

    // --- Hit-feedback overlay (TQ-015): flashes over struck enemies, then the
    // floating damage numbers, drawn on top of the world but below the HUD band.
    // Anchored in world cells (camera- and shake-relative, like the entities)
    // and clipped to the play area.
    this.drawFx(cam.x - shake.x, cam.y - shake.y, width, playH);

    // The HUD owns the reserved band below the world viewport. The HUD never
    // shakes — only the world viewport above it does — so it ignores `shake`.
    drawHud(this.screen, state, playH, width);

    // A terminal run-end banner over the frozen frame (TQ-020): the loop halts
    // the sim on victory/defeat, and this is its visible payoff. Drawn last so it
    // sits on top of the world and HUD.
    if (state.status === 'victory' || state.status === 'defeat') {
      this.drawEndScreen(state.status, width, playH);
    }

    process.stdout.write(SYNC_ON);
    this.screen.draw({ delta: true });
    process.stdout.write(SYNC_OFF);
  }

  /**
   * Centered run-end banner: bold title (gold for victory, red for defeat) plus
   * a quit hint, each line padded to a small block so it reads over the world
   * rather than as scattered glyphs. Centered within the play area (not the HUD
   * band) and clamped to the viewport, so a tiny terminal still draws sanely.
   */
  private drawEndScreen(
    status: 'victory' | 'defeat',
    width: number,
    playH: number,
  ): void {
    const banner =
      status === 'victory'
        ? { lines: ['VICTORY', 'All bosses defeated'], color: 'brightYellow' }
        : { lines: ['YOU DIED', ''], color: 'brightRed' };
    const lines = [...banner.lines, 'press q to quit'];

    const contentW = Math.max(...lines.map((l) => l.length));
    const bannerW = Math.min(width, contentW + 2);
    const x = Math.max(0, Math.floor((width - bannerW) / 2));
    const top = Math.max(0, Math.floor((playH - lines.length) / 2));

    lines.forEach((line, i) => {
      const y = top + i;
      if (y >= playH) return;
      const left = Math.max(0, Math.floor((bannerW - line.length) / 2));
      const text = (' '.repeat(left) + line).padEnd(bannerW).slice(0, bannerW);
      const isTitle = i === 0;
      this.screen.put(
        {
          x,
          y,
          attr: {
            color: isTitle ? banner.color : 'white',
            bold: isTitle,
            bgColor: 'black',
          },
          wrap: false,
          dx: 1,
          dy: 0,
        },
        text,
      );
    });
  }
}
