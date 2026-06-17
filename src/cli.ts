import terminalKit from 'terminal-kit';
import {
  type GameState,
  type Vec2,
  type World,
  isWalkable,
} from './game/state.js';
import { generateWorld } from './game/world/generate.js';
import { Rng } from './game/rng.js';
import { runLoop } from './game/loop.js';
import { Input } from './input/input.js';
import { Renderer } from './render/renderer.js';

const term = terminalKit.terminal;

/**
 * Pick a walkable spawn tile deterministically. Draws from the injected
 * {@link Rng} (seeded off the world seed) rather than the global rot.js RNG, so
 * the choice reproduces alongside the map — but only at a fixed world size: the
 * walkable-tile list comes from a map sized to the terminal, so the same seed in
 * a differently-sized terminal yields a different map and a different spawn.
 * TQ-012 resume must therefore persist the world width/height alongside the
 * seed, not the seed alone.
 * `generateWorld` guarantees at least one floor tile, so the list is non-empty.
 */
function pickSpawn(world: World, rng: Rng): Vec2 {
  const walkable: Vec2[] = [];
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      if (isWalkable(world, x, y)) walkable.push({ x, y });
    }
  }
  return rng.pick(walkable);
}

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

  // A fresh world each launch; saving/restoring a chosen seed is TQ-012. The
  // world is larger than the screen so the camera has to follow the player.
  const worldSeed = Math.floor(Math.random() * 0x100000000);
  const world = generateWorld(term.width * 2, term.height * 2, worldSeed);

  // Spawn on open ground, picked deterministically from the same seed.
  const spawn = pickSpawn(world, new Rng(worldSeed));
  const state: GameState = {
    world,
    player: { pos: spawn },
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
