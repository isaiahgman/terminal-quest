/**
 * Core game state. This is the single source of truth the simulation advances
 * and the renderer reads. Keep it plain data (serializable) — no methods, no
 * class instances — so save/load is trivial later (TQ-012).
 */

import type { Enemy } from './enemy.js';
import type { EnemyAi } from './entities.js';
import type { Progression } from './progression.js';
import { createProgression } from './progression.js';
import type { WeaponId } from '../data/weapons.js';
import type { Base } from './base.js';
import { baseRadius } from './base.js';

export interface Vec2 {
  x: number;
  y: number;
}

export type Tile = 'floor' | 'wall';

/**
 * Run status: `'playing'` normally, `'victory'` once every placed boss is
 * defeated (TQ-011), `'defeat'` once the player's hp reaches 0 (TQ-020). Both
 * `'victory'` and `'defeat'` are terminal and sticky. The visible end screens +
 * loop halt land in a later TQ-020 PR; this flag is the sim-side trigger they
 * react to — set-but-not-yet-presented, the same incremental pattern victory
 * already follows.
 */
export type GameStatus = 'playing' | 'victory' | 'defeat';

export interface World {
  readonly width: number;
  readonly height: number;
  /** Row-major: tiles[y][x]. Deeply read-only — Render is read-only (see TDD). */
  readonly tiles: ReadonlyArray<ReadonlyArray<Tile>>;
  readonly seed: number;
}

export interface Player {
  pos: Vec2;
  /** Current health; chipped by enemy contact, floored at 0 (ceiling: progress.maxHp). */
  hp: number;
  /** Current stamina; spent by attacks, regenerated each tick (ceiling: progress.maxStamina). */
  stamina: number;
  /** Defensive power subtracted from incoming attack damage (a `Combatant.def`). */
  def: number;
  /**
   * Leveling state and the stat ceilings it raises (TQ-009): `maxHp`,
   * `maxStamina`, and `atk` all live here, so a level-up powers up attacks and
   * raises the hp/stamina caps. Optional while integration rolls in
   * incrementally — states that predate progression omit it, and the combat /
   * XP paths in {@link update} default a fresh level-1 progression.
   */
  progress?: Progression;
  /**
   * The single equipped-weapon slot (TQ-010, prd §7/F6). `undefined` ⇒ unarmed
   * (the starting state and the well-defined "no gear" path — see `weapons.ts`).
   * Walking onto a {@link Pickup} replaces whatever is here, and the attack path
   * in {@link update} folds the equipped weapon's modifier into every swing via
   * `applyWeapon`. Stored as the `WeaponId` (not the `Weapon`) so the slot stays
   * a plain, serializable discriminant; the catalogue is the source of stats.
   */
  weapon?: WeaponId;
}

/**
 * A transient, render-only record of one hit landing this tick (TQ-015). The
 * simulation writes these as pure OUTPUT each tick — the renderer reads them to
 * spawn juice (flashes, floating damage numbers, screen shake). It is never read
 * back into the rules, so the sim stays pure/deterministic: omitting or ignoring
 * `hitEvents` changes nothing about how the next tick resolves. Plain data (a
 * world cell + damage + a "big hit" flag), so it stays serializable and keeps the
 * sim free of any render-layer import.
 */
export interface HitEvent {
  /** Where the hit landed, in world cells (the struck enemy's position). */
  pos: Vec2;
  /** Damage dealt — shown as the floating number; also scales the shake. */
  amount: number;
  /** True for high-damage hits that should additionally shake the screen. */
  big: boolean;
}

/**
 * A weapon lying on the ground for the player to walk onto and equip (TQ-010,
 * prd §7/F6). Plain data — a world position plus the `WeaponId` it grants — so
 * it stays serializable (TQ-012) and the renderer can draw it data-driven.
 */
export interface Pickup {
  pos: Vec2;
  weaponId: WeaponId;
}

/**
 * The player's home base placed in the world (TQ-013, prd §7/F9): the pure
 * growth value (`base.ts`) anchored to a world tile. The square area within
 * {@link baseRadius} of `pos` (Chebyshev — see {@link inBase}) is home ground:
 * enemies never enter it, contact damage never lands inside it, and hp slowly
 * recovers there — the safe, low-pressure breather the artifact asks for. Plain
 * data so it serializes (TQ-012) and the renderer draws it data-driven.
 */
export interface HomeBase {
  pos: Vec2;
  growth: Base;
}

/**
 * A live enemy: pure `Enemy` stats/position paired with the per-enemy AI
 * bookkeeping the stepper carries between ticks (`entities.ts`). Two plain
 * objects so the whole thing stays serializable for save/load (TQ-012).
 */
export interface LiveEnemy {
  enemy: Enemy;
  ai: EnemyAi;
}

/**
 * The overworld, frozen while the player is inside a dungeon (TQ-014): exactly
 * the world-bound fields the dungeon temporarily replaces, restored wholesale
 * on exit so the surface is precisely as you left it. Player-bound state
 * (stats, level, weapon, boss progress) is deliberately NOT here — what you
 * win below, you keep above.
 */
export interface SuspendedOverworld {
  world: World;
  enemies?: readonly LiveEnemy[];
  pickups?: readonly Pickup[];
  entrances?: readonly Vec2[];
  base?: HomeBase;
}

/**
 * The in-a-dungeon context (TQ-014). Present ⇒ `GameState.world` *is* the
 * dungeon; absent ⇒ the player is on the surface. Carries where to return to
 * (`returnPos`, the entrance tile), which dungeon tile leads back out
 * (`exitPos` — the tile you arrived on), and the suspended overworld itself.
 * Plain data, so the whole push/pop stays serializable and pure.
 */
export interface DungeonState {
  returnPos: Vec2;
  exitPos: Vec2;
  overworld: SuspendedOverworld;
}

export interface GameState {
  world: World;
  player: Player;
  /**
   * Live enemies (TQ-005/006). Optional during incremental wiring — movement-only
   * states omit it. Each tick the simulation resolves attacks against them,
   * advances them toward the player, removes any whose `hp` has reached 0, and
   * converts the slain to player XP (TQ-009).
   */
  enemies?: readonly LiveEnemy[];
  /**
   * Bosses the player has defeated, of the `TOTAL_BOSSES` (the roster length,
   * `data/bosses.ts`) that are the win condition (prd §7/F7). The HUD (TQ-008)
   * renders `bossesDefeated / TOTAL_BOSSES`; {@link update} increments this when a
   * boss is slain and flips {@link GameState.status} to `'victory'` once it hits
   * `TOTAL_BOSSES`. Optional during incremental wiring — a state with no bosses
   * omits it and `update` treats it as 0, so no bosses ⇒ no victory.
   */
  bossesDefeated?: number;
  /**
   * The `id`s (from `data/bosses.ts`) of the bosses defeated so far — the
   * identity twin of {@link GameState.bossesDefeated}, appended in the same
   * cull step so the two can never disagree (count === ids.length once wired).
   * This is what lets a resume keep defeated bosses *dead*: the save persists
   * these ids (TQ-022) and `cli.ts` filters them out of the respawned roster,
   * instead of resurrecting every boss from the seed and letting re-kills
   * double-count toward victory. Optional during incremental wiring, like its
   * twin.
   */
  defeatedBossIds?: readonly string[];
  /**
   * Weapon pickups lying in the world (TQ-010). Optional during incremental
   * wiring — a state with none omits it. Each tick {@link update} equips and
   * removes any pickup the player has stepped onto.
   */
  pickups?: readonly Pickup[];
  /**
   * The home base (TQ-013). Optional during incremental wiring — a state
   * without one has no safe zone and no base buff. {@link update} settles its
   * growth against `bossesDefeated` in the boss-cull step, keeps enemies out of
   * its area, and regenerates hp inside it.
   */
  base?: HomeBase;
  /**
   * Dungeon entrance tiles in the current world (TQ-014). Stepping onto one
   * swaps the run into that entrance's seeded dungeon. Optional — a state with
   * none (including the inside of a dungeon) has nowhere to descend to.
   */
  entrances?: readonly Vec2[];
  /**
   * Present while the player is inside a dungeon (TQ-014): the return/exit
   * tiles plus the suspended overworld to restore on the way out. See
   * {@link DungeonState}.
   */
  dungeon?: DungeonState;
  /**
   * Set when the player tried to attack this tick but lacked the stamina — the
   * data behind the brief "too tired" cue. The HUD surfaces it (TQ-008); for now
   * it makes the stamina gate observable and testable.
   */
  tooTired: boolean;
  /**
   * Run status (TQ-011). Optional/defaulted to `'playing'`; flips to `'victory'`
   * once `bossesDefeated` reaches `TOTAL_BOSSES`. The visible win screen + loop
   * halt land in a later TQ-011 PR.
   */
  status?: GameStatus;
  /**
   * Render-only hit feedback emitted this tick (TQ-015): one entry per enemy that
   * was actually struck by the player's swing, carrying the cell and damage shown.
   * This is pure OUTPUT — {@link update} writes it but never reads it back, so it
   * cannot influence the rules and determinism holds. Optional (mirrors
   * `enemies?`/`pickups?` incremental wiring): a tick with no landed hit omits it,
   * and a renderer that ignores it behaves exactly as before.
   */
  hitEvents?: readonly HitEvent[];
  /** Monotonic simulation tick counter (set by the loop in TQ-002). */
  tick: number;
}

/**
 * A fresh player at `pos`: full hp/stamina drawn from a level-1 {@link
 * createProgression} (so the ceilings and the current values agree), no armour.
 */
export function createPlayer(pos: Vec2): Player {
  const progress = createProgression();
  return {
    pos: { x: pos.x, y: pos.y },
    hp: progress.maxHp,
    stamina: progress.maxStamina,
    def: 0,
    progress,
  };
}

/**
 * Tile lookup that treats anything off the map as solid `'wall'`. The bounds
 * check handles the common out-of-bounds case; the nullish fallback then covers
 * the rest — a `NaN`/fractional coordinate (which slips past every `<`/`>=`
 * comparison) or a short/ragged `tiles` row — so a bad coordinate degrades to
 * "blocked" rather than throwing inside the render hot loop. No live caller
 * passes a bad coordinate today (positions are integers and `generateWorld`
 * builds a rectangular `tiles`), but the fallback retires the unchecked
 * non-null assertions that silently trusted those invariants.
 */
export function tileAt(world: World, x: number, y: number): Tile {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return 'wall';
  return world.tiles[y]?.[x] ?? 'wall';
}

export function isWalkable(world: World, x: number, y: number): boolean {
  return tileAt(world, x, y) === 'floor';
}

/**
 * Is (x, y) inside the base's safe area? Chebyshev distance (a square area, the
 * same metric the charge radius uses) at the tier's {@link baseRadius}. The one
 * containment rule every consumer shares — the enemy no-entry check and the
 * contact-damage exemption in `update`, and the renderer's home-ground tint —
 * so "inside the base" can never mean different things in different layers.
 */
export function inBase(base: HomeBase, x: number, y: number): boolean {
  return (
    Math.max(Math.abs(x - base.pos.x), Math.abs(y - base.pos.y)) <=
    baseRadius(base.growth)
  );
}
