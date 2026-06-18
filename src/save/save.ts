/**
 * Save / load (TQ-012). Persists just enough of {@link GameState} to drop the
 * player back where they were on relaunch — the world **seed + dims** (the map
 * is deterministic, so we never store the tile array), the player's position and
 * stats/level, and the tick. Enemies are *not* persisted: they respawn from the
 * seed on load (resume the *feel*, not the exact swarm — see the artifact).
 *
 * The schema is **versioned** so weapon (TQ-010) and bosses-defeated (TQ-011)
 * can be added later behind a version bump rather than a silent format break.
 *
 * This is the save layer (TDD §4) — the one sim-adjacent module that does file
 * I/O. Writes are **atomic** (write a unique temp file, then rename) so a crash
 * mid-write can never leave a half-written `save.json`; reads **validate** and
 * return `null` on anything malformed, so a corrupt or missing save degrades to
 * a fresh game instead of crashing.
 */
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type GameState, type Player, type Vec2 } from '../game/state.js';
import { type Progression, createProgression } from '../game/progression.js';

/**
 * Save-format version. Bump when the shape changes incompatibly; {@link
 * parseSave} rejects any save whose `version` differs, so an old save loads as
 * "no save" (new game) rather than mis-parsing into a broken state.
 */
export const SAVE_VERSION = 1;

/** The serialized, plain-JSON snapshot written to disk. */
export interface SaveData {
  readonly version: number;
  /** Everything needed to regenerate the world deterministically (TQ-004). */
  readonly world: {
    readonly seed: number;
    readonly width: number;
    readonly height: number;
  };
  readonly player: {
    readonly pos: Vec2;
    readonly hp: number;
    readonly stamina: number;
    readonly def: number;
    readonly progress: Progression;
  };
  readonly tick: number;
}

/** Project the live {@link GameState} down to its serializable {@link SaveData}. */
export function serialize(state: GameState): SaveData {
  // `progress` is optional on the player during incremental wiring; a fresh
  // level-1 progression is the same default the sim falls back to.
  const progress = state.player.progress ?? createProgression();
  return {
    version: SAVE_VERSION,
    world: {
      seed: state.world.seed,
      width: state.world.width,
      height: state.world.height,
    },
    player: {
      pos: { x: state.player.pos.x, y: state.player.pos.y },
      hp: state.player.hp,
      stamina: state.player.stamina,
      def: state.player.def,
      progress: { ...progress },
    },
    tick: state.tick,
  };
}

/** Rebuild the player from a validated save (the world is rebuilt separately). */
export function playerFromSave(save: SaveData): Player {
  return {
    pos: { x: save.player.pos.x, y: save.player.pos.y },
    hp: save.player.hp,
    stamina: save.player.stamina,
    def: save.player.def,
    progress: { ...save.player.progress },
  };
}

// --- Validation ---------------------------------------------------------------
// A save is attacker-controlled-ish (a hand-edited or truncated file), so every
// field is checked before use — and not just for *type* but for *domain*: a
// value that is the right type yet out of range (a fractional level, negative
// hp, an absurd stat) is rejected too, so the sim only ever loads numbers it was
// designed for. World dims/seed are integer-checked because `generateWorld`
// throws on non-integers; a check here turns that crash into a clean new game.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isPositiveInteger(value: unknown): value is number {
  return isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return isInteger(value) && value >= 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isVec2(value: unknown): value is Vec2 {
  return isRecord(value) && isInteger(value.x) && isInteger(value.y);
}

function isProgression(value: unknown): value is Progression {
  // level is a positive integer (the curve is geometric in an integer level);
  // xp is non-negative; the stat ceilings are strictly positive.
  return (
    isRecord(value) &&
    isPositiveInteger(value.level) &&
    isNonNegativeNumber(value.xp) &&
    isPositiveNumber(value.maxHp) &&
    isPositiveNumber(value.maxStamina) &&
    isPositiveNumber(value.atk)
  );
}

function isSaveData(value: unknown): value is SaveData {
  if (!isRecord(value) || value.version !== SAVE_VERSION) return false;

  const world = value.world;
  if (
    !isRecord(world) ||
    !isInteger(world.seed) ||
    !isPositiveInteger(world.width) ||
    !isPositiveInteger(world.height)
  ) {
    return false;
  }

  const player = value.player;
  if (
    !isRecord(player) ||
    !isVec2(player.pos) ||
    !isNonNegativeNumber(player.hp) ||
    !isNonNegativeNumber(player.stamina) ||
    !isNonNegativeNumber(player.def) ||
    !isProgression(player.progress)
  ) {
    return false;
  }

  return isNonNegativeInteger(value.tick);
}

/** Parse + validate save JSON. Returns `null` for malformed or wrong-version data. */
export function parseSave(text: string): SaveData | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return isSaveData(parsed) ? parsed : null;
}

// --- File I/O -----------------------------------------------------------------

/** Directory holding the save file: `~/.terminal-quest/`. */
export function saveDir(): string {
  return join(homedir(), '.terminal-quest');
}

/** Absolute path of the save file: `~/.terminal-quest/save.json`. */
export function saveFilePath(): string {
  return join(saveDir(), 'save.json');
}

// Monotonic counter giving every write a unique temp filename, so concurrent
// writes (an interval autosave and the final sync flush on quit) never collide
// on the same temp path. Each write ends in an atomic rename, so a reader never
// sees a partial file; *ordering* between concurrent writers is the caller's job
// (cli.ts serializes its async autosaves).
let writeCounter = 0;

function tempPath(file: string): string {
  writeCounter += 1;
  return `${file}.${writeCounter}.tmp`;
}

/** The exact bytes written to disk. One definition so the format can't drift. */
function serializeJson(state: GameState): string {
  return JSON.stringify(serialize(state), null, 2);
}

/**
 * Load the save, or `null` if there is none / it is unreadable / it is corrupt.
 * Synchronous because it runs once at startup, before the loop.
 */
export function readSave(): SaveData | null {
  let text: string;
  try {
    text = readFileSync(saveFilePath(), 'utf8');
  } catch {
    return null; // missing or unreadable → new game
  }
  return parseSave(text);
}

/**
 * Atomically persist the state. Async (used by the autosave interval) so disk
 * I/O never blocks the game loop. Write to a unique temp file, then rename over
 * the real path — rename is atomic on POSIX, so a reader never sees a partial file.
 */
export async function writeSave(state: GameState): Promise<void> {
  const file = saveFilePath();
  const tmp = tempPath(file);
  await mkdir(saveDir(), { recursive: true });
  try {
    await writeFile(tmp, serializeJson(state), 'utf8');
    await rename(tmp, file);
  } finally {
    // On success `rename` already consumed `tmp`; on failure (read-only $HOME,
    // full disk, EXDEV) remove the orphan so repeated autosaves don't pile up.
    await rm(tmp, { force: true });
  }
}

/**
 * Synchronous atomic save, for the final flush during shutdown — the loop is
 * already stopping, so blocking briefly is fine and guarantees the last state
 * lands before {@link process.exit}.
 */
export function writeSaveSync(state: GameState): void {
  const file = saveFilePath();
  const tmp = tempPath(file);
  mkdirSync(saveDir(), { recursive: true });
  try {
    writeFileSync(tmp, serializeJson(state), 'utf8');
    renameSync(tmp, file);
  } finally {
    rmSync(tmp, { force: true }); // remove the orphan if write/rename threw
  }
}
