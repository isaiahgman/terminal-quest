import terminalKit from 'terminal-kit';
import {
  type GameState,
  type LiveEnemy,
  type Vec2,
  type World,
  createPlayer,
  isWalkable,
} from './game/state.js';
import { type EnemyKind, createEnemy } from './game/enemy.js';
import { createEnemyAi } from './game/entities.js';
import { generateWorld } from './game/world/generate.js';
import { Rng } from './game/rng.js';
import { pickSpawn } from './game/spawn.js';
import { runLoop } from './game/loop.js';
import { Input } from './input/input.js';
import {
  startKeyboard,
  type KeyboardHandle,
} from './input/terminalKeyboard.js';
import { Renderer } from './render/renderer.js';

const term = terminalKit.terminal;

/** How many enemies to seed the world with, and the mix of kinds to draw from. */
const ENEMY_COUNT = 8;
const ENEMY_KINDS: readonly EnemyKind[] = ['grunt', 'runner', 'brute'];

/**
 * Scatter a handful of enemies on walkable ground, away from the player's spawn
 * so the run doesn't open mid-swarm. Deterministic from the injected {@link Rng}
 * (seeded off the world seed), like {@link pickSpawn}. Enemies may share a tile;
 * tighter placement is a later concern (TQ-005 core).
 */
function spawnEnemies(world: World, player: Vec2, rng: Rng): LiveEnemy[] {
  const open: Vec2[] = [];
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const far = Math.abs(x - player.x) + Math.abs(y - player.y) > 12;
      if (far && isWalkable(world, x, y)) open.push({ x, y });
    }
  }
  if (open.length === 0) return [];
  const enemies: LiveEnemy[] = [];
  for (let i = 0; i < ENEMY_COUNT; i++) {
    const kind = ENEMY_KINDS[rng.nextInt(ENEMY_KINDS.length)]!;
    enemies.push({
      enemy: createEnemy(kind, rng.pick(open)),
      ai: createEnemyAi(),
    });
  }
  return enemies;
}

/**
 * Restore the terminal to a clean state. Must run on EVERY exit path
 * (quit, SIGINT/SIGTERM, uncaught error) — a roguelike that leaves the
 * terminal in raw/alt-screen/hidden-cursor state is a failed run.
 */
let shuttingDown = false;
let keyboard: KeyboardHandle | undefined;
function shutdown(code = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;
  keyboard?.restore(); // pop the kitty protocol + raw mode before anything else
  term.hideCursor(false);
  term.fullscreen(false);
  term.styleReset();
  process.exit(code);
}

async function main(): Promise<void> {
  term.fullscreen(true);
  term.hideCursor(true);

  // A fresh world each launch; saving/restoring a chosen seed is TQ-012. The
  // world is larger than the screen so the camera has to follow the player.
  const worldSeed = Math.floor(Math.random() * 0x100000000);
  const world = generateWorld(term.width * 2, term.height * 2, worldSeed);

  // One RNG seeded off the world seed drives spawn placement; a second drives
  // the live sim (attack rolls) so combat reproduces alongside the world.
  const setupRng = new Rng(worldSeed);
  const spawn = pickSpawn(world, setupRng);
  const state: GameState = {
    world,
    player: createPlayer(spawn),
    enemies: spawnEnemies(world, spawn, setupRng),
    tooTired: false,
    tick: 0,
  };

  const simRng = new Rng(worldSeed ^ 0x9e3779b9);
  const renderer = new Renderer(term);
  const input = new Input();

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  process.on('uncaughtException', (err: unknown) => {
    console.error(err);
    shutdown(1);
  });
  // Belt-and-braces: if a signal fires *during* startKeyboard's await (before
  // `keyboard` is assigned, so shutdown's restore() is a no-op), this still
  // turns raw mode back off so the shell isn't left unusable.
  process.on('exit', () => {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  });

  // Negotiate the kitty keyboard protocol (real key-release → no coast) and
  // start feeding input. Falls back to the timeout model on terminals without
  // protocol support. Must finish before the loop so input is live frame one.
  keyboard = await startKeyboard(input);

  runLoop(state, {
    drainIntents: () => input.drain(),
    rng: () => simRng.nextFloat(),
    render: (s) => renderer.render(s),
    shouldStop: () => input.shouldQuit,
    onStop: () => shutdown(0),
  });
}

main().catch((err: unknown) => {
  console.error(err);
  shutdown(1);
});
