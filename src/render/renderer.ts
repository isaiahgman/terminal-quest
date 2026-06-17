import terminalKit from 'terminal-kit';
import { type GameState, tileAt } from '../game/state.js';
import { computeCamera } from '../game/world/camera.js';
import { type Glyph, glyphForTile, PLAYER_GLYPH } from './sprites.js';

type Term = typeof terminalKit.terminal;

/** DEC private mode 2026 — synchronized output, so a frame composites atomically. */
const SYNC_ON = '\x1b[?2026h';
const SYNC_OFF = '\x1b[?2026l';

/** A terminal-kit cell attribute built from a glyph; bgColor is omitted when unset. */
function cellAttr(
  g: Glyph,
  bold: boolean,
): { color: string; bold: boolean; bgColor?: string } {
  return g.bg === undefined
    ? { color: g.color, bold }
    : { color: g.color, bold, bgColor: g.bg };
}

/**
 * Read-only renderer: draws a GameState into one full-screen ScreenBuffer and
 * flushes the delta. Never mutates state. Draws only the camera viewport, so
 * cost is proportional to the screen, not the (much larger) world.
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

  render(state: GameState): void {
    const { width, height } = this.screen;
    const cam = computeCamera(
      state.player.pos,
      width,
      height,
      state.world.width,
      state.world.height,
    );

    for (let sy = 0; sy < height; sy++) {
      for (let sx = 0; sx < width; sx++) {
        const g = glyphForTile(tileAt(state.world, cam.x + sx, cam.y + sy));
        this.screen.put(
          { x: sx, y: sy, attr: cellAttr(g, false), wrap: false, dx: 1, dy: 0 },
          g.char,
        );
      }
    }

    this.screen.put(
      {
        x: state.player.pos.x - cam.x,
        y: state.player.pos.y - cam.y,
        attr: cellAttr(PLAYER_GLYPH, true),
        wrap: false,
        dx: 1,
        dy: 0,
      },
      PLAYER_GLYPH.char,
    );

    process.stdout.write(SYNC_ON);
    this.screen.draw({ delta: true });
    process.stdout.write(SYNC_OFF);
  }
}
