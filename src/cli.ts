import terminalKit from 'terminal-kit';
import { type GameState } from './game/state.js';
import { sampleWorld } from './game/world/sampleMap.js';
import { runLoop } from './game/loop.js';
import { Input } from './input/input.js';
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

  // World is larger than the screen so the camera has to follow the player.
  const world = sampleWorld(term.width * 2, term.height * 2);
  const state: GameState = {
    world,
    player: {
      pos: { x: Math.floor(world.width / 2), y: Math.floor(world.height / 2) },
    },
    tick: 0,
  };

  const renderer = new Renderer(term);
  const input = new Input(term);

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  process.on('uncaughtException', (err: unknown) => {
    console.error(err);
    shutdown(1);
  });

  runLoop(state, {
    drainIntents: () => input.drain(),
    render: (s) => renderer.render(s),
    shouldStop: () => input.shouldQuit,
    onStop: () => shutdown(0),
  });
}

main();
