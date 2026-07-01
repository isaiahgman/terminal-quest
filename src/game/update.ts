import {
  type GameState,
  type GameStatus,
  type HitEvent,
  type LiveEnemy,
  inBase,
  isWalkable,
} from './state.js';
import { baseHpBonus, growBase } from './base.js';
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
import { WEAPONS, applyWeapon } from '../data/weapons.js';

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
 * Hp recovered per second while standing on home ground (TQ-013) — the base's
 * "breather" made tangible: retreat home, catch your breath, wade back in.
 * Deliberately gentle (a full level-1 bar takes ~10s) so the base is a
 * recovery anchor, not an in-combat heal — enemies can't follow you in, so the
 * cost of using it is the walk, not the risk.
 */
export const BASE_HP_REGEN_PER_SEC = 2;

/**
 * The player's effective max hp: the progression ceiling plus the home base's
 * tier buff (TQ-013) — the one place the two growth axes meet. States without
 * progression default the fresh level-1 ceiling (the usual idiom); states
 * without a base get no bonus.
 */
function effectiveMaxHp(
  player: GameState['player'],
  base: GameState['base'],
): number {
  const ceiling = player.progress?.maxHp ?? createProgression().maxHp;
  return ceiling + (base === undefined ? 0 : baseHpBonus(base.growth));
}

/**
 * Damage at or above which a single landed hit is flagged "big" — the render
 * layer (TQ-015) turns a big hit into a screen shake on top of the usual flash +
 * floating number. Co-located here with the other balance knobs (per CLAUDE.md):
 * it's pure presentation, never read back into the rules, so tuning it can only
 * change how a hit *feels*, never what the sim does. Tune by playing.
 */
export const BIG_HIT_DAMAGE = 8;

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

/**
 * An enemy as the combat engine's {@link Combatant} target. {@link resolveAttack}
 * only reads `pos`/`hp`/`def` off a target, but the shape also carries stamina
 * fields — enemies have no stamina of their own, so they're zeroed. The enemy
 * twin of {@link playerCombatant}: one named adapter from the entity model to
 * combat math, rather than an anonymous inline object literal.
 */
function enemyCombatant(enemy: Enemy): Combatant {
  return {
    pos: enemy.pos,
    hp: enemy.hp,
    stamina: 0,
    maxStamina: 0,
    atk: enemy.atk,
    def: enemy.def,
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
  let pickups = state.pickups;
  let tooTired = false;
  let bossesDefeated = state.bossesDefeated ?? 0;
  let defeatedBossIds = state.defeatedBossIds;
  let base = state.base;
  let status: GameStatus = state.status ?? 'playing';
  // Render-only hit feedback for this tick (TQ-015); populated below from the
  // attack outcomes, then handed back on the returned state as pure OUTPUT.
  let hitEvents: HitEvent[] = [];

  // --- Pickups: walking onto a weapon equips it to the single slot (TQ-010). ---
  // Done after the move (so the player must reach the tile) and before the attack
  // (so the swing this tick already swings the new weapon). The last matching
  // pickup wins if several stack on one tile — the slot holds exactly one — and
  // every picked-up tile is cleared, so a pile is consumed in a single step.
  if (pickups !== undefined) {
    const here = pickups.filter(
      (p) => p.pos.x === player.pos.x && p.pos.y === player.pos.y,
    );
    if (here.length > 0) {
      player = { ...player, weapon: here[here.length - 1]!.weaponId };
      pickups = pickups.filter((p) => !here.includes(p));
    }
  }

  // --- Attack: resolve a radius swing against the enemies in reach. ---
  if (lastAttack !== undefined) {
    // Fold the equipped weapon into the chosen attack before the engine resolves
    // it — reusing the combat damage path, never forking it (TQ-010 constraint).
    // Unarmed (`player.weapon` undefined) returns the attack unchanged.
    const spec = applyWeapon(
      ATTACKS[lastAttack.attackId],
      player.weapon === undefined ? undefined : WEAPONS[player.weapon],
    );
    // Enemies aren't Combatants (no stamina of their own), so adapt them to the
    // engine's shape; it only reads pos/hp/def from a target, and `def` comes
    // from the enemy data model so the damage formula has one source.
    const targets: Combatant[] = (enemies ?? []).map(({ enemy }) =>
      enemyCombatant(enemy),
    );
    const result = resolveAttack(playerCombatant(player), targets, spec, rng);
    if (result.blocked) {
      tooTired = true;
    } else {
      // Spend the stamina the engine deducted, and write the rolled damage onto
      // each enemy by index (targets stay in input order).
      player = { ...player, stamina: result.attacker.stamina };
      if (enemies !== undefined) {
        const struck = enemies;
        enemies = struck.map((live, i) => ({
          ...live,
          enemy: { ...live.enemy, hp: result.targets[i]!.hp },
        }));
        // Emit a render-only hit event per landed hit (TQ-015). Outcome `index`
        // points back into the targets/enemies array (same order), so we read the
        // struck enemy's pre-move position for the flash/number anchor. OUTPUT
        // only — never read back, so the sim stays pure/deterministic.
        hitEvents = result.outcomes
          .filter((o) => o.hit)
          .map((o): HitEvent => {
            const pos = struck[o.index]!.enemy.pos;
            return {
              pos: { x: pos.x, y: pos.y },
              amount: o.damage,
              big: o.damage >= BIG_HIT_DAMAGE,
            };
          });
      }
    }
  }

  // --- Kill → XP, and cull the slain before they move or bite (TQ-009). ---
  if (enemies !== undefined) {
    const slain = enemies.filter(({ enemy }) => enemy.hp <= 0);
    if (slain.length > 0) {
      // Survivors are the exact negation of the slain predicate — NOT `hp > 0`.
      // For a non-finite hp both `hp <= 0` and `hp > 0` are false, so `hp > 0`
      // would silently drop a NaN-hp enemy; `!(hp <= 0)` keeps it (the same
      // partition `slain` used). This negated-predicate filter also avoids the
      // O(n*m) `slain.includes(live)` that coupled correctness to object
      // identity surviving the upstream attack-resolution map.
      enemies = enemies.filter(({ enemy }) => !(enemy.hp <= 0));
      const awarded = slain.reduce(
        (total, { enemy }) => total + xpForKill(enemy),
        0,
      );
      const priorLevel = player.progress?.level ?? 1;
      player = {
        ...player,
        progress: gainXp(player.progress ?? createProgression(), awarded),
      };

      // Bosses are slain through the same path as a normal enemy; count the
      // ones that fell this tick and declare victory once `TOTAL_BOSSES` (the
      // roster length — the same denominator the HUD shows) are down (TQ-011).
      // Gated on a boss actually dying this tick, so a no-boss game never wins;
      // the `> 0` guard keeps an empty roster from auto-winning at 0/0.
      // Identity is recorded alongside the count (`defeatedBossIds`, the
      // count's twin — see `state.ts`), appended here and nowhere else, so the
      // save can keep dead bosses dead across a resume (TQ-022).
      const slainBossIds = slain
        .map(({ enemy }) => enemy)
        .filter(isBoss)
        .map((boss) => boss.id);
      if (slainBossIds.length > 0) {
        bossesDefeated += slainBossIds.length;
        defeatedBossIds = [...(defeatedBossIds ?? []), ...slainBossIds];
        // The home base grows on the same signal (TQ-013): settle its tier
        // against the new count here — the only place the count rises — so the
        // home visibly levels up the tick the boss falls. growBase is
        // monotonic, so this only ever steps the base up.
        if (base !== undefined) {
          base = { ...base, growth: growBase(base.growth, bossesDefeated) };
        }
        if (TOTAL_BOSSES > 0 && bossesDefeated >= TOTAL_BOSSES) {
          status = 'victory';
        }
      }

      // Level-up power surge (TQ-023): a level you earn must be *felt*, not just
      // banked as headroom. `gainXp` raised the hp/stamina ceilings; on any level
      // gain, refill current hp/stamina to the new caps so the HUD jumps and you
      // come out of the grind measurably stronger (prd §2). Full-refill policy;
      // a multi-level gain heals once, to the final caps. `atk` already applies
      // live, so the offensive half of the surge needed nothing here. The hp
      // ceiling includes the base's tier buff (TQ-013); this runs after the
      // boss/base block so a boss kill that levels you refills to the ceiling
      // the kill just grew.
      const leveledTo = player.progress?.level ?? 1;
      if (leveledTo > priorLevel) {
        player = {
          ...player,
          hp: effectiveMaxHp(player, base),
          stamina: player.progress?.maxStamina ?? player.stamina,
        };
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
    // Home ground is impassable to enemies (TQ-013): the safe zone is enforced
    // where they *step*, so the swarm parts around the base rather than needing
    // a bespoke AI mode. An enemy the growing zone swallows can still step OUT
    // (its target tile is outside), so nothing gets permanently entombed.
    const home = base; // narrow once for the closure
    const walkable = (ex: number, ey: number): boolean =>
      isWalkable(state.world, ex, ey) &&
      (home === undefined || !inBase(home, ex, ey));
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
    // contactDamage is flat-per-tick by design (TQ-023): unlike the dt-scaled
    // movement/regen above, contact DPS is `atk × tickRate`, an accepted
    // invariant while SIM_DT is fixed. A dt-scaled rate was rejected — it can't
    // reproduce today's exact integer damage in IEEE-754. See contactDamage in
    // entities.ts; revisit both if SIM_DT ever becomes tunable.
    // No contact damage lands on home ground (TQ-013) — enemies can't enter the
    // zone, but one standing just outside its edge is still adjacent to a player
    // standing just inside; the exemption is what makes the base actually safe.
    const playerHome =
      base !== undefined && inBase(base, player.pos.x, player.pos.y);
    if (!playerHome) {
      let contact = 0;
      for (const { enemy } of enemies) {
        contact += contactDamage(enemy, player.pos);
      }
      if (contact > 0) {
        player = { ...player, hp: Math.max(0, player.hp - contact) };
      }
    }
  }

  // --- Home ground heals (TQ-013): the breather, made tangible. Gentle regen
  // toward the effective ceiling (progression + base buff); safe because the
  // zone already blocks entry and contact, so this can never tug against
  // same-tick damage. ---
  if (base !== undefined && inBase(base, player.pos.x, player.pos.y)) {
    const ceiling = effectiveMaxHp(player, base);
    if (player.hp < ceiling) {
      player = {
        ...player,
        hp: Math.min(ceiling, player.hp + BASE_HP_REGEN_PER_SEC * dt),
      };
    }
  }

  // --- Defeat: hp depleted ends the run (TQ-020). Sticky like victory, and set
  // only while still 'playing' so that clearing the last boss *this same tick*
  // (a 'victory' set in the cull step above) is never overridden by a
  // simultaneous contact death — if you won, you won. The visible defeat screen
  // and the loop halt are a later TQ-020 PR; this is just the sim-side trigger,
  // set-but-not-yet-presented exactly like 'victory'. (`<= 0` excludes a
  // non-finite hp, matching the engine's NaN-fails-safe stance.) ---
  if (status === 'playing' && player.hp <= 0) {
    status = 'defeat';
  }

  return {
    ...state,
    player,
    enemies,
    pickups,
    tooTired,
    bossesDefeated,
    defeatedBossIds,
    base,
    status,
    hitEvents,
    tick: state.tick + 1,
  };
}
