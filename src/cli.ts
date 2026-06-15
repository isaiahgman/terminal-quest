import terminalKit from 'terminal-kit';
import {
  isWalkable,
  type GameState,
  type Vec2,
  type World,
} from './game/state.js';
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

/**
 * Pick a guaranteed-walkable spawn. The world center is the intended spawn,
 * but procedural generation can put a wall there, so we spiral outward and
 * return the first walkable tile — never trusting the center coincidentally.
 */
function findSpawn(world: World): Vec2 {
  const cx = Math.floor(world.width / 2);
  const cy = Math.floor(world.height / 2);
  const maxRadius = Math.max(world.width, world.height);
  for (let radius = 0; radius <= maxRadius; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        // Only the ring at exactly `radius` is new this iteration.
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (isWalkable(world, x, y)) return { x, y };
      }
    }
  }
  throw new Error('world has no walkable tile to spawn the player on');
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
      pos: findSpawn(world),
    },
    tick: 0,
  };

  const renderer = new Renderer(term);
  const input = new Input(term);

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  process.on('uncaughtException', (err: unknown) => {
    shutdown(1);
    console.error(err);
  });

  runLoop(state, {
    drainIntents: () => input.drain(),
    render: (s) => renderer.render(s),
    shouldStop: () => input.shouldQuit,
    onStop: () => shutdown(0),
  });
}

main();
