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

export interface Vec2 {
  x: number;
  y: number;
}

export type Tile = 'floor' | 'wall';

/**
 * Run status: `'playing'` normally, `'victory'` once every placed boss is
 * defeated (TQ-011). The visible win screen + loop halt land in a later TQ-011
 * PR; this flag is the sim-side trigger they react to.
 */
export type GameStatus = 'playing' | 'victory';

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
 * A weapon lying on the ground for the player to walk onto and equip (TQ-010,
 * prd §7/F6). Plain data — a world position plus the `WeaponId` it grants — so
 * it stays serializable (TQ-012) and the renderer can draw it data-driven.
 */
export interface Pickup {
  pos: Vec2;
  weaponId: WeaponId;
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
   * Weapon pickups lying in the world (TQ-010). Optional during incremental
   * wiring — a state with none omits it. Each tick {@link update} equips and
   * removes any pickup the player has stepped onto.
   */
  pickups?: readonly Pickup[];
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

/** Tile lookup that treats out-of-bounds as solid wall. */
export function tileAt(world: World, x: number, y: number): Tile {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return 'wall';
  return world.tiles[y]![x]!;
}

export function isWalkable(world: World, x: number, y: number): boolean {
  return tileAt(world, x, y) === 'floor';
}
