import {
  type GameState,
  type GameStatus,
  type LiveEnemy,
  isWalkable,
} from './state.js';
import {
  type Combatant,
  type RngFn,
  regenStamina,
  resolveAttack,
} from './combat.js';
import { contactDamage, stepEnemy } from './entities.js';
import { createProgression, gainXp, xpForKill } from './progression.js';
import { ATTACKS, type AttackId } from '../data/attacks.js';
import type { Enemy } from './enemy.js';
import { type Boss, TOTAL_BOSSES } from '../data/bosses.js';

/** A player-issued action for one tick. (More variants land in later PRs.) */
export interface MoveIntent {
  type: 'move';
  dx: number;
  dy: number;
}
/** Perform a named attack (`attacks.ts`) centred on the player this tick. */
export interface AttackIntent {
  type: 'attack';
  attackId: AttackId;
}
export type Intent = MoveIntent | AttackIntent;

/** Constant simulation step (ms). The loop always advances by exactly this. */
export const SIM_DT = 1000 / 15;
/** The same step in seconds — the unit enemy speed and stamina regen use. */
export const SIM_DT_SECONDS = SIM_DT / 1000;

/** Stamina recovered per second of real time. A full bar (10) refills in ~3.3s. */
export const STAMINA_REGEN_PER_SEC = 3;

/**
 * The player's combat stats as the engine's {@link Combatant}: current hp /
 * stamina / def from the player, and the ceilings (`maxStamina`) plus `atk` from
 * progression — defaulting a fresh level-1 progression for pre-progression
 * states. This is the single adapter from the player model to combat math.
 */
function playerCombatant(player: GameState['player']): Combatant {
  const progress = player.progress ?? createProgression();
  return {
    pos: player.pos,
    hp: player.hp,
    stamina: player.stamina,
    maxStamina: progress.maxStamina,
    atk: progress.atk,
    def: player.def,
  };
}

/** A boss is an enemy whose archetype tag is `'boss'` (only `createBoss` sets it). */
function isBoss(enemy: Enemy): enemy is Boss {
  return enemy.kind === 'boss';
}

/**
 * The enemy as this tick's movement step should see it: an `enrage` boss below
 * its health threshold moves at a multiple of its speed (the signature
 * behaviour, TQ-011), reusing the move-budget path in {@link stepEnemy} rather
 * than a bespoke one. Every other enemy is returned unchanged. The boosted copy
 * is transient — used only for the step calculation, never stored — so the
 * boss keeps its real `speed` (see the survivors loop below).
 */
function steppingEnemy(enemy: Enemy): Enemy {
  if (
    isBoss(enemy) &&
    enemy.signature.kind === 'enrage' &&
    enemy.hp < enemy.maxHp * enemy.signature.below
  ) {
    return { ...enemy, speed: enemy.speed * enemy.signature.speedMultiplier };
  }
  return enemy;
}

/**
 * Advance the simulation by one tick. PURE: the same (state, intents, dt, rng)
 * always produces the same result — no I/O, no drawing, no `Math.random` (the
 * only randomness is the injected `rng`, consumed solely by attack rolls). This
 * is the heart of the game; the renderer only ever reads what this returns.
 *
 * One tick, in order: the player moves, then optionally attacks (spending
 * stamina and damaging enemies in radius via the combat engine); slain enemies
 * (hp ≤ 0) convert to player XP and leave the world (TQ-009); stamina
 * regenerates; the survivors advance toward the player's new position; and their
 * contact damage chips the player.
 */
export function update(
  state: GameState,
  intents: readonly Intent[],
  dt: number,
  rng: RngFn,
): GameState {
  // --- Intent selection: at most one move and one attack per tick. ---
  // Auto-repeat (holding a key) and the input buffer can queue several intents
  // per step; applying all moves would let the player jump multiple tiles in one
  // tick, breaking the fixed-timestep model. Take the last move (most recent
  // direction) and the last attack, so a mash within one tick is a single swing
  // — the stamina gate, not the buffer depth, is what limits attacking.
  let lastMove: MoveIntent | undefined;
  let lastAttack: AttackIntent | undefined;
  for (const intent of intents) {
    if (intent.type === 'move') lastMove = intent;
    else lastAttack = intent;
  }

  let { x, y } = state.player.pos;
  if (lastMove !== undefined) {
    const { dx, dy } = lastMove;
    if (isWalkable(state.world, x + dx, y + dy)) {
      // Target tile (orthogonal or diagonal) is open — take it.
      x += dx;
      y += dy;
    } else if (dx !== 0 && dy !== 0) {
      // Diagonal blocked: slide along the wall by trying each axis alone, so a
      // blocked corner doesn't make the player stick (TQ-017). Prefer the
      // horizontal step, then the vertical. At an outer corner — where only the
      // diagonal tile is a wall — both orthogonals are open and the horizontal
      // wins: arbitrary but deterministic.
      if (isWalkable(state.world, x + dx, y)) {
        x += dx;
      } else if (isWalkable(state.world, x, y + dy)) {
        y += dy;
      }
    }
  }

  let player = { ...state.player, pos: { x, y } };
  let enemies = state.enemies;
  let tooTired = false;
  let bossesDefeated = state.bossesDefeated ?? 0;
  let status: GameStatus = state.status ?? 'playing';

  // --- Attack: resolve a radius swing against the enemies in reach. ---
  if (lastAttack !== undefined) {
    const spec = ATTACKS[lastAttack.attackId];
    // Enemies aren't Combatants (no stamina of their own), so adapt them to the
    // engine's shape; it only reads pos/hp/def from a target, and `def` comes
    // from the enemy data model so the damage formula has one source.
    const targets: Combatant[] = (enemies ?? []).map(({ enemy }) => ({
      pos: enemy.pos,
      hp: enemy.hp,
      stamina: 0,
      maxStamina: 0,
      atk: enemy.atk,
      def: enemy.def,
    }));
    const result = resolveAttack(playerCombatant(player), targets, spec, rng);
    if (result.blocked) {
      tooTired = true;
    } else {
      // Spend the stamina the engine deducted, and write the rolled damage onto
      // each enemy by index (targets stay in input order).
      player = { ...player, stamina: result.attacker.stamina };
      if (enemies !== undefined) {
        enemies = enemies.map((live, i) => ({
          ...live,
          enemy: { ...live.enemy, hp: result.targets[i]!.hp },
        }));
      }
    }
  }

  // --- Kill → XP, and cull the slain before they move or bite (TQ-009). ---
  if (enemies !== undefined) {
    const slain = enemies.filter(({ enemy }) => enemy.hp <= 0);
    if (slain.length > 0) {
      // Partition by membership, not the complementary `hp > 0`: both predicates
      // are false for a non-finite hp, so a NaN-hp enemy would otherwise vanish.
      enemies = enemies.filter((live) => !slain.includes(live));
      const awarded = slain.reduce(
        (total, { enemy }) => total + xpForKill(enemy),
        0,
      );
      player = {
        ...player,
        progress: gainXp(player.progress ?? createProgression(), awarded),
      };

      // Bosses are slain through the same path as a normal enemy; count the
      // ones that fell this tick and declare victory once `TOTAL_BOSSES` (the
      // roster length — the same denominator the HUD shows) are down (TQ-011).
      // Gated on a boss actually dying this tick, so a no-boss game never wins;
      // the `> 0` guard keeps an empty roster from auto-winning at 0/0.
      const slainBosses = slain.filter(({ enemy }) => isBoss(enemy)).length;
      if (slainBosses > 0) {
        bossesDefeated += slainBosses;
        if (TOTAL_BOSSES > 0 && bossesDefeated >= TOTAL_BOSSES) {
          status = 'victory';
        }
      }
    }
  }

  // --- Stamina regen (after spending), so a mash nets a drain. ---
  player = {
    ...player,
    stamina: regenStamina(playerCombatant(player), STAMINA_REGEN_PER_SEC * dt)
      .stamina,
  };

  // --- Survivors advance toward the player's new position. ---
  if (enemies !== undefined) {
    const walkable = (ex: number, ey: number): boolean =>
      isWalkable(state.world, ex, ey);
    enemies = enemies.map((live): LiveEnemy => {
      const next = stepEnemy(
        steppingEnemy(live.enemy),
        live.ai,
        player.pos,
        walkable,
        dt,
      );
      // Take only the new position back onto the real enemy, so a transient
      // enrage speed boost (steppingEnemy) never persists on the stored entity.
      return { enemy: { ...live.enemy, pos: next.enemy.pos }, ai: next.ai };
    });

    // --- Contact damage: adjacent enemies chip the player (floored at 0). ---
    // NB: contactDamage is flat-per-tick (TQ-005 contract, entities.ts), unlike
    // the dt-scaled movement/regen above — so its effective DPS scales with the
    // tick rate. Fine while the tick rate is fixed; reconcile when death/HUD
    // lands (TQ-008).
    let contact = 0;
    for (const { enemy } of enemies) {
      contact += contactDamage(enemy, player.pos);
    }
    if (contact > 0) {
      player = { ...player, hp: Math.max(0, player.hp - contact) };
    }
  }

  return {
    ...state,
    player,
    enemies,
    tooTired,
    bossesDefeated,
    status,
    tick: state.tick + 1,
  };
}
