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
import { type SwarmKind, createEnemy } from './game/enemy.js';
import { createEnemyAi } from './game/entities.js';
import { generateWorld } from './game/world/generate.js';
import { Rng } from './game/rng.js';
import {
  manhattan,
  pickSpawn,
  placeBosses,
  placeWeapons,
} from './game/spawn.js';
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
const ENEMY_KINDS: readonly SwarmKind[] = ['grunt', 'runner', 'brute'];
/** Keep initial enemies at least this far (Manhattan) from the player's spawn. */
const ENEMY_MIN_PLAYER_DISTANCE = 12;

/** How many weapon pickups to scatter in a fresh world (TQ-010). */
const WEAPON_COUNT = 5;

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
      const far = manhattan({ x, y }, player) > ENEMY_MIN_PLAYER_DISTANCE;
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
 * Place the boss roster (TQ-011) into the live enemy set. Each boss is a tough
 * {@link Enemy} (`kind: 'boss'`), so it rides in `enemies[]` as a {@link LiveEnemy}
 * and reuses the existing movement/combat/contact/XP/render paths — the only
 * boss-specific logic (defeat-counting, the victory flip, the signature) lives in
 * the sim. Deterministic from the injected {@link Rng} (seeded off the world
 * seed), like {@link spawnEnemies}; bosses are spaced far from the player and each
 * other by {@link placeBosses}, not scattered as a swarm.
 */
function spawnBosses(world: World, player: Vec2, rng: Rng): LiveEnemy[] {
  return placeBosses(world, player, rng).map((boss) => ({
    enemy: boss,
    ai: createEnemyAi(),
  }));
}

/** The player's level, defaulting to 1 for pre-progression states. */
function currentLevel(state: GameState): number {
  return state.player.progress?.level ?? 1;
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
  // Terminal Quest needs a real interactive terminal: a following camera sizes
  // the world to the viewport, and raw-mode key events drive the loop. Without a
  // TTY, terminal-kit reports Infinite dimensions (so world generation throws a
  // RangeError deep in setup) and there is no keyboard to play with. Refuse up
  // front with a clear message — before touching fullscreen/raw mode — instead
  // of crashing or leaving a non-interactive shell in a half-set-up state.
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(
      'terminal-quest must be run in an interactive terminal (a TTY).',
    );
    process.exitCode = 1;
    return;
  }

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
  let player: Player;
  if (save) {
    const restored = playerFromSave(save);
    // A hand-edited or stale save can carry a pos that isn't walkable in the
    // rebuilt world (out of bounds, or inside a wall) — which would soft-lock
    // the player with no escape. Keep the restored stats but relocate to a valid
    // spawn in that case; the validator can't catch this (it can't see the world).
    player = isWalkable(world, restored.pos.x, restored.pos.y)
      ? restored
      : { ...restored, pos: pickSpawn(world, setupRng) };
  } else {
    player = createPlayer(pickSpawn(world, setupRng));
  }
  // Bosses are the win condition (prd §7/F7): place the full roster as live
  // enemies alongside the swarm so they move/fight/render via the shared paths
  // and the run is winnable. Like the swarm, they respawn from the seed each load
  // (enemies aren't persisted), so the roster is always present on a resume too.
  // NOTE: defeat progress isn't persisted yet either — `bossesDefeated` is absent
  // from SaveData (SAVE_VERSION=1), so a resume restarts the win count at 0/N with
  // the full roster respawned. Persisting it is deferred to a later save bump
  // (tracked for TQ-012); until then a quit-and-resume erases boss progress.
  const state: GameState = {
    world,
    player,
    enemies: [
      ...spawnEnemies(world, player.pos, setupRng),
      ...spawnBosses(world, player.pos, setupRng),
    ],
    // Weapon pickups scattered from the same seeded RNG (TQ-010). Not persisted
    // by the save yet, so they reseed from the seed on resume — like the swarm.
    pickups: placeWeapons(world, player.pos, setupRng, WEAPON_COUNT),
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

  // Autosave: never blocks the loop on disk I/O. Writes are coalesced through a
  // single in-flight chain so two can't race to rename (Node's threadpool doesn't
  // preserve start order) — whatever `latestState` is when a slot frees up lands
  // last. A failed write is logged, non-fatal: the next interval/level-up/exit
  // flush retries.
  latestState = state;
  let lastSavedLevel = currentLevel(state);
  let saving = false;
  let pending = false;
  const flushSave = async (): Promise<void> => {
    if (saving) {
      pending = true; // collapse a burst into one more write after this one
      return;
    }
    saving = true;
    try {
      do {
        pending = false;
        if (latestState !== undefined) await writeSave(latestState);
      } while (pending);
    } catch (err: unknown) {
      console.error('terminal-quest: autosave failed', err);
    } finally {
      saving = false;
    }
  };
  const requestSave = (): void => {
    void flushSave();
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
      const level = currentLevel(s);
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
