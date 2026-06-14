import terminalKit from 'terminal-kit';
import { type GameState } from './game/state.js';
import { sampleWorld } from './game/world/sampleMap.js';
import { Renderer } from './render/renderer.js';

const term = terminalKit.terminal;

/**
 * Restore the terminal to a clean state. Must run on EVERY exit path
 * (quit, SIGINT/SIGTERM, uncaught error) — a roguelike that leaves the
 * terminal in raw/alt-screen/hidden-cursor state is a failed run.
 */
let shuttingDown = false;
function shutdown(code = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;
  term.hideCursor(false);
  term.grabInput(false);
  term.fullscreen(false);
  term.styleReset();
  process.exit(code);
}

function main(): void {
  term.fullscreen(true);
  term.hideCursor(true);
  term.grabInput(true);

  // World is deliberately larger than the screen so the camera/viewport matters.
  const world = sampleWorld(term.width * 2, term.height * 2);
  const state: GameState = {
    world,
    player: {
      pos: { x: Math.floor(world.width / 2), y: Math.floor(world.height / 2) },
    },
    tick: 0,
  };

  const renderer = new Renderer(term);
  renderer.render(state);

  term.on('key', (name: string) => {
    if (name === 'q' || name === 'CTRL_C') shutdown(0);
  });

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  process.on('uncaughtException', (err: unknown) => {
    shutdown(1);
    console.error(err);
  });
}

main();
