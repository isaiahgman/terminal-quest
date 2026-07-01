/**
 * Save / load (TQ-012). Persists just enough of {@link GameState} to drop the
 * player back where they were on relaunch — the world **seed + dims** (the map
 * is deterministic, so we never store the tile array), the player's position and
 * stats/level, and the tick. Enemies are *not* persisted: they respawn from the
 * seed on load (resume the *feel*, not the exact swarm — see the artifact).
 *
 * The schema is **versioned**; v2 (TQ-022) added the fields prd §8 always
 * required beyond v1's player/world/tick — the defeated-boss ids and the run
 * `status` — and v1 saves still load via a tolerant upgrade (defaults for the
 * new fields) so nobody's progress is lost to the bump.
 *
 * Deliberate non-goal (TQ-022 decision #3): the combat RNG stream is **not**
 * persisted, even though `rng.ts` ships `getState`/`setState`. Enemies and
 * pickups respawn from the world seed on load anyway — a resume reproduces the
 * *feel*, not the exact frame — so persisting the roll stream would add schema
 * surface for continuity the load path already doesn't offer. Revisit only if
 * frame-exact combat continuity ever becomes a goal.
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
import {
  type GameState,
  type GameStatus,
  type Player,
  type Vec2,
} from '../game/state.js';
import { type Progression, createProgression } from '../game/progression.js';
import { BOSS_ROSTER } from '../data/bosses.js';
import { WEAPONS, type WeaponId } from '../data/weapons.js';

/**
 * Save-format version. Bump when the shape changes incompatibly; {@link
 * parseSave} rejects any save whose `version` it can't handle, so an unknown
 * save loads as "no save" (new game) rather than mis-parsing into a broken
 * state. Known *older* versions are upgraded in place instead of rejected
 * (see {@link upgradeSave}) — a bump must never cost a player their progress
 * when the new fields have safe defaults.
 */
export const SAVE_VERSION = 2;

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
    /**
     * The equipped weapon's id (prd §8, TQ-021). Absent ⇒ unarmed — the same
     * `undefined`-is-baseline convention the live slot uses (`state.ts`), so a
     * pre-weapon save and an unarmed save read identically. Additive within
     * schema v2 (no version bump): the tolerant loader treats a missing field
     * as unarmed, exactly per the TQ-022 "siblings extend v2" plan.
     */
    readonly weapon?: WeaponId;
  };
  /**
   * `id`s (from `data/bosses.ts`) of the bosses defeated so far — identity, not
   * just a count, so the resume path can keep dead bosses dead (`cli.ts` filters
   * them out of the respawned roster) and re-kills can never double-count toward
   * victory. The on-screen count restores as `defeatedBosses.length`.
   */
  readonly defeatedBosses: readonly string[];
  /** Run status — a finished run (victory/defeat) stays finished on resume. */
  readonly status: GameStatus;
  readonly tick: number;
}

/**
 * Project the live {@link GameState} down to its serializable {@link SaveData}.
 *
 * Dungeons (TQ-014): a save taken *inside* a dungeon records the suspended
 * OVERWORLD with the player at the entrance they went down through — not the
 * dungeon itself. Dungeons are transient, re-generable pockets (seed-derived,
 * like everything), so "where you were" for a resume is the door you entered;
 * everything player-bound (hp, level, weapon, loot) persists exactly as held
 * mid-dungeon. This keeps the schema world-shaped and the resume path single.
 */
export function serialize(state: GameState): SaveData {
  // `progress` is optional on the player during incremental wiring; a fresh
  // level-1 progression is the same default the sim falls back to.
  const progress = state.player.progress ?? createProgression();
  const world = state.dungeon?.overworld.world ?? state.world;
  const pos = state.dungeon?.returnPos ?? state.player.pos;
  return {
    version: SAVE_VERSION,
    world: {
      seed: world.seed,
      width: world.width,
      height: world.height,
    },
    player: {
      pos: { x: pos.x, y: pos.y },
      hp: state.player.hp,
      stamina: state.player.stamina,
      def: state.player.def,
      progress: { ...progress },
      // JSON.stringify drops an undefined field, so an unarmed player writes
      // no `weapon` key at all — absent-is-unarmed, matching the live slot.
      weapon: state.player.weapon,
    },
    defeatedBosses: [...(state.defeatedBossIds ?? [])],
    status: state.status ?? 'playing',
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
    weapon: save.player.weapon,
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

/** The boss ids a save may legitimately claim as defeated — the roster's. */
const KNOWN_BOSS_IDS: ReadonlySet<string> = new Set(
  BOSS_ROSTER.map((spec) => spec.id),
);

/**
 * Defeated-boss list: every entry a *known* roster id, no duplicates. Domain,
 * not just type — an id the roster doesn't know (a hand-edit, or a save from a
 * build whose roster shrank) can't be respawn-filtered or counted meaningfully,
 * and a duplicate would inflate the restored count past what was earned.
 */
function isDefeatedBosses(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every(
      (id): id is string => typeof id === 'string' && KNOWN_BOSS_IDS.has(id),
    ) &&
    new Set(value).size === value.length
  );
}

function isGameStatus(value: unknown): value is GameStatus {
  return value === 'playing' || value === 'victory' || value === 'defeat';
}

/**
 * Weapon slot: absent/`undefined` (unarmed) or an id the catalogue knows.
 * Domain, not just type — an unknown id would crash the equip/HUD lookups the
 * moment the slot is read (`WEAPONS[id]` has no runtime guard).
 */
function isWeaponSlot(value: unknown): value is WeaponId | undefined {
  return value === undefined || (typeof value === 'string' && value in WEAPONS);
}

/**
 * Upgrade a save written by an older known version to the current shape, or
 * return the value unchanged. v1 → v2: the new fields default safely (no bosses
 * defeated, a playing run) — exactly the state every v1 save was actually in
 * scope to record — so a v1 player keeps their level/position/world across the
 * bump instead of being reset to a new game (TQ-022 decision #1).
 */
function upgradeSave(value: unknown): unknown {
  if (isRecord(value) && value.version === 1) {
    return {
      ...value,
      version: 2,
      defeatedBosses: [],
      status: 'playing',
    };
  }
  return value;
}

function isSaveData(value: unknown): value is SaveData {
  if (!isRecord(value) || value.version !== SAVE_VERSION) return false;

  if (!isDefeatedBosses(value.defeatedBosses) || !isGameStatus(value.status)) {
    return false;
  }

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
    !isProgression(player.progress) ||
    !isWeaponSlot(player.weapon)
  ) {
    return false;
  }

  return isNonNegativeInteger(value.tick);
}

/**
 * Parse + validate save JSON. A known older version is upgraded in place first
 * ({@link upgradeSave}); anything malformed or unknown-versioned returns `null`.
 */
export function parseSave(text: string): SaveData | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const upgraded = upgradeSave(parsed);
  return isSaveData(upgraded) ? upgraded : null;
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
