import terminalKit from 'terminal-kit';
import { type GameState, tileAt } from '../game/state.js';
import { computeCamera } from '../game/world/camera.js';
import {
  cellAttr,
  glyphForTile,
  PICKUP_GLYPH,
  PLAYER_GLYPH,
} from './sprites.js';
import { HUD_ROWS, drawHud } from './hud.js';

type Term = typeof terminalKit.terminal;

/** DEC private mode 2026 — synchronized output, so a frame composites atomically. */
const SYNC_ON = '\x1b[?2026h';
export const SYNC_OFF = '\x1b[?2026l';

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
    for (let sy = 0; sy < playH; sy++) {
      for (let sx = 0; sx < width; sx++) {
        const g = glyphForTile(tileAt(state.world, cam.x + sx, cam.y + sy));
        cellOpts.x = sx;
        cellOpts.y = sy;
        cellOpts.attr.color = g.color;
        cellOpts.attr.bgColor = g.bg ?? '';
        this.screen.put(cellOpts, g.char);
      }
    }

    // Weapon pickups, drawn after tiles but before enemies/player, so anything
    // standing on a pickup's tile covers it (the pickup is gone the tick the
    // player steps on, so the only overlap is an enemy passing over). Skip any
    // outside the viewport. (TQ-010)
    for (const pickup of state.pickups ?? []) {
      const px = pickup.pos.x - cam.x;
      const py = pickup.pos.y - cam.y;
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
      const ex = enemy.pos.x - cam.x;
      const ey = enemy.pos.y - cam.y;
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
    const px = state.player.pos.x - cam.x;
    const py = state.player.pos.y - cam.y;
    if (px >= 0 && py >= 0 && px < width && py < playH) {
      this.putGlyph(px, py, cellAttr(PLAYER_GLYPH, true), PLAYER_GLYPH.char);
    }

    // The HUD owns the reserved band below the world viewport.
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
