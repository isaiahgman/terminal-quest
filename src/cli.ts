import terminalKit from 'terminal-kit';
import {
  type GameState,
  type LiveEnemy,
  type Player,
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
import { Renderer, SYNC_OFF } from './render/renderer.js';
import {
  playerFromSave,
  readSave,
  writeSave,
  writeSaveSync,
} from './save/save.js';

const term = terminalKit.terminal;

/** How often the throttled, non-blocking autosave writes the latest state. */
const AUTOSAVE_INTERVAL_MS = 5000;

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
// The latest state the loop has rendered, captured for autosave. `undefined`
// until the first frame — a signal during startup has nothing to save yet.
let latestState: GameState | undefined;
let autosaveTimer: NodeJS.Timeout | undefined;
function shutdown(code = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;
  // Stop interval autosaves before the final write so the two never race; their
  // unique temp files plus process.exit() below also rule out a late async rename.
  if (autosaveTimer !== undefined) clearInterval(autosaveTimer);
  // Leave synchronized-output mode (the renderer toggles DEC 2026 per frame); a
  // crash mid-frame would otherwise freeze the display. Guard the write so an
  // already-closed stdout (EPIPE) can't throw on the way out.
  if (process.stdout.writable) process.stdout.write(SYNC_OFF);
  keyboard?.restore(); // pop the kitty protocol + raw mode before anything else
  term.hideCursor(false);
  term.fullscreen(false);
  term.styleReset();
  // Final synchronous save so the latest progress survives quit/SIGINT/crash.
  // After the terminal is restored, so a failed save can report cleanly; wrapped
  // so a save error can never block the exit.
  if (latestState !== undefined) {
    try {
      writeSaveSync(latestState);
    } catch (err: unknown) {
      console.error('terminal-quest: final save failed', err);
    }
  }
  process.exit(code);
}

async function main(): Promise<void> {
  term.fullscreen(true);
  term.hideCursor(true);

  // Install crash/signal handlers before any setup runs: a throw from world
  // generation, spawn placement, or the renderer/input constructors below must
  // still restore the terminal via shutdown(), never leave it raw/alt-screen.
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  process.on('uncaughtException', (err: unknown) => {
    console.error(err);
    shutdown(1);
  });
  process.on('unhandledRejection', (reason: unknown) => {
    console.error(reason);
    shutdown(1);
  });
  // A piped consumer (e.g. `tq | head`) closing stdout makes the next write
  // raise EPIPE; without a listener Node throws and leaves the terminal dirty.
  // Treat the departed reader as a clean exit, any other stream error as a fault.
  process.stdout.on('error', (err: NodeJS.ErrnoException) => {
    shutdown(err.code === 'EPIPE' ? 0 : 1);
  });
  // Belt-and-braces: if a signal fires *during* startKeyboard's await (before
  // `keyboard` is assigned, so shutdown's restore() is a no-op), this still
  // turns raw mode back off so the shell isn't left unusable.
  process.on('exit', () => {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  });

  // Resume from a valid save, else start a fresh run (TQ-012). A save stores the
  // seed + dims (the world is deterministic), so we regenerate the exact same
  // world from them rather than persisting the tile array. Enemies are not saved:
  // they respawn from the seed on load — we resume the *feel*, not the swarm.
  const save = readSave();
  const worldSeed = save?.world.seed ?? Math.floor(Math.random() * 0x100000000);
  // A fresh world is larger than the screen so the camera has to follow the
  // player; a resumed world keeps its saved dims so positions stay valid.
  const world = save
    ? generateWorld(save.world.width, save.world.height, worldSeed)
    : generateWorld(term.width * 2, term.height * 2, worldSeed);

  // One RNG seeded off the world seed drives spawn placement; a second drives
  // the live sim (attack rolls) so combat reproduces alongside the world.
  const setupRng = new Rng(worldSeed);
  const player: Player = save
    ? playerFromSave(save)
    : createPlayer(pickSpawn(world, setupRng));
  const state: GameState = {
    world,
    player,
    enemies: spawnEnemies(world, player.pos, setupRng),
    tooTired: false,
    tick: save?.tick ?? 0,
  };

  const simRng = new Rng(worldSeed ^ 0x9e3779b9);
  const renderer = new Renderer(term);
  const input = new Input();

  // Negotiate the kitty keyboard protocol (real key-release → no coast) and
  // start feeding input. Falls back to the timeout model on terminals without
  // protocol support. Must finish before the loop so input is live frame one.
  keyboard = await startKeyboard(input);

  // Autosave: fire-and-forget async writes that never block the loop on disk I/O.
  // A failed autosave is logged but non-fatal — the final sync save on exit and
  // the next interval both get another chance.
  latestState = state;
  let lastSavedLevel = state.player.progress?.level ?? 1;
  const requestSave = (): void => {
    if (latestState === undefined) return;
    void writeSave(latestState).catch((err: unknown) => {
      console.error('terminal-quest: autosave failed', err);
    });
  };
  autosaveTimer = setInterval(requestSave, AUTOSAVE_INTERVAL_MS);
  autosaveTimer.unref(); // never keep the process alive for an autosave

  runLoop(state, {
    drainIntents: () => input.drain(),
    rng: () => simRng.nextFloat(),
    render: (s) => {
      latestState = s;
      // Save immediately on a level-up — the one "key event" that exists today
      // (boss-kill / weapon-equip triggers arrive with TQ-011 / TQ-010).
      const level = s.player.progress?.level ?? 1;
      if (level > lastSavedLevel) {
        lastSavedLevel = level;
        requestSave();
      }
      renderer.render(s);
    },
    shouldStop: () => input.shouldQuit,
    onStop: () => shutdown(0),
  });
}

main().catch((err: unknown) => {
  console.error(err);
  shutdown(1);
});
